-- ============================================================================
-- OPS-ONLY SCRIPT (NOT a migration — do NOT add to supabase/migrations)
-- reconcile_missing_grace_periods.sql
--
-- H2 (production readiness audit) — one-time data repair for corrupted rows.
--
-- PROBLEM
--   Before migration 103 (atomic transition RPC), TRANSITION 1 in the
--   subscription-lifecycle Edge Function performed the status change
--   (active → grace) and the subscription_grace_periods INSERT as two separate
--   PostgREST requests. When the INSERT failed, the subscription was left
--   status='grace' with NO grace-period row. N2/N3/N4 notifications
--   (which INNER-JOIN subscription_grace_periods) never fired, and the later
--   GRACE → EXPIRED resolution UPDATE silently affected 0 rows.
--
-- THIS SCRIPT
--   Finds every student_subscriptions row with status IN ('grace','expired')
--   that has NO corresponding subscription_grace_periods row, and recreates a
--   sensible grace-period record from the subscription's own stored dates.
--
--   • status='grace'  → unresolved row (resolution IS NULL), dates from the
--                       subscription's grace_end_date (clamped start).
--   • status='expired' → resolved row (resolution = 'expired_no_payment'),
--                       dates from the subscription's stored grace_end_date.
--   • status='expired' with grace_end_date IS NULL → CANNOT derive grace
--                       dates; reported but NOT repaired (manual review).
--
-- SAFETY
--   • READ-ONLY preview first (SECTION 1). Review the rows before running.
--   • The repair block (SECTION 2) is guarded by v_execute := false. Change
--     it to true ONLY after reviewing the preview.
--   • Idempotent: the INSERT ... SELECT only inserts where no grace row
--     (matching resolution state) already exists. Safe to re-run.
--   • Wrapped in a single transaction; everything commits or nothing does.
--   • No DELETE / UPDATE of any existing row. No data destruction.
--
-- HOW TO RUN (Supabase SQL editor):
--   1. Run SECTION 1 (preview). Confirm the affected rows look right.
--   2. Run SECTION 2 after setting v_execute := true.
--   3. Run SECTION 3 (post-check) to verify the repair.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — READ-ONLY PREVIEW (safe to run as-is)
-- ════════════════════════════════════════════════════════════════════════════
-- Every corrupted subscription, with the grace dates that would be used.

-- 1a. Grace subscriptions missing an unresolved grace row
select
  ss.subscription_id,
  ss.student_id,
  ss.institute_id,
  ss.status,
  ss.end_date,
  ss.grace_end_date,
  ss.is_auto_renew,
  ss.updated_at,
  case
    when ss.grace_end_date is null then null
    when ss.end_date + 1 < ss.grace_end_date then ss.end_date + 1
    else ss.grace_end_date - 1
  end as computed_grace_start_date,
  case when ss.is_auto_renew then 'auto_renewal_failed' else 'manual_expiry' end as computed_trigger_reason
from public.student_subscriptions ss
where ss.status = 'grace'
  and not exists (
    select 1
    from public.subscription_grace_periods gp
    where gp.subscription_id = ss.subscription_id
      and gp.resolution is null
  )
order by ss.updated_at;

-- 1b. Expired subscriptions missing ANY grace row
select
  ss.subscription_id,
  ss.student_id,
  ss.institute_id,
  ss.status,
  ss.end_date,
  ss.grace_end_date,
  ss.is_auto_renew,
  ss.updated_at,
  case
    when ss.grace_end_date is null then null
    when ss.end_date + 1 < ss.grace_end_date then ss.end_date + 1
    else ss.grace_end_date - 1
  end as computed_grace_start_date,
  case when ss.is_auto_renew then 'auto_renewal_failed' else 'manual_expiry' end as computed_trigger_reason
from public.student_subscriptions ss
where ss.status = 'expired'
  and not exists (
    select 1
    from public.subscription_grace_periods gp
    where gp.subscription_id = ss.subscription_id
  )
order by ss.updated_at;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — REPAIR (guarded)
-- ════════════════════════════════════════════════════════════════════════════
-- Review SECTION 1 output first. Then set v_execute := true and run.
-- Single transaction: commit all or nothing. Idempotent and safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  -- 🔒 SAFETY GUARD: flip to true ONLY after reviewing SECTION 1 output.
  v_execute boolean := true;
  v_grace_inserted bigint := 0;
  v_expired_inserted bigint := 0;
  v_expired_skipped_null_dates bigint := 0;
begin
  if not v_execute then
    raise notice 'RECONCILE_GRACE: guard v_execute = false — no rows written. Set v_execute := true to execute the repair.';
    return;
  end if;

  -- ── 2a. Repair grace subscriptions (unresolved grace row) ────────────────
  insert into public.subscription_grace_periods (
    subscription_id,
    student_id,
    institute_id,
    grace_start_date,
    grace_end_date,
    trigger_reason
  )
  select
    ss.subscription_id,
    ss.student_id,
    ss.institute_id,
    case
      when ss.end_date + 1 < ss.grace_end_date then ss.end_date + 1
      else ss.grace_end_date - 1
    end,
    ss.grace_end_date,
    case when ss.is_auto_renew then 'auto_renewal_failed' else 'manual_expiry' end
  from public.student_subscriptions ss
  where ss.status = 'grace'
    and ss.grace_end_date is not null
    and not exists (
      select 1
      from public.subscription_grace_periods gp
      where gp.subscription_id = ss.subscription_id
        and gp.resolution is null
    );
  get diagnostics v_grace_inserted = row_count;

  -- ── 2b. Repair expired subscriptions (resolved expired_no_payment row) ───
  insert into public.subscription_grace_periods (
    subscription_id,
    student_id,
    institute_id,
    grace_start_date,
    grace_end_date,
    trigger_reason,
    resolution,
    resolved_at
  )
  select
    ss.subscription_id,
    ss.student_id,
    ss.institute_id,
    case
      when ss.end_date + 1 < ss.grace_end_date then ss.end_date + 1
      else ss.grace_end_date - 1
    end,
    ss.grace_end_date,
    case when ss.is_auto_renew then 'auto_renewal_failed' else 'manual_expiry' end,
    'expired_no_payment'::public.grace_period_resolution_type,
    now()
  from public.student_subscriptions ss
  where ss.status = 'expired'
    and ss.grace_end_date is not null
    and not exists (
      select 1
      from public.subscription_grace_periods gp
      where gp.subscription_id = ss.subscription_id
    );
  get diagnostics v_expired_inserted = row_count;

  -- ── 2c. Report expired rows skipped because grace dates cannot be derived
  select count(*) into v_expired_skipped_null_dates
  from public.student_subscriptions ss
  where ss.status = 'expired'
    and ss.grace_end_date is null
    and not exists (
      select 1
      from public.subscription_grace_periods gp
      where gp.subscription_id = ss.subscription_id
    );

  raise notice 'RECONCILE_GRACE: repaired % grace row(s), % expired row(s); % expired row(s) skipped (grace_end_date IS NULL — manual review).',
    v_grace_inserted, v_expired_inserted, v_expired_skipped_null_dates;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — POST-CHECK (read-only)
-- ════════════════════════════════════════════════════════════════════════════
-- After a successful repair, no corrupted rows should remain (0 rows expected
-- in both queries).

-- 3a. Remaining grace subscriptions without an unresolved grace row
select count(*) as remaining_grace_missing
from public.student_subscriptions ss
where ss.status = 'grace'
  and not exists (
    select 1
    from public.subscription_grace_periods gp
    where gp.subscription_id = ss.subscription_id
      and gp.resolution is null
  );

-- 3b. Remaining expired subscriptions without ANY grace row
select count(*) as remaining_expired_missing
from public.student_subscriptions ss
where ss.status = 'expired'
  and not exists (
    select 1
    from public.subscription_grace_periods gp
    where gp.subscription_id = ss.subscription_id
  );

-- ============================================================================
-- END OF RECONCILIATION SCRIPT
-- ============================================================================
