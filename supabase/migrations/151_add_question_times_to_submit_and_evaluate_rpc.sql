-- ============================================================================
-- Migration: 076 — Add question_times to submit_and_evaluate_mock_attempt RPC
--
-- Background:
--   During high-concurrency exam submissions, updating time_spent_seconds on
--   mock_answers via N individual HTTP PATCH requests before calling submit
--   caused severe PostgREST connection starvation and queue delays.
--
-- Enhancements:
--   1. Adds optional `p_question_times JSONB DEFAULT NULL` parameter.
--   2. Bulk-updates mock_answers.time_spent_seconds in a single atomic SQL
--      statement before iterating through answers and computing scores.
--   3. Eliminates N sequential client-side HTTP PATCH roundtrips prior to submit.
--   4. Preserves 100% of existing evaluation, scoring, negative marking,
--      idempotency, subjective evaluation, and result release logic.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- Drop old 2-argument signature to prevent ambiguous overload resolution
-- ════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.submit_and_evaluate_mock_attempt(UUID, INTEGER);

-- ════════════════════════════════════════════════════════════════════════════
-- FUNCTION: submit_and_evaluate_mock_attempt
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_and_evaluate_mock_attempt(
  p_attempt_id         UUID,
  p_time_taken_seconds INTEGER DEFAULT NULL,
  p_question_times     JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt               RECORD;
  v_mock_test             RECORD;
  v_student_id            UUID;
  v_existing_result       RECORD;
  v_now                   TIMESTAMPTZ;
  v_total_questions       INTEGER := 0;
  v_max_score             NUMERIC(6,2) := 0;
  v_total_score           NUMERIC(6,2) := 0;
  v_correct_count         INTEGER := 0;
  v_wrong_count           INTEGER := 0;
  v_skipped_count         INTEGER := 0;
  v_total_time_seconds    INTEGER := 0;
  v_avg_time_per_question NUMERIC(6,2) := 0;
  v_percentage            NUMERIC(5,2) := 0;
  v_has_subjective        BOOLEAN := false;
  v_is_immediate          BOOLEAN := false;
  v_is_released           BOOLEAN := false;
  v_released_at           TIMESTAMPTZ := NULL;
  v_result_id             UUID;
  v_ans                   RECORD;
  v_q_type                TEXT;
  v_q_marks               NUMERIC(5,2);
  v_neg_marks             NUMERIC(5,2);
  v_is_correct            BOOLEAN;
  v_marks_awarded         NUMERIC(5,2);
  v_eval_status           TEXT;
  v_selected_opts         TEXT[];
  v_correct_opts          TEXT[];
  v_correct_num           NUMERIC;
  v_tol                   NUMERIC;
  v_stud_num              NUMERIC;
BEGIN
  -- ════════════════════════════════════════════════════════════════════════
  --  1. TRANSACTION LOCK ON ATTEMPT
  -- ════════════════════════════════════════════════════════════════════════
  SELECT * INTO v_attempt
  FROM public.mock_attempts
  WHERE attempt_id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Attempt not found.',
      'code',    'ATTEMPT_NOT_FOUND'
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  --  2. CALLER AUTHORIZATION CHECK
  -- ════════════════════════════════════════════════════════════════════════
  v_student_id := public.get_my_student_id();
  IF (v_student_id IS NULL OR v_attempt.student_id != v_student_id) AND NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Unauthorized: cannot submit an attempt for a different student.',
      'code',    'STUDENT_MISMATCH'
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  --  3. IDEMPOTENCY CHECK
  -- ════════════════════════════════════════════════════════════════════════
  -- If a result has already been generated for this attempt, return it directly.
  SELECT * INTO v_existing_result
  FROM public.mock_results
  WHERE attempt_id = p_attempt_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success',               true,
      'attempt_id',            p_attempt_id,
      'result_id',             v_existing_result.result_id,
      'test_id',               v_existing_result.test_id,
      'student_id',            v_existing_result.student_id,
      'institute_id',          v_existing_result.institute_id,
      'total_score',           v_existing_result.total_score,
      'max_score',             v_existing_result.max_score,
      'percentage',            v_existing_result.percentage,
      'correct_count',         v_existing_result.correct_count,
      'wrong_count',           v_existing_result.wrong_count,
      'skipped_count',         v_existing_result.skipped_count,
      'total_time_seconds',    v_existing_result.total_time_seconds,
      'avg_time_per_question', v_existing_result.avg_time_per_question,
      'is_released',           v_existing_result.is_released,
      'generated_at',          v_existing_result.generated_at,
      'released_at',           v_existing_result.released_at,
      'already_evaluated',     true
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  --  4. LOAD MOCK TEST METADATA
  -- ════════════════════════════════════════════════════════════════════════
  SELECT * INTO v_mock_test
  FROM public.mock_tests
  WHERE test_id = v_attempt.test_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Mock test not found.',
      'code',    'TEST_NOT_FOUND'
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  --  4.5. APPLY BATCH QUESTION TIMES (IF PROVIDED)
  -- ════════════════════════════════════════════════════════════════════════
  IF p_question_times IS NOT NULL AND jsonb_typeof(p_question_times) = 'object' THEN
    UPDATE public.mock_answers ma
    SET time_spent_seconds = (p_question_times->>ma.question_id::text)::INTEGER,
        updated_at = CLOCK_TIMESTAMP()
    WHERE ma.attempt_id = p_attempt_id
      AND p_question_times ? ma.question_id::text
      AND (p_question_times->>ma.question_id::text) ~ '^\d+$';
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  --  5. ITERATE THROUGH ANSWERS & COMPUTE SCORES
  -- ════════════════════════════════════════════════════════════════════════
  FOR v_ans IN
    SELECT
      ma.answer_id,
      ma.question_id,
      ma.is_answered,
      ma.numerical_answer,
      ma.text_answer,
      ma.time_spent_seconds,
      mtq.marks AS question_marks,
      mtq.negative_marks_override,
      mtq.question_snapshot
    FROM public.mock_answers ma
    JOIN public.mock_test_questions mtq
      ON mtq.test_id = v_attempt.test_id
     AND mtq.question_id = ma.question_id
    WHERE ma.attempt_id = p_attempt_id
    ORDER BY mtq.order_sequence ASC
  LOOP
    v_total_questions := v_total_questions + 1;
    v_q_marks := COALESCE(v_ans.question_marks, (v_ans.question_snapshot->>'marks')::NUMERIC, 0);
    v_max_score := v_max_score + v_q_marks;
    v_total_time_seconds := v_total_time_seconds + COALESCE(v_ans.time_spent_seconds, 0);

    v_q_type := COALESCE(
      v_ans.question_snapshot->>'questionType',
      v_ans.question_snapshot->>'question_type',
      'mcq'
    );

    -- 5a. Subjective questions: mark pending teacher evaluation, do NOT auto-score
    IF v_q_type = 'subjective' THEN
      v_has_subjective := true;
      v_eval_status := 'pending';
      v_is_correct := NULL;
      v_marks_awarded := NULL;

      UPDATE public.mock_answers
      SET is_correct = v_is_correct,
          marks_awarded = v_marks_awarded,
          evaluation_status = v_eval_status,
          updated_at = CLOCK_TIMESTAMP()
      WHERE answer_id = v_ans.answer_id;

      CONTINUE;
    END IF;

    -- 5b. Negative marks resolution (precedence: override -> snapshot -> test default -> 0)
    v_neg_marks := COALESCE(
      v_ans.negative_marks_override,
      (v_ans.question_snapshot->>'negativeMarks')::NUMERIC,
      (v_ans.question_snapshot->>'negative_marks')::NUMERIC,
      v_mock_test.negative_marking,
      0
    );

    -- 5c. Skipped vs Answered Evaluation
    -- Note: evaluation_status is explicitly NULL for non-subjective / skipped questions
    -- to satisfy ck_mock_answers_evaluation_status.
    IF v_ans.is_answered IS NOT TRUE THEN
      v_skipped_count := v_skipped_count + 1;
      v_is_correct := false;
      v_marks_awarded := 0;
      v_eval_status := NULL;
    ELSE
      IF v_q_type = 'numerical' THEN
        v_stud_num := v_ans.numerical_answer;
        v_correct_num := COALESCE(
          (v_ans.question_snapshot->>'correctNumericalAnswer')::NUMERIC,
          (v_ans.question_snapshot->>'correct_numerical_answer')::NUMERIC,
          0
        );
        v_tol := COALESCE(
          (v_ans.question_snapshot->>'numericalTolerance')::NUMERIC,
          (v_ans.question_snapshot->>'numerical_tolerance')::NUMERIC,
          0
        );

        IF v_stud_num IS NOT NULL AND ABS(v_stud_num - v_correct_num) <= v_tol THEN
          v_is_correct := true;
        ELSE
          v_is_correct := false;
        END IF;
      ELSE
        -- MCQ, MSQ, True/False — compare selected options with correct snapshot options
        SELECT ARRAY_AGG(mao.option_id::TEXT ORDER BY mao.option_id::TEXT)
        INTO v_selected_opts
        FROM public.mock_answer_options mao
        WHERE mao.answer_id = v_ans.answer_id;

        SELECT ARRAY_AGG(opt->>'optionId' ORDER BY opt->>'optionId')
        INTO v_correct_opts
        FROM jsonb_array_elements(COALESCE(v_ans.question_snapshot->'options', '[]'::jsonb)) opt
        WHERE (opt->>'isCorrect')::BOOLEAN IS TRUE
           OR (opt->>'is_correct')::BOOLEAN IS TRUE;

        IF COALESCE(v_selected_opts, ARRAY[]::TEXT[]) = COALESCE(v_correct_opts, ARRAY[]::TEXT[])
           AND ARRAY_LENGTH(COALESCE(v_selected_opts, ARRAY[]::TEXT[]), 1) > 0 THEN
          v_is_correct := true;
        ELSE
          v_is_correct := false;
        END IF;
      END IF;

      IF v_is_correct THEN
        v_correct_count := v_correct_count + 1;
        v_marks_awarded := v_q_marks;
        v_total_score := v_total_score + v_marks_awarded;
      ELSE
        v_wrong_count := v_wrong_count + 1;
        v_marks_awarded := CASE WHEN v_neg_marks > 0 THEN -v_neg_marks ELSE 0 END;
        v_total_score := v_total_score + v_marks_awarded;
      END IF;

      v_eval_status := NULL;
    END IF;

    -- Update answer row
    UPDATE public.mock_answers
    SET is_correct = v_is_correct,
        marks_awarded = v_marks_awarded,
        evaluation_status = v_eval_status,
        updated_at = CLOCK_TIMESTAMP()
    WHERE answer_id = v_ans.answer_id;
  END LOOP;

  -- ════════════════════════════════════════════════════════════════════════
  --  6. AGGREGATES & RELEASE STATE
  -- ════════════════════════════════════════════════════════════════════════
  IF v_max_score > 0 THEN
    v_percentage := GREATEST(0::NUMERIC, ROUND(((v_total_score / v_max_score) * 100)::NUMERIC, 2));
  ELSE
    v_percentage := 0;
  END IF;

  IF v_total_questions > 0 THEN
    v_avg_time_per_question := ROUND((v_total_time_seconds::NUMERIC / v_total_questions::NUMERIC), 2);
  ELSE
    v_avg_time_per_question := 0;
  END IF;

  v_now := CLOCK_TIMESTAMP();
  v_is_immediate := (v_mock_test.result_release_mode = 'immediate' AND NOT v_has_subjective);
  v_is_released := v_is_immediate;
  v_released_at := CASE WHEN v_is_immediate THEN v_now ELSE NULL END;

  -- ════════════════════════════════════════════════════════════════════════
  --  7. UPDATE ATTEMPT TO SUBMITTED
  -- ════════════════════════════════════════════════════════════════════════
  UPDATE public.mock_attempts
  SET status = 'submitted',
      submitted_at = v_now,
      time_remaining_seconds = CASE
        WHEN p_time_taken_seconds IS NOT NULL AND v_mock_test.duration_min IS NOT NULL
          THEN GREATEST(0, (v_mock_test.duration_min * 60) - p_time_taken_seconds)
        ELSE time_remaining_seconds
      END,
      updated_at = v_now
  WHERE attempt_id = p_attempt_id;

  -- ════════════════════════════════════════════════════════════════════════
  --  8. INSERT RESULT ROW
  -- ════════════════════════════════════════════════════════════════════════
  v_result_id := gen_random_uuid();

  INSERT INTO public.mock_results (
    result_id,
    attempt_id,
    test_id,
    student_id,
    institute_id,
    total_score,
    max_score,
    percentage,
    correct_count,
    wrong_count,
    skipped_count,
    total_time_seconds,
    avg_time_per_question,
    subject_breakdown,
    chapter_breakdown,
    is_released,
    rank,
    percentile,
    generated_at,
    released_at
  ) VALUES (
    v_result_id,
    p_attempt_id,
    v_attempt.test_id,
    v_attempt.student_id,
    v_attempt.institute_id,
    v_total_score,
    v_max_score,
    v_percentage,
    v_correct_count,
    v_wrong_count,
    v_skipped_count,
    v_total_time_seconds,
    v_avg_time_per_question,
    NULL,
    NULL,
    v_is_released,
    NULL,
    NULL,
    v_now,
    v_released_at
  );

  RETURN jsonb_build_object(
    'success',               true,
    'attempt_id',            p_attempt_id,
    'result_id',             v_result_id,
    'test_id',               v_attempt.test_id,
    'student_id',            v_attempt.student_id,
    'institute_id',          v_attempt.institute_id,
    'total_score',           v_total_score,
    'max_score',             v_max_score,
    'percentage',            v_percentage,
    'correct_count',         v_correct_count,
    'wrong_count',           v_wrong_count,
    'skipped_count',         v_skipped_count,
    'total_time_seconds',    v_total_time_seconds,
    'avg_time_per_question', v_avg_time_per_question,
    'is_released',           v_is_released,
    'generated_at',          v_now,
    'released_at',           v_released_at,
    'already_evaluated',     false
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- GRANTS & PERMISSIONS
-- ════════════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.submit_and_evaluate_mock_attempt(UUID, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_and_evaluate_mock_attempt(UUID, INTEGER, JSONB) TO authenticated;

COMMENT ON FUNCTION public.submit_and_evaluate_mock_attempt(UUID, INTEGER, JSONB) IS
  'Atomically evaluates all answers with optional batch question times, marks the mock attempt submitted, and persists the mock_results record in a single ACID transaction. Idempotent and student-scoped. Satisfies ck_mock_answers_evaluation_status.';
