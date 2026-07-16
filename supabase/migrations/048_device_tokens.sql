-- ============================================================================
-- Migration: 048 — Device Tokens (FCM Token Persistence)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Stores FCM registration tokens for push notification targeting. Each row
-- represents one authenticated device session. The same physical device may
-- have multiple rows over time (e.g. after re-install or token rotation), but
-- only one row per fcm_token is active at any given time via the UNIQUE
-- constraint on fcm_token.
--
-- Key design decisions:
--   • One user can have multiple devices (rows) — no unique constraint on
--     profile_id alone.
--   • fcm_token is globally UNIQUE — each token identifies a unique device
--     + app installation combination per Firebase guarantees.
--   • Upsert via ON CONFLICT (fcm_token) — prevents duplicate token rows
--     when the same device registers again (e.g. after logout → login).
--   • is_active = false on logout or when token becomes invalid — preserves
--     the token record for audit and future analytics.
--     Records are never physically deleted.
--   • RLS enables row-level security: users can only manage their own
--     device tokens. Service role bypasses RLS for admin operations.
--
-- Dependencies:
--   Migration 002 — Domain 01 Foundation (profiles table, set_updated_at fn)
--
-- Safety:
--   Idempotent — all CREATE IF NOT EXISTS and DROP IF EXISTS patterns.
--   Safe to apply even if the mobile app's 047 migration already created
--   this table.
--
-- Reference: Phase 2 — FCM Device Token Registration
--            MockTestApp migration 047_device_tokens.sql
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — CREATE TABLE
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.device_tokens (
  -- Primary Key
  token_id      uuid                      not null  default gen_random_uuid(),

  -- Foreign Key: owning user profile
  profile_id    uuid                      not null,

  -- FCM token (globally unique per Firebase guarantees)
  fcm_token     text                      not null,

  -- Device platform
  platform      text                      not null
                constraint ck_device_tokens_platform
                  check (platform in ('android', 'ios')),

  -- Optional human-readable device name (e.g. "Samsung Galaxy S24")
  device_name   text                      null      default null,

  -- App version at the time of registration
  app_version   text                      null      default null,

  -- Whether this token is actively receiving notifications
  is_active     boolean                   not null  default true,

  -- Last time this device contacted the server
  last_seen_at  timestamptz               not null  default now(),

  -- Timestamps
  created_at    timestamptz               not null  default now(),
  updated_at    timestamptz               not null  default now(),

  -- Primary Key constraint
  constraint pk_device_tokens primary key (token_id),

  -- Foreign Key constraint
  constraint fk_device_tokens_profile
    foreign key (profile_id) references public.profiles (profile_id)
    on delete cascade
    on update restrict,

  -- Unique constraint: prevent duplicate fcm_token rows
  constraint uq_device_tokens_fcm_token unique (fcm_token)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints.

-- Index for querying all devices for a user
create index if not exists idx_device_tokens_profile_id
  on public.device_tokens (profile_id);

-- Partial index: efficiently find active tokens for push dispatch
create index if not exists idx_device_tokens_profile_active
  on public.device_tokens (profile_id, is_active)
  where is_active = true;

-- Index for token-level lookups during push delivery
create index if not exists idx_device_tokens_fcm_token
  on public.device_tokens (fcm_token);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Trigger: set_updated_at
-- ════════════════════════════════════════════════════════════════════════════
-- Uses the existing public.set_updated_at() function from Domain 01.

drop trigger if exists trg_device_tokens_set_updated_at on public.device_tokens;

create trigger trg_device_tokens_set_updated_at
  before update on public.device_tokens
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Row-Level Security (RLS)
-- ════════════════════════════════════════════════════════════════════════════
-- Users can only manage their own device tokens.
-- Service role bypasses RLS (Supabase default for service_role API key).

-- 4a. Enable RLS on the table
alter table public.device_tokens enable row level security;

-- 4b. Policy: Users can SELECT their own device tokens
drop policy if exists "Users can view their own device tokens"
  on public.device_tokens;

create policy "Users can view their own device tokens"
  on public.device_tokens
  for select
  to authenticated
    using (profile_id = auth.uid());

-- 4c. Policy: Users can INSERT their own device tokens
drop policy if exists "Users can register their own device tokens"
  on public.device_tokens;

create policy "Users can register their own device tokens"
  on public.device_tokens
  for insert
  to authenticated
    with check (profile_id = auth.uid());

-- 4d. Policy: Users can UPDATE their own device tokens
drop policy if exists "Users can update their own device tokens"
  on public.device_tokens;

create policy "Users can update their own device tokens"
  on public.device_tokens
  for update
  to authenticated
    using (profile_id = auth.uid())
    with check (profile_id = auth.uid());

-- 4e. Policy: Users can DELETE their own device tokens
drop policy if exists "Users can delete their own device tokens"
  on public.device_tokens;

create policy "Users can delete their own device tokens"
  on public.device_tokens
  for delete
  to authenticated
    using (profile_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

comment on table public.device_tokens is
  'FCM device tokens for push notification targeting. One row per active '
  'device session. Multiple rows per user allowed (one per unique device). '
  'Tokens are deactivated (is_active = false) on logout — never deleted.';

comment on column public.device_tokens.token_id is
  'Primary key. Auto-generated UUID v4.';

comment on column public.device_tokens.profile_id is
  'FK to public.profiles.profile_id. The authenticated user who owns this '
  'device token. CASCADE on profile deletion removes all associated tokens.';

comment on column public.device_tokens.fcm_token is
  'Firebase Cloud Messaging registration token. Globally unique per device '
  '+ app installation pair. Enforced via UNIQUE constraint.';

comment on column public.device_tokens.platform is
  'Device platform identifier. Currently restricted to android or ios. '
  'Extend the CHECK constraint if web or desktop support is added.';

comment on column public.device_tokens.device_name is
  'Optional human-readable device identifier (e.g. "Samsung Galaxy S24", '
  '"iPhone 15 Pro"). Set by the frontend during registration. NULL if the '
  'device name is not available or the user has not granted the permission.';

comment on column public.device_tokens.app_version is
  'The version of the app when this token was registered or last refreshed. '
  'Useful for segmenting push campaigns by app version and debugging '
  'version-specific issues. Example: "1.2.3"';

comment on column public.device_tokens.is_active is
  'Whether this device token is currently active. Set to false on logout '
  'and true on login/token refresh. Inactive tokens are excluded from push '
  'dispatch. Physical deletion is never performed.';

comment on column public.device_tokens.last_seen_at is
  'Timestamp of the most recent interaction from this device (token '
  'registration, refresh, or app foreground event). Used to identify stale '
  'devices for cleanup.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 048 Device Tokens
-- ════════════════════════════════════════════════════════════════════════════
