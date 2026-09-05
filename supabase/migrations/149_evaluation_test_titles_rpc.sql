-- ============================================================================
-- Migration 149: Teacher Evaluation Test Titles RPC
--
-- Provides evaluation-specific metadata access (test_id, title) for teachers
-- evaluating subjective attempts, without modifying the strict own-tests-only
-- RLS policy on public.mock_tests.
--
-- Authorization is strictly scoped to:
--   1. Super Admin / Academic Admin: Any test within their institute.
--   2. Teacher: Tests that have attempts from students in batches & subjects
--      assigned to the teacher via batch_subject_teachers.
--
-- Usage:
--   supabase.rpc('get_evaluation_test_titles', { p_test_ids: ['...'] })
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_evaluation_test_titles(p_test_ids uuid[])
RETURNS TABLE(test_id uuid, title text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_institute_id uuid;
  v_is_admin boolean;
BEGIN
  -- Authenticated user check
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  v_institute_id := public.get_my_institute_id();
  v_teacher_id := public.get_my_teacher_id();
  v_is_admin := public.is_super_admin() OR public.is_academic_admin();

  IF v_is_admin THEN
    -- Admins can view any test title within their institute
    RETURN QUERY
    SELECT mt.test_id, mt.title::text
    FROM public.mock_tests mt
    WHERE mt.test_id = ANY(p_test_ids)
      AND mt.institute_id = v_institute_id;
    RETURN;
  END IF;

  IF v_teacher_id IS NULL THEN
    RETURN;
  END IF;

  -- For Teachers: Return test title IF:
  -- A) Teacher authored the test (created_by = auth.uid() OR teacher_id = v_teacher_id)
  -- OR
  -- B) The test has an attempt by a student enrolled in a batch-subject taught by this teacher
  RETURN QUERY
  SELECT mt.test_id, mt.title::text
  FROM public.mock_tests mt
  WHERE mt.test_id = ANY(p_test_ids)
    AND mt.institute_id = v_institute_id
    AND (
      mt.teacher_id = v_teacher_id
      OR mt.created_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.mock_attempts ma
        JOIN public.batch_students bs ON bs.student_id = ma.student_id
        JOIN public.batch_subjects bsub ON bsub.batch_id = bs.batch_id
        JOIN public.batch_subject_teachers bst ON bst.batch_subject_id = bsub.batch_subject_id
        WHERE ma.test_id = mt.test_id
          AND bst.teacher_id = v_teacher_id
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_evaluation_test_titles(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_evaluation_test_titles(uuid[]) IS
  'Returns test_id and title for evaluation attempts authorized under batch_subject_teachers without granting full SELECT access to mock_tests.';
