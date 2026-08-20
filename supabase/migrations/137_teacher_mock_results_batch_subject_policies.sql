-- ============================================================================
-- Migration 137: Teacher Mock Results Batch Subject Policies & Audit Actions
--
-- 1. Adds 'subjective_evaluation_saved' and 'subjective_evaluation_finalized'
--    to the public.audit_action_type enum.
-- 2. Adds SELECT policy on public.mock_results for teachers with assigned
--    batch subjects via batch_subject_teachers.
-- 3. Adds UPDATE policy on public.mock_results for teachers to update scores
--    during subjective finalization, strictly disallowing teacher release (is_released = false).
--
-- Preserves:
--   - Admin full access
--   - Student access
--   - Existing test-ownership SELECT policy
-- ============================================================================

-- ── 1. Audit Action Enum Additions ──────────────────────────────────────────
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'subjective_evaluation_saved';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'subjective_evaluation_finalized';

-- ── 2. Teacher SELECT Policy on mock_results ────────────────────────────────
CREATE POLICY "Teachers can read mock_results for students in their batch subjects"
  ON public.mock_results
  FOR SELECT
  TO authenticated
  USING (
    public.get_my_teacher_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.batch_students bs
      JOIN public.batch_subjects bsub
        ON bsub.batch_id = bs.batch_id
      JOIN public.batch_subject_teachers bst
        ON bst.batch_subject_id = bsub.batch_subject_id
      WHERE bs.student_id = mock_results.student_id
        AND bst.teacher_id = public.get_my_teacher_id()
    )
  );

COMMENT ON POLICY "Teachers can read mock_results for students in their batch subjects" ON public.mock_results IS
  'Allows teachers to read mock results for students in their assigned batch subjects, enabling score lookup and subjective evaluation review regardless of test author.';

-- ── 3. Teacher UPDATE Policy on mock_results ────────────────────────────────
CREATE POLICY "Teachers can update mock_results for subjective finalization in their batch subjects"
  ON public.mock_results
  FOR UPDATE
  TO authenticated
  USING (
    public.get_my_teacher_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.batch_students bs
      JOIN public.batch_subjects bsub
        ON bsub.batch_id = bs.batch_id
      JOIN public.batch_subject_teachers bst
        ON bst.batch_subject_id = bsub.batch_subject_id
      WHERE bs.student_id = mock_results.student_id
        AND bst.teacher_id = public.get_my_teacher_id()
    )
  )
  WITH CHECK (
    public.get_my_teacher_id() IS NOT NULL
    AND mock_results.is_released = false
    AND EXISTS (
      SELECT 1
      FROM public.batch_students bs
      JOIN public.batch_subjects bsub
        ON bsub.batch_id = bs.batch_id
      JOIN public.batch_subject_teachers bst
        ON bst.batch_subject_id = bsub.batch_subject_id
      WHERE bs.student_id = mock_results.student_id
        AND bst.teacher_id = public.get_my_teacher_id()
    )
  );

COMMENT ON POLICY "Teachers can update mock_results for subjective finalization in their batch subjects" ON public.mock_results IS
  'Allows teachers to update score columns in mock_results during subjective evaluation finalization for their assigned students. Enforces is_released = false to prevent unauthorized release.';
