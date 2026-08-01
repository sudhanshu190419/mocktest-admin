-- ============================================================================
-- Migration: 077 — Trusted Devices
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: trusted_devices
--
-- Depends on: Domain 01 (institutes, profiles)
--             Existing enums (user_role)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin)
--             Migration 074 (is_super_admin)
--
-- ## Purpose
--
-- Database foundation for the Trusted Device Login system (Phase 7A design).
-- Academic Admins and Finance Admins must have their devices approved by a
-- Super Admin before accessing the admin workspace. Super Admins bypass the
-- approval workflow.
--
-- This migration is DATABASE ONLY:
--   • No frontend changes
--   • No authentication changes (sign-in flow is untouched)
--   • No Edge Functions yet (Phase 7C)
--   • No audit triggers (existing auditService + write_audit_log() will be
--     used by the business layer in later phases)
--   • No triggers enforcing a single approved device — that rule belongs to
--     the business layer (Edge Function) and is intentionally NOT enforced
--     here. Multiple PENDING requests are allowed; only one device may ever
--     be approved, and approving a new device must automatically revoke the
--     previous approved device (implemented in Phase 7C).
--
-- ## New Enum Type
--
--   trusted_device_status — pending | approved | rejected | revoked | expired | inactive
--
--   • pending   — waiting for super admin approval
--   • approved  — active, trusted
--   • rejected  — denied by super admin
--   • revoked   — previously approved, now removed
--   • expired   — expires_at passed (auto-expiry)
--   • inactive  — no longer active (e.g. admin account deactivated)
--
-- ## RLS Model
--
--   Super Admin    → full CRUD on trusted_devices (within their institute)
--   Device owner   → SELECT only their OWN trusted_devices rows
--                    (cannot approve / reject / revoke / update status)
--   Teachers       → no access
--   Students       → no access
--
-- ## Notification Support
--
-- Extends notification_event_type with:
--   device_approval_requested — "a device is waiting for your approval"
--   device_approved           — "your device has been approved"
--   device_rejected           — "your device request was rejected"
--
-- ## Backward Compatibility
--
-- The migration is fully idempotent (DO blocks / IF NOT EXISTS) and changes
-- nothing about existing authentication, RBAC, or the login flow. Existing
-- systems continue to work unchanged.
--
-- ## Order
--
--   1. Create enum type (idempotent)
--   2. Create trusted_devices table
--   3. Create indexes
--   4. Enable RLS and create policies
--   5. Create triggers (set_updated_at only)
--   6. Extend notification_event_type enum
--   7. Add comments
--
-- Reference: Documentation/Trusted_Device_Security_Architecture.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Enum Type (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Wrapped in a DO block so re-running the migration never fails with
-- "type already exists" (matches the pattern from Domain 01 migration 002).

-- 1a. trusted_device_status — lifecycle state of a trusted device
do $$
begin
  if not exists (select 1 from pg_type where typname = 'trusted_device_status') then
    create type public.trusted_device_status as enum (
      'pending',
      'approved',
      'rejected',
      'revoked',
      'expired',
      'inactive'
    );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE: trusted_devices
-- ════════════════════════════════════════════════════════════════════════════
--
-- One row per device enrolled by an admin. The device token itself is never
-- stored — only its SHA-256 hash (device_token_hash), so a database leak
-- cannot be replayed as a valid device token.
--
-- Column design follows the Domain 17/18 pattern:
--   - Surrogate UUID PK (referenced by future audit records)
--   - institute_id denormalized for RLS performance and multi-tenant isolation
--   - Audit fields (created_at, updated_at)

create table public.trusted_devices (
  -- Primary Key (surrogate UUID)
  device_id             uuid                  not null  default gen_random_uuid(),

  -- The admin profile that owns this device (Academic/Finance Admin; Super
  -- Admin devices are recorded for audit visibility but never gated).
  profile_id            uuid                  not null,

  -- Denormalized for RLS performance and multi-tenant isolation.
  -- Populated from profiles.institute_id at enrollment time.
  institute_id          uuid                  not null,

  -- SHA-256 hex of the random device token (256-bit). The plaintext token
  -- lives only in the HttpOnly td_device cookie; never in the database.
  device_token_hash     text                  not null,

  -- Human-friendly device label, e.g. 'Chrome on Windows 11'.
  device_name           text                  not null,

  -- Coarse fingerprint hash (UA family + OS + screen + timezone). Signal
  -- only — never used as an identity identifier.
  fingerprint_hash      text                  null      default null,

  -- Raw user agent captured at enrollment (display / anomaly signal).
  user_agent            text                  null      default null,

  -- Most recently seen IP (refreshed on each trusted challenge). Audit +
  -- anomaly signal only — never an identity identifier. NOT a permanent
  -- device IP, hence the last_ prefix.
  last_ip_address       inet                  null      default null,

  -- Lifecycle state. New devices start as 'pending' until a super admin
  -- approves them (Phase 7C Edge Function).
  status                public.trusted_device_status  not null  default 'pending',

  -- UTC timestamp when the device enrollment request was submitted.
  requested_at          timestamptz           not null  default now(),

  -- UTC timestamp when the super admin approved this device. NULL until
  -- status becomes 'approved'.
  approved_at           timestamptz           null      default null,

  -- FK to profiles: the super admin who approved this device. NULL while
  -- pending / for system rows.
  approved_by           uuid                  null      default null,

  -- UTC timestamp of the last successful trusted challenge (touch on use).
  last_used_at          timestamptz           null      default null,

  -- Optional per-device expiry. NULL = no expiry. When set and in the past,
  -- the device is treated as 'expired' (checked on every challenge).
  expires_at            timestamptz           null      default null,

  -- Free-text reason for a rejection (super admin note). NULL otherwise.
  rejection_reason      text                  null      default null,

  -- Audit fields
  created_at            timestamptz           not null  default now(),
  updated_at            timestamptz           not null  default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_trusted_devices primary key (device_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to profiles: the admin who owns this device
  -- RESTRICT on delete — prevents silently losing device trust records
  constraint fk_trusted_devices_profile
    foreign key (profile_id) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant isolation
  -- RESTRICT on delete — prevents cascade deletion of institute data
  constraint fk_trusted_devices_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: the super admin who approved this device
  -- SET NULL on profile soft-delete preserves the device record
  constraint fk_trusted_devices_approved_by
    foreign key (approved_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: the same device token can never be enrolled twice for the
  -- same profile. Also creates a backing B-tree index for lookups by
  -- (profile_id, device_token_hash).
  constraint uq_trusted_devices_profile_token unique (profile_id, device_token_hash),

  -- ── CHECK Constraints ────────────────────────────────────────────────
  -- Approval consistency, enforced bidirectionally:
  --   • status = 'approved' ⇒ approved_at IS NOT NULL
  --   • every other status (pending, rejected, revoked, expired, inactive)
  --     ⇒ approved_at IS NULL
  -- This prevents inconsistent data — an approval timestamp can only exist
  -- on the currently approved device.
  constraint ck_trusted_devices_approved check (
    (status = 'approved'::public.trusted_device_status and approved_at is not null)
    or (
      status in (
        'pending'::public.trusted_device_status,
        'rejected'::public.trusted_device_status,
        'revoked'::public.trusted_device_status,
        'expired'::public.trusted_device_status,
        'inactive'::public.trusted_device_status
      )
      and approved_at is null
    )
  ),

  -- Token hygiene: SHA-256 in hex is exactly 64 characters; base64url is 43.
  -- Allow a small range so future hash algorithms don't break the column.
  constraint ck_trusted_devices_token_length check (
    char_length(device_token_hash) between 43 and 128
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints
-- (the unique constraint on (profile_id, device_token_hash) already serves
-- token lookups where profile_id is the leading column).

-- Institute-scoped status queries: super admin approval queue and
-- trusted-devices management screens.
create index if not exists idx_trusted_devices_institute_status
  on public.trusted_devices (institute_id, status);

-- Owner-scoped queries: "My Devices" screen for an admin.
create index if not exists idx_trusted_devices_profile_status
  on public.trusted_devices (profile_id, status);

-- Pending-approval queue (partial index): super admin dashboard ordering
-- by most recent request.
create index if not exists idx_trusted_devices_pending
  on public.trusted_devices (institute_id, requested_at desc)
  where status = 'pending'::public.trusted_device_status;

-- Approved-device lookups: challenge-time "is this token approved?" checks
-- and future "auto-revoke previous approved device" business queries.
create index if not exists idx_trusted_devices_profile_approved
  on public.trusted_devices (profile_id)
  where status = 'approved'::public.trusted_device_status;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 4a. Enable RLS
alter table public.trusted_devices enable row level security;

-- 4b. Super admin: full CRUD within their institute
--      Super admins can view, approve, reject, revoke and expire trusted
--      devices for their own institute. Uses the existing is_super_admin()
--      helper from migration 074 (SECURITY DEFINER — no recursion risk).
--      CREATE POLICY has no IF NOT EXISTS clause (PostgreSQL), so a
--      DROP POLICY IF EXISTS guard precedes it to keep the migration
--      fully idempotent / re-runnable.
drop policy if exists "Super admins can manage trusted_devices" on public.trusted_devices;
create policy "Super admins can manage trusted_devices"
  on public.trusted_devices
  for all
  to authenticated
  using (public.is_super_admin() and institute_id = public.get_my_institute_id())
  with check (public.is_super_admin() and institute_id = public.get_my_institute_id());

-- 4c. Device owner: read ONLY their OWN trusted_devices rows
--      Academic/Finance Admins can see their own devices (including PENDING
--      requests, so "your device is awaiting approval" can render in the
--      UI). They CANNOT approve, reject, revoke or update status — status
--      changes happen exclusively through the Phase 7C Edge Functions
--      (service role) and the super-admin policy above.
--      trusted_devices.profile_id references profiles.profile_id (NOT
--      auth.users.id), so the owner match is resolved through the profiles
--      table — the same pattern used elsewhere in the project — rather than
--      comparing directly against auth.uid(). Gated by is_admin()
--      (profiles.role = 'admin', SECURITY DEFINER, no recursion risk) so
--      teachers/students can never read this table.
--      DROP POLICY IF EXISTS guard keeps the migration re-runnable.
drop policy if exists "Device owners can read their own trusted_devices" on public.trusted_devices;
create policy "Device owners can read their own trusted_devices"
  on public.trusted_devices
  for select
  to authenticated
  using (
    profile_id = (select profile_id from public.profiles where profile_id = auth.uid())
    and public.is_admin()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Triggers
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. updated_at maintenance (uses set_updated_at() from migration 002)
--      NOTE: intentionally NO trigger enforcing a single approved device —
--      that rule belongs to the business layer (Phase 7C Edge Function),
--      which will auto-revoke the previous approved device when a new one
--      is approved.
--      CREATE TRIGGER has no IF NOT EXISTS clause (PostgreSQL), so a
--      DROP TRIGGER IF EXISTS guard keeps the migration re-runnable.
drop trigger if exists trg_trusted_devices_set_updated_at on public.trusted_devices;
create trigger trg_trusted_devices_set_updated_at
  before update on public.trusted_devices
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Notification Event Types
-- ════════════════════════════════════════════════════════════════════════════
-- Extends the notification_event_type enum (Domain 09, migration 010) with
-- the trusted-device workflow events. Uses the exact same idempotent pattern
-- as migrations 047 / 054 / 055.

alter type public.notification_event_type add value if not exists 'device_approval_requested';
alter type public.notification_event_type add value if not exists 'device_approved';
alter type public.notification_event_type add value if not exists 'device_rejected';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 7a. Table comments
comment on table public.trusted_devices is
  'Trusted device enrollments for admin accounts. One row per device. The '
  'device token itself is never stored — only its SHA-256 hash. Academic and '
  'Finance Admins require Super Admin approval for each new device; Super '
  'Admins bypass approval. Only one device per profile may be approved at a '
  'time (enforced in the business layer, not by triggers). Writes are '
  'performed exclusively by the Phase 7C Edge Functions (service role) and '
  'by super admins through RLS.' ;

-- 7b. Column comments
comment on column public.trusted_devices.device_id is
  'Surrogate primary key. Generated via gen_random_uuid().' ;

comment on column public.trusted_devices.profile_id is
  'FK to profiles.profile_id. The admin profile that owns this device. '
  'RESTRICT on delete — prevents silently losing device trust records.' ;

comment on column public.trusted_devices.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from profiles.institute_id at enrollment time.' ;

comment on column public.trusted_devices.device_token_hash is
  'SHA-256 hash of the 256-bit random device token. The plaintext token '
  'exists only in the HttpOnly td_device cookie and is never persisted, so '
  'a database leak cannot be replayed as a valid device token.' ;

comment on column public.trusted_devices.device_name is
  'Human-friendly device label, e.g. Chrome on Windows 11.' ;

comment on column public.trusted_devices.fingerprint_hash is
  'Coarse fingerprint hash (UA family + OS + screen + timezone). Signal '
  'only — never used as an identity identifier.' ;

comment on column public.trusted_devices.user_agent is
  'Raw user agent captured at enrollment. Display and anomaly signal only.' ;

comment on column public.trusted_devices.last_ip_address is
  'Most recently seen IP, refreshed on each trusted challenge. Audit and '
  'anomaly signal only — never an identity identifier (mobile NAT, office '
  'Wi-Fi, VPN and dynamic ISPs make IP unreliable). Named last_ip_address '
  'to reflect that it stores the most recent IP rather than a permanent '
  'device IP.' ;

comment on column public.trusted_devices.status is
  'Lifecycle state: pending (awaiting super admin approval), approved '
  '(active/trusted), rejected (denied), revoked (previously approved, now '
  'removed), expired (expires_at passed), inactive (no longer active, e.g. '
  'admin account deactivated).' ;

comment on column public.trusted_devices.requested_at is
  'UTC timestamp when the device enrollment request was submitted.' ;

comment on column public.trusted_devices.approved_at is
  'UTC timestamp when the super admin approved this device. Per '
  'ck_trusted_devices_approved: non-NULL only when status = approved; '
  'every other status must keep this NULL.' ;

comment on column public.trusted_devices.approved_by is
  'FK to profiles.profile_id. The super admin who approved this device. '
  'SET NULL on profile soft-delete preserves the device record.' ;

comment on column public.trusted_devices.last_used_at is
  'UTC timestamp of the last successful trusted challenge (touched on '
  'use). NULL until the device is first used after approval.' ;

comment on column public.trusted_devices.expires_at is
  'Optional per-device expiry. NULL = no expiry. When set and in the past, '
  'the device is treated as expired on the next challenge.' ;

comment on column public.trusted_devices.rejection_reason is
  'Free-text reason for a rejection, provided by the super admin. NULL '
  'otherwise.' ;

comment on column public.trusted_devices.created_at is
  'UTC timestamp when the trusted_devices row was created (enrollment '
  'request submitted).' ;

comment on column public.trusted_devices.updated_at is
  'UTC timestamp of the last modification. Maintained by the '
  'trg_trusted_devices_set_updated_at trigger.' ;

-- 7c. Constraint comments
comment on constraint uq_trusted_devices_profile_token on public.trusted_devices is
  'Enforces: the same device token can never be enrolled twice for the same '
  'profile. Prevents duplicate enrollments from a replay/retry.' ;

comment on constraint ck_trusted_devices_approved on public.trusted_devices is
  'Approval consistency, enforced bidirectionally: status = approved '
  'requires approved_at IS NOT NULL, and every other status (pending, '
  'rejected, revoked, expired, inactive) requires approved_at IS NULL. '
  'Prevents an approval timestamp existing on any device other than the '
  'currently approved one.' ;

comment on constraint ck_trusted_devices_token_length on public.trusted_devices is
  'Token hygiene: the stored hash must be between 43 and 128 characters '
  '(SHA-256 hex is 64; base64url is 43).' ;

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after migration)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Enum values:
--    select enumlabel from pg_enum
--    join pg_type on pg_type.oid = pg_enum.enumtypid
--    where pg_type.typname = 'trusted_device_status';
--    → Expect: pending, approved, rejected, revoked, expired, inactive
--
-- 2. Table creation:
--    select column_name, data_type, is_nullable
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'trusted_devices'
--    order by ordinal_position;
--    → Expect 17 columns (device_id … updated_at).
--
-- 3. Indexes:
--    select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'trusted_devices'
--    order by indexname;
--    → Expect: idx_trusted_devices_institute_status,
--      idx_trusted_devices_pending, idx_trusted_devices_profile_approved,
--      idx_trusted_devices_profile_status, pk_trusted_devices,
--      uq_trusted_devices_profile_token.
--
-- 4. RLS policies:
--    select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'trusted_devices'
--    order by policyname;
--    → Expect: "Device owners can read their own trusted_devices",
--      "Super admins can manage trusted_devices".
--
-- 5. RLS: teachers/students cannot see trusted_devices:
--    -- run as a teacher/student session
--    select * from public.trusted_devices;
--    → Expect 0 rows.
--
-- 6. RLS: non-super admin can only read their own rows:
--    -- run as an academic/finance admin session
--    select * from public.trusted_devices;
--    → Expect only rows whose profile_id matches the current user's
--      profile_id resolved via profiles (NOT auth.uid() directly).
--
-- 7. Notification enum values:
--    select enumlabel from pg_enum
--    join pg_type on pg_type.oid = pg_enum.enumtypid
--    where pg_type.typname = 'notification_event_type'
--    and enumlabel like 'device_%';
--    → Expect: device_approval_requested, device_approved, device_rejected.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 077 must be reverted BEFORE any Phase 7C code depends on it):
--
--   -- 1. Drop RLS policies
--   drop policy if exists "Super admins can manage trusted_devices" on public.trusted_devices;
--   drop policy if exists "Device owners can read their own trusted_devices" on public.trusted_devices;
--
--   -- 2. Drop trigger
--   drop trigger if exists trg_trusted_devices_set_updated_at on public.trusted_devices;
--
--   -- 3. Drop table (cascades indexes)
--   drop table if exists public.trusted_devices cascade;
--
--   -- 4. Drop enum type
--   drop type if exists public.trusted_device_status;
--
--   -- 5. Remove notification enum values (PostgreSQL 12+ single-statement
--   --    ALTER TYPE ... DROP VALUE — the enum must not be in use)
--   alter type public.notification_event_type drop value if exists 'device_rejected';
--   alter type public.notification_event_type drop value if exists 'device_approved';
--   alter type public.notification_event_type drop value if exists 'device_approval_requested';
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 077 Trusted Devices
-- ════════════════════════════════════════════════════════════════════════════
