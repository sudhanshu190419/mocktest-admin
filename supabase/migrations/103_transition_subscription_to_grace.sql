-- ============================================================================
-- Migration: 103 — Atomic ACTIVE → GRACE Transition RPC (H2 fix)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- H2 (production readiness audit — partial-failure window): the
-- subscription-lifecycle Edge Function performed TRANSITION 1 (ACTIVE → GRACE)
-- as TWO separate PostgREST requests:
--
--   1. UPDATE student_subscriptions SET status = 'grace'   (commits)
--   2. INSERT subscription_grace_periods ...               (second commit)
--
-- If step 2 failed, the subscription was left status='grace' with NO
-- subscription_grace_periods row. N2/N3/N4 lifecycle notifications
-- (which INNER-JOIN subscription_grace_periods) then never fired, and the
-- later GRACE → EXPIRED resolution UPDATE silently affected 0 rows.
--
-- This migration replaces that two-step client-side sequence with ONE atomic
-- SECURITY DEFINER RPC. The status claim and the grace-row creation (or reuse)
-- now commit or roll back TOGETHER — a grace-row failure can no longer leave a
-- subscription in 'grace' without a grace record.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SCOPE (strict, per the H2 fix request)
-- ════════════════════════════════════════════════════════════════════════════
--   • Creates ONE new function (public.transition_subscription_to_grace) plus
--     its comment. NO other object is created, altered, or dropped.
--   • NO changes to payment, pricing, entitlement, RLS, notifications,
--     triggers, or any existing migration.
--   • NO data backfill — existing corrupted rows are handled by the OPS-ONLY
--     reconciliation script (NOT a migration).
--
-- ════════════════════════════════════════════════════════════════════════════
-- FUNCTION BEHAVIOR — preserves TRANSITION 1 semantics exactly
-- ════════════════════════════════════════════════════════════════════════════
-- public.transition_subscription_to_grace(p_subscription_id uuid) → boolean
--
--   1. Atomic conditional claim (same eligibility as the old claim UPDATE):
--        status        = 'active'
--        end_date      <  current UTC date       ((now() at time zone 'utc')::date)
--        grace_end_date IS NOT NULL
--      If the UPDATE matches 0 rows → return FALSE (caller treats as
--      skipped/non-eligible; a concurrent run may have claimed the row).
--
--   2. Compute grace window dates (identical to the TypeScript helpers):
--        rawStart      = end_date + 1                         (addDays(_, 1))
--        graceStartDate = rawStart, unless rawStart >= grace_end_date, in which
--                        case clamp to grace_end_date - 1   (addDays(_, -1))
--      so the CHECK ck_subscription_grace_periods_end_date
--      (grace_end_date > grace_start_date) is always satisfied.
--
--   3. trigger_reason — identical semantics:
--        is_auto_renew → 'auto_renewal_failed', else 'manual_expiry'
--      (V1 defaults to manual_expiry; both values pass
--      ck_subscription_grace_periods_trigger_reason).
--
--   4. Reuse-or-insert grace row:
--      • If an UNRESOLVED (resolution IS NULL) subscription_grace_periods row
--        already exists for this subscription (e.g. a stale row left by a
--        renew-during-grace flow), REUSE it: update the window dates and
--        trigger_reason, and reset reminders_sent / last_reminder_sent_at so
--        it behaves like a freshly created grace window. This avoids a 23505
--        violation of uq_grace_periods_active_subscription (partial unique
--        index ON (subscription_id) WHERE resolution IS NULL).
--      • Otherwise INSERT a new unresolved grace-period row.
--
--   5. The entire operation runs in ONE plpgsql transaction. The
--      trg_student_subscriptions_validate_status and
--      trg_student_subscriptions_auto_history triggers fire inside the same
--      transaction, so a status-claim that must roll back also rolls back its
--      subscription_history row — no partial audit trail.
--
--   Returns TRUE when the row was transitioned, FALSE when it was not eligible.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONCURRENCY / SECURITY REVIEW
-- ════════════════════════════════════════════════════════════════════════════
--   • The conditional UPDATE is the atomic claim: overlapping cron runs (or
--     overlapping deliveries of the same run) serialize on the row — the first
--     UPDATE to commit wins; subsequent calls match 0 rows (status no longer
--     'active') and return FALSE. Exactly one transition per subscription.
--   • SECURITY DEFINER + set search_path = '' with fully qualified public.*
  --     references (project convention, e.g. migration 098). No search_path
  --     hijack, no RLS bypass for untrusted callers: the RPC only ever acts on
  --     the p_subscription_id passed by the caller, and it is invoked by the
  --     lifecycle Edge Function with the service-role client.
  --   • EXECUTE is REVOKED from public/anon/authenticated and granted ONLY to
  --     service_role (mirroring migration 078 approve_trusted_device): this is
  --     a privileged state-changing RPC and must not be directly invokable by
  --     clients via PostgREST. The service-role client used by the lifecycle
  --     job retains execution.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run in the Supabase SQL editor after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Function exists + is SECURITY DEFINER with empty search_path:
--      select proname, prosecdef, proconfig
--      from pg_proc
--      where proname = 'transition_subscription_to_grace';
--
-- 2. Normal active → grace (wrap in a transaction and ROLLBACK — do not commit):
--      begin;
--      select public.transition_subscription_to_grace('<active_subscription_id>');
--      select status from public.student_subscriptions
--       where subscription_id = '<active_subscription_id>';            -- 'grace'
--      select count(*) from public.subscription_grace_periods
--       where subscription_id = '<active_subscription_id>'
--         and resolution is null;                                       -- 1
--      rollback;
--
-- 3. Non-eligible row (already grace / end_date in future / grace_end_date
--    NULL) returns FALSE:
--      select public.transition_subscription_to_grace('<any_subscription_id>');
--      -- false when the row is not active-and-overdue
--
-- 4. Idempotency — calling twice in a row: first returns TRUE, second FALSE:
--      select public.transition_subscription_to_grace('<id>');          -- true
--      select public.transition_subscription_to_grace('<id>');          -- false
--
-- 5. Reuse path (no 23505): pre-insert an unresolved grace row for the target
--    subscription, then call the RPC — expect TRUE and exactly ONE unresolved
--    grace row (dates refreshed):
--      insert into public.subscription_grace_periods (
--        subscription_id, student_id, institute_id,
--        grace_start_date, grace_end_date, trigger_reason
--      ) select subscription_id, student_id, institute_id,
--               '2000-01-01', '2000-01-02', 'manual_expiry'
--        from public.student_subscriptions
--       where subscription_id = '<id>'
--         and status = 'active'
--       limit 1;
--      select public.transition_subscription_to_grace('<id>');
--
-- 6. EXECUTE grants (expect service_role only — no PUBLIC/anon/authenticated):
--      select grantee, privilege_type
--      from information_schema.role_routine_grants
--      where routine_name = 'transition_subscription_to_grace'
--      order by grantee;
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- drop function if exists public.transition_subscription_to_grace(uuid);
-- ============================================================================

create or replace function public.transition_subscription_to_grace(
  p_subscription_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id     uuid;
  v_institute_id   uuid;
  v_end_date       date;
  v_grace_end_date date;
  v_is_auto_renew  boolean;
  v_raw_start      date;
  v_grace_start    date;
  v_trigger_reason text;
  v_grace_id       uuid;
begin
  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 1 — Atomic conditional claim: ACTIVE → GRACE
  -- ════════════════════════════════════════════════════════════════════════
  -- Same eligibility predicates as TRANSITION 1 in subscription-lifecycle:
  --   status='active' AND end_date < current UTC date AND grace_end_date IS NOT NULL
  -- The row lock held by this UPDATE serializes concurrent invocations; only
  -- the first caller to commit wins, all later calls match 0 rows.
  update public.student_subscriptions ss
     set status = 'grace'
   where ss.subscription_id = p_subscription_id
     and ss.status = 'active'
     and ss.end_date < (now() at time zone 'utc')::date
     and ss.grace_end_date is not null
   returning ss.student_id,
             ss.institute_id,
             ss.end_date,
             ss.grace_end_date,
             ss.is_auto_renew
     into v_student_id,
          v_institute_id,
          v_end_date,
          v_grace_end_date,
          v_is_auto_renew;

  if not found then
    return false;
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 2 — Grace window dates (identical clamp semantics)
  -- ════════════════════════════════════════════════════════════════════════
  -- rawStart = end_date + 1 (first day of grace); if rawStart is not strictly
  -- before grace_end_date, clamp to grace_end_date - 1 so the CHECK
  -- ck_subscription_grace_periods_end_date (grace_end_date > grace_start_date)
  -- is satisfied in the degenerate case where grace_end_date == end_date.
  v_raw_start := v_end_date + 1;

  if v_raw_start < v_grace_end_date then
    v_grace_start := v_raw_start;
  else
    v_grace_start := v_grace_end_date - 1;
  end if;

  -- trigger_reason — identical semantics to the Edge Function:
  --   is_auto_renew → 'auto_renewal_failed', else 'manual_expiry'
  v_trigger_reason := case
    when v_is_auto_renew then 'auto_renewal_failed'
    else 'manual_expiry'
  end;

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 3 — Reuse-or-insert the unresolved grace row
  -- ════════════════════════════════════════════════════════════════════════
  -- uq_grace_periods_active_subscription (partial unique index ON
  -- (subscription_id) WHERE resolution IS NULL) guarantees at most one
  -- unresolved row per subscription. If one already exists (e.g. a stale row
  -- left behind by a renew-during-grace flow), REUSE it instead of INSERTing:
  -- refreshing the window dates and resetting reminder bookkeeping so the row
  -- behaves exactly like a freshly created grace window — never a 23505.
  select gp.grace_id
    into v_grace_id
    from public.subscription_grace_periods gp
   where gp.subscription_id = p_subscription_id
     and gp.resolution is null
   limit 1;

  if v_grace_id is not null then
    update public.subscription_grace_periods gp
       set grace_start_date      = v_grace_start,
           grace_end_date        = v_grace_end_date,
           trigger_reason        = v_trigger_reason,
           reminders_sent        = 0,
           last_reminder_sent_at = null
     where gp.grace_id = v_grace_id
       and gp.resolution is null;

    return true;
  end if;

  -- No unresolved row → INSERT a fresh grace record.
  insert into public.subscription_grace_periods (
    subscription_id,
    student_id,
    institute_id,
    grace_start_date,
    grace_end_date,
    trigger_reason
  ) values (
    p_subscription_id,
    v_student_id,
    v_institute_id,
    v_grace_start,
    v_grace_end_date,
    v_trigger_reason
  );

  return true;
end;
$$;

-- ── Restrict execution ─────────────────────────────────────────────────────
-- SECURITY: this RPC is a PRIVILEGED state-changing operation (it moves a
-- subscription from active to grace and writes a grace-period record). Unlike
-- read-only helpers (can_student_access_*, get_my_student_id), it MUST NOT be
-- callable by every anon/authenticated user via PostgREST — otherwise any
-- client could force status transitions directly, bypassing the lifecycle
-- job's batching/eligibility handling. EXECUTE is granted ONLY to
-- service_role, which is exactly how the subscription-lifecycle Edge Function
-- invokes it (service-role client). This mirrors migration 078
-- (approve_trusted_device), the established repo convention for privileged
-- internal RPCs. Authorization/business rules remain in the Edge Function.
revoke execute on function public.transition_subscription_to_grace(uuid) from public;
revoke execute on function public.transition_subscription_to_grace(uuid) from anon, authenticated;

grant execute on function public.transition_subscription_to_grace(uuid)
  to service_role;

comment on function public.transition_subscription_to_grace(uuid) is
  'H2 fix (migration 103): atomically transitions an eligible student_'
  'subscriptions row from active to grace AND creates (or safely reuses) its '
  'unresolved subscription_grace_periods row in a single transaction. Returns '
  'TRUE when the row was transitioned, FALSE when it was not eligible (already '
  'grace/expired, end_date not past, or grace_end_date NULL). Preserves the '
  'exact TRANSITION 1 eligibility predicates, grace_start_date clamp, and '
  'trigger_reason semantics from the subscription-lifecycle Edge Function. '
  'SECURITY DEFINER with empty search_path — safe to call via supabase.rpc '
  'from the lifecycle job with the service-role client. Reusing a stale '
  'unresolved grace row (instead of INSERTing) avoids a 23505 violation of '
  'uq_grace_periods_active_subscription. EXECUTE restricted to service_role — '
  'this is a privileged state-changing operation and must only ever be '
  'invoked by the subscription-lifecycle Edge Function.';

-- ============================================================================
-- END OF MIGRATION 103
-- ============================================================================
