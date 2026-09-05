-- ============================================================================
-- Migration: 075 — Optimize Mock Attempt Initialization & Answers Concurrency
--
-- Background:
--   During 200-VU load testing, calling GET /rest/v1/mock_answers immediately after
--   initialize_mock_attempt caused severe PostgREST connection starvation and RLS
--   subquery contention across thousands of rows.
--
-- Enhancements:
--   1. Embeds the complete pre-populated answers array directly in the
--      initialize_mock_attempt RPC JSON response. This eliminates 100% of the
--      cold-start GET /rest/v1/mock_answers REST calls.
--   2. Preserves full entitlement gating (public.can_student_attempt_mock_test)
--      from mocktest-admin Migration 098.
--   3. Preserves server-authoritative timer recovery and advisory lock serialization.
--   4. Optimizes RLS on mock_answers to use indexed attempt lookups.
--   5. Adds composite indexes for instant query evaluation.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Index Optimizations
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists idx_mock_attempts_student_attempt
  on public.mock_attempts (student_id, attempt_id);

create index if not exists idx_mock_answers_attempt_question_idx
  on public.mock_answers (attempt_id, question_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Optimize mock_answers RLS Policy
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "Students have full access to their own mock_answers" on public.mock_answers;

create policy "Students have full access to their own mock_answers"
  on public.mock_answers
  for all
  to authenticated
  using (
    attempt_id in (
      select ma.attempt_id
      from public.mock_attempts ma
      where ma.student_id = public.get_my_student_id()
    )
  )
  with check (
    attempt_id in (
      select ma.attempt_id
      from public.mock_attempts ma
      where ma.student_id = public.get_my_student_id()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Update initialize_mock_attempt RPC to Return Embedded Answers
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.initialize_mock_attempt(
  p_test_id       uuid,
  p_student_id    uuid,
  p_institute_id  uuid,
  p_attempt_limit integer default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_attempt_id                 uuid;
  v_attempt_number             integer;
  v_existing_attempt_id        uuid;
  v_answer_count               integer;
  v_question_count             integer;
  v_in_progress_count          integer;
  v_stored_remaining           integer;
  v_last_activity_at           timestamptz;
  v_effective_remaining        integer;
  v_is_expired                 boolean;
  v_remaining_attempts         integer;
  v_total_attempts             bigint;
  v_answers_json               jsonb;
  v_result                     jsonb;
begin
  -- ════════════════════════════════════════════════════════════════════════
  --  AUTHORISATION CHECK
  -- ════════════════════════════════════════════════════════════════════════
  if not exists (
    select 1
      from public.student_details sd
     where sd.student_id  = p_student_id
       and sd.profile_id  = auth.uid()
  ) then
    return jsonb_build_object(
      'success', false,
      'error',   'Unauthorized: cannot start an attempt for a different student.',
      'code',    'STUDENT_MISMATCH'
    );
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  --  ENTITLEMENT CHECK (from mocktest-admin Migration 098)
  -- ════════════════════════════════════════════════════════════════════════
  if not public.can_student_attempt_mock_test(p_test_id) then
    return jsonb_build_object(
      'success', false,
      'error',   'This test requires an active subscription or course purchase. Renew or buy the course to continue.',
      'code',    'ENTITLEMENT_REQUIRED'
    );
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  --  SERIALISATION LOCK
  -- ════════════════════════════════════════════════════════════════════════
  perform pg_advisory_xact_lock(
    hashtext(
      coalesce(p_test_id::text, '') || '::' || coalesce(p_student_id::text, '')
    )
  );

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 1 — Check for existing in_progress attempt
  -- ════════════════════════════════════════════════════════════════════════

  -- 1a — Count how many in_progress attempts exist
  select count(*)
    into v_in_progress_count
    from public.mock_attempts ma
   where ma.test_id     = p_test_id
     and ma.student_id  = p_student_id
     and ma.status      = 'in_progress';

  -- 1b — Warn if multiple in_progress rows exist
  if v_in_progress_count > 1 then
    raise warning 'initialize_mock_attempt: found % in_progress attempts for student % on test %. Selecting the most recent.',
      v_in_progress_count, p_student_id, p_test_id;
  end if;

  -- 1c — Select the most recent attempt deterministically
  select ma.attempt_id,
         ma.time_remaining_seconds,
         ma.last_activity_at
    into v_existing_attempt_id,
         v_stored_remaining,
         v_last_activity_at
    from public.mock_attempts ma
   where ma.test_id     = p_test_id
     and ma.student_id  = p_student_id
     and ma.status      = 'in_progress'
   order by ma.started_at desc, ma.attempt_number desc
   limit 1;

  if found then
    -- ── Step 1d — Count existing mock_answers vs expected count ─────────
    select count(*) into v_answer_count
      from public.mock_answers
     where attempt_id = v_existing_attempt_id;

    select count(*) into v_question_count
      from public.mock_test_questions
     where test_id = p_test_id;

    -- ── Step 1e — Complete partial initialisation if needed ─────────────
    if v_answer_count < v_question_count then
      insert into public.mock_answers (attempt_id, question_id, institute_id)
      select v_existing_attempt_id, mtq.question_id, p_institute_id
        from public.mock_test_questions mtq
       where mtq.test_id = p_test_id
         and not exists (
           select 1
             from public.mock_answers ma
            where ma.attempt_id   = v_existing_attempt_id
              and ma.question_id  = mtq.question_id
         );
    end if;

    -- ════════════════════════════════════════════════════════════════════
    --  STEP 1f — Compute effective remaining time (server-authoritative)
    -- ════════════════════════════════════════════════════════════════════
    if v_last_activity_at is not null and v_stored_remaining is not null then
      v_effective_remaining := v_stored_remaining - (
        extract(epoch from now() - v_last_activity_at)
      )::integer;

      -- Clamp: never go below zero, never exceed stored value
      v_effective_remaining := greatest(0, least(v_stored_remaining, v_effective_remaining));
      v_is_expired := (v_effective_remaining <= 0);
    else
      v_effective_remaining := v_stored_remaining;
      v_is_expired := false;
    end if;

    -- ════════════════════════════════════════════════════════════════════
    --  STEP 1g — Auto-close expired attempts
    -- ════════════════════════════════════════════════════════════════════
    if v_is_expired then
      update public.mock_attempts
         set status               = 'timed_out',
             submitted_at         = now(),
             time_remaining_seconds = 0
       where attempt_id = v_existing_attempt_id;

      select count(*)
        into v_total_attempts
        from public.mock_attempts ma
       where ma.test_id    = p_test_id
         and ma.student_id = p_student_id;

      if p_attempt_limit is not null then
        v_remaining_attempts := greatest(0, p_attempt_limit - v_total_attempts::integer);
      else
        v_remaining_attempts := -1;  -- unlimited
      end if;
    end if;

    -- ── Step 1h — Aggregate mock_answers into JSON ───────────────────────
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'answer_id', ma.answer_id,
          'question_id', ma.question_id,
          'is_answered', ma.is_answered,
          'is_marked_for_review', ma.is_marked_for_review,
          'numerical_answer', ma.numerical_answer,
          'text_answer', ma.text_answer,
          'evaluation_status', ma.evaluation_status,
          'awarded_marks', ma.awarded_marks
        ) order by mtq.order_sequence asc
      ),
      '[]'::jsonb
    ) into v_answers_json
    from public.mock_answers ma
    join public.mock_test_questions mtq
      on mtq.question_id = ma.question_id and mtq.test_id = p_test_id
    where ma.attempt_id = v_existing_attempt_id;

    -- ── Return existing attempt with server-corrected timer & answers ───
    v_result := jsonb_build_object(
      'success',                     true,
      'attempt_id',                  v_existing_attempt_id,
      'reused',                      true,
      'effective_remaining_seconds', v_effective_remaining,
      'is_expired',                  v_is_expired,
      'answers',                     v_answers_json
    );

    if v_is_expired then
      v_result := v_result || jsonb_build_object('remaining_attempts', v_remaining_attempts);
    end if;
    return v_result;
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 2 — Compute attempt_number (safe under advisory lock)
  -- ════════════════════════════════════════════════════════════════════════
  select coalesce(max(ma.attempt_number), 0) + 1
    into v_attempt_number
    from public.mock_attempts ma
   where ma.test_id    = p_test_id
     and ma.student_id = p_student_id;

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 3 — Validate attempt limit
  -- ════════════════════════════════════════════════════════════════════════
  if p_attempt_limit is not null and v_attempt_number > p_attempt_limit then
    v_result := jsonb_build_object(
      'success', false,
      'error',   'You have used ' || (v_attempt_number - 1) || ' of ' ||
                 p_attempt_limit || ' allowed attempt(s) for this test.',
      'code',    'ATTEMPT_LIMIT_REACHED'
    );
    return v_result;
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 4 — Insert the attempt row (initialise last_activity_at = now())
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.mock_attempts (
    test_id, student_id, institute_id, attempt_number, status,
    last_activity_at
  ) values (
    p_test_id, p_student_id, p_institute_id, v_attempt_number, 'in_progress',
    now()
  )
  returning attempt_id into v_attempt_id;

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 5 — Bulk insert all mock_answer rows (single INSERT-SELECT)
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.mock_answers (attempt_id, question_id, institute_id)
  select v_attempt_id, mtq.question_id, p_institute_id
    from public.mock_test_questions mtq
   where mtq.test_id = p_test_id;

  -- ── Step 5b — Aggregate newly created mock_answers into JSON ──────────
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'answer_id', ma.answer_id,
        'question_id', ma.question_id,
        'is_answered', ma.is_answered,
        'is_marked_for_review', ma.is_marked_for_review,
        'numerical_answer', ma.numerical_answer,
        'text_answer', ma.text_answer,
        'evaluation_status', ma.evaluation_status,
        'awarded_marks', ma.awarded_marks
      ) order by mtq.order_sequence asc
    ),
    '[]'::jsonb
  ) into v_answers_json
  from public.mock_answers ma
  join public.mock_test_questions mtq
    on mtq.question_id = ma.question_id and mtq.test_id = p_test_id
  where ma.attempt_id = v_attempt_id;

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 6 — Return success with pre-populated answers
  -- ════════════════════════════════════════════════════════════════════════
  v_result := jsonb_build_object(
    'success',    true,
    'attempt_id', v_attempt_id,
    'reused',     false,
    'answers',    v_answers_json
  );
  return v_result;

exception
  when others then
    v_result := jsonb_build_object(
      'success', false,
      'error',   'Initialization failed: ' || sqlerrm,
      'code',    sqlstate
    );
    return v_result;
end;
$$;

comment on function public.initialize_mock_attempt(uuid, uuid, uuid, integer) is
  'Atomic mock attempt initialisation with server-authoritative timer recovery, subscription entitlement checks, and embedded answers array. '
  'Creates or reuses an in_progress attempt and returns the full pre-populated answers array directly to avoid '
  'cold-start REST roundtrip latency and RLS subquery contention.';
