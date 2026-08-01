-- ============================================================================
-- Migration: 078 — Trusted Device Approval Fixes (atomic RPC + pending guard)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ## Purpose
--
-- Implements the fixes identified in the Trusted Device root-cause analysis:
--
--   Bug 1 (duplicate pending rows per login)
--     • Partial unique index: only ONE 'pending' row per profile. A second
--       concurrent insert is rejected by the database, not just by the edge
--       function's check-then-insert.
--
--   Bug 2 (approving a second device revokes BOTH devices)
--     • `approve_trusted_device()` RPC: replaces the two-step
--       revoke-then-approve UPDATEs in the device-approve edge function with
--       ONE atomic database operation. The target device is NEVER revoked
--       (revoke query excludes it), and the whole revoke+approve runs inside
--       a single function call — a partial failure can no longer leave the
--       profile with zero approved devices.
--     • Idempotent approval: if the target is ALREADY approved, the RPC
--       returns success without changing state.
--
-- ## Design notes
--
--   • SECURITY DEFINER + SET search_path = '' (matches write_audit_log in
--     migration 076). The edge function invokes it with the service-role
--     client; EXECUTE is granted to both service_role (edge functions) and
--     authenticated (defense in depth).
--   • The RPC returns a jsonb envelope ({ success, deviceId, errorCode,
--     revokedPreviousDeviceIds, alreadyApproved }) instead of raising
--     exceptions, so the edge function can map business rejections to clean
--     HTTP statuses (404 / 409) exactly like the previous two-step code.
--   • The one-approved-device policy is preserved and now enforced
--     atomically in the business layer (no trigger was added — consistent
--     with the Phase 7A decision to keep that rule in the business layer).
--   • updated_at is maintained by the existing
--     trg_trusted_devices_set_updated_at trigger (migration 077).
--
-- ## Depends on
--
--   Migration 077 — public.trusted_devices, trusted_device_status,
--                   ck_trusted_devices_approved
--
-- ## Idempotency
--
--   • CREATE UNIQUE INDEX IF NOT EXISTS
--   • CREATE OR REPLACE FUNCTION
--   • REVOKE / GRANT are safe to re-run
--
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — One pending request per profile (defense in depth for Bug 1)
-- ════════════════════════════════════════════════════════════════════════════
-- Prevents two 'pending' rows for the same profile even when two challenges
-- race past the edge function's check. Only 'pending' is constrained —
-- 'rejected' / 'revoked' / 'expired' / 'inactive' rows are historical and
-- may accumulate, and only one row can ever be 'approved' at a time (that
-- rule lives in approve_trusted_device + was already the business contract).

create unique index if not exists uq_trusted_devices_one_pending_per_profile
  on public.trusted_devices (profile_id)
  where status = 'pending'::public.trusted_device_status;

comment on index public.uq_trusted_devices_one_pending_per_profile is
  'Enforces at most ONE pending trusted-device request per profile. The edge '
  'function checks for an existing pending row before inserting (Bug 1 fix); '
  'this partial unique index makes that check race-safe at the database level.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — approve_trusted_device() RPC (atomic revoke + approve)
-- ════════════════════════════════════════════════════════════════════════════
-- Replaces the non-atomic two-step UPDATE sequence in the device-approve edge
-- function. Inside this single function call the profile can never be left
-- with zero approved devices by a partial failure:
--
--   1. Load the target device (not found → success:false, errorCode not_found)
--   2. Idempotency: already 'approved' → success with no state change
--   3. Reject anything that is not 'pending' (409 semantics)
--   4. Atomically revoke OTHER approved devices for the profile
--      (device_id <> target — the target is NEVER revoked)
--   5. Approve the target (sets approved_at, approved_by, last_used_at,
--      clears rejection_reason — satisfies ck_trusted_devices_approved)
--
-- Returns jsonb:
--   { success: true,  deviceId, alreadyApproved, revokedPreviousDeviceIds }
--   { success: false, error, errorCode: 'not_found' | 'not_pending' }

create or replace function public.approve_trusted_device(
  p_device_id    uuid,
  p_approved_by  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id    uuid;
  v_device_name   text;
  v_status        public.trusted_device_status;
  v_revoked       uuid;
  v_revoked_ids   uuid[] := '{}';
begin
  -- ── 1. Load the target device ──────────────────────────────────────────
  select profile_id, device_name, status
    into v_profile_id, v_device_name, v_status
    from public.trusted_devices
   where device_id = p_device_id;

  if not found then
    return jsonb_build_object(
      'success',   false,
      'error',     'Device not found.',
      'errorCode', 'not_found'
    );
  end if;

  -- ── 2. Idempotent: already approved → success, no state change ────────
  if v_status = 'approved'::public.trusted_device_status then
    return jsonb_build_object(
      'success',             true,
      'deviceId',            p_device_id,
      'alreadyApproved',     true,
      'revokedPreviousDeviceIds', '[]'::jsonb
    );
  end if;

  -- ── 3. Only pending devices can be approved ────────────────────────────
  if v_status <> 'pending'::public.trusted_device_status then
    return jsonb_build_object(
      'success',   false,
      'error',     'Only pending devices can be approved.',
      'errorCode', 'not_pending'
    );
  end if;

  -- ── 4. Atomically revoke OTHER approved devices (never the target) ────
  for v_revoked in
    update public.trusted_devices
       set status       = 'revoked'::public.trusted_device_status,
           approved_at  = null,
           updated_at   = now()
     where profile_id   = v_profile_id
       and status       = 'approved'::public.trusted_device_status
       and device_id   <> p_device_id
     returning device_id
  loop
    v_revoked_ids := array_append(v_revoked_ids, v_revoked);
  end loop;

  -- ── 5. Approve the target device ───────────────────────────────────────
  update public.trusted_devices
     set status            = 'approved'::public.trusted_device_status,
         approved_at       = now(),
         approved_by       = p_approved_by,
         last_used_at      = now(),
         rejection_reason  = null,
         updated_at        = now()
   where device_id = p_device_id;

  return jsonb_build_object(
    'success',                   true,
    'deviceId',                  p_device_id,
    'alreadyApproved',           false,
    'revokedPreviousDeviceIds',  to_jsonb(v_revoked_ids)
  );
end;
$$;

-- ── Restrict execution ─────────────────────────────────────────────────────
-- SECURITY: this RPC is a PRIVILEGED state-changing operation (it approves
-- devices). Unlike write_audit_log (a pure recorder), it MUST NOT be callable
-- by every authenticated user — otherwise a teacher/student/finance admin
-- could approve devices directly via PostgREST, bypassing the super-admin
-- check that lives in the device-approve edge function. EXECUTE is granted
-- ONLY to service_role (the edge function is the sole intended caller).
-- Authorization remains exclusively in the edge function (isApprovedSuperAdmin).
revoke execute on function public.approve_trusted_device(uuid, uuid) from public;

grant execute on function public.approve_trusted_device(uuid, uuid)
  to service_role;

comment on function public.approve_trusted_device(uuid, uuid) is
  'Atomic trusted-device approval (SECURITY DEFINER). Revokes any OTHER '
  'approved device for the profile and approves the target in a single '
  'operation — the target is never revoked and a partial failure cannot '
  'leave the profile with zero approved devices. Idempotent: already-approved '
  'targets return success without changing state. Returns a jsonb envelope '
  '{success, deviceId, alreadyApproved, revokedPreviousDeviceIds} or '
  '{success, error, errorCode}. EXECUTE restricted to service_role — this is '
  'a privileged operation and must only ever be invoked by the device-approve '
  'edge function, which performs the super-admin authorization check before '
  'calling it.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (run manually after applying the migration)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Partial unique index present:
--    select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'trusted_devices'
--      and indexname = 'uq_trusted_devices_one_pending_per_profile';
--    → Expect one row.
--
-- 2. RPC resolves:
--    select pg_get_functiondef('public.approve_trusted_device(uuid, uuid)'::regprocedure)
--    → Expect the CREATE OR REPLACE FUNCTION body.
--
-- 3. Grants:
--    select grantee, privilege_type from information_schema.role_routine_grants
--    where routine_name = 'approve_trusted_device' order by grantee;
--    → Expect service_role and authenticated (no PUBLIC).
--
-- 4. Idempotent already-approved (no change):
--    select public.approve_trusted_device('<approved-device-id>', '<super-admin-profile-id>');
--    → Expect { success: true, alreadyApproved: true, revokedPreviousDeviceIds: [] }
--
-- 5. Not-found / not-pending rejections:
--    select public.approve_trusted_device(gen_random_uuid(), gen_random_uuid());
--    → Expect { success: false, errorCode: 'not_found' }
--
-- 6. One-pending constraint (race safety):
--    -- insert a pending row manually, then attempt a second insert for the
--    -- same profile — expect a unique violation on
--    -- uq_trusted_devices_one_pending_per_profile.

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 078 must be reverted):
--
--   drop index if exists public.uq_trusted_devices_one_pending_per_profile;
--   drop function if exists public.approve_trusted_device(uuid, uuid);
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 078 Trusted Device Approval Fixes
-- ════════════════════════════════════════════════════════════════════════════
