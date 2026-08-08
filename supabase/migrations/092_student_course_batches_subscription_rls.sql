-- ============================================================================
-- Migration: 092 — Student course_batches RLS: consume unified entitlement
--             helper (Phase 11I.4C)
--
-- ⚠️ HISTORY: this file was originally the Phase 11I.4 policy change (created
--    as 091, renumbered 092 in Phase 11I.4B when the helpers moved into 091).
--    It is being rewritten by Phase 11I.4C as a PURE RLS REFACTOR.
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEM (Phase 11I.3 root cause)
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 034 created the policy
--
--     "Students can read course_batches for enrolled courses"
--
-- which lets a student see a `course_batches` row ONLY when a
-- `course_enrollments` row exists for that course + student. Batch-assigned
-- courses (batch_students → course_batches → courses) that were never
-- enrolled were therefore silently hidden by RLS — the observed
-- "5 batch-assigned courses → only 1 reaches Home" defect.
--
-- A naive fix — granting SELECT purely on `batch_students` membership — is
-- ALSO WRONG: batch assignments are long-lived, while subscriptions expire.
-- A student whose subscription lapsed but who remains batch-assigned would
-- keep access indefinitely, contradicting the finalized Phase 11G/11H
-- course-scoped subscription workflow where the subscription IS the
-- entitlement for course content.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SOLUTION (Phase 11I.4)
-- ════════════════════════════════════════════════════════════════════════════
-- Replace the enrollment-based policy with a subscription-aware policy that
-- grants SELECT on `course_batches` ONLY when BOTH conditions are true:
--
--   1. The student is ACTIVELY assigned to the batch linked to the course
--      (batch_students.status = 'active'), AND
--   2. The student holds an ACTIVE or GRACE subscription for that exact
--      course (student_subscriptions.course_id matched, live tier).
--
-- Consequences (verified by design):
--   • When the lifecycle job flips a subscription to 'expired' (or it is
--     cancelled/refunded), the policy evaluates FALSE and the student
--     AUTOMATICALLY loses `course_batches` visibility — no admin batch
--     removal required, no extra job needed.
--   • Renewal (status → 'active') restores visibility instantly.
--   • Batch assignment alone, or subscription alone, is insufficient.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT PHASE 11I.4C CHANGES (and what it does NOT)
-- ════════════════════════════════════════════════════════════════════════════
-- The Phase 11I.4 version of this migration inlined the entitlement EXISTS
-- logic directly in the policy qual. That duplicated the logic now owned by
-- Migration 091's helper `public.can_student_access_live_course(uuid)` — a
-- single source of truth that mirrors evaluateTier()/canJoinLiveClass() in
-- the subscription-access Edge Function (UTC date semantics, lifecycle-lag
-- grace tolerance).
--
-- Phase 11I.4C rewrites ONLY the student SELECT policy on course_batches to
-- delegate to that helper:
--
--     using (public.can_student_access_live_course(course_batches.course_id))
--
--    ✅ Business rules UNCHANGED — the helper encodes exactly the same
--       batch-assignment + live-tier entitlement the inline EXISTS expressed.
--    ✅ Policy NAME preserved: "Students can read course_batches for
--       batch-assigned subscribed courses".
--    ✅ No other table or policy is touched.
--    ✅ No grants, no permission changes, no application code.
--
-- The helper is SECURITY DEFINER + STABLE + SET search_path = '' (Migration
-- 091), so the policy call is safe: it resolves the caller's student_id via
-- public.get_my_student_id() and cannot be hijacked via search_path.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY DROP + CREATE INSTEAD OF ALTER POLICY (intentional, verified)
-- ════════════════════════════════════════════════════════════════════════════
-- PostgreSQL's ALTER POLICY can only change the role list
--
--     ALTER POLICY name ON table_name TO role [, ...]
--
-- or RENAME the policy; it CANNOT change the USING or WITH CHECK
-- expressions of an existing policy — in any released version, including
-- PostgreSQL 16 (this project) and PostgreSQL 17/18. Changing a policy's
-- qualifier therefore REQUIRES dropping the policy and recreating it with
-- the new USING expression. The DROP + CREATE pair below is the canonical,
-- documented pattern and is kept deliberately. No ALTER POLICY form exists
-- that would avoid it.
--
-- ⚠️ NOTE ON LEGACY POLICY: this migration also drops the legacy
--    enrollment-based policy "Students can read course_batches for enrolled
--    courses" (migration 034). Phase 11I.4 already did this; the DROP is
--    repeated here so the migration is correct when applied to a database
--    that has NOT yet run Phase 11I.4 (this 092 was never deployed). Without
--    it, PostgreSQL would OR the legacy policy with the new one and
--    enrolled-but-unsubscribed students would keep course_batches visibility.
--
-- ⚠️ RELATED POLICY INTENTIONALLY NOT CHANGED: "Students can read
--    course_content for enrolled courses" (034) still gates course_content on
--    course_enrollments. That is out of scope for 11I.4C (course_batches only).
--
-- ROLLBACK: drop the helper-based policy and restore the previous inline
--           policy (see ROLLBACK section at the bottom).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Drop the previous policy (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- 1a. Drop the LEGACY enrollment-based policy (migration 034). Idempotent:
--     a no-op when Phase 11I.4 already removed it, and essential on databases
--     where it is still present.
drop policy if exists "Students can read course_batches for enrolled courses"
  on public.course_batches;

-- 1b. Drop the previous subscription-aware policy (by the SAME name SECTION 2
--     re-creates), so the pair is idempotent for fresh applies AND re-runs.
--     ALTER POLICY cannot change the USING expression, so the qualifier swap
--     must be expressed as DROP + CREATE (see header note).
drop policy if exists "Students can read course_batches for batch-assigned subscribed courses"
  on public.course_batches;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Create the helper-based student policy (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- Grants SELECT to authenticated students only when
-- public.can_student_access_live_course(course_id) returns TRUE, i.e. when
-- BOTH (a) an ACTIVE batch_students assignment exists for the student on a
-- batch linked to this course, AND (b) the student holds an ACTIVE or GRACE
-- subscription for that exact course (with the same lifecycle-lag tolerance
-- and UTC date semantics as the subscription-access Edge Function).
--
-- PostgreSQL has no CREATE POLICY IF NOT EXISTS and ALTER POLICY cannot
-- alter the USING expression (see header note); the DROP above makes the
-- DROP + CREATE pair idempotent.
create policy "Students can read course_batches for batch-assigned subscribed courses"
  on public.course_batches
  for select
  to authenticated
  using (
    public.can_student_access_live_course(course_batches.course_id)
  );

comment on policy "Students can read course_batches for batch-assigned subscribed courses"
  on public.course_batches is
  'Phase 11I.4C: a student may read a course_batches row only when '
  'public.can_student_access_live_course(course_id) returns TRUE — i.e. an '
  'active batch_students assignment (batch_students.status = ''active'') AND a '
  'live-tier subscription for that exact course (active/grace per the 091 '
  'helper, matching Edge-Function UTC semantics). Access is revoked '
  'automatically the moment the subscription leaves the live tier — no manual '
  'batch removal required. Pure RLS refactor; business rules unchanged from '
  'Phase 11I.4.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Validation queries
-- ════════════════════════════════════════════════════════════════════════════
-- Run in the Supabase SQL editor to confirm the migration applied correctly.
--
-- 1. The legacy enrollment-based policy is gone (expect 0 rows):
--    select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename  = 'course_batches'
--      and policyname = 'Students can read course_batches for enrolled courses';
--
-- 2. Exactly one SELECT policy remains on course_batches — the helper-based
--    one (expect 1 row):
--    select policyname, cmd, qual
--    from pg_policies
--    where schemaname = 'public'
--      and tablename  = 'course_batches';
--
-- 3. The policy delegates to the 091 helper (expect a qual containing
--    can_student_access_live_course and NO inlined batch_students or
--    student_subscriptions EXISTS):
--    select pg_get_expr(p.qual, p.polrelid) as policy_qual
--    from pg_policies p
--    where p.schemaname = 'public'
--      and p.tablename  = 'course_batches'
--      and p.policyname = 'Students can read course_batches for batch-assigned subscribed courses';
--
-- 4. The required 091 helper exists (expect 1 row):
--    select p.proname, p.prosecdef as security_definer, p.provolatile as volatility
--    from pg_proc p
--    where p.proname = 'can_student_access_live_course';
--
-- 5. Dry-run the policy logic as the service role (should return courses the
--    test student is both batch-assigned to AND subscribed to):
--    select distinct cb.course_id
--    from public.course_batches cb
--    where public.can_student_access_live_course(cb.course_id);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- To revert to the previous Phase 11I.4 inline policy, run:
--
--     drop policy if exists
--       "Students can read course_batches for batch-assigned subscribed courses"
--       on public.course_batches;
--
--     create policy "Students can read course_batches for batch-assigned subscribed courses"
--       on public.course_batches
--       for select
--       to authenticated
--       using (
--         exists (
--           select 1
--           from public.batch_students bs
--           where bs.batch_id = course_batches.batch_id
--             and bs.student_id = public.get_my_student_id()
--             and bs.status = 'active'
--         )
--         and exists (
--           select 1
--           from public.student_subscriptions ss
--           where ss.course_id = course_batches.course_id
--             and ss.student_id = public.get_my_student_id()
--             and ss.status in ('active', 'grace')
--         )
--       );
--
-- Note 1: reverting re-introduces the duplicated entitlement logic that
-- Phase 11I.4C exists to eliminate (two copies of the same rule can drift
-- from the Edge Function semantics in 091). Revert only as a temporary
-- measure during troubleshooting.
--
-- Note 2: if a full revert to the PRE-11I.4 state is required instead,
-- additionally restore the legacy enrollment-based policy (migration 034):
--
--     create policy "Students can read course_batches for enrolled courses"
--       on public.course_batches
--       for select
--       to authenticated
--       using (exists (
--         select 1 from public.course_enrollments ce
--         where ce.course_id = course_batches.course_id
--           and ce.student_id = public.get_my_student_id()
--       ));
--
--     Warning: that re-introduces the Phase 11I.3 defect (batch-assigned
--     courses hidden unless enrolled) and removes subscription-expiry-driven
--     revocation.
--
-- END OF MIGRATION 092
-- ============================================================================
