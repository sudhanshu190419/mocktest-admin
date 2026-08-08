-- ============================================================================
-- Migration: 094 — Remove Legacy Course Content RLS (Phase 11J.4)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- Phases 11G–11J introduced the unified course-scoped entitlement model:
--
--   • course-scoped subscriptions           (089 / 090)
--   • entitlement helpers                   (091):
--       is_student_assigned_to_course_batch()
--       can_student_access_live_course()    — live tier (active/grace)
--       can_student_access_content()        — content tier (active/grace/
--                                              content_only)
--   • batch-subject wrapper helpers         (093):
--       can_student_access_live_batch_subject()
--       can_student_access_content_batch_subject()
--   • server-derived authorization          (Edge Functions: livekit-token,
--                                            recording-playback-url)
--
-- Several LEGACY student policies still grant access through the OLD
-- course_enrollments / live_class_batch model. Those policies are
-- enrollment-based loopholes: they ignore batch-subject assignments AND
-- subscription expiry. This migration removes them and replaces them with
-- policies that are entirely driven by the entitlement helpers.
--
-- Required outcome (after this migration):
--   ✅ ONE consistent authorization model exists.
--   ✅ No legacy enrollment-based loopholes remain.
--   ✅ All Phase 11G–11J authorization paths remain functional.
--   ✅ Admin and teacher permissions remain unchanged.
--   ✅ Student permissions are entirely driven by the new entitlement model.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POLICY-BY-POLICY AUDIT (the five audited tables)
-- ════════════════════════════════════════════════════════════════════════════
-- ----------------------------------------------------------------------------
-- 1) public.course_content
-- ----------------------------------------------------------------------------
--   "Admins have full access to course_content"            (033) → KEEP (admin)
--   "Teachers can read course_content for their courses"   (033) → KEEP (teacher)
--   "Students can read course_content for enrolled courses"(034) → REPLACE
--        Legacy: EXISTS course_enrollments by student_id. Grants access with
--        NO subscription check and NO batch-subject awareness — a purchased
--        course unlocks it forever, and it ignores expiry entirely.
--        Replaced by: can_student_access_content(course_content.course_id).
-- ----------------------------------------------------------------------------
-- 2) public.course_batches
-- ----------------------------------------------------------------------------
--   "Admins have full access to course_batches"            (033) → KEEP (admin)
--   "Teachers can read course_batches for their courses"   (033) → KEEP (teacher)
--   "Students can read course_batches for enrolled courses"(034) → ALREADY REMOVED
--        Migration 092 dropped this legacy policy and created:
--   "Students can read course_batches for batch-assigned
--    subscribed courses"                                   (092) → KEEP (unified)
--        using (public.can_student_access_live_course(course_id)).
--        ⇒ course_batches is ALREADY unified. Intentionally unchanged here.
-- ----------------------------------------------------------------------------
-- 3) public.live_classes
-- ----------------------------------------------------------------------------
--   "Teachers have full access to their own live_classes"  (021) → KEEP (teacher)
--   "Admins have full access to live_classes"              (021) → KEEP (admin)
--   "Students can read live_classes for their batches"     (021→051) → REPLACE
--        Current (051) uses is_student_in_live_class_batches(class_id) which
--        walks the LEGACY live_class_batch junction. It is batch-only and has
--        NO subscription check, NO course scoping, and ignores the active
--        batch_subject_live_classes flow.--   Replaced by: EXISTS batch_subject_live_classes →
--        can_student_access_live_batch_subject(batch_subject_id) (093 helper).
--   ⚠️ BEHAVIOR CHANGE (intended): the legacy policy granted visibility with
--   NO subscription requirement; the replacement requires BOTH a
--   batch_subject_live_classes link AND a live-tier subscription for the
--   linked course. Any class assigned only through the legacy live_class_batch
--   junction (pre-Domain-17 data) will now be invisible to students — this
--   is the same tightening 093 applied to the junction table itself, and it
--   is required so subscription expiry revokes live-class visibility.
-- ----------------------------------------------------------------------------
-- 4) public.recordings
-- ----------------------------------------------------------------------------
--   "Teachers can read recordings for their classes"       (021) → KEEP (teacher)
--   "Teachers manage their recordings"                     (065) → KEEP (teacher)
--   "Admins have full access to recordings"                (021/065) → KEEP (admin)
--   "Students can read recordings for their batch classes" (021) → REPLACE
--        Legacy: EXISTS live_class_batch (LEGACY junction) + batch_students.
--        No subscription, no course scoping, no batch_subject awareness.
--   "Students view batch recordings"                       (065) → REPLACE
--        Legacy: recordings.batch_id denormalized column + batch_students.
--        NOTE: migration 080 documents that 065's CREATE TABLE IF NOT EXISTS
--        no-op'd against the 005 recordings table, so the live table may NOT
--        have batch_id/is_deleted. Dropping by name is idempotent either way;
--        the replacement below references ONLY columns guaranteed on both
--        shapes (recording_id) plus the 073 junction.
--   Replaced by ONE schema-agnostic policy: EXISTS batch_subject_recordings →
--   can_student_access_content_batch_subject(batch_subject_id) (093 helper).
--   (The completed/is_deleted filters remain app/edge-enforced: the mobile
--   service filters status='completed' client-side and recording-playback-url
--   enforces status + soft-delete server-side.)
-- ----------------------------------------------------------------------------
-- 5) public.course_mock_tests
-- ----------------------------------------------------------------------------
--   "Admins have full access to course_mock_tests"         (039) → KEEP (admin)
--   "Teachers can read course_mock_tests for their courses"(039) → KEEP (teacher)
--   NO student policy exists (039 explicitly leaves students to the
--   service/RPC layer; the active student path is batch_subject_mock_tests,
--   already unified in 093). ⇒ Intentionally unchanged. Documented only.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEPENDENCIES (must be applied in order)
-- ════════════════════════════════════════════════════════════════════════════
--   091 — unified course entitlement helpers
--   092 — course_batches student policy (unified; NOT touched here)
--   093 — batch-subject wrapper helpers + junction policies
--   073 — batch_subject_recordings junction table
--   Must run AFTER 093 (numerical order enforces this).
--
-- ════════════════════════════════════════════════════════════════════════════
-- IDEMPOTENCY / RECURSION / SECURITY NOTES
-- ════════════════════════════════════════════════════════════════════════════
-- • Every change is drop-if-exists → create (the project's established
--   idempotent policy pattern, same as 092/093).
-- • The helpers called inside policies are SECURITY DEFINER (091/093) and
--   never SELECT from the policy's own table, so there is NO RLS recursion.
-- • The new policies rely on get_my_student_id() inside the helpers, which
--   resolves the caller's OWN student_id — no cross-user access.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — course_content: replace the enrollment-based student policy
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "Students can read course_content for enrolled courses"
  on public.course_content;

create policy "Students can read course_content for accessible courses"
  on public.course_content
  for select
  to authenticated
  using (
    public.can_student_access_content(course_content.course_id)
  );

comment on policy "Students can read course_content for accessible courses"
  on public.course_content is
  'Phase 11J.4: replaces the legacy enrollment-based student policy (034). '
  'A student may read course_content only when public.can_student_access_'
  'content(course_id) returns TRUE — active batch assignment linked to the '
  'course AND a subscription inside the content window (active/grace/'
  'content_only per the 091 helper). No course_enrollments dependence.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — course_batches: INTENTIONALLY UNCHANGED
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 092 already dropped "Students can read course_batches for
-- enrolled courses" and created the unified helper-based policy
-- "Students can read course_batches for batch-assigned subscribed courses"
-- (using can_student_access_live_course). Nothing to do here.
-- Kept as a no-op safety net ONLY for databases where 092's legacy drop may
-- not have run (idempotent):
drop policy if exists "Students can read course_batches for enrolled courses"
  on public.course_batches;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — live_classes: replace the legacy live_class_batch student policy
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "Students can read live_classes for their batches"
  on public.live_classes;

create policy "Students can read live_classes for accessible batch subjects"
  on public.live_classes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.batch_subject_live_classes bslc
      where bslc.class_id = live_classes.class_id
        and public.can_student_access_live_batch_subject(bslc.batch_subject_id)
    )
  );

comment on policy "Students can read live_classes for accessible batch subjects"
  on public.live_classes is
  'Phase 11J.4: replaces the legacy live_class_batch-based student policy '
  '(021/051). A student may read a live class only when the class is linked '
  'through batch_subject_live_classes to a batch subject that '
  'can_student_access_live_batch_subject() authorizes (active batch_students '
  'assignment AND live-tier subscription for the linked course, per the 093 '
  'helper). Live classes are LIVE-tier gated (never content-only).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — recordings: replace BOTH legacy student policies with ONE
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "Students can read recordings for their batch classes"
  on public.recordings;

drop policy if exists "Students view batch recordings"
  on public.recordings;

create policy "Students can read recordings for accessible batch subjects"
  on public.recordings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.batch_subject_recordings bsr
      where bsr.recording_id = recordings.recording_id
        and public.can_student_access_content_batch_subject(bsr.batch_subject_id)
    )
  );

comment on policy "Students can read recordings for accessible batch subjects"
  on public.recordings is
  'Phase 11J.4: replaces the legacy student policies (021 live_class_batch-'
  'based and 065 recordings.batch_id-based). Schema-agnostic: references '
  'only recordings.recording_id + the batch_subject_recordings junction '
  '(073) — never recordings.batch_id/is_deleted (which may not exist on the '
  'live table; see migration 080). Authorizes via '
  'can_student_access_content_batch_subject() — active batch assignment AND '
  'content-window subscription for the linked course. Recordings are '
  'CONTENT-tier gated (available through the content window).';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — course_mock_tests: INTENTIONALLY UNCHANGED
-- ════════════════════════════════════════════════════════════════════════════
-- No student policy exists on this table (039 deliberately leaves students to
-- the service/RPC layer). The active student path is batch_subject_mock_tests,
-- already unified in 093. Admin + teacher policies remain untouched.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Validation Queries
-- ════════════════════════════════════════════════════════════════════════════

-- V1. Every legacy enrollment-based student policy must be GONE
--     (expected: 0 rows):
-- select tablename, policyname
-- from pg_policies
-- where schemaname = 'public'
--   and (
--     policyname = 'Students can read course_content for enrolled courses'
--     or policyname = 'Students can read course_batches for enrolled courses'
--     or policyname = 'Students can read live_classes for their batches'
--     or policyname = 'Students can read recordings for their batch classes'
--     or policyname = 'Students view batch recordings'
--   );

-- V2. The new unified student policies must exist (expected: 3 rows):
-- select tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and policyname in (
--     'Students can read course_content for accessible courses',
--     'Students can read live_classes for accessible batch subjects',
--     'Students can read recordings for accessible batch subjects'
--   )
-- order by tablename;

-- V3. NO policy on the five audited tables may reference course_enrollments
--     (expected: 0 rows — closes the enrollment loophole):
-- select tablename, policyname, qual
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'course_content', 'course_batches', 'live_classes',
--     'recordings', 'course_mock_tests'
--   )
--   and (qual::text ilike '%course_enrollments%'
--        or with_check::text ilike '%course_enrollments%');

-- V4. Admin + teacher policies must be intact (expected: same counts as
--     before — course_content 2, course_batches 2, live_classes 2,
--     recordings 2 or 3, course_mock_tests 2, excluding student policies):
-- select tablename, count(*) as policy_count
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'course_content', 'course_batches', 'live_classes',
--     'recordings', 'course_mock_tests'
--   )
-- group by tablename
-- order by tablename;
--     Expected after 094:
--       course_content      → 3 (admin + teacher + student)
--       course_batches      → 3 (admin + teacher + student[092])
--       live_classes        → 3 (admin + teacher + student)
--       recordings          → 3 or 4 — depends on which recordings table
--                              shape is live:
--                              • 005-shape (065's CREATE no-op'd per 080):
--                                teacher[021] + admin[021] + student[094] = 3
--                              • 065-shape (065 applied cleanly):
--                                teacher[021] + admin[021] + teacher[065]
--                                + student[094] = 4
--                              (021 and 065 both name their admin policy
--                              "Admins have full access to recordings" —
--                              policy names are unique per table, so only
--                              ONE admin policy can ever exist.)
--       course_mock_tests   → 2 (admin + teacher)

-- V5. Smoke test — the entitlement helpers are reachable from a policy
--     context (each returns boolean, no recursion/exception):
-- select public.can_student_access_content('00000000-0000-0000-0000-000000000000');
-- select public.can_student_access_live_course('00000000-0000-0000-0000-000000000000');

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- To revert to the legacy enrollment-based model, run the following in order.
-- (NOT recommended — it re-introduces the Phase 11I.3/11J.4 defects:
-- purchased courses unlock forever, expired subscriptions keep access, and
-- batch-subject assignments are ignored.)
--
-- -- 7a. Drop the unified student policies:
-- drop policy if exists "Students can read course_content for accessible courses"
--   on public.course_content;
-- drop policy if exists "Students can read live_classes for accessible batch subjects"
--   on public.live_classes;
-- drop policy if exists "Students can read recordings for accessible batch subjects"
--   on public.recordings;
--
-- -- 7b. Restore the legacy course_content student policy (migration 034):
-- create policy "Students can read course_content for enrolled courses"
--   on public.course_content
--   for select
--   to authenticated
--   using (exists (
--     select 1 from public.course_enrollments ce
--     where ce.course_id = course_content.course_id
--       and ce.student_id = public.get_my_student_id()
--   ));
--
-- -- 7c. Restore the legacy live_classes student policy (migration 051):
-- create policy "Students can read live_classes for their batches"
--   on public.live_classes
--   for select
--   to authenticated
--   using (
--     public.is_student_in_live_class_batches(live_classes.class_id)
--   );
--
-- -- 7d. Restore the legacy recordings student policy (migration 021).
-- --     NOTE: 065's "Students view batch recordings" referenced
-- --     recordings.batch_id/is_deleted which may not exist on the live
-- --     table (see 080) — restoring it would fail on such databases. Only
-- --     the 021 policy is restored here (it uses recordings.class_id, which
-- --     exists on both shapes):
-- create policy "Students can read recordings for their batch classes"
--   on public.recordings
--   for select
--   to authenticated
--   using (exists (
--     select 1 from public.live_class_batch lcb
--     join public.batch_students bs on bs.batch_id = lcb.batch_id
--     where lcb.class_id = recordings.class_id
--       and bs.student_id = public.get_my_student_id()
--   ));
--
-- ============================================================================
-- END OF MIGRATION 094
-- ============================================================================
