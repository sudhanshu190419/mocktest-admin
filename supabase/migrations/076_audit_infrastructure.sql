-- ============================================================================
-- Migration: 076 — Audit Infrastructure (extend, not redesign)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ## Purpose
--
-- Upgrade the EXISTING audit system (Migration 011, Domain 10) so it becomes
-- the centralized foundation for all future audit events. Nothing is rebuilt:
--   • audit_logs table        — reused as-is
--   • audit_action_type enum  — extended with the missing actions
--   • existing indexes        — reused as-is (no new indexes required)
--   • immutability triggers   — kept intact (UPDATE / DELETE remain blocked)
--   • old_value / new_value   — kept, with the snapshot model extended
--
-- This migration ONLY prepares the database. It does NOT:
--   • wire audit logging into business services        (Phase 6B)
--   • create the auditService.ts frontend/backend layer (Phase 6B)
--   • build the Audit UI / export / timeline / filters  (Phase 6C)
--   • implement Soft Delete / Restore                  (later phase)
--   • create triggers on every table
--
-- ## What this migration delivers
--
--   1. Extends audit_action_type with the 13 actions identified in the
--      architecture review (suspend, reactivate, revoke, grant, assign,
--      unassign, transfer, submit, archive, failed_login, reset_password,
--      device_approve, device_revoke).
--   2. Adds the two approved columns: outcome ('success'|'failure') and
--      reason (free-text review/decision note).
--   3. Extends the snapshot-consistency CHECK constraints so the NEW actions
--      follow the same old_value/new_value discipline already applied to
--      create / update / delete / login / logout.
--   4. Fixes the audit RLS read policy: was is_admin() (every admin type),
--      now is_super_admin() only. Finance Admin, Academic Admin, Teacher,
--      Student cannot read audit logs. Institute isolation preserved.
--   5. Creates write_audit_log() — the ONE supported write path. SECURITY
--      DEFINER; actor derived from auth.uid(); institute derived from the
--      actor's profile; never trusts client-supplied profile IDs.
--
-- ## Why the CHECK constraints are function-backed + NOT VALID
--
-- PostgreSQL error 55P04 ("unsafe use of new value of enum type") occurs when
-- a value added by ALTER TYPE ... ADD VALUE is USED in the same transaction
-- as the ALTER (see Migration 047's documented constraint). Direct enum
-- literals inside CHECK constraint expressions would violate this rule when
-- the migration runner applies the file inside a single transaction.
--
-- Two mitigations are combined here:
--   1. `set check_function_bodies = off;` — plpgsql function bodies are
--      compiled at FIRST CALL, not at creation, so functions that reference
--      the new enum values can be created safely now.
--   2. The CHECK constraints call the helper functions and are added
--      NOT VALID, so no existing row is scanned (and no function invoked)
--      during the migration. Existing rows were written under the original,
--      strictly weaker constraints, so they are automatically compliant;
--      ALTER TABLE ... VALIDATE CONSTRAINT can be run post-apply as a
--      hygiene step.
--
-- ## Depends on
--
--   Migration 011 — public.audit_logs, public.audit_action_type
--   Migration 021 — RLS policy "Only admins can read audit_logs"
--   Migration 002 — public.get_my_institute_id()
--   Migration 074 — public.is_super_admin()
--
-- ## Idempotency
--
--   • ALTER TYPE ... ADD VALUE IF NOT EXISTS  (standalone statements)
--   • ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   • DROP CONSTRAINT IF EXISTS before recreating constraints
--   • DROP POLICY IF EXISTS before recreating policies
--   • CREATE OR REPLACE FUNCTION for the RPC and helpers
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — Session Safety
-- ════════════════════════════════════════════════════════════════════════════
-- Allow creating plpgsql functions whose bodies reference the enum values
-- added later in this same migration. plpgsql bodies are validated at first
-- execution (which happens after this migration commits), so this is safe
-- and required to avoid error 55P04 (see header).

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Extend audit_action_type Enum (Idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds the 13 missing actions identified in the architecture review. Each
-- ALTER TYPE ... ADD VALUE is a standalone statement with IF NOT EXISTS
-- (PostgreSQL 16), matching the proven pattern from Migration 047.
--
-- New values append at the END of the enum's sort order — never inserted in
-- the middle — so existing rows and any code that orders by enumsortorder
-- remain fully compatible.

alter type public.audit_action_type add value if not exists 'suspend';
alter type public.audit_action_type add value if not exists 'reactivate';
alter type public.audit_action_type add value if not exists 'revoke';
alter type public.audit_action_type add value if not exists 'grant';
alter type public.audit_action_type add value if not exists 'assign';
alter type public.audit_action_type add value if not exists 'unassign';
alter type public.audit_action_type add value if not exists 'transfer';
alter type public.audit_action_type add value if not exists 'submit';
alter type public.audit_action_type add value if not exists 'archive';
alter type public.audit_action_type add value if not exists 'failed_login';
alter type public.audit_action_type add value if not exists 'reset_password';
alter type public.audit_action_type add value if not exists 'device_approve';
alter type public.audit_action_type add value if not exists 'device_revoke';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Add Missing Columns (outcome · reason)
-- ════════════════════════════════════════════════════════════════════════════
-- Only the two approved fields are added. No existing column is renamed or
-- modified. The table is NOT redesigned.
--
--   outcome — success | failure, always populated (default 'success').
--             Enables cheap filtering of failed logins / failed operations
--             without scanning metadata JSON.
--   reason  — optional free-text note (e.g. rejection remark, suspension
--             cause, restore justification). NULL when no note is provided.

alter table public.audit_logs
  add column if not exists outcome text not null default 'success';

alter table public.audit_logs
  add column if not exists reason text;

-- outcome domain constraint (text literals — no enum risk)
alter table public.audit_logs drop constraint if exists ck_audit_logs_outcome;

alter table public.audit_logs
  add constraint ck_audit_logs_outcome
  check (outcome in ('success', 'failure'));

comment on constraint ck_audit_logs_outcome on public.audit_logs is
  'outcome must be ''success'' or ''failure''. Defaults to ''success'' for '
  'backward compatibility with rows written before this column existed.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Extend Snapshot-Consistency CHECK Constraints
-- ════════════════════════════════════════════════════════════════════════════
-- The original design (Migration 011) enforces:
--   • create / login            → old_value must be NULL (no before-state)
--   • delete / soft_delete / logout → new_value must be NULL (no after-state)
--
-- This is extended so the NEW actions follow the same philosophy:
--   • old_value must be NULL:   create, login, submit, grant, device_approve,
--                               failed_login, reset_password
--     (pure-creation / point-in-time events with no meaningful before-state)
--   • new_value must be NULL:   delete, soft_delete, logout, revoke, unassign,
--                               device_revoke, failed_login, reset_password
--     (pure-removal events; failed_login / reset_password never capture
--      state — in particular reset_password must NEVER store secrets)
--
-- Implemented as pure plpgsql helper functions (compiled on first call, so
-- they may reference the new enum values) referenced from the constraints,
-- which are added NOT VALID (see header for the 55P04 rationale).

-- 3a. Helper: is old_value permitted for this action?
create or replace function public.audit_log_old_value_allowed(
  p_action    public.audit_action_type,
  p_old_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_action in (
    'create'::public.audit_action_type,
    'login'::public.audit_action_type,
    'submit'::public.audit_action_type,
    'grant'::public.audit_action_type,
    'device_approve'::public.audit_action_type,
    'failed_login'::public.audit_action_type,
    'reset_password'::public.audit_action_type
  ) then
    return p_old_value is null;
  end if;
  return true;
end;
$$;

-- 3b. Helper: is new_value permitted for this action?
create or replace function public.audit_log_new_value_allowed(
  p_action    public.audit_action_type,
  p_new_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_action in (
    'delete'::public.audit_action_type,
    'soft_delete'::public.audit_action_type,
    'logout'::public.audit_action_type,
    'revoke'::public.audit_action_type,
    'unassign'::public.audit_action_type,
    'device_revoke'::public.audit_action_type,
    'failed_login'::public.audit_action_type,
    'reset_password'::public.audit_action_type
  ) then
    return p_new_value is null;
  end if;
  return true;
end;
$$;

-- 3c. Recreate the extended constraints (drop-if-exists makes this idempotent)
alter table public.audit_logs
  drop constraint if exists ck_audit_logs_create_old_value_null;

alter table public.audit_logs
  add constraint ck_audit_logs_create_old_value_null
  check (public.audit_log_old_value_allowed(action, old_value))
  not valid;

alter table public.audit_logs
  drop constraint if exists ck_audit_logs_delete_new_value_null;

alter table public.audit_logs
  add constraint ck_audit_logs_delete_new_value_null
  check (public.audit_log_new_value_allowed(action, new_value))
  not valid;

comment on constraint ck_audit_logs_create_old_value_null on public.audit_logs is
  'Snapshot consistency: actions that represent pure creation or point-in-time '
  'events (create, login, submit, grant, device_approve, failed_login, '
  'reset_password) must not carry an old_value before-state. Added NOT VALID '
  'to avoid enum-use-in-transaction errors; existing rows are compliant with '
  'the original weaker rule. Run ALTER TABLE public.audit_logs VALIDATE '
  'CONSTRAINT ck_audit_logs_create_old_value_null post-apply for hygiene.';

comment on constraint ck_audit_logs_delete_new_value_null on public.audit_logs is
  'Snapshot consistency: actions that represent pure removal or session end '
  '(delete, soft_delete, logout, revoke, unassign, device_revoke, '
  'failed_login, reset_password) must not carry a new_value after-state. '
  'reset_password is included so secrets are never persisted in snapshots. '
  'Added NOT VALID; run VALIDATE CONSTRAINT post-apply for hygiene.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Fix Audit RLS (Super Admin only)
-- ════════════════════════════════════════════════════════════════════════════
-- Replaces the generic "Only admins can read audit_logs" policy (is_admin() —
-- satisfied by EVERY admin type) with an RBAC-aware policy: only an APPROVED
-- super_admin may read audit logs. Finance Admin, Academic Admin, Teacher and
-- Student are denied at the RLS layer even if they call the client directly.
--
-- Institute isolation is preserved: the policy still requires the log row to
-- belong to the caller's institute (get_my_institute_id()).
--
-- No INSERT / UPDATE / DELETE policies are created — client roles cannot
-- write audit rows directly. The only write path is write_audit_log() (a
-- SECURITY DEFINER function, Section 5) and the existing immutability
-- triggers (Migration 011) keep UPDATE / DELETE blocked for every role.

drop policy if exists "Only admins can read audit_logs" on public.audit_logs;

create policy "Super admins can read audit_logs"
  on public.audit_logs
  for select
  to authenticated
  using (public.is_super_admin() and institute_id = public.get_my_institute_id());

comment on policy "Super admins can read audit_logs" on public.audit_logs is
  'Only approved super admins can read audit logs, scoped to their institute. '
  'Finance admins, academic admins, teachers, and students are denied. '
  'is_super_admin() is SECURITY DEFINER (Migration 074), so no RLS recursion. '
  'No write policies exist — INSERT happens exclusively through '
  'write_audit_log(); UPDATE/DELETE remain blocked by immutability triggers.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — write_audit_log() RPC (the only supported write path)
-- ════════════════════════════════════════════════════════════════════════════
-- A single SECURITY DEFINER function that all future backend services will
-- call (via auditService.log() in Phase 6B).
--
-- Security properties:
--   • Actor (profile_id, actor_role, institute_id) is derived server-side
--     from auth.uid() + public.profiles. Client-supplied profile IDs are
--     NEVER trusted.
--   • A caller can only create rows attributed to THEMSELVES in THEIR OWN
--     institute — impersonation is structurally impossible.
--   • enum values are validated by the parameter type itself
--     (audit_action_type) — invalid actions are rejected by PostgreSQL.
--   • Snapshot consistency is enforced here (mirroring the CHECK
--     constraints) so callers get clean, actionable errors.
--   • SECURITY DEFINER + SET search_path = '' — RLS is bypassed for the
--     INSERT only (service-role credentials are never exposed); search-path
--     hijacking is prevented.
--   • Execution is revoked from PUBLIC and granted only to authenticated,
--     so anonymous callers cannot invoke it.
--   • NO authorization gating — this RPC never decides whether an action is
--     permitted. It only securely records actions the service layer has
--     already authorized. Role/permission checks live exclusively in the
--     service layer (approvalGuard.ts + permissionService in Phase 6B) and
--     the existing RLS policies.
--
-- Returns jsonb: { success: true, log_id } or { success: false, error }.

-- ── Re-enable function-body validation before creating write_audit_log() ──
-- The two snapshot helper functions (Section 3a/3b) are created with body
-- validation disabled because their bodies reference the enum values added in
-- Section 1 (55P04 avoidance). write_audit_log() itself contains NO new enum
-- literals — it only calls the helpers and casts its typed parameter — so
-- body validation is safe here and guarantees the function actually compiles
-- before the REVOKE / GRANT / COMMENT statements below are executed.

set check_function_bodies = on;

create or replace function public.write_audit_log(
  p_action        public.audit_action_type,
  p_resource_type text,
  p_resource_id   uuid        default null,
  p_old_value     jsonb       default null,
  p_new_value     jsonb       default null,
  p_metadata      jsonb       default null,
  p_ip_address    inet        default null,
  p_user_agent    text        default null,
  p_session_id    text        default null,
  p_outcome       text        default 'success',
  p_reason        text        default null,
  p_performed_at  timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id   uuid;
  v_institute_id uuid;
  v_actor_role   public.user_role;
  v_log_id       uuid;
begin
  -- ── Resolve the actor from the session (never from client input) ──────
  v_profile_id := auth.uid();

  if v_profile_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated.');
  end if;

  -- ── Derive institute + role server-side from the actor's profile ──────
  select p.institute_id, p.role
    into v_institute_id, v_actor_role
    from public.profiles p
   where p.profile_id = v_profile_id;

  if v_institute_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Profile not found for the authenticated user.'
    );
  end if;

  -- ── resource_type validation (mirrors ck_audit_logs_resource_type_length)
  if p_resource_type is null
     or char_length(p_resource_type) < 1
     or char_length(p_resource_type) > 100 then
    return jsonb_build_object(
      'success', false,
      'error', 'resource_type must be 1-100 characters.'
    );
  end if;

  -- ── outcome validation (mirrors ck_audit_logs_outcome) ────────────────
  if p_outcome is null or p_outcome not in ('success', 'failure') then
    return jsonb_build_object(
      'success', false,
      'error', 'outcome must be ''success'' or ''failure''.'
    );
  end if;

  -- ── Snapshot consistency (mirrors the extended CHECK constraints) ─────
  if not public.audit_log_old_value_allowed(p_action, p_old_value) then
    return jsonb_build_object(
      'success', false,
      'error', 'old_value must be null for action: ' || p_action::text
    );
  end if;

  if not public.audit_log_new_value_allowed(p_action, p_new_value) then
    return jsonb_build_object(
      'success', false,
      'error', 'new_value must be null for action: ' || p_action::text
    );
  end if;

  -- ── Append the immutable row ───────────────────────────────────────────
  insert into public.audit_logs (
    institute_id,
    profile_id,
    actor_role,
    action,
    resource_type,
    resource_id,
    old_value,
    new_value,
    metadata,
    ip_address,
    user_agent,
    session_id,
    outcome,
    reason,
    performed_at
  ) values (
    v_institute_id,
    v_profile_id,
    v_actor_role,
    p_action,
    p_resource_type,
    p_resource_id,
    p_old_value,
    p_new_value,
    p_metadata,
    p_ip_address,
    p_user_agent,
    p_session_id,
    p_outcome,
    p_reason,
    coalesce(p_performed_at, now())
  )
  returning log_id into v_log_id;

  return jsonb_build_object('success', true, 'log_id', v_log_id);
end;
$$;

-- ── Restrict execution to authenticated users only ─────────────────────────
revoke execute on function public.write_audit_log(
  public.audit_action_type, text, uuid, jsonb, jsonb, jsonb,
  inet, text, text, text, text, timestamptz
) from public;

grant execute on function public.write_audit_log(
  public.audit_action_type, text, uuid, jsonb, jsonb, jsonb,
  inet, text, text, text, text, timestamptz
) to authenticated;

comment on function public.write_audit_log(
  public.audit_action_type, text, uuid, jsonb, jsonb, jsonb,
  inet, text, text, text, text, timestamptz
) is
  'The ONLY supported write path for audit logs. SECURITY DEFINER; the actor '
  '(profile_id), their role, and their institute are derived server-side from '
  'auth.uid() + public.profiles — client-supplied profile IDs are never '
  'trusted. Validates resource_type, outcome, and snapshot consistency before '
  'appending an immutable row. Returns jsonb {success, log_id} or '
  '{success, error}. Execution is restricted to authenticated users. Future '
  'backend services call this via auditService.log().';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — COMMENT Statements
-- ════════════════════════════════════════════════════════════════════════════
-- (check_function_bodies was re-enabled before write_audit_log() creation
--  above, so it remains on for the rest of this session — subsequent
--  statements are fully validated.)

comment on column public.audit_logs.outcome is
  'Outcome of the audited operation: success or failure. Always populated, '
  'defaults to success for backward compatibility. Enables cheap filtering of '
  'failed operations (e.g. failed_logins) without scanning metadata JSON. '
  'Note: outcome describes the ACTION that was audited — it is not an audit '
  'row write status.';

comment on column public.audit_logs.reason is
  'Optional free-text note recorded with the action (rejection remark, '
  'suspension cause, revoke justification, restore note, export purpose). '
  'NULL when no note is provided. Plain text only — never store secrets or '
  'credentials here.';

comment on function public.audit_log_old_value_allowed(public.audit_action_type, jsonb) is
  'Pure helper enforcing the old_value side of the snapshot-consistency model: '
  'returns false when the action is a pure-creation / point-in-time event '
  '(create, login, submit, grant, device_approve, failed_login, '
  'reset_password) but an old_value was supplied. Referenced by the '
  'ck_audit_logs_create_old_value_null CHECK constraint.';

comment on function public.audit_log_new_value_allowed(public.audit_action_type, jsonb) is
  'Pure helper enforcing the new_value side of the snapshot-consistency model: '
  'returns false when the action is a pure-removal / session-end event '
  '(delete, soft_delete, logout, revoke, unassign, device_revoke, '
  'failed_login, reset_password) but a new_value was supplied. reset_password '
  'is included so secrets are never persisted. Referenced by the '
  'ck_audit_logs_delete_new_value_null CHECK constraint.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after applying the migration)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Enum extended with exactly the 13 new actions:
--    select enumlabel from pg_enum
--    join pg_type on pg_type.oid = pg_enum.enumtypid
--    where pg_type.typname = 'audit_action_type'
--    order by enumsortorder;
--    → Expect the original 18 actions plus: suspend, reactivate, revoke,
--      grant, assign, unassign, transfer, submit, archive, failed_login,
--      reset_password, device_approve, device_revoke (31 total).
--
-- 2. Columns added:
--    select column_name, data_type, is_nullable, column_default
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'audit_logs'
--      and column_name in ('outcome', 'reason');
--    → Expect outcome text NOT NULL default 'success'; reason text NULL.
--
-- 3. Constraints present:
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.audit_logs'::regclass
--    order by conname;
--    → Expect ck_audit_logs_outcome, ck_audit_logs_create_old_value_null
--      (function-backed), ck_audit_logs_delete_new_value_null
--      (function-backed), plus the untouched original constraints.
--
-- 4. RLS policy narrowed to super admins:
--    select policyname, cmd, qual from pg_policies
--    where schemaname = 'public' and tablename = 'audit_logs';
--    → Expect exactly one SELECT policy, "Super admins can read audit_logs",
--      referencing is_super_admin() and get_my_institute_id().
--
-- 5. write_audit_log() resolves and rejects invalid snapshots
--    (run as ANY authenticated user — actor is self-derived):
--    select public.write_audit_log('login', 'profiles');
--    → Expect { success: true, log_id: ... }
--    select public.write_audit_log('create', 'profiles',
--           p_old_value := '{"x":1}'::jsonb);
--    → Expect { success: false, error: 'old_value must be null ...' }
--
-- 5b. Structural validation only — NO RBAC gating in the RPC. The audit RPC
--    never decides whether an action is permitted; it only securely records
--    actions the service layer has already authorized. Role checks live
--    exclusively in the service layer and the existing RLS policies:
--    select public.write_audit_log('update', 'questions',
--           p_outcome := 'maybe');
--    → Expect { success: false, error: 'outcome must be ...' }
--    select public.write_audit_log('update', '');
--    → Expect { success: false, error: 'resource_type must be 1-100 ...' }
--    -- run as a TEACHER session
--    select public.write_audit_log('approve', 'questions');
--    → Expect { success: true, log_id: ... }  (structural validation passes;
--      whether the teacher MAY approve is enforced by the service layer,
--      not by the audit RPC)
--
-- 6. RLS: only super admins can read (run as each role):
--    select count(*) from public.audit_logs;
--    → Super admin: rows visible (their institute).
--      Finance admin / academic admin / teacher / student: 0 rows.
--
-- 7. Immutability preserved:
--    update public.audit_logs set outcome = 'failure';
--    → Expect exception 'audit_logs rows are immutable — UPDATE is not
--      permitted'.
--
-- 8. (Hygiene, optional) Validate the NOT VALID constraints:
--    alter table public.audit_logs validate constraint ck_audit_logs_create_old_value_null;
--    alter table public.audit_logs validate constraint ck_audit_logs_delete_new_value_null;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 076 must be reverted):
--
--   -- 1. Drop the write RPC (cascade its privileges)
--   drop function if exists public.write_audit_log(
--     public.audit_action_type, text, uuid, jsonb, jsonb, jsonb,
--     inet, text, text, text, text, timestamptz
--   );
--
--   -- 2. Restore the original snapshot constraints (direct enum literals
--   --    are safe here because the new values are already committed)
--   alter table public.audit_logs drop constraint if exists ck_audit_logs_create_old_value_null;
--   alter table public.audit_logs add constraint ck_audit_logs_create_old_value_null
--     check ((action in ('create', 'login') and old_value is null)
--            or (action not in ('create', 'login')));
--   alter table public.audit_logs drop constraint if exists ck_audit_logs_delete_new_value_null;
--   alter table public.audit_logs add constraint ck_audit_logs_delete_new_value_null
--     check ((action in ('delete', 'soft_delete', 'logout') and new_value is null)
--            or (action not in ('delete', 'soft_delete', 'logout')));
--
--   -- 3. Drop helper functions
--   drop function if exists public.audit_log_old_value_allowed(public.audit_action_type, jsonb);
--   drop function if exists public.audit_log_new_value_allowed(public.audit_action_type, jsonb);
--
--   -- 4. Drop the new columns + outcome constraint
--   alter table public.audit_logs drop constraint if exists ck_audit_logs_outcome;
--   alter table public.audit_logs drop column if exists outcome;
--   alter table public.audit_logs drop column if exists reason;
--
--   -- 5. Restore the original RLS policy
--   drop policy if exists "Super admins can read audit_logs" on public.audit_logs;
--   create policy "Only admins can read audit_logs"
--     on public.audit_logs for select to authenticated
--     using (public.is_admin());
--
--   -- 6. Enum values CANNOT be removed (PostgreSQL limitation). The new
--   --    audit_action_type values remain in the type but are unused after
--   --    rollback — they are harmless and do not affect existing rows.
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 076 Audit Infrastructure
-- ════════════════════════════════════════════════════════════════════════════
