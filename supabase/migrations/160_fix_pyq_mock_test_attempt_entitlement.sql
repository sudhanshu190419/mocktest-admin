-- ============================================================================
-- Migration: 160 — Fix PYQ Mock Test Attempt Entitlement & Access
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEM
-- ════════════════════════════════════════════════════════════════════════════
-- When a student purchases a PYQ package (student_pyq_purchases), the package
-- contains multiple papers (pyq_papers) mapped to mock tests (pyq_mock_mappings).
--
-- However, Migration 098's `can_student_attempt_mock_test(p_test_id)` only checked:
--   (a) Tests with NO course/batch linkage (free fallback)
--   (b) Direct course enrollments (course_mock_tests)
--   (c) Batch subject enrollments (batch_subject_mock_tests)
--   (d) Legacy batch links (batch_mock_tests)
--
-- It completely omitted checking whether the test belongs to a purchased PYQ package!
--
-- Result:
--   - If a mock test was ONLY created for PYQ and not mapped to any course batch,
--     condition (a) evaluated to TRUE (accidental free pass).
--   - If a mock test was ALSO mapped to a course/batch in batch_subject_mock_tests,
--     condition (a) evaluated to FALSE, and because the student only held a PYQ
--     purchase (not a full course subscription), conditions (b), (c), and (d) failed.
--   - The student was blocked by `initialize_mock_attempt` (ENTITLEMENT_REQUIRED)
--     and RLS on `mock_tests` / `mock_test_questions`, showing "Cannot access test".
--
-- ════════════════════════════════════════════════════════════════════════════
-- FIX
-- ════════════════════════════════════════════════════════════════════════════
-- Update `can_student_attempt_mock_test(p_test_id)` to include clause (e):
--   (e) Active PYQ package purchase via pyq_mock_mappings -> pyq_papers ->
--       student_pyq_purchases for the current authenticated student.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_student_attempt_mock_test(
    p_test_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    -- (a) No course/batch linkage → free institute-wide test
    NOT EXISTS (
      SELECT 1 FROM public.course_mock_tests cmt
       WHERE cmt.test_id = p_test_id
      UNION ALL
      SELECT 1 FROM public.batch_subject_mock_tests bsmt
       WHERE bsmt.test_id = p_test_id
      UNION ALL
      SELECT 1 FROM public.batch_mock_tests bmt
       WHERE bmt.test_id = p_test_id
    )
    -- (b) Content entitlement for ANY directly-linked course
    OR EXISTS (
      SELECT 1 FROM public.course_mock_tests cmt
       WHERE cmt.test_id = p_test_id
         AND public.can_student_access_content(cmt.course_id)
    )
    -- (c) Content entitlement for ANY linked batch-subject
    OR EXISTS (
      SELECT 1 FROM public.batch_subject_mock_tests bsmt
       WHERE bsmt.test_id = p_test_id
         AND public.can_student_access_content_batch_subject(bsmt.batch_subject_id)
    )
    -- (d) Content entitlement for ANY legacy-batch-linked course
    OR EXISTS (
      SELECT 1
        FROM public.batch_mock_tests bmt
        JOIN public.course_batches cb ON cb.batch_id = bmt.batch_id
       WHERE bmt.test_id = p_test_id
         AND public.can_student_access_content(cb.course_id)
    )
    -- (e) Active PYQ package purchase for ANY linked PYQ paper
    OR EXISTS (
      SELECT 1
        FROM public.pyq_mock_mappings pmm
        JOIN public.pyq_papers pp ON pp.paper_id = pmm.paper_id
        JOIN public.student_pyq_purchases spp ON spp.package_id = pp.package_id
       WHERE pmm.test_id = p_test_id
         AND spp.student_id = public.get_my_student_id()
         AND spp.is_active = true
    );
$$;

COMMENT ON FUNCTION public.can_student_attempt_mock_test(uuid) IS
  'Audit C3 + PYQ Fix: TRUE when the current authenticated student may attempt '
  'the given mock test. Supports free unlinked tests, active course subscriptions, '
  'batch enrollments, and active purchased PYQ packages via pyq_mock_mappings. '
  'SECURITY DEFINER — safe to call from RLS policies and initialize_mock_attempt.';
