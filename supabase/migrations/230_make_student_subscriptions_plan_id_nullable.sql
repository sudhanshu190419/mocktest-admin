-- ============================================================================
-- Migration 230: Make student_subscriptions.plan_id Nullable for Course-Level Subscriptions
--
-- PURPOSE:
-- Fixes error:
--   Settlement RPC error: null value in column "plan_id" of relation "student_subscriptions" violates not-null constraint
-- encountered in complete-installment-purchase during gateway webhook fulfillment.
--
-- ROOT CAUSE:
-- In Domain 11 (Migration 012), `public.student_subscriptions` was created with:
--   plan_id uuid not null references public.subscription_plans (plan_id)
-- under the assumption that all subscriptions were tied to platform recurring plans.
--
-- With the introduction of the course installment architecture (Migration 219, 221, 228),
-- subscriptions are managed directly at the course level (`course_id`).
-- In `public.process_installment_payment()`, the entitlement synchronization inserts a
-- course-based subscription record without a recurring `subscription_plans.plan_id`:
--   insert into public.student_subscriptions (
--     student_id, course_id, institute_id, start_date, end_date, ...
--   ) values ...
-- Because `plan_id` remained `NOT NULL`, PostgreSQL rejected the insertion.
--
-- CORRECTION:
-- 1. Drops the NOT NULL constraint on `public.student_subscriptions.plan_id`.
-- 2. Adds check constraint `ck_student_subscriptions_plan_or_course` to ensure every
--    subscription record is anchored to either a recurring plan (`plan_id`) or a course (`course_id`).
-- 3. Adds index `idx_student_subscriptions_student_course` to optimize the installment
--    entitlement lookup query: (student_id, course_id).
-- ============================================================================

-- 1. Make plan_id nullable
alter table public.student_subscriptions
  alter column plan_id drop not null;

-- 2. Ensure each subscription record has at least a plan_id or a course_id
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_student_subscriptions_plan_or_course'
  ) then
    alter table public.student_subscriptions
      add constraint ck_student_subscriptions_plan_or_course
      check (plan_id is not null or course_id is not null);
  end if;
end $$;

comment on constraint ck_student_subscriptions_plan_or_course on public.student_subscriptions is
  'Ensures that every subscription is associated with either a subscription plan (recurring platform pass) or a course (installment / modular course enrollment).';

-- 3. Optimization index for installment course subscription lookups
create index if not exists idx_student_subscriptions_student_course
  on public.student_subscriptions (student_id, course_id)
  where course_id is not null;
