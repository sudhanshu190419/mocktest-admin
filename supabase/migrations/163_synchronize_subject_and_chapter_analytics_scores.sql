-- ============================================================================
-- Migration: 088_synchronize_subject_and_chapter_analytics_scores.sql
-- (Corresponding mocktest-admin: 163_synchronize_subject_and_chapter_analytics_scores.sql)
-- Description: Synchronize subjective evaluations into Subject & Chapter Analytics RPCs.
--
-- Updates the four student analytics RPCs:
--   1. public.get_student_subject_analytics(p_test_id uuid DEFAULT NULL)
--   2. public.get_student_chapter_analytics()
--   3. public.get_student_weak_chapters()
--   4. public.get_student_strong_chapters()
--
-- Calculates effective marks per question as:
--   COALESCE(ma.awarded_marks, ma.marks_awarded, 0)
-- so that evaluated subjective marks stored in `mock_answers.awarded_marks`
-- are included alongside objective marks in total_score and percentage calculations.
--
-- Preserves:
--   - Released-results gating (`r.is_released = true`)
--   - Optional test filter (`p_test_id`)
--   - Objective correct, wrong, and skipped counts (`is_correct` boolean logic)
--   - Accuracy calculation formula (`correct / (correct + wrong) * 100`)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — get_student_subject_analytics(p_test_id uuid DEFAULT NULL)
-- ════════════════════════════════════════════════════════════════════════════

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
      -- Step 1: Filter to completed attempts with released results for this student
      student_attempts AS (
        SELECT a.attempt_id
        FROM public.mock_attempts a
        JOIN public.mock_results r
          ON r.attempt_id = a.attempt_id
        WHERE a.student_id = v_student_id
          AND a.status IN ('submitted', 'timed_out')
          AND r.is_released = true
          AND (p_test_id IS NULL OR a.test_id = p_test_id)
      ),

      -- Step 2: Join answers + questions + attempt + mock_test_questions
      answer_details AS (
        SELECT
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          COALESCE(ma.awarded_marks, ma.marks_awarded, 0) AS effective_marks,
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
          coalesce(sum(ad.effective_marks) FILTER (WHERE ad.is_answered = true), 0) AS total_score,
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
  'Returns a JSON array of subject analytics for released test results of the authenticated student. Accepts an optional p_test_id parameter (default NULL). If NULL, aggregates all released tests. If provided, aggregates only attempts for that specific test. Total score includes evaluated subjective marks.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — get_student_chapter_analytics()
-- ════════════════════════════════════════════════════════════════════════════

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
  'Returns a JSON array of chapter-wise analytics for released test results of the authenticated student. Total score includes evaluated subjective marks.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — get_student_weak_chapters()
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_student_weak_chapters()
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

  -- Return chapters ordered weakest → strongest
  RETURN (
    WITH
      student_attempts AS (
        SELECT a.attempt_id
        FROM public.mock_attempts a
        JOIN public.mock_results r
          ON r.attempt_id = a.attempt_id
        WHERE a.student_id = v_student_id
          AND a.status IN ('submitted', 'timed_out')
          AND r.is_released = true
      ),
      answer_details AS (
        SELECT
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          COALESCE(ma.awarded_marks, ma.marks_awarded, 0) AS effective_marks,
          ma.time_spent_seconds,
          q.chapter_id,
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
      chapter_agg AS (
        SELECT
          ad.chapter_id,
          ch.name AS chapter_name,
          ad.subject_id,
          sub.name AS subject_name,
          count(*) FILTER (WHERE ad.is_answered = true)                  AS questions_attempted,
          count(*) FILTER (WHERE ad.is_correct = true)                   AS correct_count,
          count(*) FILTER (WHERE ad.is_correct = false AND ad.is_answered = true) AS wrong_count,
          count(*) FILTER (WHERE ad.is_answered = false)                  AS skipped_count,
          coalesce(sum(ad.effective_marks) FILTER (WHERE ad.is_answered = true), 0) AS total_score,
          coalesce(sum(ad.question_marks) FILTER (WHERE ad.is_answered = true), 0) AS max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) FILTER (WHERE ad.is_answered = true),
              0
            ), 2
          )                                                               AS avg_time_per_question
        FROM answer_details ad
        JOIN public.chapters ch
          ON ch.chapter_id = ad.chapter_id
        JOIN public.subjects sub
          ON sub.subject_id = ad.subject_id
        GROUP BY ad.chapter_id, ch.name, ad.subject_id, sub.name
      )
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
        ORDER BY (CASE WHEN ca.max_score > 0 THEN round((ca.total_score / ca.max_score) * 100, 2) ELSE 0 END) ASC NULLS LAST
      ),
      '[]'::json
    )
    FROM chapter_agg ca
    WHERE ca.questions_attempted > 0
  );
END;
$$;

COMMENT ON FUNCTION public.get_student_weak_chapters() IS
  'Returns a JSON array of chapters ordered from weakest to strongest based on percentage score from released test results. Total score includes evaluated subjective marks.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — get_student_strong_chapters()
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_student_strong_chapters()
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

  -- Return chapters ordered strongest → weakest
  RETURN (
    WITH
      student_attempts AS (
        SELECT a.attempt_id
        FROM public.mock_attempts a
        JOIN public.mock_results r
          ON r.attempt_id = a.attempt_id
        WHERE a.student_id = v_student_id
          AND a.status IN ('submitted', 'timed_out')
          AND r.is_released = true
      ),
      answer_details AS (
        SELECT
          ma.question_id,
          ma.is_correct,
          ma.is_answered,
          COALESCE(ma.awarded_marks, ma.marks_awarded, 0) AS effective_marks,
          ma.time_spent_seconds,
          q.chapter_id,
          q.subject_id,
          mtq.marks AS question_marks
        FROM public.mock_answers ma
        JOIN public.mock_attempts a
          on a.attempt_id = ma.attempt_id
        JOIN public.questions q
          on q.question_id = ma.question_id
        JOIN public.mock_test_questions mtq
          on mtq.test_id = a.test_id
         and mtq.question_id = ma.question_id
        WHERE a.attempt_id IN (SELECT attempt_id FROM student_attempts)
      ),
      chapter_agg AS (
        SELECT
          ad.chapter_id,
          ch.name AS chapter_name,
          ad.subject_id,
          sub.name AS subject_name,
          count(*) FILTER (WHERE ad.is_answered = true)                  AS questions_attempted,
          count(*) FILTER (WHERE ad.is_correct = true)                   AS correct_count,
          count(*) FILTER (WHERE ad.is_correct = false AND ad.is_answered = true) AS wrong_count,
          count(*) FILTER (WHERE ad.is_answered = false)                  AS skipped_count,
          coalesce(sum(ad.effective_marks) FILTER (WHERE ad.is_answered = true), 0) AS total_score,
          coalesce(sum(ad.question_marks) FILTER (WHERE ad.is_answered = true), 0) AS max_score,
          round(
            coalesce(
              avg(ad.time_spent_seconds) FILTER (WHERE ad.is_answered = true),
              0
            ), 2
          )                                                               AS avg_time_per_question
        FROM answer_details ad
        JOIN public.chapters ch
          ON ch.chapter_id = ad.chapter_id
        JOIN public.subjects sub
          ON sub.subject_id = ad.subject_id
        GROUP BY ad.chapter_id, ch.name, ad.subject_id, sub.name
      )
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
        ORDER BY (CASE WHEN ca.max_score > 0 THEN round((ca.total_score / ca.max_score) * 100, 2) ELSE 0 END) DESC NULLS LAST
      ),
      '[]'::json
    )
    FROM chapter_agg ca
    WHERE ca.questions_attempted > 0
  );
END;
$$;

COMMENT ON FUNCTION public.get_student_strong_chapters() IS
  'Returns a JSON array of chapters ordered from strongest to weakest based on percentage score from released test results. Total score includes evaluated subjective marks.';
