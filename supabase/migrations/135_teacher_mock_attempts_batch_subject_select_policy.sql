-- ============================================================================
-- Migration 135: Teacher Mock Attempts Batch Subject SELECT Policy
--
-- Enables teachers to read mock_attempts for students enrolled in batches
-- where the teacher is assigned via batch_subject_teachers.
--
-- This policy works in conjunction with:
--   - Migration 131: "Teachers can read answers for subjective evaluation in their batch subjects" on mock_answers
--   - Migration 130: "Teachers can evaluate subjective answers in their batch subjects" on mock_answers
--
-- The legacy author-based policy ("Teachers can read mock_attempts on their tests")
-- is preserved to keep existing teacher access intact.
-- ============================================================================

CREATE POLICY "Teachers can read mock_attempts for students in their batch subjects"
  ON public.mock_attempts
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
      WHERE bs.student_id = mock_attempts.student_id
        AND bst.teacher_id = public.get_my_teacher_id()
    )
  );

COMMENT ON POLICY "Teachers can read mock_attempts for students in their batch subjects" ON public.mock_attempts IS
  'Allows teachers to read mock attempt records for students in their assigned batch subjects, enabling subjective question evaluation regardless of test author.';
