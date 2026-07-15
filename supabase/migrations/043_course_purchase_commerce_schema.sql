-- ============================================================================
-- Migration: 043 — Course Purchase Commerce Schema
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds the schema support needed for the create-payment-order Edge Function
-- to store course purchase orders in the existing commerce tables.
--
-- This migration MUST run AFTER migration 042 (which adds 'course' to the
-- item_type enum) because all statements here reference item_type = 'course'
-- in CHECK constraints and column comments.
--
-- Changes:
--   1. Adds profile_id to orders (nullable) — enables order creation before
--      student_details exists (pre-onboarding checkout flow)
--   2. Adds course_id to order_items (nullable FK to courses) — polymorphic
--      extension alongside existing plan_id and package_id
--   3. Updates the item_type consistency CHECK constraint to include 'course'
--   4. Adds FK constraints, indexes, and comments
--
-- These changes follow the existing polymorphic pattern where order_items
-- uses item_type as a discriminator with exactly one FK populated per type.
--
-- Depends on:
--   Migration 042 — item_type enum now includes 'course'
--   Domain 07 — public.orders, public.order_items tables
--   Domain 01 — public.profiles, public.student_details tables
--   Domain 16 — public.courses table
--   Migration 008 — Domain 07 Commerce schema
--   Migration 032 — Domain 16 Course Management Core
--
-- @module migrations/043
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Add profile_id to orders
-- ════════════════════════════════════════════════════════════════════════════
-- Enables order creation before the student_details row exists. At checkout
-- time, the user has a profile (from auth) but may not have student_details
-- (created post-payment by complete-course-purchase). The profile_id column
-- provides an alternative FK path so the order can be created upfront.
--
-- Constraints:
--   • profile_id is NULLABLE — existing rows and direct-purchase orders
--     (where student_details already exists) are unaffected.
--   • At least one of profile_id or student_id must be populated — enforced
--     by CHECK constraint below.
--   • Both may be set once student_details is created and linked.

alter table public.orders
  add column if not exists profile_id uuid null;

-- Add FK constraint (idempotent via DO block)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'fk_orders_profile'
  ) then
    alter table public.orders
      add constraint fk_orders_profile
        foreign key (profile_id) references public.profiles (profile_id)
        on delete restrict
        on update restrict;
  end if;
end $$;

-- Add CHECK constraint ensuring at least one identifier is set
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'ck_orders_identifier_present'
  ) then
    alter table public.orders
      add constraint ck_orders_identifier_present
        check (profile_id is not null or student_id is not null);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Add course_id to order_items
-- ════════════════════════════════════════════════════════════════════════════
-- Extends the polymorphic item_type pattern with a 'course' variant.
-- Follows the same convention as plan_id (for subscription_plan) and
-- package_id (for pyq_package).

alter table public.order_items
  add column if not exists course_id uuid null;

-- Add FK constraint
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'fk_order_items_course'
  ) then
    alter table public.order_items
      add constraint fk_order_items_course
        foreign key (course_id) references public.courses (course_id)
        on delete restrict
        on update restrict;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Update item_type Consistency CHECK Constraint
-- ════════════════════════════════════════════════════════════════════════════
-- The existing constraint ensures the correct FK is populated based on
-- item_type. We drop and recreate it to include the new 'course' type.
-- This references item_type = 'course', so it MUST run after migration 042.

alter table public.order_items
  drop constraint if exists ck_order_items_item_type_consistency;

alter table public.order_items
  add constraint ck_order_items_item_type_consistency
    check (
      (item_type = 'subscription_plan' and plan_id is not null and package_id is null and course_id is null)
      or (item_type = 'pyq_package'      and package_id is not null and plan_id is null and course_id is null)
      or (item_type = 'course'           and course_id is not null and plan_id is null and package_id is null)
    );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Indexes
-- ════════════════════════════════════════════════════════════════════════════

-- Index for querying orders by profile_id (pre-onboarding lookup)
create index if not exists idx_orders_profile_id
  on public.orders (profile_id)
  where profile_id is not null;

-- Partial index for course purchases on order_items
create index if not exists idx_order_items_course_id
  on public.order_items (course_id)
  where course_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on column public.orders.profile_id is
  'FK to profiles.profile_id. Alternative to student_id for orders created '
  'before the student_details row exists (pre-onboarding checkout flow). '
  'NULL for orders created after student_details exists. At least one of '
  'profile_id or student_id must be set.';

comment on column public.order_items.course_id is
  'FK to courses.course_id. Populated when item_type = course. NULL '
  'otherwise. Follows the same polymorphic pattern as plan_id and package_id.';

comment on constraint ck_order_items_item_type_consistency on public.order_items is
  'Enforces polymorphic FK consistency: item_type determines which FK is '
  'populated. subscription_plan → plan_id, pyq_package → package_id, '
  'course → course_id. Exactly one FK per item_type. All others must be NULL.';

comment on constraint ck_orders_identifier_present on public.orders is
  'Ensures every order has at least one identity reference: either profile_id '
  '(for pre-onboarding orders) or student_id (for post-onboarding orders). '
  'Both may be set once the student record is linked.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 043 Course Purchase Commerce Schema
-- ════════════════════════════════════════════════════════════════════════════
