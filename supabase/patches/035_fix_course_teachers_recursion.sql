-- ============================================================================
-- Patch: 035 — Fix Infinite RLS Recursion Between course_teachers ↔ course_enrollments
--
-- PostgreSQL 16 | Supabase SQL Editor | Idempotent
--
-- Problem:
--   A mutual RLS recursion cycle exists:
--     course_teachers(student policy)
--       → subqueries course_enrollments → RLS fires
--         → course_enrollments(teacher policy)
--           → subqueries course_teachers → RLS fires → ... INFINITE RECURSION
--
-- Fix:
--   1. Create a SECURITY DEFINER helper function that queries course_enrollments
--      with RLS bypassed, so the teacher policy on course_enrollments never fires.
--   2. Replace the student SELECT policy on course_teachers to use the new helper.
--
-- Authorization preserved:
--   - The function internally calls get_my_student_id() to scope to the current user
--   - Only a boolean is returned — no enrollment data is leaked
--   - Same semantic check as the original inline subquery
--
-- Safe to run multiple times (idempotent):
--   - CREATE OR REPLACE FUNCTION
--   - DROP POLICY IF EXISTS + CREATE POLICY
--   - No CREATE TABLE, ALTER TABLE, CREATE INDEX, or other DDL
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Helper Function
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER bypasses RLS on course_enrollments, breaking the cycle.
-- get_my_student_id() scopes the check to the current authenticated user.

create or replace function public.is_student_enrolled_in_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_enrollments ce
    where ce.course_id = p_course_id
      and ce.student_id = public.get_my_student_id()
  );
$$;

comment on function public.is_student_enrolled_in_course(uuid) is
  'Returns TRUE if the current user has an enrollment record in the given course. '
  'SECURITY DEFINER prevents recursive RLS evaluation between course_teachers '
  'and course_enrollments policies. Authorization is preserved via internal '
  'call to get_my_student_id().';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Replace Recursive Student Policy on course_teachers
-- ════════════════════════════════════════════════════════════════════════════
-- The old policy used an inline subquery on course_enrollments, which triggered
-- RLS on course_enrollments → teacher policy → subquery on course_teachers → ∞.
--
-- The new policy calls the SECURITY DEFINER helper, which queries
-- course_enrollments with RLS bypassed — the teacher policy never fires.

drop policy if exists "Students can read course_teachers for enrolled courses"
  on public.course_teachers;

create policy "Students can read course_teachers for enrolled courses"
  on public.course_teachers
  for select
  to authenticated
  using (public.is_student_enrolled_in_course(course_id));

-- ════════════════════════════════════════════════════════════════════════════
-- END OF PATCH — 035
-- ════════════════════════════════════════════════════════════════════════════
