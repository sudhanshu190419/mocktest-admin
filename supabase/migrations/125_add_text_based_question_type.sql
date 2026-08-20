-- ============================================================================
-- Migration 125: Add Text-Based / Short-Answer Question Type Support
--
-- 1. Extends public.question_type enum with 'text_based'
-- 2. Adds correct_text_answer column to public.question_explanations
-- 3. Adds text_answer column to public.mock_answers
-- 4. Updates public.bulk_import_questions_atomic RPC to store correct_text_answer
-- ============================================================================

-- ── 1. Add enum value ────────────────────────────────────────────────────────
ALTER TYPE public.question_type ADD VALUE IF NOT EXISTS 'text_based';

-- ── 2. Add correct_text_answer to question_explanations ──────────────────────
ALTER TABLE public.question_explanations
  ADD COLUMN IF NOT EXISTS correct_text_answer text NULL DEFAULT NULL;

-- ── 3. Add text_answer to mock_answers ───────────────────────────────────────
ALTER TABLE public.mock_answers
  ADD COLUMN IF NOT EXISTS text_answer text NULL DEFAULT NULL;

-- ── 4. Update bulk_import_questions_atomic RPC ───────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_import_questions_atomic(
  p_institute_id uuid,
  p_questions jsonb,
  p_actor uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_count integer := 0;
  v_q jsonb;
  v_question_id uuid;
  v_explanation_id uuid;
  v_question_type text;
  v_options jsonb;
  v_opt jsonb;
  v_imported_ids uuid[] := array[]::uuid[];
BEGIN
  -- 1. Authorization: Only super_admin or academic_admin can invoke
  SELECT role INTO v_role
  FROM public.profiles
  WHERE profile_id = p_actor;

  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'academic_admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only Super Admin and Academic Admin can bulk import questions.';
  END IF;

  IF p_questions IS NULL OR jsonb_array_length(p_questions) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'imported_count', 0,
      'question_ids', '[]'::jsonb
    );
  END IF;

  -- 2. Iterate through questions and insert atomically
  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    v_question_id := gen_random_uuid();
    v_question_type := v_q->>'question_type';

    -- Insert parent question record directly as published & approved
    INSERT INTO public.questions (
      question_id,
      institute_id,
      subject_id,
      chapter_id,
      created_by,
      approved_by,
      approved_at,
      question_type,
      difficulty,
      status,
      version,
      question_text,
      marks,
      negative_marks,
      times_attempted,
      created_at,
      updated_at
    ) VALUES (
      v_question_id,
      p_institute_id,
      (v_q->>'subject_id')::uuid,
      (v_q->>'chapter_id')::uuid,
      p_actor,
      p_actor,
      clock_timestamp(),
      v_question_type::public.question_type,
      (v_q->>'difficulty')::public.difficulty_level,
      'published'::public.question_status,
      1,
      v_q->>'question_text',
      COALESCE((v_q->>'marks')::numeric(5,2), 4.00),
      COALESCE((v_q->>'negative_marks')::numeric(5,2), 1.00),
      0,
      clock_timestamp(),
      clock_timestamp()
    );

    -- Insert child options if provided (MCQ, MSQ, True/False)
    v_options := v_q->'options';
    IF v_options IS NOT NULL AND jsonb_array_length(v_options) > 0 THEN
      FOR v_opt IN SELECT * FROM jsonb_array_elements(v_options)
      LOOP
        INSERT INTO public.question_options (
          option_id,
          question_id,
          institute_id,
          option_text,
          is_correct,
          order_sequence,
          created_at
        ) VALUES (
          gen_random_uuid(),
          v_question_id,
          p_institute_id,
          v_opt->>'option_text',
          COALESCE((v_opt->>'is_correct')::boolean, false),
          (v_opt->>'order_sequence')::integer,
          clock_timestamp()
        );
      END LOOP;
    END IF;

    -- Insert child explanation if text, numerical, or text answer is present
    IF (v_q->>'explanation_text') IS NOT NULL
       OR (v_q->>'correct_numerical_answer') IS NOT NULL
       OR (v_q->>'correct_text_answer') IS NOT NULL THEN
      INSERT INTO public.question_explanations (
        explanation_id,
        question_id,
        institute_id,
        explanation_text,
        correct_numerical_answer,
        numerical_tolerance,
        correct_text_answer,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_question_id,
        p_institute_id,
        NULLIF(trim(v_q->>'explanation_text'), ''),
        CASE
          WHEN (v_q->>'correct_numerical_answer') IS NOT NULL AND trim(v_q->>'correct_numerical_answer') != ''
          THEN (v_q->>'correct_numerical_answer')::numeric(15,6)
          ELSE NULL
        END,
        CASE
          WHEN (v_q->>'numerical_tolerance') IS NOT NULL AND trim(v_q->>'numerical_tolerance') != ''
          THEN (v_q->>'numerical_tolerance')::numeric(10,6)
          ELSE NULL
        END,
        NULLIF(trim(v_q->>'correct_text_answer'), ''),
        clock_timestamp(),
        clock_timestamp()
      );
    END IF;

    v_imported_ids := array_append(v_imported_ids, v_question_id);
    v_count := v_count + 1;
  END LOOP;

  -- 3. Log audit event for bulk import
  INSERT INTO public.audit_logs (
    institute_id,
    user_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  ) VALUES (
    p_institute_id,
    p_actor,
    'bulk_import_questions',
    'questions',
    p_institute_id::text,
    jsonb_build_object(
      'count', v_count,
      'imported_by', p_actor,
      'imported_ids', v_imported_ids
    ),
    clock_timestamp()
  );

  RETURN jsonb_build_object(
    'success', true,
    'imported_count', v_count,
    'question_ids', to_jsonb(v_imported_ids)
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_questions_atomic(uuid, jsonb, uuid) TO authenticated;
