-- ============================================================================
-- Migration 229: Fix Subscription Plan Capacity Check for Installments & Non-Plan Subscriptions
--
-- PURPOSE:
-- Fixes error:
--   Settlement RPC error: query returned no rows (SQLSTATE P0002 / NO_DATA_FOUND)
-- encountered in complete-installment-purchase during gateway webhook fulfillment.
--
-- ROOT CAUSE:
-- In Domain 11 (Migration 012), trigger `trg_student_subscriptions_check_capacity` fires
-- on `insert or update on public.student_subscriptions when (new.status = 'active')`
-- and calls `public.trgfn_subscription_check_capacity()`.
--
-- The function contained:
--   if new.status = 'active' then
--     select max_students into strict v_max_students
--       from public.subscription_plans
--      where plan_id = new.plan_id;
--
-- In PL/pgSQL, `select ... into strict` unconditionally throws `query returned no rows`
-- if zero rows match. For installment purchases, subscriptions are course-level and
-- tied to an installment plan (`course_installment_plans`), NOT a recurring
-- `subscription_plans` product. Thus `new.plan_id` is NULL (or not present in
-- `public.subscription_plans`), causing the query to return 0 rows and abort the entire
-- settlement transaction.
--
-- CORRECTION:
-- 1. Updates `public.trgfn_subscription_check_capacity()` to:
--    - Strictly guard with `new.plan_id is not null`.
--    - Use standard `select ... into` (non-strict) so that if a plan_id is not present
--      in `public.subscription_plans`, it safely skips the capacity check instead of crashing.
--    - Adds `security definer` and `set search_path = ''` adhering to database security standards.
-- 2. Updates trigger `trg_student_subscriptions_check_capacity` condition to
--    `when (new.status = 'active' and new.plan_id is not null)`.
-- ============================================================================

create or replace function public.trgfn_subscription_check_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_students integer;
  v_active_count integer;
begin
  -- Only enforce capacity checks on active subscriptions associated with a recurring subscription plan
  if new.status = 'active' and new.plan_id is not null then
    select sp.max_students into v_max_students
      from public.subscription_plans sp
     where sp.plan_id = new.plan_id;

    if v_max_students is not null then
      select count(*) into v_active_count
        from public.student_subscriptions ss
       where ss.plan_id = new.plan_id
         and ss.status = 'active'
         and ss.subscription_id != coalesce(new.subscription_id, '00000000-0000-0000-0000-000000000000'::uuid);

      if v_active_count >= v_max_students then
        raise exception 'Plan % has reached maximum capacity (%)', new.plan_id, v_max_students;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.trgfn_subscription_check_capacity() is
  'Enforces max_students capacity on recurring subscription_plans. Safely ignores course-level and installment subscriptions where plan_id is null or unmanaged by subscription_plans.';

-- Recreate trigger with the plan_id is not null guard
drop trigger if exists trg_student_subscriptions_check_capacity on public.student_subscriptions;

create trigger trg_student_subscriptions_check_capacity
  before insert or update on public.student_subscriptions
  for each row
  when (new.status = 'active' and new.plan_id is not null)
  execute function public.trgfn_subscription_check_capacity();

comment on trigger trg_student_subscriptions_check_capacity on public.student_subscriptions is
  'Fires capacity check before activating a subscription that references a recurring subscription_plan.';
