-- ============================================================================
-- Migration: 160_create_evaluate_subjective_answer_rpc.sql
-- Description: Consolidate teacher subjective evaluation into an atomic RPC.
-- Replaces multi-step client round-trips with a single ACID-guaranteed call.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_subjective_answer(
  p_answer_id     uuid,
  p_awarded_marks numeric,
  p_feedback      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id             uuid;
  v_institute_id        uuid;
  v_role                text;
  v_is_admin            boolean := false;
  v_teacher_id          uuid := NULL;
  
  v_attempt_id          uuid;
  v_student_id          uuid;
  v_test_id             uuid;
  v_attempt_status      text;
  v_is_released         boolean := false;
  v_question_id         uuid;
  v_question_type       text;
  v_question_marks      numeric;
  v_subject_id          uuid;
  v_old_marks           numeric;
  v_old_feedback        text;
  v_authorized          boolean := false;
  v_audit_result        jsonb;
BEGIN
  -- ── 1. Authenticate caller ──────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- ── 2. Resolve Profile & Institute ──────────────────────────────────
  SELECT p.institute_id, p.role
    INTO v_institute_id, v_role
    FROM public.profiles p
   WHERE p.profile_id = v_user_id;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found.');
  END IF;

  -- ── 3. Check Admin Role (super_admin / academic_admin) ──────────────
  IF v_role = 'admin' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.admin_roles
       WHERE profile_id = v_user_id
         AND admin_role IN ('super_admin', 'academic_admin')
    ) INTO v_is_admin;
  END IF;

  -- ── 4. If not Admin, resolve Teacher ID ─────────────────────────────
  IF NOT v_is_admin THEN
    SELECT td.teacher_id
      INTO v_teacher_id
      FROM public.teacher_details td
     WHERE td.profile_id = v_user_id;

    IF v_teacher_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Teacher profile not found.');
    END IF;
  END IF;

  -- ── 5. Fetch Answer, Attempt, Question, and Result Status in 1 Query ─
  SELECT
    ma.attempt_id,
    ma.question_id,
    ma.awarded_marks,
    ma.evaluator_feedback,
    att.student_id,
    att.test_id,
    att.status,
    COALESCE(res.is_released, false),
    q.question_type,
    q.marks,
    q.subject_id
  INTO
    v_attempt_id,
    v_question_id,
    v_old_marks,
    v_old_feedback,
    v_student_id,
    v_test_id,
    v_attempt_status,
    v_is_released,
    v_question_type,
    v_question_marks,
    v_subject_id
  FROM public.mock_answers ma
  JOIN public.mock_attempts att ON att.attempt_id = ma.attempt_id
  JOIN public.questions q ON q.question_id = ma.question_id
  LEFT JOIN public.mock_results res ON res.attempt_id = att.attempt_id
  WHERE ma.answer_id = p_answer_id
  FOR UPDATE OF ma;

  IF v_attempt_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Answer not found.');
  END IF;

  -- ── 6. Validate Question & Marks ────────────────────────────────────
  IF v_question_type <> 'subjective' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This question is not subjective and cannot be manually evaluated.');
  END IF;

  IF p_awarded_marks < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Awarded marks cannot be negative.');
  END IF;

  IF p_awarded_marks > v_question_marks THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Awarded marks (' || p_awarded_marks || ') cannot exceed question maximum (' || v_question_marks || ').'
    );
  END IF;

  -- ── 7. Check Attempt Released State ─────────────────────────────────
  IF (v_attempt_status IN ('submitted', 'timed_out')) AND v_is_released THEN
    RETURN jsonb_build_object('success', false, 'error', 'This attempt has been finalized and released. Evaluation cannot be modified.');
  END IF;

  -- ── 8. Teacher Authorization via Single Set-Based Join ───────────────
  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.batch_subject_teachers bst
        JOIN public.batch_subjects bs ON bs.batch_subject_id = bst.batch_subject_id
        JOIN public.batch_students bstud ON bstud.batch_id = bs.batch_id
       WHERE bst.teacher_id = v_teacher_id
         AND bs.subject_id = v_subject_id
         AND bstud.student_id = v_student_id
    ) INTO v_authorized;

    IF NOT v_authorized THEN
      RETURN jsonb_build_object('success', false, 'error', 'You are not authorized to evaluate this student''s answer.');
    END IF;
  END IF;

  -- ── 9. Atomic Update ────────────────────────────────────────────────
  UPDATE public.mock_answers
     SET evaluation_status = 'manual_evaluated',
         awarded_marks = p_awarded_marks,
         evaluated_by = v_user_id,
         evaluated_at = now(),
         evaluator_feedback = p_feedback
   WHERE answer_id = p_answer_id;

  -- ── 10. Audit Log Record ────────────────────────────────────────────
  v_audit_result := public.write_audit_log(
    p_action        => 'subjective_evaluation_saved'::public.audit_action_type,
    p_resource_type => 'mock_answers',
    p_resource_id   => p_answer_id,
    p_old_value     => jsonb_build_object('awardedMarks', v_old_marks, 'feedback', v_old_feedback),
    p_new_value     => jsonb_build_object('awardedMarks', p_awarded_marks, 'feedback', p_feedback),
    p_metadata      => jsonb_build_object(
      'attemptId', v_attempt_id,
      'questionId', v_question_id,
      'studentId', v_student_id,
      'testId', v_test_id
    )
  );

  IF NOT COALESCE((v_audit_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'Failed to record audit log: %', v_audit_result->>'error';
  END IF;

  RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('answerId', p_answer_id));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.evaluate_subjective_answer(uuid, numeric, text) TO authenticated;
