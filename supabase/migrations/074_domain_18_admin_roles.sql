-- ============================================================================
-- Migration: 074 — Domain 18 Admin Roles
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: admin_roles
--
-- Depends on: Domain 01 (institutes, profiles)
--             Existing enums (user_role)
--             Existing functions (set_updated_at, get_my_institute_id, is_admin)
--
-- ## Purpose
--
-- Introduce granular admin roles WITHOUT replacing the existing `admin` role.
--
-- Every admin continues to have:
--     profiles.role = 'admin'
--
-- Their specific admin type (super_admin / academic_admin / finance_admin) is
-- determined via the new `admin_roles` table. This keeps 100% backward
-- compatibility: every existing RLS policy that calls public.is_admin()
-- continues to work unchanged because it reads profiles.role only.
--
-- Functional scoping between admin types is enforced at the SERVICE layer in
-- Phase 2 (backend) — the database stores WHO is what type of admin and
-- whether that assignment is approved.
--
-- ## New Enum Types
--
--   admin_role            — super_admin | academic_admin | finance_admin
--   admin_access_status   — pending | approved | suspended | revoked
--
-- ## RLS Model
--
--   Super Admin    → full CRUD on admin_roles (within their institute)
--   Other admins   → can only SELECT their own admin_roles row(s)
--   Teachers       → no access
--   Students       → no access
--
-- ## Helper Functions
--
--   is_super_admin()     — current user has approved super_admin role
--   is_academic_admin()  — current user has approved academic_admin role
--   is_finance_admin()   — current user has approved finance_admin role
--   is_any_admin()       — current user has ANY approved admin role
--
-- All are SECURITY DEFINER + SET search_path = '' (prevents recursion and
-- search-path hijacking), matching the existing is_admin()/is_teacher()/
-- is_student() pattern.
--
-- ## Backfill
--
-- Every existing profile with role = 'admin' gets an admin_roles row:
--     admin_role     = super_admin
--     access_status  = approved
--     access_granted_at = now()
-- This preserves current admin access with zero downtime. Idempotent via
-- ON CONFLICT DO NOTHING.
--
-- ## Order
--
--   1. Create enum types (idempotent)
--   2. Create admin_roles table
--   3. Create indexes
--   4. Create helper functions (is_super_admin, is_academic_admin,
--      is_finance_admin, is_any_admin, check_admin_role)
--   5. Enable RLS and create policies
--   6. Create triggers (role check, set_updated_at)
--   7. Backfill existing admins (idempotent)
--   8. Add comments
--
-- Reference: ADMIN_ROLES_IMPLEMENTATION_PLAN.md
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Enum Types (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Wrapped in DO blocks so re-running the migration never fails with
-- "type already exists" (matches the pattern from Domain 01 migration 002).

-- 1a. admin_role — the specific type of admin a profile holds
do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_role') then
    create type public.admin_role as enum (
      'super_admin',
      'academic_admin',
      'finance_admin'
    );
  end if;
end $$;

-- 1b. admin_access_status — lifecycle state of an admin role assignment
do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_access_status') then
    create type public.admin_access_status as enum (
      'pending',
      'approved',
      'suspended',
      'revoked'
    );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CREATE TABLE: admin_roles
-- ════════════════════════════════════════════════════════════════════════════
--
-- Maps a profile (which must have profiles.role = 'admin') to one or more
-- admin role types. A profile may hold multiple admin roles (e.g. both
-- super_admin and academic_admin), which is why the PK is a surrogate UUID
-- and the unique constraint is on (profile_id, admin_role).
--
-- Column design follows the Domain 17 pattern:
--   - Surrogate UUID PK (referenced by future audit / approval tables)
--   - institute_id denormalized for RLS performance and multi-tenant isolation
--   - Audit fields (created_at, updated_at)

create table public.admin_roles (
  -- Primary Key (surrogate UUID)
  admin_role_id         uuid                  not null  default gen_random_uuid(),

  -- The profile granted the admin role. Must be a profile with role = 'admin'
  -- (enforced by the trg_admin_roles_check_role trigger defined in
  -- Section 6 of this migration; the FK guarantees the profile exists).
  profile_id            uuid                  not null,

  -- Denormalized for RLS performance and multi-tenant isolation.
  -- Populated from profiles.institute_id at grant time.
  institute_id          uuid                  not null,

  -- The specific admin type (super_admin | academic_admin | finance_admin)
  admin_role            public.admin_role     not null,

  -- Lifecycle state. New grants start as 'pending' until a super admin
  -- approves them (finance admin OTP flow in Phase 2/3).
  access_status         public.admin_access_status  not null  default 'pending',

  -- The profile that granted/approved this admin role. NULL for system
  -- backfilled rows and for the first (bootstrap) super admin.
  granted_by            uuid                  null      default null,

  -- UTC timestamp when access was approved (not when the row was created).
  -- NULL while status is 'pending'.
  access_granted_at     timestamptz           null      default null,

  -- Audit fields
  created_at            timestamptz           not null  default now(),
  updated_at            timestamptz           not null  default now(),

  -- ── Primary Key ───────────────────────────────────────────────────────
  constraint pk_admin_roles primary key (admin_role_id),

  -- ── Foreign Keys ──────────────────────────────────────────────────────
  -- FK to profiles: the admin being granted the role
  -- RESTRICT on delete — prevents silently losing role assignments
  constraint fk_admin_roles_profile
    foreign key (profile_id) references public.profiles (profile_id)
    on delete restrict
    on update restrict,

  -- FK to institutes: denormalized for RLS performance and multi-tenant isolation
  -- RESTRICT on delete — prevents cascade deletion of institute data
  constraint fk_admin_roles_institute
    foreign key (institute_id) references public.institutes (institute_id)
    on delete restrict
    on update restrict,

  -- FK to profiles: the super admin who granted/approved this role
  -- SET NULL on profile soft-delete preserves the grant record
  constraint fk_admin_roles_granted_by
    foreign key (granted_by) references public.profiles (profile_id)
    on delete set null
    on update restrict,

  -- ── Unique Constraints ────────────────────────────────────────────────
  -- Enforces: a profile can hold a specific admin role at most once.
  -- The unique constraint also creates a backing B-tree index for fast
  -- lookups by (profile_id, admin_role).
  constraint uq_admin_roles_profile_role unique (profile_id, admin_role),

  -- ── CHECK Constraints ────────────────────────────────────────────────
  -- Grant-time consistency: a 'pending' role must NOT have an
  -- access_granted_at; an 'approved' role MUST have one.
  -- 'suspended' / 'revoked' roles may retain or clear their original
  -- grant timestamp (the status transition is audited in Phase 2).
  constraint ck_admin_roles_access_granted check (
    (access_status = 'pending'::public.admin_access_status and access_granted_at is null)
    or (access_status = 'approved'::public.admin_access_status and access_granted_at is not null)
    or access_status in ('suspended'::public.admin_access_status, 'revoked'::public.admin_access_status)
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- All indexes are created after the table exists.
-- No duplicate indexes on columns already covered by UNIQUE constraints
-- (the unique constraint on (profile_id, admin_role) already serves
-- "find my roles" queries where profile_id is the leading column).

-- Institute-scoped status queries: "Which admins are pending approval in
-- institute X?" — the primary admin-management and finance-approval query.
create index if not exists idx_admin_roles_institute_status
  on public.admin_roles (institute_id, access_status);

-- Pending-approval queue (partial index): super admin dashboard
create index if not exists idx_admin_roles_pending
  on public.admin_roles (institute_id, created_at)
  where access_status = 'pending'::public.admin_access_status;

-- Role-scoped queries: "Which profiles are finance admins?"
create index if not exists idx_admin_roles_admin_role
  on public.admin_roles (admin_role, access_status);

-- Granted-by lookups for super admin audit trails
create index if not exists idx_admin_roles_granted_by
  on public.admin_roles (granted_by);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Helper Functions
-- ════════════════════════════════════════════════════════════════════════════
-- All functions are SECURITY DEFINER + SET search_path = '' to:
--   1. Bypass RLS when checking roles (prevents infinite recursion)
--   2. Protect against search-path hijacking attacks
--   3. Match the existing is_admin() / is_teacher() / is_student() pattern
--
-- Important: SECURITY DEFINER means the function runs with the privileges of
-- the function owner, so reading public.admin_roles here does NOT recurse
-- into the table's own RLS policies.

-- 4a. is_super_admin()
-- Returns TRUE if the current authenticated user has an approved
-- super_admin role in admin_roles.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where profile_id = auth.uid()
      and admin_role = 'super_admin'::public.admin_role
      and access_status = 'approved'::public.admin_access_status
  );
$$;

comment on function public.is_super_admin() is
  'Returns TRUE if the current user has an approved super_admin role in '
  'admin_roles. SECURITY DEFINER prevents recursive RLS evaluation.';

-- 4b. is_academic_admin()
-- Returns TRUE if the current authenticated user has an approved
-- academic_admin role in admin_roles.
create or replace function public.is_academic_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where profile_id = auth.uid()
      and admin_role = 'academic_admin'::public.admin_role
      and access_status = 'approved'::public.admin_access_status
  );
$$;

comment on function public.is_academic_admin() is
  'Returns TRUE if the current user has an approved academic_admin role in '
  'admin_roles. SECURITY DEFINER prevents recursive RLS evaluation.';

-- 4c. is_finance_admin()
-- Returns TRUE if the current authenticated user has an approved
-- finance_admin role in admin_roles.
create or replace function public.is_finance_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where profile_id = auth.uid()
      and admin_role = 'finance_admin'::public.admin_role
      and access_status = 'approved'::public.admin_access_status
  );
$$;

comment on function public.is_finance_admin() is
  'Returns TRUE if the current user has an approved finance_admin role in '
  'admin_roles. SECURITY DEFINER prevents recursive RLS evaluation.';

-- 4d. is_any_admin()
-- Returns TRUE if the current authenticated user has ANY approved admin
-- role in admin_roles. Used by policies that grant access to every admin
-- type (superset of is_admin() for the new role model).
create or replace function public.is_any_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where profile_id = auth.uid()
      and access_status = 'approved'::public.admin_access_status
  );
$$;

comment on function public.is_any_admin() is
  'Returns TRUE if the current user has ANY approved admin role in '
  'admin_roles. SECURITY DEFINER prevents recursive RLS evaluation.';

-- 4e. check_admin_role()
-- Trigger function enforcing that admin_roles.profile_id always references
-- a profile with role = 'admin'. Prevents a teacher/student from being
-- granted an admin role via direct SQL, which would corrupt authorization.
-- Mirrors the check_teacher_role() / check_student_role() pattern from
-- migration 002.
create or replace function public.check_admin_role()
returns trigger
language plpgsql
as $$
declare
  v_role public.user_role;
begin
  select role into strict v_role
    from public.profiles
   where profile_id = new.profile_id;

  if v_role is distinct from 'admin' then
    raise exception 'Profile % has role % — admin_roles requires role = admin',
      new.profile_id, v_role;
  end if;

  return new;
exception
  when no_data_found then
    raise exception 'Profile % does not exist — cannot create admin_roles', new.profile_id;
end;
$$;

comment on function public.check_admin_role() is
  'Trigger function enforcing that admin_roles.profile_id references a '
  'profile with role = ''admin''. Prevents non-admin profiles from being '
  'granted admin roles.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Row Level Security
-- ════════════════════════════════════════════════════════════════════════════

-- 5a. Enable RLS
alter table public.admin_roles enable row level security;

-- 5b. Super admin: full CRUD within their institute
--      Super admins can grant, approve, suspend, revoke and delete admin
--      role assignments for their own institute.
create policy "Super admins can manage admin_roles"
  on public.admin_roles
  for all
  to authenticated
  using (public.is_super_admin() and institute_id = public.get_my_institute_id())
  with check (public.is_super_admin() and institute_id = public.get_my_institute_id());

-- 5c. Any admin: read only their OWN admin_roles rows
--      Admins (profiles.role = 'admin') can see their own role assignments
--      — including PENDING grants, so a finance admin awaiting approval can
--      see "your request is pending" in the UI. They cannot see or modify
--      other admins' assignments.
--      Gated by is_admin() (profiles.role = 'admin', SECURITY DEFINER, no
--      recursion risk) so teachers/students can never read this table.
create policy "Admins can read their own admin_roles"
  on public.admin_roles
  for select
  to authenticated
  using (profile_id = auth.uid() and public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Triggers
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. Role enforcement: only profiles with role = 'admin' can hold an
--      admin role (mirrors trg_teacher_details_check_role / 
--      trg_student_details_check_role from migration 002).
create trigger trg_admin_roles_check_role
  before insert or update on public.admin_roles
  for each row
  execute function public.check_admin_role();

-- 6b. updated_at maintenance (uses set_updated_at() from migration 002)
create trigger trg_admin_roles_set_updated_at
  before update on public.admin_roles
  for each row
  execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Backfill: Existing Admins Become Super Admins
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every existing profile with profiles.role = 'admin' is granted:
--     admin_role     = super_admin
--     access_status  = approved
--     access_granted_at = now()
--
-- This preserves 100% of current admin access with zero downtime. A super
-- admin can later reassign specific admins to academic_admin / finance_admin
-- via the Phase 2 admin management service.
--
-- Idempotent: ON CONFLICT (profile_id, admin_role) DO NOTHING. Re-running
-- this migration never creates duplicates and never downgrades existing rows.

insert into public.admin_roles (
  profile_id,
  institute_id,
  admin_role,
  access_status,
  granted_by,
  access_granted_at
)
select
  p.profile_id,
  p.institute_id,
  'super_admin'::public.admin_role,
  'approved'::public.admin_access_status,
  null,                       -- system backfill — no explicit granter
  now()
from public.profiles p
where p.role = 'admin'::public.user_role
on conflict (profile_id, admin_role) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 8 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. Table comments
comment on table public.admin_roles is
  'Granular admin role assignments. Maps a profile (with profiles.role = '
  '''admin'') to one or more admin types (super_admin, academic_admin, '
  'finance_admin). The profiles.role column remains the coarse access gate '
  'for all existing RLS policies (is_admin()); this table adds fine-grained '
  'role scoping consumed by the service layer and the new helper functions '
  '(is_super_admin, is_academic_admin, is_finance_admin, is_any_admin). '
  'A profile may hold multiple admin roles; each (profile_id, admin_role) '
  'pair is unique.' ;

-- 8b. Column comments
comment on column public.admin_roles.admin_role_id is
  'Surrogate primary key. Generated via gen_random_uuid().' ;

comment on column public.admin_roles.profile_id is
  'FK to profiles.profile_id. The admin profile granted this role. Enforced '
  'by trg_admin_roles_check_role to only allow profiles with role = ''admin''. '
  'RESTRICT on delete — prevents silently losing role assignments.' ;

comment on column public.admin_roles.institute_id is
  'Denormalized for RLS performance and multi-tenant isolation. Populated '
  'from profiles.institute_id at grant time.' ;

comment on column public.admin_roles.admin_role is
  'The specific admin type: super_admin (full access), academic_admin '
  '(approvals + academic resources), finance_admin (transactions, revenue, '
  'refunds, invoices). A profile can hold multiple roles.' ;

comment on column public.admin_roles.access_status is
  'Lifecycle state: pending (awaiting super admin approval), approved '
  '(active), suspended (temporarily disabled), revoked (permanently '
  'removed). Finance admin grants start as pending until a super admin '
  'approves them.' ;

comment on column public.admin_roles.granted_by is
  'FK to profiles.profile_id. The super admin who granted or approved this '
  'role. NULL for system-backfilled rows. SET NULL on profile soft-delete '
  'preserves the grant record.' ;

comment on column public.admin_roles.access_granted_at is
  'UTC timestamp when access was APPROVED (not row creation). NULL while '
  'status is pending. Used to audit and, in Phase 2/3, to enforce the '
  'finance admin OTP approval workflow.' ;

comment on column public.admin_roles.created_at is
  'UTC timestamp when the admin_roles row was created (the grant request '
  'was submitted).' ;

comment on column public.admin_roles.updated_at is
  'UTC timestamp of the last modification. Maintained by the '
  'trg_admin_roles_set_updated_at trigger.' ;

-- 8c. Constraint comments
comment on constraint uq_admin_roles_profile_role on public.admin_roles is
  'Enforces the business rule: a profile can hold a specific admin role at '
  'most once. Prevents duplicate role grants.' ;

comment on constraint ck_admin_roles_access_granted on public.admin_roles is
  'Grant-time consistency: pending roles must not have access_granted_at; '
  'approved roles must have it. Suspended/revoked roles may retain or clear '
  'their original grant timestamp.' ;

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after migration)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Every existing admin became an approved super_admin:
--    select p.profile_id, p.name, p.role, ar.admin_role, ar.access_status
--    from public.profiles p
--    left join public.admin_roles ar on ar.profile_id = p.profile_id
--    where p.role = 'admin'::public.user_role;
--    → Expect exactly one approved super_admin row per admin profile.
--
-- 2. No admin was left without a role:
--    select count(*) from public.profiles p
--    where p.role = 'admin'::public.user_role
--      and not exists (
--        select 1 from public.admin_roles ar
--        where ar.profile_id = p.profile_id
--      );
--    → Expect 0.
--
-- 3. Helper functions resolve (run as an existing admin user):
--    select public.is_super_admin() as is_super;
--    → Expect true for existing admins (after backfill).
--
-- 4. RLS: teachers/students cannot see admin_roles:
--    -- run as a teacher/student session
--    select * from public.admin_roles;
--    → Expect 0 rows.
--
-- 5. RLS: non-super admin can only see their own row:
--    -- run as an academic/finance admin (created in Phase 2)
--    select * from public.admin_roles;
--    → Expect only rows where profile_id = auth.uid().

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 074 must be reverted BEFORE any Phase 2 code depends on it):
--
--   -- 1. Drop RLS policies
--   drop policy if exists "Super admins can manage admin_roles" on public.admin_roles;
--   drop policy if exists "Admins can read their own admin_roles" on public.admin_roles;
--
--   -- 2. Drop triggers
--   drop trigger if exists trg_admin_roles_check_role on public.admin_roles;
--   drop trigger if exists trg_admin_roles_set_updated_at on public.admin_roles;
--
--   -- 3. Drop helper functions
--   drop function if exists public.is_super_admin();
--   drop function if exists public.is_academic_admin();
--   drop function if exists public.is_finance_admin();
--   drop function if exists public.is_any_admin();
--   drop function if exists public.check_admin_role();
--
--   -- 4. Drop table (cascades indexes)
--   drop table if exists public.admin_roles cascade;
--
--   -- 5. Drop enum types
--   drop type if exists public.admin_role;
--   drop type if exists public.admin_access_status;
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 074 Domain 18 Admin Roles
-- ════════════════════════════════════════════════════════════════════════════
