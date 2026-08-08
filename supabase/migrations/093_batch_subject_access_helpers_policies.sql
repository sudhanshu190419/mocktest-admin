-- ============================================================================
-- Migration: 093 — Batch-Subject Access Helpers + Student Policy Unification
--             (Phase 11I.5B)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXT
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 091 introduced course-level entitlement helpers:
--
--     is_student_assigned_to_course_batch(course_id)
--     can_student_access_live_course(course_id)    (active/grace live tier)
--     can_student_access_content(course_id)        (content-window tier)
--
-- Migration 092 rewired the student SELECT policy on course_batches onto
-- can_student_access_live_course(). However, the batch-subject delivery
-- layer (batch_subjects + the four batch_subject_* junction tables, created
-- in 066-073) still uses batch-membership-ONLY policies:
--
--     institute_id = get_my_institute_id()
--     and is_student()
--     and <batch_subject's batch ∈ student's batches>
--
-- Those policies never consult student_subscriptions, so after a student's
-- subscription expires they could keep reading junction rows (content, mock
-- tests, recordings, live classes) — contradicting the course-scoped
-- subscription model (Phase 11G/11H) where the subscription IS the
-- entitlement and batch assignment alone is insufficient.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ARCHITECTURE DECISION (per the 11I.5 analysis)
-- ════════════════════════════════════════════════════════════════════════════
-- Wrapper helpers at batch_subject_id granularity (Option A), composed over
-- the 091 course helpers:
--
--     batch_subject_id
--         ↓ batch_subjects
--         ↓ course_batches
--         ↓ course_id(s)     (ANY-course semantics: EXISTS)
--         ↓ can_student_access_live_course() | can_student_access_content()
--
-- Why wrappers instead of inlining the JOIN into every policy:
--   * single source of truth for entitlement rules (091) AND for the
--     batch_subject → course resolution (this file)
--   * policy bodies become one-line helper calls — no duplicated logic
--   * a future rule change touches one function, not five policies
--
-- Semantics:
--   * ANY-course: a batch_subject is visible when the student may access ANY
--     course linked to its batch. A batch can link to several courses via
--     course_batches (pk_course_batches (course_id, batch_id)), and junction
--     content carries no course_id, so requiring ALL courses would wrongly
--     block shared batch-subjects.
--   * Batch membership is preserved: bs.batch_id ∈ get_student_batch_ids()
--     (the same guard the legacy 066-073 policies used), so a student only
--     sees batch-subjects of batches they are actively assigned to.
--   * is_active = true: deactivated batch-subjects are invisible to students
--     (matches the admin deactivation workflow and the app-side filter in
--     getCourseBatches()).
--   * Fail closed: unknown or NULL batch_subject_id → no rows → FALSE; the
--     course helpers fail closed for non-students (get_my_student_id() NULL).
--
-- Axis mapping per table:
--   * batch_subjects             → CONTENT helper (the hub is inner-joined by
--     content-tier tables and must stay resolvable through the content
--     window; live tier ⊂ content tier, so live-tier students pass too)
--   * batch_subject_contents     → CONTENT helper (notes/PDFs/study material)
--   * batch_subject_mock_tests   → CONTENT helper
--   * batch_subject_recordings   → CONTENT helper
--   * batch_subject_live_classes → LIVE helper (live classes only in live tier)
--   * batch_subject_teachers     → LIVE helper (teacher names render on the
--     course-detail flow, which is already live-gated by 092 on course_batches)
--
-- ⚠️ KNOWN CONSIDERATION (out of scope here): course_batches (092) is gated
--    by the LIVE helper, so a content-only student cannot currently reach the
--    content window through the app's My Courses navigation. This migration
--    makes the content tables themselves content-window-safe; whether the
--    navigation hub should open to content-only students is a separate
--    product decision for a future phase (11J).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — batch_subject_id entitlement wrappers
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. Live tier: active/grace subscription for ANY course linked to the
--     batch-subject's batch, with active batch assignment.
create or replace function public.can_student_access_live_batch_subject(
    p_batch_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.batch_subjects bs
    join public.course_batches cb
      on cb.batch_id = bs.batch_id
    where bs.batch_subject_id = p_batch_subject_id
      and bs.is_active = true
      and bs.batch_id = any (public.get_student_batch_ids())
      and public.can_student_access_live_course(cb.course_id)
  );
$$;

comment on function public.can_student_access_live_batch_subject(uuid) is
  'True when the current authenticated student (via get_my_student_id()) is '
  'actively assigned to a batch containing the given batch_subject and holds '
  'an ACTIVE or GRACE subscription for ANY course linked to that batch via '
  'course_batches (ANY-course semantics). Delegates live-tier evaluation to '
  'public.can_student_access_live_course(). SECURITY DEFINER; fail-closed '
  'for unknown/NULL batch_subject_id and for non-students.';

-- 1b. Content tier: active/grace/content-window access for ANY course linked
--     to the batch-subject's batch, with active batch assignment.
create or replace function public.can_student_access_content_batch_subject(
    p_batch_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.batch_subjects bs
    join public.course_batches cb
      on cb.batch_id = bs.batch_id
    where bs.batch_subject_id = p_batch_subject_id
      and bs.is_active = true
      and bs.batch_id = any (public.get_student_batch_ids())
      and public.can_student_access_content(cb.course_id)
  );
$$;

comment on function public.can_student_access_content_batch_subject(uuid) is
  'True when the current authenticated student is actively assigned to a batch '
  'containing the given batch_subject and still holds content-window access '
  '(active, grace, or content_only) for ANY course linked to that batch via '
  'course_batches (ANY-course semantics). Delegates content-tier evaluation to '
  'public.can_student_access_content(). SECURITY DEFINER; fail-closed for '
  'unknown/NULL batch_subject_id and for non-students.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Rewrite student SELECT policies onto the wrapper helpers
-- ════════════════════════════════════════════════════════════════════════════
-- PostgreSQL's ALTER POLICY can only change the role list or RENAME; it cannot
-- change a USING expression. Each rewrite is therefore DROP + CREATE with the
-- original policy name preserved (canonical pattern, same as 092).

-- 2a. batch_subjects — the delivery hub (CONTENT tier).
drop policy if exists "Students can read batch_subjects for their batches"
  on public.batch_subjects;

create policy "Students can read batch_subjects for their batches"
  on public.batch_subjects
  for select
  to authenticated
  using (
    public.can_student_access_content_batch_subject(batch_subjects.batch_subject_id)
  );

-- 2b. batch_subject_contents (CONTENT tier).
drop policy if exists "Students can read batch_subject_contents for their batches"
  on public.batch_subject_contents;

create policy "Students can read batch_subject_contents for their batches"
  on public.batch_subject_contents
  for select
  to authenticated
  using (
    public.can_student_access_content_batch_subject(batch_subject_contents.batch_subject_id)
  );

-- 2c. batch_subject_mock_tests (CONTENT tier).
drop policy if exists "Students can read batch_subject_mock_tests for their batches"
  on public.batch_subject_mock_tests;

create policy "Students can read batch_subject_mock_tests for their batches"
  on public.batch_subject_mock_tests
  for select
  to authenticated
  using (
    public.can_student_access_content_batch_subject(batch_subject_mock_tests.batch_subject_id)
  );

-- 2d. batch_subject_recordings (CONTENT tier).
drop policy if exists "Students can read batch_subject_recordings for their batches"
  on public.batch_subject_recordings;

create policy "Students can read batch_subject_recordings for their batches"
  on public.batch_subject_recordings
  for select
  to authenticated
  using (
    public.can_student_access_content_batch_subject(batch_subject_recordings.batch_subject_id)
  );

-- 2e. batch_subject_live_classes (LIVE tier).
drop policy if exists "Students can read batch_subject_live_classes for their batches"
  on public.batch_subject_live_classes;

create policy "Students can read batch_subject_live_classes for their batches"
  on public.batch_subject_live_classes
  for select
  to authenticated
  using (
    public.can_student_access_live_batch_subject(batch_subject_live_classes.batch_subject_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — batch_subject_teachers: add the missing student SELECT policy
-- ════════════════════════════════════════════════════════════════════════════
-- Audit finding: the mobile app (studentDashboardService.getCourseBatches,
-- step 5) queries batch_subject_teachers directly with the student token, but
-- migration 067 defined only admin and teacher-own policies — so teacher
-- names silently returned NULL. Gate on the LIVE helper to match the
-- course-detail flow entry gate (092 on course_batches). This is a NEW
-- policy (no prior student policy exists to replace).
create policy "Students can read batch_subject_teachers for accessible batch subjects"
  on public.batch_subject_teachers
  for select
  to authenticated
  using (
    public.can_student_access_live_batch_subject(batch_subject_teachers.batch_subject_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Validation queries (run manually against the database)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Both wrapper functions exist (expect 2 rows):
--    select proname
--    from pg_proc
--    where proname in (
--      'can_student_access_live_batch_subject',
--      'can_student_access_content_batch_subject'
--    );

-- 2. Wrappers are SECURITY DEFINER with empty search_path and delegate to the
--    091 course helpers (expect the resolution JOIN + helper call in each body):
--    select proname, pg_get_functiondef(oid)
--    from pg_proc
--    where proname in (
--      'can_student_access_live_batch_subject',
--      'can_student_access_content_batch_subject'
--    );

-- 3. Exactly one student SELECT policy per table, all six referencing the
--    wrappers (expect 6 rows):
--    select tablename, policyname
--    from pg_policies
--    where cmd = 'SELECT'
--      and tablename in (
--        'batch_subjects',
--        'batch_subject_contents',
--        'batch_subject_mock_tests',
--        'batch_subject_recordings',
--        'batch_subject_live_classes',
--        'batch_subject_teachers'
--      )
--    order by tablename;

-- 4. Policy qualifiers are pure helper calls — no inlined EXISTS/JOIN logic:
--    select p.polname,
--           pg_get_expr(p.polqual, p.polrelid) as using_expression
--    from pg_policy p
--    where p.polname like 'Students can read batch_subject%'
--       or p.polname like 'Students can read batch_subjects%';

-- 5. Fail-closed smoke test (expect false / false):
--    select public.can_student_access_live_batch_subject(null) as null_input,
--           public.can_student_access_content_batch_subject(
--             '00000000-0000-0000-0000-000000000000'
--           ) as unknown_id;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Order matters: drop the helper-based policies first (they reference the
-- wrapper functions), restore the original batch-membership policies from
-- 066-073 verbatim, then drop the wrappers.

-- 5a. Drop the new teacher policy and the five rewritten student policies.
--     drop policy if exists "Students can read batch_subject_teachers for accessible batch subjects"
--       on public.batch_subject_teachers;
--     drop policy if exists "Students can read batch_subjects for their batches"
--       on public.batch_subjects;
--     drop policy if exists "Students can read batch_subject_contents for their batches"
--       on public.batch_subject_contents;
--     drop policy if exists "Students can read batch_subject_mock_tests for their batches"
--       on public.batch_subject_mock_tests;
--     drop policy if exists "Students can read batch_subject_recordings for their batches"
--       on public.batch_subject_recordings;
--     drop policy if exists "Students can read batch_subject_live_classes for their batches"
--       on public.batch_subject_live_classes;

-- 5b. Restore the original batch-membership student policies (from 066-073).
--     create policy "Students can read batch_subjects for their batches"
--       on public.batch_subjects
--       for select
--       to authenticated
--       using (
--         institute_id = public.get_my_institute_id()
--         and public.is_student()
--         and batch_id = any (public.get_student_batch_ids())
--       );
--     create policy "Students can read batch_subject_contents for their batches"
--       on public.batch_subject_contents
--       for select
--       to authenticated
--       using (
--         institute_id = public.get_my_institute_id()
--         and public.is_student()
--         and exists (
--           select 1 from public.batch_subjects bs
--           where bs.batch_subject_id = batch_subject_contents.batch_subject_id
--           and bs.batch_id = any (public.get_student_batch_ids())
--         )
--       );
--     create policy "Students can read batch_subject_mock_tests for their batches"
--       on public.batch_subject_mock_tests
--       for select
--       to authenticated
--       using (
--         institute_id = public.get_my_institute_id()
--         and public.is_student()
--         and exists (
--           select 1 from public.batch_subjects bs
--           where bs.batch_subject_id = batch_subject_mock_tests.batch_subject_id
--           and bs.batch_id = any (public.get_student_batch_ids())
--         )
--       );
--     create policy "Students can read batch_subject_recordings for their batches"
--       on public.batch_subject_recordings
--       for select
--       to authenticated
--       using (
--         institute_id = public.get_my_institute_id()
--         and public.is_student()
--         and exists (
--           select 1 from public.batch_subjects bs
--           where bs.batch_subject_id = batch_subject_recordings.batch_subject_id
--           and bs.batch_id = any (public.get_student_batch_ids())
--         )
--       );
--     create policy "Students can read batch_subject_live_classes for their batches"
--       on public.batch_subject_live_classes
--       for select
--       to authenticated
--       using (
--         institute_id = public.get_my_institute_id()
--         and public.is_student()
--         and exists (
--           select 1 from public.batch_subjects bs
--           where bs.batch_subject_id = batch_subject_live_classes.batch_subject_id
--           and bs.batch_id = any (public.get_student_batch_ids())
--         )
--       );

-- 5c. Drop the wrapper helpers (after all dependent policies are gone).
--     drop function if exists public.can_student_access_live_batch_subject(uuid);
--     drop function if exists public.can_student_access_content_batch_subject(uuid);

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 093
-- ════════════════════════════════════════════════════════════════════════════
