-- ============================================================================
-- Migration: 091 — Unified Course Entitlement Helpers (Phase 11I.4B)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- Establish the reusable student-entitlement foundation for the Phase 11G
-- course-scoped subscription workflow. Every future student RLS policy on
-- course resources will call these SECURITY DEFINER helpers instead of
-- inlining near-duplicate EXISTS blocks, so the entitlement rule lives in
-- exactly ONE place and cannot drift between tables.
--
-- Three helpers, one responsibility each:
--   • is_student_assigned_to_course_batch()  — shared batch-assignment check
--   • can_student_access_live_course()       — active OR grace tier
--   • can_student_access_content()           — active OR grace OR content_only
--
-- The two tier helpers DELEGATE the batch-assignment condition to the shared
-- helper, so the batch rule is defined once and future RLS policies consume
-- the same building block (pure refactor — business logic unchanged).
--
-- This migration is HELPER-ONLY by design (Phase 11I.4B constraint):
--   • NO RLS policy is created, dropped, or modified here.
--   • NO permissions are changed (function EXECUTE is PUBLIC by default,
--     matching the existing helper convention — no explicit grants needed).
--   • NO application code / Edge Functions are touched.
--
-- Policy rewrites that consume these helpers belong to Migration 092
-- (course_batches) and the later policy-unification migration.
--
-- ════════════════════════════════════════════════════════════════════════════
-- BUSINESS RULE (approved workflow)
-- ════════════════════════════════════════════════════════════════════════════
-- A student is entitled to a course ONLY when BOTH conditions hold:
--
--   1. The student is ACTIVELY assigned to a batch linked to the course
--      (batch_students.status = 'active' via course_batches), AND
--   2. The student's subscription covers the course per the Phase 11C tier
--      model (status + stored date boundaries — NEVER derived from
--      system_settings at check time; stored dates are authoritative).
--
-- Tier model (mirrors _shared/subscriptionAccess.ts evaluateTier):
--   active       — everything available
--   grace        — everything available (incl. live classes)
--   content_only — live classes blocked; content available until
--                  content_access_end_date (recordings, notes, PDFs,
--                  downloads, lessons, mock tests)
--   none         — everything blocked until renewal
--
-- ════════════════════════════════════════════════════════════════════════════
-- DATE SEMANTICS
-- ════════════════════════════════════════════════════════════════════════════
-- The Edge Function compares dates as UTC strings (new Date().toISOString()).
-- To match exactly, these helpers compare DATE columns against the UTC date:
--
--     (now() at time zone 'utc')::date
--
-- NOT `current_date`, which depends on the session timezone. This guarantees
-- RLS and Edge Function authorization never disagree by a day.
--
-- Each entitlement helper computes this value exactly ONCE per invocation
-- via a `WITH today AS (...) SELECT ...` CTE and reuses it throughout the
-- query — a readability + micro-performance refinement with zero behavioural
-- change (now() is STABLE, so repeated evaluation was already identical).
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEPENDENCIES
-- ════════════════════════════════════════════════════════════════════════════
-- Tables read:
--   • course_batches        (033) — PK (course_id, batch_id) → course_id indexed
--   • batch_students        (003) — idx_batch_students_student_id (student_id),
--                                   idx_batch_students_batch_status (batch_id, status)
--   • student_subscriptions (012/090) — uq_student_subscriptions_student_course_active_grace
--                                   (student_id, course_id) WHERE status IN ('active','grace')
--                                   [090] + idx_student_subs_student_course_status
--                                   (student_id, course_id, status) [090]
-- Functions reused:
--   • public.get_my_student_id()  (021) — SECURITY DEFINER, resolves the
--                                   caller's student_details.student_id.
-- No new indexes are required: every subquery is already index-backed.
--
-- ════════════════════════════════════════════════════════════════════════════
-- RECURSION / SECURITY / PARALLEL REVIEW
-- ════════════════════════════════════════════════════════════════════════════
-- • SECURITY DEFINER + set search_path = '' (project convention, e.g.
--   get_my_student_id, is_student_enrolled_in_course): the body executes as
--   the function owner and bypasses RLS on the tables it reads, so there is
--   NO recursive RLS evaluation when these helpers are called from a policy
--   on another table.
-- • They never SELECT from the table whose policy would call them
--   (course_content, live_classes, ...), so no self-reference recursion.
-- • Caller scoping is guaranteed by get_my_student_id() → the caller can only
--   ever resolve THEIR OWN student_id; admin/teacher callers (no
--   student_details row) resolve NULL and correctly get FALSE.
-- • No search_path hijack: fully-qualified public.* references + empty
--   search_path.
-- • PARALLEL SAFE: these helpers are deterministic read-only SQL functions
--   (no writes, no session mutation, no temp tables, no sequence access), so
--   they may run in parallel workers. now() is STABLE and safe in workers.
--   NOTE: the planner will still only parallelize when the surrounding query
--   is itself parallel-safe — declaring the helpers safe merely permits it.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — is_student_assigned_to_course_batch(course_id uuid)
-- ════════════════════════════════════════════════════════════════════════════
-- Shared batch-assignment condition. TRUE only when the current
-- authenticated student (via public.get_my_student_id()) has an ACTIVE
-- batch_students row for at least one batch linked to the supplied course
-- through course_batches.
--
-- Centralizes the batch-membership rule so can_student_access_live_course()
-- and can_student_access_content() (and any future RLS policy) never
-- duplicate it.
create or replace function public.is_student_assigned_to_course_batch(
    p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_batches cb
    join public.batch_students bs on bs.batch_id = cb.batch_id
    where cb.course_id = p_course_id
      and bs.student_id = public.get_my_student_id()
      and bs.status = 'active'
  );
$$;

comment on function public.is_student_assigned_to_course_batch(uuid) is
  'Phase 11I.4B: TRUE when the current student is actively assigned to at '
  'least one batch linked to the supplied course via course_batches '
  '(batch_students.status = ''active''). SECURITY DEFINER — safe to call '
  'from RLS policies without recursion. Shared building block for every '
  'course-entitlement helper.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — can_student_access_live_course(course_id uuid)
-- ════════════════════════════════════════════════════════════════════════════
-- TRUE when BOTH:
--   (a) the student is actively assigned to a batch linked to the course, AND
--   (b) the subscription tier is 'active' OR 'grace' (live-class entitlement).
--
-- Mirrors canJoinLiveClass() in _shared/subscriptionAccess.ts exactly,
-- including the lifecycle-lag tolerance: a row still status='active' whose
-- end_date has passed behaves as grace while grace_end_date >= today.
create or replace function public.can_student_access_live_course(
    p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'utc')::date as d
  )
  select
    -- (a) Active batch assignment linked to the course (shared helper)
    public.is_student_assigned_to_course_batch(p_course_id)
    -- (b) Live entitlement: active or grace tier (with lifecycle-lag grace)
    and exists (
      select 1
      from public.student_subscriptions ss, today
      where ss.course_id = p_course_id
        and ss.student_id = public.get_my_student_id()
        and (
          (ss.status = 'active'
            and (ss.end_date >= today.d
                 or (ss.grace_end_date is not null
                     and ss.grace_end_date >= today.d)))
          or (ss.status = 'grace'
              and ss.grace_end_date is not null
              and ss.grace_end_date >= today.d)
        )
    );
$$;

comment on function public.can_student_access_live_course(uuid) is
  'Phase 11I.4B: TRUE when the current student is actively assigned to a '
  'batch linked to the course AND holds an active or grace subscription for '
  'that course (Phase 11C tier model). SECURITY DEFINER — safe to call from '
  'RLS policies without recursion. Intended for: live classes, LiveKit token '
  'generation, attendance, course_batches visibility.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — can_student_access_content(course_id uuid)
-- ════════════════════════════════════════════════════════════════════════════
-- TRUE when BOTH:
--   (a) the student is actively assigned to a batch linked to the course, AND
--   (b) the subscription is still inside the content-access window:
--       tier 'active', 'grace', OR 'content_only' (content_access_end_date
--       not yet passed). Every non-'none' tier grants content access.
--
-- Mirrors canAccessContent() in _shared/subscriptionAccess.ts exactly:
--   • status 'active' with end_date >= today                     → active
--   • status 'active', end_date passed, grace still open        → grace
--   • status 'grace' with grace_end_date >= today               → grace
--   • any of active/grace/expired with content window open      → content_only
--   • pending / cancelled / refunded                            → never
--
-- NOTE on grouping: each status branch is wrapped in its OWN parentheses so
-- the OR of the tier conditions can never escape the status guard (SQL
-- operator precedence: AND binds tighter than OR).
create or replace function public.can_student_access_content(
    p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'utc')::date as d
  )
  select
    -- (a) Active batch assignment linked to the course (shared helper)
    public.is_student_assigned_to_course_batch(p_course_id)
    -- (b) Content entitlement: every tier except 'none'
    and exists (
      select 1
      from public.student_subscriptions ss, today
      where ss.course_id = p_course_id
        and ss.student_id = public.get_my_student_id()
        and (
          (ss.status = 'active'
            and (
              ss.end_date >= today.d
              or (ss.grace_end_date is not null
                  and ss.grace_end_date >= today.d)
              or (ss.content_access_end_date is not null
                  and ss.content_access_end_date >= today.d)
            ))
          or (ss.status = 'grace'
              and (
                (ss.grace_end_date is not null
                 and ss.grace_end_date >= today.d)
                or (ss.content_access_end_date is not null
                    and ss.content_access_end_date >= today.d)
              ))
          or (ss.status = 'expired'
              and ss.content_access_end_date is not null
              and ss.content_access_end_date >= today.d)
        )
    );
$$;

comment on function public.can_student_access_content(uuid) is
  'Phase 11I.4B: TRUE when the current student is actively assigned to a '
  'batch linked to the course AND remains inside the subscription content-'
  'access window (active, grace, or content_only — i.e. content_access_end_'
  'date not passed). SECURITY DEFINER — safe to call from RLS policies '
  'without recursion. Intended for: course content, notes, PDFs, recordings, '
  'batch content, mock tests, subject content, subject mock tests.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Validation queries
-- ════════════════════════════════════════════════════════════════════════════
-- Run in the Supabase SQL editor after applying.
--
-- 1. Both functions exist (expect 2 rows):
--    select proname, prosecdef, provolatile
--    from pg_proc
--    where proname in ('can_student_access_live_course', 'can_student_access_content');
--
-- 2. SECURITY DEFINER + STABLE (verify search_path via pg_get_functiondef):
--    select p.proname, p.prosecdef as security_definer, p.provolatile as volatility,
--           a.rolname as owner
--    from pg_proc p
--    join pg_roles a on a.oid = p.proowner
--    where p.proname in ('can_student_access_live_course', 'can_student_access_content');
--
--    -- Confirm the empty search_path is baked into the definition:
--    select pg_get_functiondef(oid)
--    from pg_proc
--    where proname in ('can_student_access_live_course', 'can_student_access_content');
--
-- 3. Dry-run live entitlement (run as a student; expect TRUE only for a
--    batch-assigned course with active/grace subscription):
--    select public.can_student_access_live_course('<course_uuid>');
--
-- 4. Dry-run content entitlement (run as a student; expect TRUE even after
--    expiry while content_access_end_date >= today):
--    select public.can_student_access_content('<course_uuid>');
--
-- 5. Negative test — no subscription / expired beyond window (expect FALSE):
--    select public.can_student_access_live_course('<course_without_sub>'),
--           public.can_student_access_content('<course_without_sub>');
--
-- 6. Shared batch-assignment helper exists + dry-run (expect TRUE for a
--    course the student is batch-assigned to, FALSE otherwise):
--    select proname from pg_proc where proname = 'is_student_assigned_to_course_batch';
--    select public.is_student_assigned_to_course_batch('<course_uuid>');

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Safe to run at any time; these helpers are not referenced by any object
-- until Migration 092+ policies start consuming them.
--
-- Drop in dependency order: the tier helpers call the shared batch helper,
-- so the batch helper must be dropped LAST.
--
--     drop function if exists public.can_student_access_live_course(uuid);
--     drop function if exists public.can_student_access_content(uuid);
--     drop function if exists public.is_student_assigned_to_course_batch(uuid);
--
-- END OF MIGRATION 091
-- ============================================================================
