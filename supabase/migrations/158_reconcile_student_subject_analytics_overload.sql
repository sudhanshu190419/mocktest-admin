-- ============================================================================
-- Migration: 158 ? Reconcile Student Subject Analytics Function Overload
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Drops the obsolete 0-argument overload of get_student_subject_analytics()
-- to eliminate PostgREST function overload ambiguity (PGRST203).
--
-- The authoritative parameterized function:
--   public.get_student_subject_analytics(p_test_id uuid DEFAULT NULL)
-- remains intact and handles both:
--   1. Overall cumulative analytics when p_test_id IS NULL (or omitted)
--   2. Test-specific analytics when p_test_id IS provided
--
-- @module migrations/158
-- ============================================================================

-- Drop the obsolete 0-argument overload
DROP FUNCTION IF EXISTS public.get_student_subject_analytics();

-- Ensure the parameterized function is the single authoritative definition
CREATE OR REPLACE FUNCTION public.get_student_subject_analytics(
  p_test_id uuid DEFAULT NULL
)
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
      -- Step 1: Filter to completed attempts for this student (optionally filtered by test)
      student_attempts AS (
        SELECT a.attempt_id
        FROM public.mock_attempts a
        WHERE a.student_id = v_student_id
          AND a.status IN ('submitted', 'timed_out')
          AND (p_test_id IS NULL OR a.test_id = p_test_id)
      ),

      -- Step 2: Join answers + questions + attempt + mock_test_questions
      answer_details AS (
        SELECT
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          ma.marks_awarded,
          ma.time_spent_seconds,
          q.subject_id,
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

      -- Step 3: Aggregate by subject
      subject_agg AS (
        SELECT
          ad.subject_id,
          sub.name AS subject_name,
          count(*) AS total_questions,
          count(*) FILTER (WHERE ad.is_answered = true) AS questions_attempted,
          count(*) FILTER (WHERE ad.is_correct = true) AS correct_count,
          count(*) FILTER (WHERE ad.is_correct = false AND ad.is_answered = true) AS wrong_count,
          count(*) FILTER (WHERE ad.is_answered = false) AS skipped_count,
          coalesce(sum(ad.marks_awarded) FILTER (WHERE ad.is_answered = true), 0) AS total_score,
          coalesce(sum(ad.question_marks) FILTER (WHERE ad.is_answered = true), 0) AS max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) FILTER (WHERE ad.is_answered = true),
              0
            ), 2
          ) AS avg_time_per_question
        FROM answer_details ad
        JOIN public.subjects sub
          ON sub.subject_id = ad.subject_id
        GROUP BY ad.subject_id, sub.name
      )

    -- Step 4: Build the JSON array
    SELECT coalesce(
      json_agg(
        json_build_object(
          'subject_id',                           s.subject_id,
          'subject_name',                         s.subject_name,
          'questions_attempted',                  s.questions_attempted,
          'correct_count',                        s.correct_count,
          'wrong_count',                          s.wrong_count,
          'skipped_count',                        s.skipped_count,
          'accuracy',                             CASE
            WHEN (s.correct_count + s.wrong_count) > 0
            THEN round(
              (s.correct_count::numeric / (s.correct_count + s.wrong_count)) * 100, 2
            )
            ELSE null
          END,
          'total_score',                          s.total_score,
          'max_score',                            s.max_score,
          'percentage',                           CASE
            WHEN s.max_score > 0
            THEN round((s.total_score / s.max_score) * 100, 2)
            ELSE 0
          END,
          'average_time_per_question_seconds',    s.avg_time_per_question
        )
        ORDER BY s.subject_name
      ),
      '[]'::json
    )
    FROM subject_agg s
  );
END;
$$;

COMMENT ON FUNCTION public.get_student_subject_analytics(uuid) IS
  'Returns a JSON array of subject analytics for the authenticated student. '
  'Accepts an optional p_test_id parameter (default NULL). If NULL, aggregates '
  'all completed tests. If provided, aggregates only attempts for that test.';
