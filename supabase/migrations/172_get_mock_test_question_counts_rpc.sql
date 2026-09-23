-- ============================================================================
-- Migration: 172 — get_mock_test_question_counts RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEM
-- ════════════════════════════════════════════════════════════════════════════
-- Both the web app (fetchMockTestQuestionCounts) and the mobile app
-- (getAssignedMockTests) count questions for a batch of assigned mock tests
-- with a raw PostgREST read:
--
--     from('mock_test_questions').select('test_id').in('test_id', [...])
--
-- The deployed student SELECT policy on public.mock_test_questions
-- (migration 102, "Students can read questions in published tests") evaluates
-- its USING expression PER QUESTION ROW. That expression contains a nested
-- EXISTS against mock_tests plus two per-row SECURITY DEFINER entitlement
-- helpers:
--
--     public.can_student_attempt_mock_test(mock_test_questions.test_id)
--     OR public.student_has_attempt(mock_test_questions.test_id)
--
-- EXPLAIN evidence: 11 visible question rows took ~70 ms under the student
-- policy versus ~0.109 ms with RLS bypassed — the helper SubPlan loops once
-- per question row. A 200-question test therefore pays the entitlement cost
-- 200 times even though the answer is identical for every row of the test.
--
-- ════════════════════════════════════════════════════════════════════════════
-- FIX
-- ════════════════════════════════════════════════════════════════════════════
-- Add ONE read-only RPC that:
--   1. Deduplicates the requested test ids.
--   2. Drops NULL ids.
--   3. Resolves the VISIBLE test set with the exact migration-102 visibility
--      rule — mock_tests.status = 'published' AND
--      mock_tests.institute_id = get_my_institute_id() AND
--      (can_student_attempt_mock_test(test_id) OR student_has_attempt(test_id)).
--   4. ONLY THEN counts mock_test_questions per test via a plain indexed join.
--
-- The visible-test CTE is MATERIALIZED, so the entitlement helpers execute
-- ONCE PER DISTINCT TEST instead of once per question row. PostgreSQL cannot
-- inline the CTE and push the function predicates back down onto every
-- question row.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEMANTICS PRESERVED
-- ════════════════════════════════════════════════════════════════════════════
-- • Same visibility rule as the deployed mock_test_questions RLS policy —
--   the policy itself is NOT touched or weakened.
-- • Tests that are unpublished, in another institute, or neither entitled nor
--   previously attempted return NO row (never a fabricated 0), matching the
--   previous client behavior where the returned Map only carried test ids that
--   had at least one readable question row. Clients keep their existing
--   `?? fallback` (e.g. paperMetadata.total_questions).
-- • A visible test with zero questions yields no group row — same as before.
-- • Covers normal batch-assigned tests, course-unlinked batch tests,
--   PYQ-derived tests (via clause (e) of can_student_attempt_mock_test in
--   migration 160), tests with a previous attempt (student_has_attempt), and
--   tests allowed purely by can_student_attempt_mock_test. It deliberately
--   does NOT require course_batches linkage, so it does not reproduce the
--   narrower get_courses_content_summary semantics.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY REVIEW
-- ════════════════════════════════════════════════════════════════════════════
-- • SECURITY DEFINER with set search_path = '' and fully qualified public.*
--   references (project convention, 098/102/155). The function definition
--   bypasses mock_test_questions RLS on purpose — that is what removes the
--   per-row policy cost — and reproduces the visibility authorization
--   explicitly instead.
-- • Institute scoping: get_my_institute_id() resolves auth.uid()'s institute;
--   an anonymous or cross-institute caller matches no mock_tests row.
-- • Caller scoping: can_student_attempt_mock_test / student_has_attempt scope
--   to get_my_student_id() (auth.uid()), so no other student's entitlement or
--   attempt history can be observed and no cross-student counts are possible.
-- • Read-only, STABLE, no dynamic SQL, parallel safe.
-- • EXECUTE is revoked from PUBLIC/anon and granted only to authenticated.
--
-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run in the Supabase SQL editor after applying, as a student)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Function exists and is SECURITY DEFINER:
--    select proname, prosecdef, proretset
--      from pg_proc where proname = 'get_mock_test_question_counts';
-- 2. Normal batch-assigned test returns its real question count:
--    select * from public.get_mock_test_question_counts(
--      array['<assigned_test_id>']::uuid[]);
-- 3. Duplicate ids are deduplicated (one row per test):
--    select * from public.get_mock_test_question_counts(
--      array['<t>', '<t>']::uuid[]);
-- 4. Unpublished / cross-institute / non-entitled tests return NO row.
-- 5. Empty / NULL input returns no rows:
--    select * from public.get_mock_test_question_counts(null);
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
--   drop function if exists public.get_mock_test_question_counts(uuid[]);
-- ============================================================================

create or replace function public.get_mock_test_question_counts(
  p_test_ids uuid[]
)
returns table (
  test_id        uuid,
  question_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as materialized (
    -- 1. Deduplicate the requested ids and drop NULLs.
    select distinct t.test_id
      from unnest(p_test_ids) as t(test_id)
     where t.test_id is not null
  ),
  visible_tests as materialized (
    -- 2. Authorization is resolved ONCE per distinct test id, never per
    --    question row. Mirrors the migration-102 mock_test_questions policy
    --    exactly; nothing here reads mock_test_questions.
    select r.test_id
      from requested r
      join public.mock_tests mt
        on mt.test_id = r.test_id
     where mt.status = 'published'::public.mock_test_status
       and mt.institute_id = public.get_my_institute_id()
       and (
         public.can_student_attempt_mock_test(r.test_id)
         or public.student_has_attempt(r.test_id)
       )
  )
  -- 3. Only now count questions, with a plain indexed join on test_id.
  select v.test_id,
         count(*)::integer as question_count
    from visible_tests v
    join public.mock_test_questions mtq
      on mtq.test_id = v.test_id
   group by v.test_id;
$$;

comment on function public.get_mock_test_question_counts(uuid[]) is
  'Migration 172: batched, authorization-aware question counts for assigned '
  'mock tests. Resolves the visible test set with the exact mock_test_questions '
  'RLS visibility rule (published + same institute + can_student_attempt_mock_test '
  'OR student_has_attempt) ONCE PER DISTINCT TEST, then counts '
  'mock_test_questions by test_id. Returns { test_id, question_count } only for '
  'visible tests with at least one question — unpublished, cross-institute, '
  'non-entitled and zero-question tests produce no row, preserving the previous '
  'client Map semantics. SECURITY DEFINER, read-only, no dynamic SQL.';

-- ── Grants: authenticated students only ────────────────────────────────────
revoke all on function public.get_mock_test_question_counts(uuid[]) from public;
revoke all on function public.get_mock_test_question_counts(uuid[]) from anon;
grant execute on function public.get_mock_test_question_counts(uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 172
-- ============================================================================
