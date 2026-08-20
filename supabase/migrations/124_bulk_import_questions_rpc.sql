-- ============================================================================
-- Migration: 124 — Atomic Bulk Import RPC for Text-Only Questions
--
-- Description:
--   Creates the `public.bulk_import_questions_atomic` RPC to allow Super Admin
--   and Academic Admin to import batches of text-only questions (with options
--   and explanations) in a single atomic database transaction.
--   Questions imported by admins are immediately set to status='published'
--   with approved_by and approved_at populated.
-- ============================================================================

create or replace function public.bulk_import_questions_atomic(
  p_institute_id uuid,
  p_questions    jsonb,
  p_actor        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor                  uuid;
  v_q                      jsonb;
  v_opt                    jsonb;
  v_subject_id             uuid;
  v_chapter_id             uuid;
  v_question_text          text;
  v_question_type          text;
  v_difficulty             text;
  v_marks                  numeric(5,2);
  v_negative_marks         numeric(5,2);
  v_explanation_text       text;
  v_correct_num_ans        numeric;
  v_num_tolerance          numeric;
  v_new_question_id        uuid;
  v_count                  int := 0;
  v_created_ids            uuid[] := array[]::uuid[];
begin
  -- ── 1. Determine & verify actor ──────────────────────────────────────────
  v_actor := coalesce(p_actor, auth.uid());
  if v_actor is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Authentication required. No active session or actor provided.'
    );
  end if;

  -- ── 2. RBAC check (Super Admin or Academic Admin only) ───────────────────
  if not (public.is_super_admin() or public.is_academic_admin()) then
    return jsonb_build_object(
      'success', false,
      'error', 'Unauthorized. Only Super Admin or Academic Admin can bulk import questions.'
    );
  end if;

  -- ── 3. Validate Institute Scope ─────────────────────────────────────────
  if p_institute_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Institute ID is required.'
    );
  end if;

  if p_institute_id <> public.get_my_institute_id() then
    return jsonb_build_object(
      'success', false,
      'error', 'Institute mismatch with active session.'
    );
  end if;

  -- ── 4. Validate payload array ────────────────────────────────────────────
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Payload must be a non-empty JSON array of questions.'
    );
  end if;

  if jsonb_array_length(p_questions) > 500 then
    return jsonb_build_object(
      'success', false,
      'error', 'Batch size exceeds maximum limit of 500 questions per chunk.'
    );
  end if;

  -- ── 5. Process each question atomically ──────────────────────────────────
  for v_q in select * from jsonb_array_elements(p_questions)
  loop
    v_subject_id := (v_q->>'subject_id')::uuid;
    v_chapter_id := (v_q->>'chapter_id')::uuid;
    v_question_text := trim(v_q->>'question_text');
    v_question_type := v_q->>'question_type';
    v_difficulty := v_q->>'difficulty';
    v_marks := coalesce((v_q->>'marks')::numeric(5,2), 4.00);
    v_negative_marks := coalesce((v_q->>'negative_marks')::numeric(5,2), 1.00);
    v_explanation_text := nullif(trim(coalesce(v_q->>'explanation_text', '')), '');
    v_correct_num_ans := nullif(v_q->>'correct_numerical_answer', '')::numeric;
    v_num_tolerance := nullif(v_q->>'numerical_tolerance', '')::numeric;

    -- Basic row checks
    if v_question_text is null or length(v_question_text) < 10 then
      raise exception 'Question text must be at least 10 characters: %', coalesce(v_question_text, '(empty)');
    end if;

    if v_marks <= 0 then
      raise exception 'Marks must be greater than 0 for question: %', v_question_text;
    end if;

    if v_negative_marks < 0 then
      raise exception 'Negative marks cannot be negative for question: %', v_question_text;
    end if;

    -- 5a. Insert parent question
    insert into public.questions (
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
      negative_marks
    ) values (
      p_institute_id,
      v_subject_id,
      v_chapter_id,
      v_actor,
      v_actor,
      clock_timestamp(),
      v_question_type::public.question_type,
      v_difficulty::public.difficulty_level,
      'published'::public.question_status,
      1,
      v_question_text,
      v_marks,
      v_negative_marks
    ) returning question_id into v_new_question_id;

    v_created_ids := array_append(v_created_ids, v_new_question_id);
    v_count := v_count + 1;

    -- 5b. Insert child options (for non-numerical types)
    if v_q ? 'options' and jsonb_typeof(v_q->'options') = 'array' then
      for v_opt in select * from jsonb_array_elements(v_q->'options')
      loop
        insert into public.question_options (
          question_id,
          institute_id,
          option_text,
          is_correct,
          order_sequence
        ) values (
          v_new_question_id,
          p_institute_id,
          coalesce(v_opt->>'option_text', ''),
          coalesce((v_opt->>'is_correct')::boolean, false),
          coalesce((v_opt->>'order_sequence')::int, 1)
        );
      end loop;
    end if;

    -- 5c. Insert child explanation (if text or numerical fields exist)
    if v_explanation_text is not null or v_correct_num_ans is not null or v_num_tolerance is not null then
      insert into public.question_explanations (
        question_id,
        institute_id,
        explanation_text,
        correct_numerical_answer,
        numerical_tolerance
      ) values (
        v_new_question_id,
        p_institute_id,
        v_explanation_text,
        v_correct_num_ans,
        v_num_tolerance
      );
    end if;

  end loop;

  -- ── 6. Log audit event ───────────────────────────────────────────────────
  begin
    insert into public.audit_logs (
      institute_id,
      actor_id,
      action,
      resource_type,
      resource_id,
      new_value,
      metadata
    ) values (
      p_institute_id,
      v_actor,
      'create',
      'questions',
      v_created_ids[1]::text,
      jsonb_build_object('status', 'published', 'count', v_count),
      jsonb_build_object('bulk_import', true, 'imported_count', v_count)
    );
  exception when others then
    -- Best-effort audit logging
    null;
  end;

  return jsonb_build_object(
    'success', true,
    'imported_count', v_count,
    'question_ids', v_created_ids
  );

exception when others then
  return jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
end;
$$;

comment on function public.bulk_import_questions_atomic(uuid, jsonb, uuid) is
  'Atomic bulk importer for text-only questions by Super Admin and Academic Admin with direct auto-publish.';

grant execute on function public.bulk_import_questions_atomic(uuid, jsonb, uuid) to authenticated;
