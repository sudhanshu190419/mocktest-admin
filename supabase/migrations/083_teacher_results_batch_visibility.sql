-- ============================================================================
-- Migration: 083 — Teacher Results Visibility (Batch Assignment Enforcement)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Table: mock_results
--
-- Depends on: Migration 021 (base RLS policies + get_my_teacher_id())
--             Migration 066 (batch_subjects, get_teacher_batch_ids() v1)
--             Migration 067 (batch_subject_teachers — subject-scoped assignments;
--                             get_teacher_batch_ids() v2 via batch_subject_teachers)
--             Migration 082 (teacher RLS fixes for batches / batch_students /
--                            student_details / profiles)
--
-- ## Problem
--
-- The teacher SELECT policy on `mock_results` (migration 021) is scoped ONLY
-- by test ownership:
--
--   "Teachers can read mock_results for their tests"
--     using (exists (
--       select 1 from public.mock_tests mt
--       where mt.test_id = mock_results.test_id
--         and mt.teacher_id = public.get_my_teacher_id()
--     ))
--
-- This means a teacher can see results of ANY student who attempted one of
-- their tests — even if that student is not assigned to the teacher.
--
-- ## Desired behaviour
--
-- A teacher should see a result ONLY when BOTH conditions hold:
--
--   1. The teacher owns the mock test (mock_tests.teacher_id = current teacher)
--   2. The student belongs to one of the teacher's assigned batches
--      (resolved through the centralized SECURITY DEFINER helper
--       `get_teacher_batch_ids()` — no manual rejoin of
--       batch_subject_teachers → batch_subjects)
--
-- ## Solution
--
-- Replace the single teacher SELECT policy on `mock_results` with a combined
-- policy requiring both conditions. Admin and Student policies are untouched.
--
-- ## Why the helper (not a manual rejoin)
--
-- `get_teacher_batch_ids()` (migration 067) centralizes teacher→batch
-- resolution and is SECURITY DEFINER (`set search_path = ''`), so:
--   - RLS is bypassed inside the helper → no recursive RLS evaluation.
--   - The teacher→batch mapping stays in ONE place, consistent with the
--     `batch_subjects` teacher policy (066) which already uses this helper.
--
-- The chain terminates: `get_teacher_batch_ids()` → `get_my_teacher_id()`
-- (also SECURITY DEFINER, reads teacher_details only). No cycle back to
-- `mock_results`, `batch_students`, or the batch tables.
--
-- ## Order
--
--   1. Drop the legacy teacher policy on mock_results
--   2. Create the combined teacher policy
--   3. Validation queries
--   4. Rollback (commented)
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Replace teacher SELECT policy on `mock_results`
-- ════════════════════════════════════════════════════════════════════════════
--
-- Drop first (idempotent — safe to re-run).

drop policy if exists "Teachers can read mock_results for their tests"
  on public.mock_results;

create policy "Teachers can read mock_results for their tests and assigned students"
  on public.mock_results
  for select
  to authenticated
  using (
    -- Condition 1: the teacher owns the mock test (unchanged behaviour)
    exists (
      select 1
      from public.mock_tests mt
      where mt.test_id = mock_results.test_id
        and mt.teacher_id = public.get_my_teacher_id()
    )
    -- Condition 2: the student is enrolled in one of the teacher's assigned
    -- batches. Teacher→batch resolution reuses the centralized SECURITY
    -- DEFINER helper `get_teacher_batch_ids()` (migration 067) instead of
    -- rejoining batch_subject_teachers → batch_subjects.
    and exists (
      select 1
      from public.batch_students bs
      where bs.student_id = mock_results.student_id
        and bs.batch_id = any (public.get_teacher_batch_ids())
    )
  );

comment on policy "Teachers can read mock_results for their tests and assigned students"
  on public.mock_results is
  'Teachers can read mock_results only when they own the mock test AND the '
  'student is enrolled in one of their assigned batches (via the centralized '
  'get_teacher_batch_ids() SECURITY DEFINER helper). Replaces the '
  'test-ownership-only policy from migration 021.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Validation Queries
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run these to confirm the policy is installed correctly.
--
-- -- 2a. The old teacher policy must be GONE; the new one must exist
-- select tablename, policyname, cmd, qual
-- from pg_policies
-- where tablename = 'mock_results'
--   and policyname like 'Teachers%';
--   -- Expected: exactly ONE row, policyname =
--   --   'Teachers can read mock_results for their tests and assigned students'
--   --   and qual contains BOTH 'mock_tests' AND 'get_teacher_batch_ids'
--   --   and does NOT contain 'batch_subject_teachers' (helper reused, not rejoined).
--
-- -- 2b. All three mock_results policies present (teacher + admin + student)
-- select tablename, policyname, cmd
-- from pg_policies
-- where tablename = 'mock_results'
-- order by policyname;
--   -- Expected:
--   --   Admins have full access to mock_results                    (FOR ALL)
--   --   Students can read their own mock_results                   (FOR SELECT)
--   --   Teachers can read mock_results for their tests and
--   --     assigned students                                        (FOR SELECT)
--
-- -- 2c. Functional smoke tests — run as each role.
-- --     (Set the role first, then run the SELECT; count expectations assume
-- --      the described seed data.)
-- --
-- --     NOTE: `set role` statements below use illustrative placeholder names
-- --     (authenticated_user_a, etc.). In a real Supabase session, the user is
-- --     already authenticated, so auth.uid() resolves automatically — replace
-- --     the placeholders with the actual role/test users and run each block
-- --     from a fresh connection (or use the Supabase UI / client SDK as the
-- --     corresponding user) rather than executing `set role` verbatim.
--
-- -- Teacher A (assigned to Batch B; S1 ∈ B; S2 ∉ B; T_A owns the test):
-- set role authenticated_user_a;  -- auth.uid() resolves to Teacher A's profile
-- select count(*) from public.mock_results mr
-- where exists (
--   select 1 from public.mock_tests mt
--   where mt.test_id = mr.test_id and mt.teacher_id = public.get_my_teacher_id()
-- );
--   -- Expected: only results where student ∈ Teacher A's batches (S1's results
--   -- are visible; S2's results on the same test are hidden).
-- reset role;
--
-- -- Teacher B (different teacher, no shared assignments):
-- set role authenticated_user_b;
-- select count(*) from public.mock_results;
--   -- Expected: zero results referencing Teacher A's students.
-- reset role;
--
-- -- Admin (full access preserved):
-- set role authenticated_admin;
-- select count(*) from public.mock_results;
--   -- Expected: every result in the institute.
-- reset role;
--
-- -- Student (own results only, unchanged):
-- set role authenticated_student_s1;
-- select count(*) from public.mock_results;
--   -- Expected: only S1's own results.
-- reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
--
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 083 must be reverted).
--
-- Restores the exact teacher policy from migration 021 (test-ownership only).
--
--   -- 3a. Drop the combined teacher policy added by this migration
--   drop policy if exists
--     "Teachers can read mock_results for their tests and assigned students"
--     on public.mock_results;
--
--   -- 3b. Restore the original migration-021 teacher policy
--   create policy "Teachers can read mock_results for their tests"
--     on public.mock_results
--     for select
--     to authenticated
--     using (exists (
--       select 1 from public.mock_tests mt
--       where mt.test_id = mock_results.test_id
--       and mt.teacher_id = public.get_my_teacher_id()
--     ));
--
--   -- 3c. Restore the original comment
--   comment on policy "Teachers can read mock_results for their tests"
--     on public.mock_results is
--     'Teachers can read mock_results for tests they own.';
--     -- NOTE: match the exact original comment text from migration 021 if one
--     --       exists; the text above is a safe default if the original is unknown.
