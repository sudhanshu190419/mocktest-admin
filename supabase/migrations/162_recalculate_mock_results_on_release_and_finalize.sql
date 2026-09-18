-- ============================================================================
-- Migration: 087_recalculate_mock_results_on_release_and_finalize.sql
-- (Corresponding mocktest-admin: 162_recalculate_mock_results_on_release_and_finalize.sql)
-- Description: Synchronize subjective evaluations into public.mock_results upon
-- finalization and test result release.
--
-- 1. Updates `public.release_test_results(p_test_id uuid)`:
--    - Atomically recalculates total_score, max_score, percentage from mock_answers
--      joined with mock_test_questions and questions before releasing results.
--    - Preserves objective scoring (+4/-1, etc.) and integrates evaluated subjective marks.
--    - Keeps correct_count, wrong_count, and skipped_count strictly objective.
--    - Idempotent and concurrency-safe.
--
-- 2. Creates `public.finalize_subjective_evaluation(p_attempt_id uuid)`:
--    - Atomic single-attempt finalization RPC called when a teacher completes grading.
--    - Verifies teacher/admin authorization.
--    - Validates that all subjective questions are evaluated.
--    - Recalculates total_score, max_score, percentage and updates mock_results.
--    - Records an audit log entry.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Update public.release_test_results(p_test_id uuid)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_test_results(p_test_id uuid)
RETURNS TABLE (updated_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id       uuid;
  v_is_admin      boolean := false;
  v_teacher_id    uuid := NULL;
  v_authorized    boolean := false;
  v_has_pending   boolean := false;
BEGIN
  -- 1. Authentication check
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    -- Check if admin
    SELECT EXISTS (
      SELECT 1 FROM public.admin_roles
      WHERE profile_id = v_user_id
        AND admin_role IN ('super_admin', 'academic_admin')
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
      -- Check if teacher assigned to this test or created this test
      SELECT td.teacher_id INTO v_teacher_id
      FROM public.teacher_details td
      WHERE td.profile_id = v_user_id;

      IF v_teacher_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.mock_tests mt
          WHERE mt.test_id = p_test_id
            AND (
              mt.teacher_id = v_teacher_id
              OR mt.created_by = v_user_id
              OR EXISTS (
                SELECT 1
                FROM public.batch_subject_teachers bst
                JOIN public.batch_subjects bs ON bs.batch_subject_id = bst.batch_subject_id
                JOIN public.batch_mock_tests bmt ON bmt.batch_id = bs.batch_id
                WHERE bmt.test_id = p_test_id
                  AND bst.teacher_id = v_teacher_id
              )
            )
        ) INTO v_authorized;
      END IF;

      IF NOT v_authorized THEN
        RAISE EXCEPTION 'You are not authorized to release results for this test.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 2. Verify no submitted attempt for this test has pending subjective evaluations
  SELECT EXISTS (
    SELECT 1
    FROM public.mock_answers ma
    JOIN public.mock_attempts att ON att.attempt_id = ma.attempt_id
    WHERE att.test_id = p_test_id
      AND att.status = 'submitted'
      AND ma.evaluation_status = 'pending'
  ) INTO v_has_pending;

  IF v_has_pending THEN
    RAISE EXCEPTION 'Cannot release results: subjective evaluations are still pending.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Atomic Set-Based Score Recalculation and Release Update
  WITH calculated_scores AS (
    SELECT 
      ma.attempt_id,
      COALESCE(SUM(COALESCE(ma.awarded_marks, ma.marks_awarded, 0)), 0)::NUMERIC(6,2) AS new_total_score,
      COALESCE(SUM(mtq.marks), 0)::NUMERIC(6,2) AS new_max_score,
      COUNT(*) FILTER (WHERE ma.is_correct IS TRUE)::INTEGER AS new_correct_count,
      COUNT(*) FILTER (WHERE ma.is_correct IS FALSE AND ma.is_answered IS TRUE AND q.question_type <> 'subjective')::INTEGER AS new_wrong_count,
      COUNT(*) FILTER (WHERE ma.is_answered IS NOT TRUE AND q.question_type <> 'subjective')::INTEGER AS new_skipped_count
    FROM public.mock_answers ma
    JOIN public.mock_attempts att ON att.attempt_id = ma.attempt_id
    JOIN public.questions q ON q.question_id = ma.question_id
    JOIN public.mock_test_questions mtq ON mtq.test_id = att.test_id AND mtq.question_id = ma.question_id
    WHERE att.test_id = p_test_id
    GROUP BY ma.attempt_id
  )
  UPDATE public.mock_results mr
  SET 
    total_score = cs.new_total_score,
    max_score = cs.new_max_score,
    percentage = CASE 
      WHEN cs.new_max_score > 0 THEN 
        GREATEST(0::NUMERIC, ROUND(((cs.new_total_score / cs.new_max_score) * 100)::NUMERIC, 2))
      ELSE 0 
    END,
    correct_count = cs.new_correct_count,
    wrong_count = cs.new_wrong_count,
    skipped_count = cs.new_skipped_count,
    is_released = true,
    released_at = COALESCE(mr.released_at, now())
  FROM calculated_scores cs
  WHERE mr.attempt_id = cs.attempt_id;

  -- 4. Fallback update for any attempt with no answer rows (if any)
  UPDATE public.mock_results
  SET is_released = true,
      released_at = COALESCE(released_at, now())
  WHERE test_id = p_test_id
    AND is_released = false;

  -- 5. Return updated count
  RETURN QUERY
  SELECT count(*)::bigint AS updated_count
  FROM public.mock_results
  WHERE test_id = p_test_id
    AND is_released = true;
END;
$$;

COMMENT ON FUNCTION public.release_test_results(uuid) IS
  'Releases all results for the given test after atomically recalculating total scores, percentages, and max scores from mock_answers. Strictly guards against pending subjective evaluations.';

REVOKE ALL ON FUNCTION public.release_test_results(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.release_test_results(uuid) TO authenticated, service_role, postgres;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Create public.finalize_subjective_evaluation(p_attempt_id uuid)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.finalize_subjective_evaluation(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id             uuid;
  v_is_admin            boolean := false;
  v_teacher_id          uuid := NULL;
  v_authorized          boolean := false;
  
  v_attempt             RECORD;
  v_has_pending         boolean := false;
  v_result_id           uuid;
  v_total_score         numeric;
  v_max_score           numeric;
  v_percentage          numeric;
  v_correct_count       int;
  v_wrong_count         int;
  v_skipped_count       int;
  v_audit_result        jsonb;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- 2. Role Check
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE profile_id = v_user_id
      AND admin_role IN ('super_admin', 'academic_admin')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT td.teacher_id INTO v_teacher_id
    FROM public.teacher_details td
    WHERE td.profile_id = v_user_id;

    IF v_teacher_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Teacher profile not found.');
    END IF;
  END IF;

  -- 3. Load attempt
  SELECT attempt_id, test_id, student_id, institute_id, status
  INTO v_attempt
  FROM public.mock_attempts
  WHERE attempt_id = p_attempt_id;

  IF v_attempt.attempt_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Attempt not found.');
  END IF;

  -- 4. Authorize teacher
  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.batch_students bs
      JOIN public.batch_subjects bsub ON bsub.batch_id = bs.batch_id
      JOIN public.batch_subject_teachers bst ON bst.batch_subject_id = bsub.batch_subject_id
      WHERE bs.student_id = v_attempt.student_id
        AND bst.teacher_id = v_teacher_id
    ) INTO v_authorized;

    IF NOT v_authorized THEN
      -- Also allow test creator
      SELECT EXISTS (
        SELECT 1 FROM public.mock_tests mt
        WHERE mt.test_id = v_attempt.test_id
          AND (mt.teacher_id = v_teacher_id OR mt.created_by = v_user_id)
      ) INTO v_authorized;
    END IF;

    IF NOT v_authorized THEN
      RETURN jsonb_build_object('success', false, 'error', 'You are not authorized to finalize this evaluation.');
    END IF;
  END IF;

  -- 5. Validate that all subjective answers are evaluated
  SELECT EXISTS (
    SELECT 1
    FROM public.mock_answers ma
    JOIN public.questions q ON q.question_id = ma.question_id
    WHERE ma.attempt_id = p_attempt_id
      AND q.question_type = 'subjective'
      AND ma.evaluation_status = 'pending'
  ) INTO v_has_pending;

  IF v_has_pending THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subjective answers are still pending evaluation.');
  END IF;

  -- 6. Atomic Score Recalculation
  SELECT 
    COALESCE(SUM(COALESCE(ma.awarded_marks, ma.marks_awarded, 0)), 0)::NUMERIC(6,2),
    COALESCE(SUM(mtq.marks), 0)::NUMERIC(6,2),
    COUNT(*) FILTER (WHERE ma.is_correct IS TRUE)::INTEGER,
    COUNT(*) FILTER (WHERE ma.is_correct IS FALSE AND ma.is_answered IS TRUE AND q.question_type <> 'subjective')::INTEGER,
    COUNT(*) FILTER (WHERE ma.is_answered IS NOT TRUE AND q.question_type <> 'subjective')::INTEGER
  INTO
    v_total_score,
    v_max_score,
    v_correct_count,
    v_wrong_count,
    v_skipped_count
  FROM public.mock_answers ma
  JOIN public.questions q ON q.question_id = ma.question_id
  JOIN public.mock_test_questions mtq ON mtq.test_id = v_attempt.test_id AND mtq.question_id = ma.question_id
  WHERE ma.attempt_id = p_attempt_id;

  IF v_max_score > 0 THEN
    v_percentage := GREATEST(0::NUMERIC, ROUND(((v_total_score / v_max_score) * 100)::NUMERIC, 2));
  ELSE
    v_percentage := 0;
  END IF;

  -- 7. Update mock_results
  UPDATE public.mock_results
  SET total_score = v_total_score,
      max_score = v_max_score,
      percentage = v_percentage,
      correct_count = v_correct_count,
      wrong_count = v_wrong_count,
      skipped_count = v_skipped_count
  WHERE attempt_id = p_attempt_id
  RETURNING result_id INTO v_result_id;

  IF v_result_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mock result record not found for this attempt.');
  END IF;

  -- 8. Record audit log
  v_audit_result := public.write_audit_log(
    p_action        => 'subjective_evaluation_finalized'::public.audit_action_type,
    p_resource_type => 'mock_results',
    p_resource_id   => v_result_id,
    p_old_value     => NULL,
    p_new_value     => jsonb_build_object('totalScore', v_total_score, 'maxScore', v_max_score, 'percentage', v_percentage),
    p_metadata      => jsonb_build_object(
      'attemptId', p_attempt_id,
      'testId', v_attempt.test_id,
      'studentId', v_attempt.student_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'resultId', v_result_id,
      'totalScore', v_total_score,
      'maxScore', v_max_score,
      'percentage', v_percentage
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.finalize_subjective_evaluation(uuid) IS
  'Atomically finalizes subjective evaluation for an attempt, recalculating total score, percentage, and updating mock_results in one transaction.';

REVOKE ALL ON FUNCTION public.finalize_subjective_evaluation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_subjective_evaluation(uuid) TO authenticated, service_role, postgres;
