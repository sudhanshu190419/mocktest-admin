-- ============================================================================
-- Migration: 086 — Subscription Duplicate Active/Grace Guard (Concurrency)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Eliminate the race condition where two concurrent webhook
--          deliveries (or two orders completing back-to-back) could create
--          duplicate ACTIVE or GRACE student_subscriptions rows for the same
--          student and the same subscription plan.
--
-- Problem: The existing unique constraint
--            uq_student_subscriptions_student_plan_start
--              (student_id, plan_id, start_date)
--          only prevents duplicates that share an identical start date. Two
--          orders completing on different days — or a SELECT-then-INSERT
--          race in the purchase backend — could still produce two 'active'
--          rows for the same (student_id, plan_id).
--
-- Solution: A partial UNIQUE index that atomically guarantees at most one
--           ACTIVE or GRACE subscription per (student_id, plan_id):
--
--             create unique index ... on student_subscriptions (student_id, plan_id)
--             where status in ('active', 'grace');
--
--           This enforces the documented Domain-11 business rule
--           (migration 012:289-290): "at most one should have status =
--           'active' or 'grace' at any given time."
--
-- Design notes:
--   • Partial UNIQUE indexes are the standard PostgreSQL mechanism for
--     conditional uniqueness — ADD CONSTRAINT ... UNIQUE does not support a
--     WHERE clause.
--   • The purchase backend (complete-subscription-purchase, Phase 11A.2.1)
--     converts the resulting unique_violation (SQLSTATE 23505) into the
--     standard 409 ALREADY_SUBSCRIBED response; idempotent same-order
--     webhook re-deliveries are recovered by order_id instead.
--   • Fail-fast pre-flight guard: if existing data already violates the new
--     invariant, this migration ABORTS with a clear message rather than
--     silently merging or dropping paid subscription rows — automatic
--     de-duplication of billing data is unsafe.
--   • Expired / cancelled / refunded / pending rows do NOT conflict with
--     this partial index, so a future renewal can stack a new subscription
--     once the previous row leaves active/grace.
--   • An active TRIAL grant (is_trial = true, status = 'active') also blocks
--     a same-plan purchase until it leaves active/grace — consistent with
--     the documented "reject if active/grace" policy.
--
-- Depends on: Migration 012 (Domain 11 — student_subscriptions)
-- Reference: Phase 11A.2 / 11A.2.1 (approved) | 012 uq_student_subscriptions_*
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Pre-flight: abort if existing data violates the invariant
-- ════════════════════════════════════════════════════════════════════════════
-- If any (student_id, plan_id) pair already has more than one active/grace
-- row, creating the unique index below would fail anyway — but with a
-- cryptic "could not create unique index" error. Fail fast instead with a
-- clear message so the operator can resolve the data before applying.
do $$
declare
  v_violating_pairs bigint;
begin
  select count(*) into v_violating_pairs
  from (
    select student_id, plan_id
    from public.student_subscriptions
    where status in ('active', 'grace')
    group by student_id, plan_id
    having count(*) > 1
  ) d;

  if v_violating_pairs > 0 then
    raise exception
      'Migration 086 aborted: % (student_id, plan_id) pair(s) already have '
      'multiple ACTIVE/GRACE subscriptions. Resolve these rows manually '
      '(e.g. expire the older grant) before applying this migration.',
      v_violating_pairs;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Partial UNIQUE index (the atomic guarantee)
-- ════════════════════════════════════════════════════════════════════════════
-- Naming follows the existing table-level unique-constraint family
-- (uq_student_subscriptions_student_plan_start) while the partial predicate
-- matches the established index style from 012 (where status in ...).
create unique index if not exists uq_student_subscriptions_student_plan_active_grace
  on public.student_subscriptions (student_id, plan_id)
  where status in ('active', 'grace');

comment on index public.uq_student_subscriptions_student_plan_active_grace is
  'Concurrency guard (Phase 11A.2.1): guarantees at most one ACTIVE or GRACE '
  'subscription per (student_id, plan_id). The purchase backend converts the '
  'resulting unique_violation (23505) into 409 ALREADY_SUBSCRIBED. '
  'Expired/cancelled/refunded/pending rows do not conflict, so a future '
  'renewal can stack a new subscription once the previous row leaves '
  'active/grace.';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Index exists (expect one row):
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename  = 'student_subscriptions'
--   and indexname  = 'uq_student_subscriptions_student_plan_active_grace';
--
-- 2. Index is UNIQUE and partial (expect true | true):
-- select i.indisunique,
--        (i.indpred is not null) as is_partial
-- from pg_index i
-- join pg_class c     on c.oid = i.indexrelid
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname = 'uq_student_subscriptions_student_plan_active_grace';
--
-- 3. The guard rejects a conflicting second active row.
--    Run inside a transaction and ROLLBACK — do NOT commit this probe.
--    Expected: ERROR: duplicate key value violates unique constraint
--              "uq_student_subscriptions_student_plan_active_grace"
-- begin;
-- insert into public.student_subscriptions (
--   student_id, plan_id, institute_id, status, start_date, end_date
-- )
-- select student_id, plan_id, institute_id, 'active', '2000-01-01', '2000-02-01'
-- from public.student_subscriptions
-- where status in ('active', 'grace')
-- limit 1;
-- rollback;
--
-- 4. No existing duplicates (expect 0):
-- select count(*) as violating_pairs
-- from (
--   select student_id, plan_id
--   from public.student_subscriptions
--   where status in ('active', 'grace')
--   group by student_id, plan_id
--   having count(*) > 1
-- ) d;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (if this migration must be undone)
-- ════════════════════════════════════════════════════════════════════════════
-- drop index if exists public.uq_student_subscriptions_student_plan_active_grace;
