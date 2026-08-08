-- ============================================================================
-- Migration: 096 — Unified Subscription Entitlement Helpers (Phase 11K.2)
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- ════════════════════════════════════════════════════════════════════════════
-- PURPOSE
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 11K.2 — implement ONLY the database-helper layer of the Phase 11K.1
-- renewal redesign. No Edge Functions, mobile, admin, payment, renewal,
-- lifecycle, or UI code is touched in this migration.
--
-- Two changes:
--   1. Entitlement: students who PERMANENTLY OWN a course
--      (course_enrollments.enrollment_type = 'purchase') retain access even
--      after their subscription is cancelled following Full Course
--      conversion. Implemented by a new shared helper
--      (is_permanent_course_owner) that the two existing tier helpers
--      (can_student_access_live_course / can_student_access_content) OR at
--      the top of their evaluation.
--   2. New helper: total_subscription_payments(student_id, course_id) —
--      the sum of everything the student paid in subscription plans for one
--      course. This is the building block for the 11K.4 conversion pricing
--      rule (Remaining Amount = Course Price − Total Subscription Payments).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ARCHITECTURE UPDATE — REVISED RENEWAL MODEL (authoritative)
-- ════════════════════════════════════════════════════════════════════════════
-- The Phase 11K.1 design was revised BEFORE implementation:
--
--   • There is ALWAYS exactly ONE current student_subscriptions row per
--     student per course.
--   • Renewals UPDATE that row — they do NOT insert new rows.
--   • Payment history lives in orders / order_items (immutable).
--   • Audit history lives in subscription_history.
--
-- Compatibility of THIS migration with that revised model:
--   • The tier helpers read student_subscriptions by (course_id, student_id)
--     and evaluate the CURRENT row. This is identical whether renewals
--     insert or update — migration 090's partial unique index
--     uq_student_subscriptions_student_course_active_grace guarantees at
--     most one active/grace row, so "the current row" is unambiguous.
--   • total_subscription_payments reads orders + order_items ONLY. It is
--     deliberately decoupled from student_subscriptions, so it never depends
--     on whether renewal history is kept in separate rows (old model) or
--     overwritten in place (new model). Per-period amounts will only ever
--     exist in order history, which is exactly where this helper looks.
--   • No constraint, index, column, or trigger on student_subscriptions is
--     created, altered, or dropped here — nothing in this migration
--     precludes the revised renewal architecture.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SCOPE (strict, per Phase 11K.2)
-- ════════════════════════════════════════════════════════════════════════════
--   • HELPER FUNCTIONS ONLY — CREATE OR REPLACE / CREATE.
--   • NO RLS policies are created, dropped, or modified.
--   • NO new enums. NO schema changes. NO new columns. NO constraint
--     changes. NO new indexes (the ownership + payment queries are already
--     fully index-backed — see PERFORMANCE below).
--   • NO Edge Functions, mobile, admin, payment, or lifecycle code.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEPENDENCIES
-- ════════════════════════════════════════════════════════════════════════════
-- Tables read:
--   • course_enrollments   (034) — uq_course_enrollments_course_student
--                                   (course_id, student_id) + idx_course_enrollments_student_active
--                                   (student_id, is_active) back the ownership EXISTS.
--   • orders               (008) — idx_orders_student_placed_at (student_id)
--   • order_items          (008/043/090) — idx_order_items_course_id (course_id)
--                                   where course_id is not null + idx_order_items_order_id (order_id)
--   • student_subscriptions (012/090) — unchanged from 091 usage.
-- Functions reused:
--   • public.get_my_student_id() (021) — caller → student_details.student_id.
--   • public.is_student_assigned_to_course_batch() (091) — shared batch rule.
--   • public.is_admin() (021) — staff guard for total_subscription_payments.
--   • auth.role() — Supabase built-in; 'service_role' allows Edge Function
--     (server-side) callers to use total_subscription_payments.
--
-- ════════════════════════════════════════════════════════════════════════════
-- RECURSION / SECURITY REVIEW
-- ════════════════════════════════════════════════════════════════════════════
-- • All four functions are SECURITY DEFINER with set search_path = '' and
--   fully-qualified public.* / auth.* references — the project convention
--   (091/093/095). No search_path hijack.
-- • No function SELECTs from a table whose RLS policy calls it, so no
--   42P17-style recursion is possible. The batch-subject wrappers (093) and
--   class wrapper (095) delegate into the tier helpers; updating the tier
--   helpers here automatically propagates ownership to every downstream
--   policy (batch_subject_contents, batch_subject_live_classes, recordings,
--   live_classes, ...) with zero policy edits.
-- • Caller scoping for is_permanent_course_owner and the tier helpers is
--   guaranteed by get_my_student_id(): a caller can only ever test their OWN
--   ownership/entitlement. Admins/teachers (no student_details row) resolve
--   NULL → correctly FALSE.
-- • total_subscription_payments takes an EXPLICIT student_id (it is a
--   server-side billing helper, not a per-caller policy helper). To prevent
--   a student from reading another student's payment totals through
--   PostgREST RPC, the body returns NULL unless the caller is the student
--   themselves, an admin, or the service role (Edge Functions).
--
-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE REVIEW
-- ════════════════════════════════════════════════════════════════════════════
-- • is_permanent_course_owner: EXISTS against course_enrollments filtered by
--   (course_id, student_id) → served by uq_course_enrollments_course_student;
--   is_active/enrollment_type filters applied after the index lookup. The
--   per-course uniqueness means at most one row is ever examined.
-- • can_student_access_live_course / can_student_access_content: same as 091
--   (unchanged subscription subquery, backed by the 090 partial unique index
--   + idx_student_subs_student_course_status) plus one ownership EXISTS.
--   Ownership short-circuits the batch + subscription work for permanent
--   owners (OR ordering → PostgreSQL evaluates the cheap indexed EXISTS
--   first where possible).
-- • total_subscription_payments: order_items filtered by course_id
--   (idx_order_items_course_id) → join orders on order_id
--   (idx_order_items_order_id) → student_id filter (idx_orders_student_placed_at)
--   + status='confirmed'. A student's paid subscription order lines for one
--   course are always a small set; the query is lightweight.
-- • No new indexes required — explicitly listed to avoid duplicate DDL.
--
-- ════════════════════════════════════════════════════════════════════════════
-- COMPATIBILITY WITH PHASES 11G–11J
-- ════════════════════════════════════════════════════════════════════════════
-- • Course-scoped access (11G/11H): tier helpers remain course-scoped;
--   ownership is also course-scoped (course_enrollments.course_id).
-- • Helper-driven RLS (11I.4B/11J.4): policy texts are untouched; the
--   helpers they call simply become slightly more permissive FOR PERMANENT
--   OWNERS ONLY. No policy behavior changes for anyone else.
-- • LiveKit (11J.2) / recording (11J.3) server-side checks still verify
--   batch membership independently; ownership does not bypass the
--   class/recording batch rules enforced inside the Edge Functions.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — is_permanent_course_owner(course_id uuid)
-- ════════════════════════════════════════════════════════════════════════════
-- TRUE when the current authenticated student permanently owns the course:
-- an ACTIVE course_enrollments row with enrollment_type = 'purchase' that
-- has not been revoked and (defensively) has not been time-limited into the
-- past. Used by the tier helpers below as a standalone entitlement that
-- does NOT depend on a subscription or on batch assignment — a one-time
-- full-course purchaser (complete-course-purchase never creates
-- batch_students rows) and a converted Full Course owner must both keep
-- access after their subscription is cancelled.
create or replace function public.is_permanent_course_owner(
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
    from public.course_enrollments ce
    where ce.course_id = p_course_id
      and ce.student_id = public.get_my_student_id()
      and ce.enrollment_type = 'purchase'
      and ce.is_active = true
      and ce.revoked_at is null
      and (ce.expires_at is null or ce.expires_at >= now())
  );
$$;

comment on function public.is_permanent_course_owner(uuid) is
  'Phase 11K.2: TRUE when the current student permanently owns the course '
  '(course_enrollments.enrollment_type = ''purchase'', is_active, not '
  'revoked, not time-expired). Standalone entitlement — independent of '
  'subscriptions and batch assignment. SECURITY DEFINER — safe to call '
  'from RLS policies without recursion. Feeds can_student_access_live_course '
  'and can_student_access_content so Full Course owners retain access after '
  'their subscription is cancelled following conversion.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — can_student_access_live_course(course_id uuid) [CREATE OR REPLACE]
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 11K.2 change: the existing rule
--   batch-assigned AND (active OR grace subscription)
-- becomes
--   PERMANENT OWNER OR (batch-assigned AND (active OR grace subscription)).
--
-- Ownership ORs at the TOP of the expression (not inside the AND), because:
--   • complete-course-purchase writes enrollment_type='purchase' without any
--     batch_students row — batch assignment is not guaranteed for owners.
--   • After Full Course conversion the subscription is status='cancelled',
--     so the subscription leg alone can never keep the owner entitled.
--
-- Everything else (UTC date semantics, lifecycle-lag grace, STABLE /
-- SECURITY DEFINER / search_path) is unchanged from Migration 091.
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
    -- (1) Permanent course ownership (Phase 11K.2) — standalone entitlement
    public.is_permanent_course_owner(p_course_id)
    or (
      -- (2) Subscription live entitlement delivered through an active batch:
      --     (a) Active batch assignment linked to the course (shared helper)
      public.is_student_assigned_to_course_batch(p_course_id)
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
      )
    );
$$;

comment on function public.can_student_access_live_course(uuid) is
  'Phase 11I.4B / 11K.2: TRUE when the current student permanently owns the '
  'course OR (is actively assigned to a batch linked to the course AND holds '
  'an active or grace subscription for that course). Ownership is a '
  'standalone entitlement so Full Course owners / one-time purchasers keep '
  'live access after subscription cancellation. SECURITY DEFINER — safe to '
  'call from RLS policies without recursion.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — can_student_access_content(course_id uuid) [CREATE OR REPLACE]
-- ════════════════════════════════════════════════════════════════════════════
-- Same Phase 11K.2 change as Section 2, applied to the content tier:
--   PERMANENT OWNER OR (batch-assigned AND (subscription content window)).
-- The subscription content-window branch (active / grace / content_only) is
-- byte-for-byte unchanged from Migration 091.
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
    -- (1) Permanent course ownership (Phase 11K.2) — standalone entitlement
    public.is_permanent_course_owner(p_course_id)
    or (
      -- (2) Subscription content entitlement delivered through an active batch
      public.is_student_assigned_to_course_batch(p_course_id)
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
      )
    );
$$;

comment on function public.can_student_access_content(uuid) is
  'Phase 11I.4B / 11K.2: TRUE when the current student permanently owns the '
  'course OR (is actively assigned to a batch linked to the course AND '
  'remains inside the subscription content-access window — active, grace, or '
  'content_only). Ownership is a standalone entitlement so Full Course '
  'owners / one-time purchasers keep content access after subscription '
  'cancellation. SECURITY DEFINER — safe to call from RLS policies without '
  'recursion.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — total_subscription_payments(student_id, course_id)
-- ════════════════════════════════════════════════════════════════════════════
-- Sum of everything the student has PAID in subscription plans for one
-- course. This is the building block for the 11K.4 Full Course conversion
-- pricing rule:  Remaining Amount = Course Price − Total Subscription
-- Payments.
--
-- SOURCE OF TRUTH: orders (status = 'confirmed' = captured payment) joined
-- to order_items (item_type = 'subscription_plan', course_id). This is
-- IMMUTABLE BILLING HISTORY — deliberately NOT student_subscriptions — so
-- the helper is correct under the revised renewal architecture (one row per
-- student per course updated in place; per-period amounts live only in
-- orders). Refunded/cancelled/pending orders are excluded automatically.
--
-- CALLER GUARD: returns NULL (fail-closed) unless the caller is the student
-- themselves, an admin, or the service role (Edge Function). A plain
-- student must never be able to pass another student_id through RPC.
create or replace function public.total_subscription_payments(
    p_student_id uuid,
    p_course_id uuid
)
returns numeric(12,2)
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.role() = 'service_role'
      or p_student_id = public.get_my_student_id()
      or public.is_admin()
    then (
      select coalesce(sum(oi.line_total), 0)::numeric(12,2)
      from public.order_items oi
      join public.orders o on o.order_id = oi.order_id
      where o.student_id = p_student_id
        and o.status = 'confirmed'
        and oi.item_type = 'subscription_plan'
        and oi.course_id = p_course_id
    )
    else null
  end;
$$;

comment on function public.total_subscription_payments(uuid, uuid) is
  'Phase 11K.2: total amount the student has paid in subscription plans for '
  'one course (sum of order_items.line_total across orders with status = '
  '''confirmed'' where item_type = ''subscription_plan'' and course_id '
  'matches). Reads immutable billing history (orders/order_items), never '
  'student_subscriptions — correct under the revised renewal architecture '
  '(single row updated in place). Returns NULL for unauthorized callers '
  '(not the student, not an admin, not the service role). Feeds the 11K.4 '
  'Full Course conversion price rule.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Validation queries
-- ════════════════════════════════════════════════════════════════════════════
-- Run in the Supabase SQL editor after applying.
--
-- 1. All four functions exist (expect 4 rows):
--    select proname, prosecdef, provolatile
--    from pg_proc
--    where proname in (
--      'is_permanent_course_owner',
--      'can_student_access_live_course',
--      'can_student_access_content',
--      'total_subscription_payments'
--    );
--
-- 2. SECURITY DEFINER + STABLE + empty search_path baked in:
--    select p.proname, p.prosecdef as security_definer, p.provolatile as volatility
--    from pg_proc p
--    where p.proname in (
--      'is_permanent_course_owner',
--      'can_student_access_live_course',
--      'can_student_access_content',
--      'total_subscription_payments'
--    );
--    select proname, pg_get_functiondef(oid)
--    from pg_proc
--    where proname in ('is_permanent_course_owner', 'total_subscription_payments');
--
-- 3. Ownership dry-run (run AS the owning student):
--    select public.is_permanent_course_owner('<purchased_course_uuid>');
--    -- expect TRUE
--
-- 4. Live entitlement for an owner whose subscription was cancelled
--    (simulate the post-conversion state). WRAPPED IN A TRANSACTION THAT
--    ROLLS BACK — the UPDATE is a simulation only and must never persist:
--    begin;
--    update public.student_subscriptions
--    set status = 'cancelled'
--    where student_id = public.get_my_student_id()
--      and course_id = '<purchased_course_uuid>'
--      and status in ('active', 'grace');
--    select public.can_student_access_live_course('<purchased_course_uuid>'),
--           public.can_student_access_content('<purchased_course_uuid>');
--    -- expect TRUE / TRUE (ownership keeps access after cancellation)
--    rollback;   -- IMPORTANT: never commit the simulated cancellation
--
-- 5. Regression — subscription-only student WITHOUT ownership (expect the
--    pre-11K.2 answers: live TRUE only with active/grace, content TRUE
--    inside the content window; FALSE after expiry beyond the window):
--    select public.can_student_access_live_course('<sub_course_uuid>'),
--           public.can_student_access_content('<sub_course_uuid>');
--
-- 6. Payment total dry-run (run as admin or the student; else expect NULL):
--    select public.total_subscription_payments(
--             '<student_uuid>', '<course_uuid>'
--           );
--    -- expect sum of confirmed subscription_plan line_totals for that course
--
-- 7. Guard negative test (run as a DIFFERENT student; expect NULL):
--    select public.total_subscription_payments('<other_student_uuid>', '<course_uuid>');

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- Safe to run at any time; nothing else references the new helpers yet.
--
-- ⚠️ ORDER MATTERS: the tier helpers call is_permanent_course_owner, so
-- PostgreSQL will REFUSE `drop function ... is_permanent_course_owner` while
-- they still reference it. Rollback in dependency order:
--   (1) restore the ORIGINAL 091 bodies of the two tier helpers first
--       (this removes the is_permanent_course_owner call), then
--   (2) drop the two new helpers.
--
-- 1. Restore the ORIGINAL Migration 091 bodies of the two tier helpers
--    (remove the ownership OR branch). Original can_student_access_live_course:
--
--      create or replace function public.can_student_access_live_course(
--          p_course_id uuid
--      )
--      returns boolean
--      language sql
--      stable
--      security definer
--      set search_path = ''
--      as $$
--        with today as (
--          select (now() at time zone 'utc')::date as d
--        )
--        select
--          public.is_student_assigned_to_course_batch(p_course_id)
--          and exists (
--            select 1
--            from public.student_subscriptions ss, today
--            where ss.course_id = p_course_id
--              and ss.student_id = public.get_my_student_id()
--              and (
--                (ss.status = 'active'
--                  and (ss.end_date >= today.d
--                       or (ss.grace_end_date is not null
--                           and ss.grace_end_date >= today.d)))
--                or (ss.status = 'grace'
--                    and ss.grace_end_date is not null
--                    and ss.grace_end_date >= today.d)
--              )
--          );
--      $$;
--
--    Original can_student_access_content:
--
--      create or replace function public.can_student_access_content(
--          p_course_id uuid
--      )
--      returns boolean
--      language sql
--      stable
--      security definer
--      set search_path = ''
--      as $$
--        with today as (
--          select (now() at time zone 'utc')::date as d
--        )
--        select
--          public.is_student_assigned_to_course_batch(p_course_id)
--          and exists (
--            select 1
--            from public.student_subscriptions ss, today
--            where ss.course_id = p_course_id
--              and ss.student_id = public.get_my_student_id()
--              and (
--                (ss.status = 'active'
--                  and (
--                    ss.end_date >= today.d
--                    or (ss.grace_end_date is not null
--                        and ss.grace_end_date >= today.d)
--                    or (ss.content_access_end_date is not null
--                        and ss.content_access_end_date >= today.d)
--                  ))
--                or (ss.status = 'grace'
--                    and (
--                      (ss.grace_end_date is not null
--                       and ss.grace_end_date >= today.d)
--                      or (ss.content_access_end_date is not null
--                          and ss.content_access_end_date >= today.d)
--                    ))
--                or (ss.status = 'expired'
--                    and ss.content_access_end_date is not null
--                    and ss.content_access_end_date >= today.d)
--              )
--          );
--      $$;
--
--
-- 2. THEN drop the two new helpers (dependency order — helpers last):
--      drop function if exists public.total_subscription_payments(uuid, uuid);
--      drop function if exists public.is_permanent_course_owner(uuid);
--
-- END OF MIGRATION 096
-- ============================================================================
