-- ============================================================================
-- Migration 130: Teacher Subjective Evaluation RLS Policy
--
-- Allows teachers to UPDATE mock_answers for subjective question evaluation,
-- scoped to students in their assigned batch subjects via batch_subject_teachers.
--
-- Only evaluation-specific columns are accessible through the service layer;
-- the RLS policy grants UPDATE on the row level. Column-level access control
-- is enforced by the manualEvaluationService (only evaluation fields are set).
--
-- Depends on: 067 (batch_subject_teachers), 021 (existing mock_answers policies)
-- ============================================================================

-- ── Teacher evaluation UPDATE policy ───────────────────────────────────────
-- Teachers can UPDATE mock_answers when:
--   1. The answer belongs to an attempt for a student in a batch they teach
--   2. They are assigned to that batch_subject via batch_subject_teachers
--   3. The question belongs to the subject they teach in that batch
--   4. The answer is for a subjective question (enforced by service, not RLS)
--
-- This policy works in conjunction with the existing SELECT policy
-- ("Teachers can read mock_answers for their tests") which already allows
-- teachers to read answers for tests they authored.
--
-- For evaluation, teachers need access to answers from ANY test containing
-- subjective questions for students in their assigned batches — not just
-- tests they authored. Hence a new policy.
create policy "Teachers can evaluate subjective answers in their batch subjects"
  on public.mock_answers
  for update
  to authenticated
  using (
    -- Verify the caller is a teacher
    public.get_my_teacher_id() IS NOT NULL
    AND
    -- The answer belongs to an attempt for a student in the teacher's assigned batch
    EXISTS (
      SELECT 1
      FROM public.mock_attempts ma
      JOIN public.batch_students bs ON bs.student_id = ma.student_id
      JOIN public.batch_subjects bsub ON bsub.batch_id = bs.batch_id
      JOIN public.batch_subject_teachers bst ON bst.batch_subject_id = bsub.batch_subject_id
      WHERE ma.attempt_id = mock_answers.attempt_id
        AND bst.teacher_id = public.get_my_teacher_id()
        -- Ensure the question belongs to the subject this teacher teaches in this batch
        AND mock_answers.question_id IN (
          SELECT q.question_id
          FROM public.questions q
          WHERE q.subject_id = bsub.subject_id
            AND q.institute_id = bst.institute_id
        )
    )
  )
  with check (
    -- Same verification for the new row state
    public.get_my_teacher_id() IS NOT NULL
    AND
    EXISTS (
      SELECT 1
      FROM public.mock_attempts ma
      JOIN public.batch_students bs ON bs.student_id = ma.student_id
      JOIN public.batch_subjects bsub ON bsub.batch_id = bs.batch_id
      JOIN public.batch_subject_teachers bst ON bst.batch_subject_id = bsub.batch_subject_id
      WHERE ma.attempt_id = mock_answers.attempt_id
        AND bst.teacher_id = public.get_my_teacher_id()
        AND mock_answers.question_id IN (
          SELECT q.question_id
          FROM public.questions q
          WHERE q.subject_id = bsub.subject_id
            AND q.institute_id = bst.institute_id
        )
    )
  );
