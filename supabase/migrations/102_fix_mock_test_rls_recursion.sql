-- ============================================================================
-- Migration: 102 — Fix RLS recursion in Migration 101 policies
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEM
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 101 gated the five student SELECT policies with the entitlement
-- helper can_student_attempt_mock_test() PLUS an own-attempt exception that
-- was written as an INLINE subquery on public.mock_attempts:
--
--     or exists (
--       select 1 from public.mock_attempts ma
--        where ma.test_id = <test ref>
--          and ma.student_id = public.get_my_student_id()
--     )
--
-- Because the subquery lives INSIDE the policy expression, PostgreSQL applies
-- RLS to public.mock_attempts while evaluating it. mock_attempts carries a
-- PRE-EXISTING teacher policy (Migration 021, "Teachers can read mock_attempts
-- on their tests") that references public.mock_tests BACK:
--
--     mock_tests (101 policy)
--       └─ inline subquery → mock_attempts (RLS applied)
--            └─ 021 teacher policy → mock_tests (RLS applied again)
--                 └─ … infinite loop
--
-- Result: every student read that touches mock_tests (assigned mock tests via
-- the dashboard, PYQ CBT launch via pyq_mock_mappings→mock_tests, direct REST
-- reads) fails with:
--
--     ERROR 42P17: infinite recursion detected in policy for relation
--     "mock_tests"
--
-- ════════════════════════════════════════════════════════════════════════════
-- FIX
-- ════════════════════════════════════════════════════════════════════════════
-- Wrap the own-attempt lookup in a SECURITY DEFINER helper,
-- student_has_attempt(p_test_id uuid), so the mock_attempts read executes
-- under the definer role and BYPASSES RLS — exactly the same technique used
-- by can_student_attempt_mock_test (098) and the tier helpers (091/093/096).
-- The RLS policy-reference graph becomes a DAG:
--
--     mock_tests / mock_test_questions / questions / question_options /
--     question_explanations
--       └─ can_student_attempt_mock_test (SECURITY DEFINER — bypasses RLS)
--       └─ student_has_attempt          (SECURITY DEFINER — bypasses RLS)
--
-- No policy references a table that references it back → no recursion.
--
-- This migration:
--   • Creates ONE helper: public.student_has_attempt(uuid) → boolean.
--   • Drops + recreates ONLY the five Migration 101 student policies with the
--     inline mock_attempts subquery replaced by public.student_has_attempt(...).
--   • Changes NO business rule: the own-attempt exception still applies
--     (any-status attempt row owned by the caller) and can_student_attempt_
--     mock_test is untouched.
--   • Does NOT touch teacher/admin policies, junction tables, publishing,
--     the mobile app, or Edge Functions.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY / RECURSION REVIEW
-- ════════════════════════════════════════════════════════════════════════════
-- • student_has_attempt is SECURITY DEFINER with set search_path = '' and
--   fully qualified public.* references (project convention, 098/091/093/096).
--   The mock_attempts read inside it therefore never triggers RLS.
-- • Caller scoping: get_my_student_id() resolves auth.uid() — a caller can
--   only ever check for their OWN attempt rows (SECURITY DEFINER does not
--   change auth.uid(), so impersonation is impossible).
-- • STABLE / read-only — parallel safe, safe to call from policy expressions.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run in the Supabase SQL editor after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Helper exists:
--    select proname, prosecdef from pg_proc where proname = 'student_has_attempt';
-- 2. No recursion — assigned mock tests load for an entitled student:
--    (student JWT)
--    select * from public.mock_tests
--     where status = 'published' limit 5;        -- must NOT throw 42P17
--    select * from public.mock_test_questions limit 5;  -- must NOT throw 42P17
-- 3. Own-attempt exception still works (student with an in_progress attempt):
--    select public.student_has_attempt('<attempted_test_id>');  -- true
--    (student JWT)  select * from public.mock_test_questions
--     where test_id = '<attempted_test_id>';     -- rows return, no 42P17
-- 4. Premium test still gated for a non-entitled student (no attempt row):
--    select public.student_has_attempt('<premium_test_id>');     -- false
--    (non-entitled student JWT)
--    select * from public.mock_test_questions where test_id = '<premium_test_id>';
--    -- 0 rows — entitlement still enforced
-- 5. Teacher/admin CRUD unchanged:
--    (teacher JWT)  select * from public.mock_attempts limit 5;
--    (admin JWT)    select * from public.questions limit 5;
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Re-apply the five policy bodies from Migration 101 (which restore the
-- inline subquery form), then:
--   drop function if exists public.student_has_attempt(uuid);
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — student_has_attempt(p_test_id uuid)
-- ════════════════════════════════════════════════════════════════════════════
-- TRUE when the current authenticated student holds ANY mock_attempts row
-- (any status — in_progress, completed, timed_out) for the given test.
-- SECURITY DEFINER so the mock_attempts read bypasses RLS, breaking the
-- mock_tests ⇄ mock_attempts policy cycle introduced by Migration 101.
create or replace function public.student_has_attempt(
    p_test_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mock_attempts ma
     where ma.test_id = p_test_id
       and ma.student_id = public.get_my_student_id()
  );
$$;

comment on function public.student_has_attempt(uuid) is
  'Migration 102: TRUE when the current authenticated student holds any '
  'mock_attempts row for the given test (any status). SECURITY DEFINER so the '
  'mock_attempts read bypasses RLS — breaking the recursion cycle between the '
  'Migration 101 mock_tests/mock_test_questions policies and the Migration 021 '
  'teacher policy on mock_attempts. Own-attempt exception for the 101 content '
  'policies; caller is scoped via get_my_student_id() (auth.uid()).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — mock_test_questions  (primary content table — question_snapshot)
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "Students can read questions in published tests"
  on public.mock_test_questions;

create policy "Students can read questions in published tests"
  on public.mock_test_questions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.mock_tests mt
      where mt.test_id = mock_test_questions.test_id
        and mt.status = 'published'::public.mock_test_status
        and mt.institute_id = public.get_my_institute_id()
        and (
          public.can_student_attempt_mock_test(mock_test_questions.test_id)
          or public.student_has_attempt(mock_test_questions.test_id)
        )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — mock_tests  (test catalog metadata — same gate for consistency)
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "Students can read published mock_tests"
  on public.mock_tests;

create policy "Students can read published mock_tests"
  on public.mock_tests
  for select
  to authenticated
  using (
    status = 'published'::public.mock_test_status
    and institute_id = public.get_my_institute_id()
    and (
      public.can_student_attempt_mock_test(test_id)
      or public.student_has_attempt(test_id)
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — questions  (live question bank — stems + marks)
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "Students can read published questions"
  on public.questions;

create policy "Students can read published questions"
  on public.questions
  for select
  to authenticated
  using (
    status = 'published'::public.question_status
    and institute_id = public.get_my_institute_id()
    and exists (
      select 1
      from public.mock_test_questions mtq
      join public.mock_tests mt on mt.test_id = mtq.test_id
      where mtq.question_id = questions.question_id
        and mt.status = 'published'::public.mock_test_status
        and (
          public.can_student_attempt_mock_test(mtq.test_id)
          or public.student_has_attempt(mtq.test_id)
        )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — question_options  (live answer key — is_correct)
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "Students can read options for published questions"
  on public.question_options;

create policy "Students can read options for published questions"
  on public.question_options
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.questions q
      join public.mock_test_questions mtq on mtq.question_id = q.question_id
      join public.mock_tests mt on mt.test_id = mtq.test_id
      where q.question_id = question_options.question_id
        and q.status = 'published'::public.question_status
        and q.institute_id = public.get_my_institute_id()
        and mt.status = 'published'::public.mock_test_status
        and (
          public.can_student_attempt_mock_test(mtq.test_id)
          or public.student_has_attempt(mtq.test_id)
        )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — question_explanations  (solutions)
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "Students can read explanations for published questions"
  on public.question_explanations;

create policy "Students can read explanations for published questions"
  on public.question_explanations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.questions q
      join public.mock_test_questions mtq on mtq.question_id = q.question_id
      join public.mock_tests mt on mt.test_id = mtq.test_id
      where q.question_id = question_explanations.question_id
        and q.status = 'published'::public.question_status
        and q.institute_id = public.get_my_institute_id()
        and mt.status = 'published'::public.mock_test_status
        and (
          public.can_student_attempt_mock_test(mtq.test_id)
          or public.student_has_attempt(mtq.test_id)
        )
    )
  );

-- ============================================================================
-- END OF MIGRATION 102
-- ============================================================================
