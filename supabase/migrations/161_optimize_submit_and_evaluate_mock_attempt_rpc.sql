-- ============================================================================
-- Migration: Optimize submit_and_evaluate_mock_attempt RPC (Set-Based Execution)
--
-- Background:
--   During high-concurrency mock test submissions, the previous implementation
--   iterated row-by-row in PL/pgSQL performing O(Q) mock_answers UPDATEs and O(Q)
--   option subqueries.
--
-- Enhancements:
--   1. Replaces O(Q) row-by-row iteration with a single set-based CTE evaluation
--      pipeline and a single bulk UPDATE ... FROM graded_answers.
--   2. Gathers and aggregates mock_answer_options and snapshot correct options
--      per question in set-based sub-aggregates with deterministic sorting.
--   3. Calculates aggregate scores, counts, durations, and subjective flags
--      directly from the RETURNING projection of the bulk UPDATE.
--   4. Preserves 100% of existing evaluation semantics, scoring rules, negative
--      marking precedence, numerical tolerance checks, subjective handling,
--      caller authorization, FOR UPDATE attempt locking, idempotency, and
--      response JSON contract.
-- ============================================================================

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
  --  5. SET-BASED ANSWER EVALUATION & BULK UPDATE
  -- ════════════════════════════════════════════════════════════════════════
  WITH answer_eval_raw AS (
    SELECT
      ma.answer_id,
      ma.question_id,
      ma.is_answered,
      ma.numerical_answer,
      ma.time_spent_seconds,
      COALESCE(mtq.marks, (mtq.question_snapshot->>'marks')::NUMERIC, 0) AS q_marks,
      COALESCE(
        mtq.negative_marks_override,
        (mtq.question_snapshot->>'negativeMarks')::NUMERIC,
        (mtq.question_snapshot->>'negative_marks')::NUMERIC,
        v_mock_test.negative_marking,
        0
      ) AS neg_marks,
      COALESCE(
        mtq.question_snapshot->>'questionType',
        mtq.question_snapshot->>'question_type',
        'mcq'
      ) AS q_type,
      COALESCE(
        (mtq.question_snapshot->>'correctNumericalAnswer')::NUMERIC,
        (mtq.question_snapshot->>'correct_numerical_answer')::NUMERIC,
        0
      ) AS correct_num,
      COALESCE(
        (mtq.question_snapshot->>'numericalTolerance')::NUMERIC,
        (mtq.question_snapshot->>'numerical_tolerance')::NUMERIC,
        0
      ) AS num_tol,
      (
        SELECT ARRAY_AGG(mao.option_id::TEXT ORDER BY mao.option_id::TEXT)
        FROM public.mock_answer_options mao
        WHERE mao.answer_id = ma.answer_id
      ) AS selected_opts,
      (
        SELECT ARRAY_AGG(opt->>'optionId' ORDER BY opt->>'optionId')
        FROM jsonb_array_elements(COALESCE(mtq.question_snapshot->'options', '[]'::jsonb)) opt
        WHERE (opt->>'isCorrect')::BOOLEAN IS TRUE
           OR (opt->>'is_correct')::BOOLEAN IS TRUE
      ) AS correct_opts
    FROM public.mock_answers ma
    JOIN public.mock_test_questions mtq
      ON mtq.test_id = v_attempt.test_id
     AND mtq.question_id = ma.question_id
    WHERE ma.attempt_id = p_attempt_id
  ),
  graded_answers AS (
    SELECT
      r.answer_id,
      r.question_id,
      r.q_type,
      r.q_marks,
      r.time_spent_seconds,
      r.is_answered,
      CASE
        WHEN r.q_type = 'subjective' THEN NULL
        WHEN r.is_answered IS NOT TRUE THEN false
        WHEN r.q_type = 'numerical' THEN
          (r.numerical_answer IS NOT NULL AND ABS(r.numerical_answer - r.correct_num) <= r.num_tol)
        ELSE
          (
            r.selected_opts IS NOT NULL
            AND ARRAY_LENGTH(r.selected_opts, 1) > 0
            AND r.selected_opts = COALESCE(r.correct_opts, ARRAY[]::TEXT[])
          )
      END AS is_correct,
      CASE
        WHEN r.q_type = 'subjective' THEN NULL
        WHEN r.is_answered IS NOT TRUE THEN 0
        WHEN r.q_type = 'numerical' THEN
          CASE
            WHEN (r.numerical_answer IS NOT NULL AND ABS(r.numerical_answer - r.correct_num) <= r.num_tol)
              THEN r.q_marks
            ELSE (CASE WHEN r.neg_marks > 0 THEN -r.neg_marks ELSE 0 END)
          END
        ELSE
          CASE
            WHEN (
              r.selected_opts IS NOT NULL
              AND ARRAY_LENGTH(r.selected_opts, 1) > 0
              AND r.selected_opts = COALESCE(r.correct_opts, ARRAY[]::TEXT[])
            ) THEN r.q_marks
            ELSE (CASE WHEN r.neg_marks > 0 THEN -r.neg_marks ELSE 0 END)
          END
      END AS marks_awarded,
      CASE
        WHEN r.q_type = 'subjective' THEN 'pending'
        ELSE NULL
      END AS evaluation_status
    FROM answer_eval_raw r
  ),
  updated_answers AS (
    UPDATE public.mock_answers ma
    SET is_correct = g.is_correct,
        marks_awarded = g.marks_awarded,
        evaluation_status = g.evaluation_status,
        updated_at = CLOCK_TIMESTAMP()
    FROM graded_answers g
    WHERE ma.answer_id = g.answer_id
    RETURNING g.*
  )
  SELECT
    COUNT(*)::INTEGER,
    COALESCE(SUM(q_marks), 0)::NUMERIC(6,2),
    COALESCE(SUM(COALESCE(marks_awarded, 0)), 0)::NUMERIC(6,2),
    COALESCE(COUNT(*) FILTER (WHERE is_correct IS TRUE), 0)::INTEGER,
    COALESCE(COUNT(*) FILTER (WHERE is_correct IS FALSE AND is_answered IS TRUE AND q_type <> 'subjective'), 0)::INTEGER,
    COALESCE(COUNT(*) FILTER (WHERE is_answered IS NOT TRUE AND q_type <> 'subjective'), 0)::INTEGER,
    COALESCE(SUM(COALESCE(time_spent_seconds, 0)), 0)::INTEGER,
    COALESCE(BOOL_OR(q_type = 'subjective'), false)
  INTO
    v_total_questions,
    v_max_score,
    v_total_score,
    v_correct_count,
    v_wrong_count,
    v_skipped_count,
    v_total_time_seconds,
    v_has_subjective
  FROM updated_answers;

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
  'Set-based atomic mock attempt evaluation RPC. Atomically evaluates all answers with optional batch question times, marks the mock attempt submitted, and persists the mock_results record in a single ACID transaction. Idempotent and student-scoped. Satisfies ck_mock_answers_evaluation_status.';
