-- ============================================================================
-- Migration 141: Student INSERT policy on mock_results for immediate result release
--
-- ## Problem
--
-- Migration 134 added a student INSERT policy on mock_results that strictly
-- enforced is_released = false. When a test is configured with
-- result_release_mode = 'immediate', the client tries to create the result
-- row as is_released = true (with released_at = NOW()), but PostgreSQL
-- rejects the INSERT with RLS error 42501.
--
-- ## Solution
--
-- Replace the student INSERT policy on mock_results to allow:
-- 1. is_released = false AND released_at IS NULL (for manual, scheduled, or subjective tests)
-- 2. is_released = true AND released_at IS NOT NULL IF AND ONLY IF the referenced
--    mock_test has result_release_mode = 'immediate'.
--
-- ## Security & Invariants
--
-- - INSERT only: students still CANNOT UPDATE or DELETE mock_results.
-- - WITH CHECK ensures student_id = public.get_my_student_id().
-- - For manual or scheduled tests, students CANNOT insert is_released = true.
-- - Constraint ck_mock_results_is_released is fully satisfied.
-- - Student SELECT policy (Migration 132 requiring is_released = true) remains untouched.
-- ============================================================================

-- Drop existing student INSERT policy
DROP POLICY IF EXISTS "Students can insert their own mock_results"
  ON public.mock_results;

-- Recreate with immediate release support
CREATE POLICY "Students can insert their own mock_results"
  ON public.mock_results
  FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = public.get_my_student_id()
    AND (
      -- Case 1: Unreleased result (for manual, scheduled, or subjective pending tests)
      (is_released = false AND released_at IS NULL)
      OR
      -- Case 2: Immediate release (only if test has result_release_mode = 'immediate')
      (
        is_released = true
        AND released_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.mock_tests mt
          WHERE mt.test_id = mock_results.test_id
            AND mt.result_release_mode = 'immediate'
        )
      )
    )
  );

COMMENT ON POLICY "Students can insert their own mock_results"
  ON public.mock_results IS
  'Allows authenticated students to INSERT their own mock_results row. Enforces that is_released = true is allowed ONLY when the referenced mock test is configured with result_release_mode = ''immediate''. For manual and scheduled tests, is_released must be false. Students cannot UPDATE or DELETE results.';