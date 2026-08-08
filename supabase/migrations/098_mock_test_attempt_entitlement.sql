-- ============================================================================
-- Migration: 098 — Mock Test Attempt Entitlement Enforcement (audit C3)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- Server-side enforcement that only entitled students can start or resume a
-- mock test. Previously the ONLY server-side guard on attempt creation was
-- student-ownership (STUDENT_MISMATCH) + attempt limits: an expired or
-- never-subscribed student could call initialize_mock_attempt directly with
-- any published test_id in their institute (or INSERT a mock_attempts row via
-- the REST API) and receive a fully pre-populated attempt + all questions.
--
-- This migration closes BOTH creation surfaces:
--   1. initialize_mock_attempt RPC — new entitlement gate (fail-closed).
--   2. mock_attempts student INSERT/UPDATE policy — WITH CHECK now requires
--      the same entitlement helper.
--
-- SCOPE (strict, per the C3 fix request):
--   • Creates ONE new helper and modifies ONLY initialize_mock_attempt and
--     the student mock_attempts policy.
--   • NO changes to pricing, subscriptions, renewals, conversions, payments,
--     or any RLS policy unrelated to mock tests.
--   • Reuses the existing Phase 11I/11K entitlement helpers — no duplicated
--     business logic.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ENTITLEMENT RULE (delegated to existing helpers)
-- ════════════════════════════════════════════════════════════════════════════
-- can_student_attempt_mock_test(p_test_id) returns TRUE when:
--   (a) the test has NO course/batch linkage  → free institute-wide test, OR
--   (b) the student holds content entitlement for ANY linked course
--       (course_mock_tests.course_id → can_student_access_content), OR
--   (c) for ANY linked batch-subject
--       (batch_subject_mock_tests.batch_subject_id →
--        can_student_access_content_batch_subject), OR
--   (d) for ANY legacy-batch-linked course
--       (batch_mock_tests.batch_id → course_batches.course_id →
--        can_student_access_content).
--
-- can_student_access_content already composes permanent course ownership
-- (is_permanent_course_owner, 096), active/grace/content-window tiers, and
-- active batch assignment — so this migration inherits every existing
-- business rule (incl. post-conversion ownership) without re-implementing it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY / RECURSION REVIEW
-- ════════════════════════════════════════════════════════════════════════════
-- • The helper is SECURITY DEFINER with set search_path = '' and fully
--   qualified public.* references (project convention, 091/093/096).
-- • It reads course_mock_tests / batch_subject_mock_tests / batch_mock_tests
--   and delegates to the existing tier helpers; NONE of these read
--   mock_attempts, so no RLS recursion is possible when the helper is used
--   inside the mock_attempts policy.
-- • Caller scoping is via get_my_student_id() inside the tier helpers
--   (auth.uid()): a caller can only ever test their OWN entitlement.
-- • Inside initialize_mock_attempt (SECURITY DEFINER) the helper resolves the
--   SAME authenticated caller — the STUDENT_MISMATCH check above it already
--   proves p_student_id belongs to auth.uid().
-- • STABLE / read-only — parallel safe.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run in the Supabase SQL editor after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Helper exists:
--    select proname, prosecdef from pg_proc where proname = 'can_student_attempt_mock_test';
-- 2. Entitled student on a course-linked test → TRUE:
--    select public.can_student_attempt_mock_test('<test_id>');
-- 3. Unlinked (institute-wide) test → TRUE for any student:
--    select public.can_student_attempt_mock_test('<unlinked_test_id>');
-- 4. Non-entitled student on a course-linked test → FALSE + RPC returns
--    { success:false, code:'ENTITLEMENT_REQUIRED' } and NO mock_attempts row.
-- 5. Direct REST INSERT into mock_attempts without entitlement → policy
--    rejects (with check violation).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Restore the pre-098 initialize_mock_attempt body (Migration 051) and drop
-- the helper, then restore the original mock_attempts policy:
--   drop function if exists public.can_student_attempt_mock_test(uuid);
-- (then re-apply the 051 CREATE OR REPLACE and the original 021 policy)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — can_student_attempt_mock_test(p_test_id uuid)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.can_student_attempt_mock_test(
    p_test_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- (a) No course/batch linkage → free institute-wide test
    not exists (
      select 1 from public.course_mock_tests cmt
       where cmt.test_id = p_test_id
      union all
      select 1 from public.batch_subject_mock_tests bsmt
       where bsmt.test_id = p_test_id
      union all
      select 1 from public.batch_mock_tests bmt
       where bmt.test_id = p_test_id
    )
    -- (b) Content entitlement for ANY directly-linked course
    or exists (
      select 1 from public.course_mock_tests cmt
       where cmt.test_id = p_test_id
         and public.can_student_access_content(cmt.course_id)
    )
    -- (c) Content entitlement for ANY linked batch-subject
    or exists (
      select 1 from public.batch_subject_mock_tests bsmt
       where bsmt.test_id = p_test_id
         and public.can_student_access_content_batch_subject(bsmt.batch_subject_id)
    )
    -- (d) Content entitlement for ANY legacy-batch-linked course
    or exists (
      select 1
        from public.batch_mock_tests bmt
        join public.course_batches cb on cb.batch_id = bmt.batch_id
       where bmt.test_id = p_test_id
         and public.can_student_access_content(cb.course_id)
    );
$$;

comment on function public.can_student_attempt_mock_test(uuid) is
  'Audit C3: TRUE when the current authenticated student may attempt the '
  'given mock test. Free for tests with no course/batch linkage; otherwise '
  'requires content entitlement (permanent ownership, active/grace/'
  'content-window subscription) to at least one linked course or batch-'
  'subject. Delegates to can_student_access_content and '
  'can_student_access_content_batch_subject. SECURITY DEFINER — safe to '
  'call from RLS policies and from initialize_mock_attempt without '
  'recursion.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — initialize_mock_attempt (CREATE OR REPLACE with C3 gate)
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
  --  ENTITLEMENT CHECK (audit C3 — server-side mock-test authorization)
  -- ════════════════════════════════════════════════════════════════════════
  -- Course/batch-linked tests are premium content: the student must hold
  -- content entitlement (permanent ownership, active subscription, grace,
  -- or the content-access window) for at least one linked course or
  -- batch-subject. Institute-wide tests with NO course/batch linkage
  -- remain free. All entitlement rules are delegated to the existing
  -- helpers (can_student_access_content / can_student_access_content_
  -- batch_subject) — no business logic is duplicated here.
  --
  -- This check runs BEFORE the advisory lock and BEFORE any reuse/insert
  -- logic, so an expired or never-entitled student can neither CREATE nor
  -- RESUME an attempt: a deterministic ENTITLEMENT_REQUIRED error is
  -- returned and no attempt row or answer row is ever written.
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
    --
    --   effective_remaining := stored_remaining - (now() - last_activity_at)
    --
    -- This is the CORE of the crash-recovery fix. If the student killed
    -- the app 30 minutes ago, the stored time_remaining_seconds is stale.
    -- We subtract the real wall-clock elapsed time since last_activity_at
    -- using server NOW(), which cannot be manipulated by the client.
    --
    -- Edge cases:
    --   - If last_activity_at is NULL (legacy data before migration 050),
    --     we trust the stored value and skip the correction.
    --   - If effective_remaining <= 0, the attempt is expired.
    --   - If effective_remaining > stored_remaining, we clamp to stored
    --     (this should never happen, but is a safe guard).
    --
    if v_last_activity_at is not null and v_stored_remaining is not null then
      v_effective_remaining := v_stored_remaining - (
        extract(epoch from now() - v_last_activity_at)
      )::integer;

      -- Clamp: never go below zero, never exceed stored value
      v_effective_remaining := greatest(0, least(v_stored_remaining, v_effective_remaining));
      v_is_expired := (v_effective_remaining <= 0);
    else
      -- No last_activity_at — trust stored value (legacy fallback)
      v_effective_remaining := v_stored_remaining;
      v_is_expired := false;
    end if;

    -- ════════════════════════════════════════════════════════════════════
    --  STEP 1g — Auto-close expired attempts
    -- ════════════════════════════════════════════════════════════════════
    -- If the timer has expired while the student was away, transition the
    -- attempt to 'timed_out' atomically within this transaction.  This
    -- eliminates the infinite "Test Time Expired" loop where the student
    -- can never start a new attempt because the expired attempt remains
    -- in_progress forever.
    --
    -- This is safe under the advisory lock acquired in Step 0 — no
    -- concurrent session can create a new attempt while we finalize this
    -- one.  On the next RPC call, this attempt will no longer match
    -- WHERE status = 'in_progress', so a new attempt will be created
    -- (or ATTEMPT_LIMIT_REACHED returned if the limit is exhausted).
    --
    -- The status 'timed_out' requires submitted_at IS NOT NULL
    -- (enforced by ck_mock_attempts_status_submitted).
    if v_is_expired then
      update public.mock_attempts
         set status               = 'timed_out',
             submitted_at         = now(),
             time_remaining_seconds = 0
       where attempt_id = v_existing_attempt_id;

      -- ════════════════════════════════════════════════════════════════════
      --  STEP 1h — Compute remaining attempts for the expired UI
      -- ════════════════════════════════════════════════════════════════════
      -- The client needs to know whether the student can start another
      -- attempt.  Compute remaining (including the one just closed, which
      -- still counts toward the limit).
      --   - NULL attempt_limit → unlimited (v_remaining_attempts = -1)
      --   - Otherwise          → max(0, limit - total_attempts)
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

    -- ── Return existing attempt with server-corrected timer ─────────────
    v_result := jsonb_build_object(
      'success',                   true,
      'attempt_id',                v_existing_attempt_id,
      'reused',                    true,
      'effective_remaining_seconds', v_effective_remaining,
      'is_expired',                v_is_expired
    );

    -- Add remaining_attempts only when expired (UI needs it)
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

  -- ════════════════════════════════════════════════════════════════════════
  --  STEP 6 — Return success (new attempt, effective_remaining not applicable)
  -- ════════════════════════════════════════════════════════════════════════
  v_result := jsonb_build_object(
    'success',    true,
    'attempt_id', v_attempt_id,
    'reused',     false
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

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — mock_attempts student policy: gate INSERT/UPDATE on entitlement
-- ════════════════════════════════════════════════════════════════════════════
-- The original 021 policy "Students have full access to their own
-- mock_attempts" used (student_id = get_my_student_id()) as its WITH CHECK,
-- which allowed a student to INSERT a mock_attempts row directly via the
-- REST API for ANY test_id — bypassing the RPC entirely. The WITH CHECK now
-- also requires can_student_attempt_mock_test(test_id), so direct creation
-- (INSERT) and continuation (UPDATE) of attempts are entitlement-gated while
-- SELECT/DELETE of one's own rows remain unchanged.
--
-- SECURITY DEFINER functions bypass RLS, so initialize_mock_attempt's
-- internal inserts/updates are unaffected by this policy change.
drop policy if exists "Students have full access to their own mock_attempts"
  on public.mock_attempts;

create policy "Students have full access to their own mock_attempts"
  on public.mock_attempts
  for all
  to authenticated
  using (student_id = public.get_my_student_id())
  with check (
    student_id = public.get_my_student_id()
    and public.can_student_attempt_mock_test(test_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 098
-- ============================================================================
