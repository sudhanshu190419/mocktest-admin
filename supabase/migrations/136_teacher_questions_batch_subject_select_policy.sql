-- ============================================================================
-- Migration 136: Teacher Questions Batch Subject SELECT Policy
--
-- Enables authenticated teachers to read questions for subjects assigned to
-- them in batch_subjects via batch_subject_teachers.
--
-- This policy works in conjunction with:
--   - Migration 131: "Teachers can read answers for subjective evaluation in their batch subjects" on mock_answers
--   - Migration 135: "Teachers can read mock_attempts for students in their batch subjects" on mock_attempts
--
-- Existing policies on public.questions:
--   - "Teachers have full access to their own questions" (created_by = auth.uid()) is preserved.
--   - "Admins have full access to questions" is preserved.
--   - "Students can read published questions" is preserved.
-- ============================================================================

CREATE POLICY "Teachers can read questions for assigned subjects"
  ON public.questions
  FOR SELECT
  TO authenticated
  USING (
    public.is_teacher()
    AND EXISTS (
      SELECT 1
      FROM public.batch_subjects bs
      JOIN public.batch_subject_teachers bst
        ON bst.batch_subject_id = bs.batch_subject_id
      WHERE bs.subject_id = questions.subject_id
        AND bst.teacher_id = public.get_my_teacher_id()
    )
  );

COMMENT ON POLICY "Teachers can read questions for assigned subjects" ON public.questions IS
  'Allows teachers to read question stems and metadata for subjects assigned to them via batch_subject_teachers, enabling subjective answer evaluation and curriculum visibility.';
