-- ============================================================================
-- Migration 131: Teacher Subjective Evaluation SELECT Policy
--
-- The existing SELECT policy ("Teachers can read mock_answers for their tests")
-- only allows reading answers for tests the teacher authored (mt.teacher_id =
-- public.get_my_teacher_id()). For manual evaluation of subjective questions,
-- teachers need to read answers from ANY test containing subjective questions
-- for students in their assigned batch subjects.
--
-- This policy mirrors Migration 130's UPDATE policy but applies to SELECT.
--
-- Depends on: 067 (batch_subject_teachers), 021 (existing mock_answers policies),
--             130 (UPDATE policy)
-- ============================================================================

-- ── Teacher evaluation SELECT policy ───────────────────────────────────────
-- Teachers can SELECT mock_answers when:
--   1. The answer belongs to an attempt for a student in a batch they teach
--   2. They are assigned to that batch_subject via batch_subject_teachers
--   3. The question belongs to the subject they teach in that batch
-- This is used by the manual evaluation service to fetch pending answers
-- and display student answers during evaluation.
create policy "Teachers can read answers for subjective evaluation in their batch subjects"
  on public.mock_answers
  for select
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
  );
