-- ============================================================================
-- Migration: 101 — Mock Test Content Entitlement (audit C3 residual fix)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEM
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 098 closed the attempt-CREATION surfaces (initialize_mock_attempt
-- RPC + mock_attempts INSERT/UPDATE policy), but the student SELECT policies
-- on the mock-test content tables were left untouched. Any authenticated
-- student in the institute could still read premium content directly via
-- REST/SQL with no entitlement:
--
--   • mock_tests          — "Students can read published mock_tests"
--   • mock_test_questions — "Students can read questions in published tests"
--                            (question_snapshot incl. isCorrect +
--                             correctNumericalAnswer — the ANSWER KEY)
--   • questions           — "Students can read published questions"
--   • question_options    — "Students can read options for published questions"
--                            (question_options.is_correct = live answer key)
--   • question_explanations — "Students can read explanations for published
--                              questions"  (comment claims 'after attempt' but
--                              no attempt check exists)
--
-- All five policies only checked published status + institute membership.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FIX (Option B — protect ALL five student SELECT policies)
-- ════════════════════════════════════════════════════════════════════════════
-- Gate the student SELECT policies with the existing entitlement helper
-- can_student_attempt_mock_test(p_test_id) (migration 098) PLUS an own-attempt
-- exception so a student who legitimately started (or completed) an attempt
-- can finish and review it even if their subscription lapses mid-attempt.
--
-- can_student_attempt_mock_test already encodes the business rule without
-- duplicating logic:
--   (a) test has NO course/batch-subject/batch linkage  → free institute-wide
--       test → TRUE for every student
--   (b) any linked course → can_student_access_content(course_id)
--   (c) any linked batch-subject → can_student_access_content_batch_subject(...)
--   (d) legacy batch-linked course → course_batches → can_student_access_content
--
-- The own-attempt exception mirrors the existing mock_answers ownership
-- policy: a student may always read content for a test they hold an attempt
-- row on (any status — in_progress, completed, timed_out), so in-flight
-- attempts and post-submission review keep working after entitlement expiry.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SCOPE (strict, per the C3 residual fix request)
-- ════════════════════════════════════════════════════════════════════════════
--   • Rewrites ONLY the five student SELECT policies listed above.
--   • Does NOT touch teacher policies (teacher_id = get_my_teacher_id()),
--     admin policies (075 super_admin/academic_admin), publishing
--     (publishMockTestWorkflow + migration-100 trigger run as service role /
--     SECURITY DEFINER and bypass RLS), or any junction-table policy.
--   • No mobile-app or Edge Function changes required — reads already flow
--     through RLS.
--
-- ════════════════════════════════════════════════════════════════════════════
-- RECURSION REVIEW
-- ════════════════════════════════════════════════════════════════════════════
--   questions          → mock_test_questions → mock_tests / mock_attempts
--   question_options   → questions           → mock_test_questions → ...
--   question_explanations → questions        → mock_test_questions → ...
--   mock_test_questions → mock_tests / mock_attempts
--   mock_tests         → can_student_attempt_mock_test (SECURITY DEFINER,
--                        reads course_mock_tests / batch_subject_mock_tests /
--                        batch_mock_tests / course_batches — NONE of which
--                        read these five tables) + mock_attempts
-- No policy references a table that references it back → no RLS recursion.
-- can_student_attempt_mock_test is SECURITY DEFINER with search_path='' and
-- fully qualified public.* references (098 convention).
--
-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run in the Supabase SQL editor after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Free institute-wide test (no course/batch linkage) still readable by any
--    student:
--      select public.can_student_attempt_mock_test('<unlinked_test_id>');  -- true
-- 2. Premium test invisible to a non-entitled student (expect 0 rows):
--      set local role authenticated;  -- as a student JWT
--      select * from public.mock_test_questions where test_id = '<premium_test_id>';
-- 3. Premium test visible to an entitled student:
--      (entitled student JWT)
--      select * from public.mock_test_questions where test_id = '<premium_test_id>';
-- 4. question_options.is_correct no longer reachable without entitlement:
--      (non-entitled student JWT)
--      select * from public.question_options
--       where question_id in (select question_id from public.mock_test_questions);
-- 5. Teacher/admin CRUD unchanged:
--      (teacher JWT)  select * from public.mock_test_questions limit 5;
--      (admin JWT)    select * from public.questions limit 5;
-- 6. In-progress attempt still renders after subscription expiry:
--      (student with in_progress attempt)  select * from public.mock_test_questions
--       where test_id = '<attempted_test_id>';
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- Re-apply the original five policies from Migration 021_rls_policies.sql
-- (Sections 7a–7e student SELECT policies).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — mock_test_questions  (primary content table — question_snapshot)
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
          or exists (
            select 1 from public.mock_attempts ma
            where ma.test_id = mock_test_questions.test_id
              and ma.student_id = public.get_my_student_id()
          )
        )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — mock_tests  (test catalog metadata — same gate for consistency)
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
      or exists (
        select 1 from public.mock_attempts ma
        where ma.test_id = mock_tests.test_id
          and ma.student_id = public.get_my_student_id()
      )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — questions  (live question bank — stems + marks)
-- ════════════════════════════════════════════════════════════════════════════
-- A published question is student-readable only when it appears in at least
-- one published mock test the student may attempt (or has attempted).
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
          or exists (
            select 1 from public.mock_attempts ma
            where ma.test_id = mtq.test_id
              and ma.student_id = public.get_my_student_id()
          )
        )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — question_options  (live answer key — is_correct)
-- ════════════════════════════════════════════════════════════════════════════
-- Mirrors Section 3 via the parent question. This closes the direct answer-key
-- path (question_options.is_correct) that did not even require question_snapshot.
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
          or exists (
            select 1 from public.mock_attempts ma
            where ma.test_id = mtq.test_id
              and ma.student_id = public.get_my_student_id()
          )
        )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — question_explanations  (solutions — previously readable with no
--              attempt despite the 'after attempt' comment)
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
          or exists (
            select 1 from public.mock_attempts ma
            where ma.test_id = mtq.test_id
              and ma.student_id = public.get_my_student_id()
          )
        )
    )
  );

-- ============================================================================
-- END OF MIGRATION 101
-- ============================================================================
