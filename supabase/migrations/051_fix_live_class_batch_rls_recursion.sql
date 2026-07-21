-- ============================================================================
-- Migration: 051 — Fix live_class_batch RLS Infinite Recursion
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Problem
-- -------
-- Migration 050 added INSERT and DELETE policies for teachers on
-- `live_class_batch`. These policies use direct subqueries against
-- `live_classes` to verify teacher ownership. However, the `live_classes`
-- student SELECT policy also queries `live_class_batch` to check batch
-- enrollment. This creates a circular RLS dependency:
--
--   live_class_batch INSERT/DELETE/SELECT
--     → queries live_classes (via policy subquery)
--       → live_classes RLS evaluates ALL policies (OR'd together)
--         → Student SELECT policy queries live_class_batch
--           → live_class_batch SELECT policy queries live_classes
--             → INFINITE RECURSION
--
-- Solution
-- --------
-- Follow the same pattern used in migration 021 to solve similar recursion
-- issues: create SECURITY DEFINER helper functions that query the protected
-- tables without triggering RLS, then rewrite policies to call the helpers.
--
-- Two new helper functions:
--
--   1. public.get_live_class_teacher_id(class_id)
--      → Returns the teacher_id for a given live_classes row.
--        Used by live_class_batch policies to verify ownership.
--
--   2. public.is_student_in_live_class_batches(class_id)
--      → Returns TRUE if the current student is enrolled in any batch
--        linked to the given live class.
--        Used by the live_classes student SELECT policy.
--
-- Then rewrite four policies:
--   - live_class_batch INSERT  (migration 050) → use helper #1
--   - live_class_batch DELETE  (migration 050) → use helper #1
--   - live_class_batch SELECT  (migration 021) → use helper #1
--   - live_classes student SELECT (migration 021) → use helper #2
--
-- Dependencies
-- ------------
--   Migration 021 (existing helper functions: get_my_teacher_id, etc.)
--   Migration 050 (existing INSERT/DELETE policies being replaced)
--   Tables: live_classes, live_class_batch, batch_students
--
-- Security
-- --------
-- Both helper functions are:
--   - SECURITY DEFINER (runs as owner, bypasses RLS)
--   - SET search_path = '' (prevents search-path hijacking)
--   - STABLE (can be cached within a statement)
--
-- The functions only return data the caller already has implicit permission
-- to see via the outer policy — there is no privilege escalation.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Helper Functions
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. get_live_class_teacher_id()
-- Returns the teacher_id for a given live_classes row.
-- SECURITY DEFINER bypasses RLS on live_classes, breaking the recursion
-- cycle when live_class_batch policies need to verify ownership.
create or replace function public.get_live_class_teacher_id(class_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select teacher_id
  from public.live_classes
  where live_classes.class_id = class_id
  limit 1;
$$;

-- 1b. is_student_in_live_class_batches()
-- Returns TRUE if the current authenticated user (as a student) is enrolled
-- in any batch linked to the given live class.
-- SECURITY DEFINER bypasses RLS on live_class_batch, breaking the recursion
-- cycle when the live_classes student policy needs to check batch enrollment.
create or replace function public.is_student_in_live_class_batches(class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.live_class_batch lcb
    join public.batch_students bs on bs.batch_id = lcb.batch_id
    where lcb.class_id = class_id
      and bs.student_id = public.get_my_student_id()
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Rewrite live_class_batch Policies
-- ════════════════════════════════════════════════════════════════════════════
-- These policies previously queried live_classes directly, which triggered
-- RLS on live_classes and caused infinite recursion.
-- Now they call get_live_class_teacher_id() which bypasses RLS.

-- 2a. Drop the old recursive policies

drop policy if exists "Teachers can read live_class_batch for their classes"
  on public.live_class_batch;

drop policy if exists "Teachers can insert into live_class_batch for their classes"
  on public.live_class_batch;

drop policy if exists "Teachers can delete from live_class_batch for their classes"
  on public.live_class_batch;

-- Note: "Admins have full access to live_class_batch" remains unchanged
-- because is_admin() is already SECURITY DEFINER and does not create recursion.

-- 2b. SELECT policy (replaces the one from migration 021)
-- Teachers can read batch mappings for classes they own.
create policy "Teachers can read live_class_batch for their classes"
  on public.live_class_batch
  for select
  to authenticated
  using (
    public.get_live_class_teacher_id(live_class_batch.class_id) = public.get_my_teacher_id()
  );

-- 2c. INSERT policy (replaces the one from migration 050)
-- Teachers can link batches to classes they own.
create policy "Teachers can insert into live_class_batch for their classes"
  on public.live_class_batch
  for insert
  to authenticated
  with check (
    public.get_live_class_teacher_id(live_class_batch.class_id) = public.get_my_teacher_id()
  );

-- 2d. DELETE policy (replaces the one from migration 050)
-- Teachers can remove batch links from classes they own.
create policy "Teachers can delete from live_class_batch for their classes"
  on public.live_class_batch
  for delete
  to authenticated
  using (
    public.get_live_class_teacher_id(live_class_batch.class_id) = public.get_my_teacher_id()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Rewrite live_classes Student SELECT Policy
-- ════════════════════════════════════════════════════════════════════════════
-- This policy previously queried live_class_batch directly, which triggered
-- RLS on live_class_batch and contributed to the recursion cycle.
-- Now it calls is_student_in_live_class_batches() which bypasses RLS.

-- 3a. Drop the old recursive policy

drop policy if exists "Students can read live_classes for their batches"
  on public.live_classes;

-- 3b. New student SELECT policy (replaces the one from migration 021)
-- Students can read live classes for batches they are enrolled in.
create policy "Students can read live_classes for their batches"
  on public.live_classes
  for select
  to authenticated
  using (
    public.is_student_in_live_class_batches(live_classes.class_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 051
-- ════════════════════════════════════════════════════════════════════════════
