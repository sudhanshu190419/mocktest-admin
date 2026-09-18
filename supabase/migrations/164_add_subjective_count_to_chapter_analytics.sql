-- ============================================================================
-- Migration: 164_add_subjective_count_to_chapter_analytics.sql
-- Description: Add subjective_count to get_student_chapter_analytics() RPC.
--
-- Updates public.get_student_chapter_analytics():
--   - Selects q.question_type in answer_details CTE.
--   - Computes subjective_count as answered questions where question_type = 'subjective'.
--   - Returns 'subjective_count' in JSON output.
--
-- Preserves:
--   - questions_attempted = answered questions (ad.is_answered = true)
--   - correct_count = objective correct only (ad.is_correct = true)
--   - wrong_count = objective wrong only (ad.is_correct = false AND ad.is_answered = true)
--   - skipped_count = unanswered questions (ad.is_answered = false)
--   - accuracy = objective accuracy only ((correct / (correct + wrong)) * 100)
--   - effective_marks and total_score remain intact
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_student_chapter_analytics()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  -- Resolve the caller's student_id from the auth session
  v_student_id := public.get_my_student_id();

  IF v_student_id IS NULL THEN
    RETURN json_build_object(
      'error', 'Authenticated user is not a student or has no student_details row.'
    );
  END IF;

  RETURN (
    WITH
      -- Step 1: Filter to completed attempts with released results for this student
      student_attempts AS (
        SELECT a.attempt_id
        FROM public.mock_attempts a
        JOIN public.mock_results r
          ON r.attempt_id = a.attempt_id
        WHERE a.student_id = v_student_id
          AND a.status IN ('submitted', 'timed_out')
          AND r.is_released = true
      ),

      -- Step 2: Join answers + questions + attempt + mock_test_questions
      answer_details AS (
        SELECT
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          COALESCE(ma.awarded_marks, ma.marks_awarded, 0) AS effective_marks,
          ma.time_spent_seconds,
          q.chapter_id,
          q.subject_id,
          q.question_type,
          mtq.marks AS question_marks
        FROM public.mock_answers ma
        JOIN public.mock_attempts a
          ON a.attempt_id = ma.attempt_id
        JOIN public.questions q
          ON q.question_id = ma.question_id
        JOIN public.mock_test_questions mtq
          ON mtq.test_id = a.test_id
         AND mtq.question_id = ma.question_id
        WHERE a.attempt_id IN (SELECT attempt_id FROM student_attempts)
      ),

      -- Step 3: Aggregate by chapter
      chapter_agg AS (
        SELECT
          ad.chapter_id,
          ch.name AS chapter_name,
          ad.subject_id,
          sub.name AS subject_name,
          count(*) AS total_questions,
          count(*) FILTER (WHERE ad.is_answered = true) AS questions_attempted,
          count(*) FILTER (WHERE ad.is_correct = true) AS correct_count,
          count(*) FILTER (WHERE ad.is_correct = false AND ad.is_answered = true) AS wrong_count,
          count(*) FILTER (WHERE ad.is_answered = false) AS skipped_count,
          count(*) FILTER (WHERE ad.question_type = 'subjective' AND ad.is_answered = true) AS subjective_count,
          coalesce(sum(ad.effective_marks) FILTER (WHERE ad.is_answered = true), 0) AS total_score,
          coalesce(sum(ad.question_marks) FILTER (WHERE ad.is_answered = true), 0) AS max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) FILTER (WHERE ad.is_answered = true),
              0
            ), 2
          ) AS avg_time_per_question
        FROM answer_details ad
        JOIN public.chapters ch
          ON ch.chapter_id = ad.chapter_id
        JOIN public.subjects sub
          ON sub.subject_id = ad.subject_id
        GROUP BY ad.chapter_id, ch.name, ad.subject_id, sub.name
      )

    -- Step 4: Build the JSON array
    SELECT coalesce(
      json_agg(
        json_build_object(
          'chapter_id',                           ca.chapter_id,
          'chapter_name',                         ca.chapter_name,
          'subject_id',                           ca.subject_id,
          'subject_name',                         ca.subject_name,
          'questions_attempted',                  ca.questions_attempted,
          'correct_count',                        ca.correct_count,
          'wrong_count',                          ca.wrong_count,
          'skipped_count',                        ca.skipped_count,
          'subjective_count',                     ca.subjective_count,
          'accuracy',                             CASE
            WHEN (ca.correct_count + ca.wrong_count) > 0
            THEN round(
              (ca.correct_count::numeric / (ca.correct_count + ca.wrong_count)) * 100, 2
            )
            ELSE null
          END,
          'total_score',                          ca.total_score,
          'max_score',                            ca.max_score,
          'percentage',                           CASE
            WHEN ca.max_score > 0
            THEN round((ca.total_score / ca.max_score) * 100, 2)
            ELSE 0
          END,
          'average_time_per_question_seconds',    ca.avg_time_per_question
        )
        ORDER BY ca.chapter_name
      ),
      '[]'::json
    )
    FROM chapter_agg ca
  );
END;
$$;

COMMENT ON FUNCTION public.get_student_chapter_analytics() IS
  'Returns a JSON array of chapter-wise analytics for released test results of the authenticated student. Total score includes evaluated subjective marks, and subjective_count reflects answered subjective questions.';
