-- ============================================================================
-- Migration 132: Student mock_results SELECT requires is_released = true
--
-- ## Problem
--
-- The student SELECT policy on `mock_results` (migration 021) only checks
-- ownership:
--
--   student_id = public.get_my_student_id()
--
-- This allows a student to read ALL their own results at the database level,
-- including unreleased ones. The `is_released` check exists only in the
-- application layer (resultService.ts), which can be bypassed by a modified
-- client or direct Supabase query.
--
-- ## Solution
--
-- Drop the existing student policy and recreate it with an additional
-- `is_released = true` condition. Students can only read results that have
-- been officially released by the admin.
--
-- ## Safety
--
-- - Only affects student SELECT on mock_results.
-- - Does NOT modify admin, teacher, or any other policies.
-- - Existing released results remain visible to students.
-- - Students see no change in the mobile app (app already filters by is_released).
--
-- ============================================================================

-- Drop the existing student policy (idempotent — safe to re-run)
drop policy if exists "Students can read their own mock_results"
  on public.mock_results;

-- Recreate with is_released enforcement
create policy "Students can read their own released mock_results"
  on public.mock_results
  for select
  to authenticated
  using (
    student_id = public.get_my_student_id()
    and is_released = true
  );

comment on policy "Students can read their own released mock_results"
  on public.mock_results is
  'Students can read their own mock_results only when the result has been '
  'released by the admin (is_released = true). Enforces result visibility '
  'at the database level, not just the application layer. Replaces the '
  'ownership-only policy from migration 021.';
