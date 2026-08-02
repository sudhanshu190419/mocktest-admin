-- ============================================================================
-- Migration: 082 — Teacher RLS Fix: Batch & Student Visibility
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Tables: batches, batch_students, student_details, profiles
--
-- Depends on: Migration 021 (base RLS policies + is_teacher(), get_my_teacher_id())
--             Migration 066 (batch_subjects, get_teacher_batch_ids())
--             Migration 067 (batch_subject_teachers — subject-scoped assignments)
--             Migration 029 (admin profiles policy)
--
-- ## Problem
--
-- Teachers are now assigned to subjects WITHIN batches via the
-- `batch_subject_teachers` table (Domain 17, migrations 066–067). The admin
-- UI (batchSubjectTeacherAssignmentService, adminService.allotBatchToTeacher)
-- writes ONLY to `batch_subject_teachers`; the legacy `batch_teachers` table
-- is no longer maintained by any admin service.
--
-- However, the teacher RLS policies on `batches` and `batch_students`
-- (created in migration 021) still resolve teacher access through the legacy
-- `batch_teachers` table:
--
--   "Teachers can read batches they are assigned to"
--     using (exists (select 1 from batch_teachers ...))        -- LEGACY
--
--   "Teachers can read batch_students for their batches"
--     using (exists (select 1 from batch_teachers ...))        -- LEGACY
--
-- Because `batch_teachers` contains no rows for newly-assigned teachers,
-- every teacher query that reads `batches` / `batch_students` is filtered to
-- ZERO rows. The Teacher Dashboard → Students page shows no students.
--
-- Additionally, `student_details` and `profiles` have NO teacher read policy
-- at all (only self-access + admin). Even if the parent `batch_students`
-- rows were readable, the roster query's nested embeds
-- `student_details(*, profiles(*))` would be RLS-filtered to NULL, hiding
-- student names.
--
-- ## Solution
--
-- 1. Recreate the teacher policy on `batches` to resolve through
--    `batch_subject_teachers` (subject-scoped assignments).
-- 2. Recreate the teacher policy on `batch_students` the same way.
-- 3. Add a teacher read policy on `student_details` for students in batches
--    the teacher is assigned to (via batch_subject_teachers).
-- 4. Add a teacher read policy on `profiles` for the profiles of those
--    students — scoped so teachers can ONLY see student profiles in their
--    own assigned batches, never other teachers/admins/students.
--
-- This matches the intent already documented in migrations 066–073 (all
-- Domain 17 teacher policies resolve through batch_subject_teachers).
--
-- ## Order
--
--   1. Drop legacy teacher policies on batches + batch_students
--   2. Recreate them using batch_subject_teachers
--   3. Add teacher policy on student_details
--   4. Add teacher policy on profiles
--   5. Validation queries
--   6. Rollback
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Fix teacher policy on `batches`
-- ════════════════════════════════════════════════════════════════════════════
--
-- Replace the legacy `batch_teachers` lookup with `batch_subject_teachers`
-- (joined through `batch_subjects`). A teacher can read a batch if they are
-- assigned to ANY subject within that batch.
--
-- Drop first (idempotent — safe to re-run).

drop policy if exists "Teachers can read batches they are assigned to"
  on public.batches;

create policy "Teachers can read batches they are assigned to"
  on public.batches
  for select
  to authenticated
  using (exists (
    select 1
    from public.batch_subjects bs
    join public.batch_subject_teachers bst
      on bst.batch_subject_id = bs.batch_subject_id
    where bs.batch_id = batches.batch_id
      and bst.teacher_id = public.get_my_teacher_id()
  ));

comment on policy "Teachers can read batches they are assigned to"
  on public.batches is
  'Teachers can read batches where they are assigned to at least one batch_subject '
  '(via batch_subject_teachers). Replaces the legacy batch_teachers lookup.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Fix teacher policy on `batch_students`
-- ════════════════════════════════════════════════════════════════════════════
--
-- Same replacement: teacher can read batch_students rows for batches where
-- they hold a subject-scoped assignment.

drop policy if exists "Teachers can read batch_students for their batches"
  on public.batch_students;

create policy "Teachers can read batch_students for their batches"
  on public.batch_students
  for select
  to authenticated
  using (exists (
    select 1
    from public.batch_subjects bs
    join public.batch_subject_teachers bst
      on bst.batch_subject_id = bs.batch_subject_id
    where bs.batch_id = batch_students.batch_id
      and bst.teacher_id = public.get_my_teacher_id()
  ));

comment on policy "Teachers can read batch_students for their batches"
  on public.batch_students is
  'Teachers can read batch enrollments for batches where they hold a '
  'subject-scoped assignment (via batch_subject_teachers). Replaces the '
  'legacy batch_teachers lookup.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Teacher read policy on `student_details`
-- ════════════════════════════════════════════════════════════════════════════
--
-- Previously teachers had NO read access to student_details (only self-access
-- for students and full access for admins). This policy lets teachers read
-- the details of students enrolled in batches where they are assigned to a
-- subject. Existing student self-access + admin policies are untouched.

drop policy if exists "Teachers can read student_details for their batches"
  on public.student_details;

create policy "Teachers can read student_details for their batches"
  on public.student_details
  for select
  to authenticated
  using (exists (
    select 1
    from public.batch_students bs
    join public.batch_subjects bsub
      on bsub.batch_id = bs.batch_id
    join public.batch_subject_teachers bst
      on bst.batch_subject_id = bsub.batch_subject_id
    where bs.student_id = student_details.student_id
      and bst.teacher_id = public.get_my_teacher_id()
  ));

comment on policy "Teachers can read student_details for their batches"
  on public.student_details is
  'Teachers can read student_details of students enrolled in batches where '
  'they hold a subject-scoped assignment (via batch_subject_teachers).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Teacher read policy on `profiles` (student profiles only)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `profiles` currently has only self-access (migration 001) + admin full
-- access (migration 029). This policy lets teachers read the PROFILE row of
-- students in their own assigned batches — so the roster's nested
-- `profiles(*)` embed returns real names.
--
-- The subquery is inherently self-scoping: `get_my_teacher_id()` returns NULL
-- for non-teachers, so students/admins can never use this policy to read
-- other users' profiles. Teachers can only match profiles that link (via
-- student_details → batch_students → batch_subjects → batch_subject_teachers)
-- to their own assignments.

drop policy if exists "Teachers can read profiles of students in their batches"
  on public.profiles;

create policy "Teachers can read profiles of students in their batches"
  on public.profiles
  for select
  to authenticated
  using (exists (
    select 1
    from public.student_details sd
    join public.batch_students bs
      on bs.student_id = sd.student_id
    join public.batch_subjects bsub
      on bsub.batch_id = bs.batch_id
    join public.batch_subject_teachers bst
      on bst.batch_subject_id = bsub.batch_subject_id
    where sd.profile_id = profiles.profile_id
      and bst.teacher_id = public.get_my_teacher_id()
  ));

comment on policy "Teachers can read profiles of students in their batches"
  on public.profiles is
  'Teachers can read the profile rows of students enrolled in batches where '
  'they hold a subject-scoped assignment (via batch_subject_teachers). '
  'Self-scoped: get_my_teacher_id() is NULL for non-teachers.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Validation Queries
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run these to confirm the policies are installed correctly.
--
-- -- 5a. All four policies must appear with the expected command/roles:
-- select schemaname, tablename, policyname, cmd, roles
-- from pg_policies
-- where tablename in ('batches', 'batch_students', 'student_details', 'profiles')
--   and policyname like 'Teachers%'
-- order by tablename, policyname;
--
-- -- 5b. The legacy batch_teachers lookups must be GONE from the two
-- --     recreated policies:
-- select tablename, policyname, qual
-- from pg_policies
-- where tablename in ('batches', 'batch_students')
--   and policyname like 'Teachers%';
--   -- Expected: qual contains batch_subject_teachers, NOT batch_teachers
--
-- -- 5c. Functional smoke test (as a teacher with a batch_subject_teachers
-- --     row): the following should return the teacher's batches + students:
-- select count(*) from public.batches
-- where batch_id = any (public.get_teacher_batch_ids());
-- select count(*) from public.batch_students
-- where batch_id = any (public.get_teacher_batch_ids());

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
--
-- ROLLBACK SQL (NOT executed by this migration — copy & run manually only if
-- Migration 082 must be reverted).
--
-- Restores the exact legacy policies from migration 021 and removes the two
-- new policies added by this migration.
--
--   -- 6a. Restore legacy teacher policy on batches (migration 021 original)
--   drop policy if exists "Teachers can read batches they are assigned to"
--     on public.batches;
--
--   create policy "Teachers can read batches they are assigned to"
--     on public.batches
--     for select
--     to authenticated
--     using (exists (
--       select 1 from public.batch_teachers bt
--       where bt.batch_id = batches.batch_id
--       and bt.teacher_id = public.get_my_teacher_id()
--     ));
--
--   -- 6b. Restore legacy teacher policy on batch_students (migration 021 original)
--   drop policy if exists "Teachers can read batch_students for their batches"
--     on public.batch_students;
--
--   create policy "Teachers can read batch_students for their batches"
--     on public.batch_students
--     for select
--     to authenticated
--     using (exists (
--       select 1 from public.batch_teachers bt
--       where bt.batch_id = batch_students.batch_id
--       and bt.teacher_id = public.get_my_teacher_id()
--     ));
--
--   -- 6c. Drop the two new teacher policies
--   drop policy if exists "Teachers can read student_details for their batches"
--     on public.student_details;
--
--   drop policy if exists "Teachers can read profiles of students in their batches"
--     on public.profiles;
