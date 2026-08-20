-- ============================================================================
-- Migration 134: Student INSERT policy on mock_results
--
-- ## Problem
--
-- The mobile app's evaluateAttempt() performs a client-side INSERT into
-- mock_results after scoring a submitted test. The current RLS policies
-- on mock_results are:
--
--   1. Students SELECT (migration 132) — SELECT only, is_released = true
--   2. Teachers SELECT (migration 083) — SELECT only, batch visibility
--   3. Admin ALL (migration 021)       — ALL operations, is_admin()
--
-- There is NO student INSERT policy. When the authenticated student tries
-- to INSERT their own result (with is_released = false), PostgreSQL rejects
-- it with RLS error 42501.
--
-- ## Solution
--
-- Add a scoped INSERT policy that allows students to create their own
-- result rows, but ONLY with is_released = false. Students cannot release
-- their own results — that remains admin-only.
--
-- ## Safety
--
-- - INSERT only — students cannot UPDATE or DELETE results.
-- - WITH CHECK ensures student_id matches the authenticated student.
-- - WITH CHECK ensures is_released = false — students cannot self-release.
-- - Existing SELECT policy (migration 132) unchanged — students still
--   cannot read unreleased results.
-- - Admin ALL policy unchanged.
-- - Teacher policies unchanged.
-- - CHECK constraint ck_mock_results_is_released is satisfied:
--   is_released = false AND released_at = NULL.
--
-- ============================================================================

-- Student INSERT policy: own results, always unreleased
create policy "Students can insert their own mock_results"
  on public.mock_results
  for insert
  to authenticated
  with check (
    student_id = public.get_my_student_id()
    and is_released = false
  );

comment on policy "Students can insert their own mock_results"
  on public.mock_results is
  'Allows authenticated students to INSERT their own mock_results row after '
  'test submission and evaluation. The student_id must match the '
  'authenticated user''s student_details, and is_released must be false '
  '(students cannot self-release results). This policy does NOT grant '
  'UPDATE or DELETE access — students cannot modify results after creation. '
  'Added to fix RLS error 42501 during mobile test submission.';
