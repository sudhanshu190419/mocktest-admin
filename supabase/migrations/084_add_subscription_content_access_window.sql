-- ============================================================================
-- Migration: 084 — Subscription Content Access Window
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Purpose: Extend student_subscriptions with content_access_end_date — the
--          date until which a student retains access to content-only resources
--          (Recorded Classes, Notes, PDFs, Downloads) after the subscription
--          ends and the grace period lapses.
--
-- Access timeline (approved Phase 11A business rule):
--   start_date ──▶ end_date (full paid access)
--   ──▶ grace_end_date (end_date + 7d — live classes still joinable)
--   ──▶ content_access_end_date (grace_end_date + 30d — content-only access)
--   ──▶ full expiry (everything inaccessible until renewal)
--
-- Design: Extends the existing grace_end_date mechanism:
--   • DATE column, NULL by default — mirrors grace_end_date exactly
--   • Backfill derives the content window FROM the grace window:
--       content_access_end_date = COALESCE(grace_end_date, end_date + grace_days)
--                                 + content_days
--   • CHECK constraint enforcing window ordering
--   • Partial index for the content-window expiry job
--   • Explicit column/constraint/index comments
--
-- The backfill intentionally applies the approved Phase 11 defaults
-- (grace_days = 7, content_access_days = 30). This migration backfills
-- existing rows only; future subscription lifecycle / purchase code is
-- responsible for maintaining content_access_end_date on new rows and
-- renewals — exactly as it does for grace_end_date.
--
-- Depends on: Migration 012 (Domain 11 — student_subscriptions)
-- Reference: Phase 11A/11A.0 (approved) | 012 grace_end_date pattern
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Add Column
-- ════════════════════════════════════════════════════════════════════════════

alter table public.student_subscriptions
  add column if not exists content_access_end_date date null default null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Backfill Existing Rows
-- ════════════════════════════════════════════════════════════════════════════
-- content_access_end_date is derived from the existing grace window:
--   content_access_end_date = COALESCE(grace_end_date, end_date + v_grace_days)
--                             + v_content_days
-- i.e. the approved Phase 11 rule — a 30-day content window starting when
-- grace ends (falling back to end_date + 7 days when no grace window was
-- ever opened). This keeps the new column aligned with the grace window
-- instead of recomputing the window from scratch.
--
-- The constants (7 / 30) are the approved Phase 11 defaults and mirror the
-- system_settings seeded in migration 085. This migration backfills existing
-- rows only; future subscription purchase / lifecycle code maintains the
-- column on new rows and renewals — exactly like grace_end_date (which is
-- also set by job/backend code, never by a trigger).
--
-- Backfill is restricted to non-terminated statuses (active, grace, expired).
-- Cancelled / refunded subscriptions are terminated grants and intentionally
-- get NO content window (NULL) — the same rule the lifecycle job must follow
-- for new rows in later phases.

do $$
declare
  v_grace_days      int := 7;
  v_content_days    int := 30;
begin
  update public.student_subscriptions
     set content_access_end_date = coalesce(grace_end_date, end_date + v_grace_days) + v_content_days
   where content_access_end_date is null
     and status in ('active', 'grace', 'expired');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — CHECK Constraint
-- ════════════════════════════════════════════════════════════════════════════
-- The content window must end on or after the grace window end (which the
-- existing ck_student_subscriptions_grace_end_date already guarantees is
-- >= end_date). An idempotent DO block avoids double-application failures.
--
-- Why `>=` (not exact equality with grace_end_date + 30): this CHECK's role
-- is ordering integrity — the content window can never end before the grace
-- window — not business-rule enforcement. The exact 30-day length is
-- configurable (content_access_days system setting) and maintained by the
-- lifecycle code, and `>=` deliberately permits admins to shorten the window
-- (early revocation) as a valid operational action. This mirrors the existing
-- grace_end_date >= end_date constraint exactly.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.student_subscriptions'::regclass
      and conname = 'ck_student_subscriptions_content_access_end_date'
  ) then
    alter table public.student_subscriptions
      add constraint ck_student_subscriptions_content_access_end_date
      check (
        content_access_end_date is null
        or content_access_end_date >= coalesce(grace_end_date, end_date)
      );
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Index
-- ════════════════════════════════════════════════════════════════════════════
-- Partial index for the content-window expiry job (find subscriptions whose
-- content window has passed) and for RLS/access-check predicates.

create index if not exists idx_student_subs_content_access_end_date
  on public.student_subscriptions (content_access_end_date)
  where content_access_end_date is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on column public.student_subscriptions.content_access_end_date is
  'The last date on which the student retains access to content-only resources '
  '(Recorded Classes, Notes, PDFs, Downloads) after the grace period ends. '
  'Computed as COALESCE(grace_end_date, end_date + grace_days) + '
  'content_access_days (7 + 30 by default) — an extension of the existing '
  'grace_end_date mechanism. NULL when no content window applies (e.g. '
  'cancelled / refunded grants). After this date everything is inaccessible '
  'until renewal. Backfilled on migration with the approved Phase 11 defaults; '
  'maintained thereafter by subscription purchase/lifecycle code — not '
  'trigger-maintained (mirrors grace_end_date).';

comment on constraint ck_student_subscriptions_content_access_end_date
  on public.student_subscriptions is
  'The content access window must end on or after the grace window end date. '
  'Prevents data entry errors where content access expires before the grace '
  'period ends.';

comment on index public.idx_student_subs_content_access_end_date is
  'Partial index for the content-window expiry job: find subscriptions whose '
  'content access window has passed (content_access_end_date IS NOT NULL). '
  'Named to mirror the existing idx_student_subs_grace_end_date convention.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6 — Validation Queries (run after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Column exists:
--    select column_name, data_type, is_nullable
--    from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'student_subscriptions'
--      and column_name = 'content_access_end_date';
--
-- 2. Backfill succeeded (rows with active/grace/expired status):
--    For rows that opened a grace window this validates content_access_end_date
--    = grace_end_date + 30; for rows without one it validates
--    (end_date + 7) + 30.
--    select count(*)                                                           as eligible_rows,
--           count(content_access_end_date)                                     as with_window,
--           count(*) filter (where content_access_end_date =
--             coalesce(grace_end_date, end_date + 7) + 30)                     as correctly_backfilled,
--           count(*) filter (where status in ('cancelled', 'refunded')
--                            and content_access_end_date is null)              as terminated_without_window
--    from public.student_subscriptions
--    where status in ('active', 'grace', 'expired');
--
-- 6. Index created:
--    select indexname, indexdef
--    from pg_indexes
--    where schemaname = 'public'
--      and tablename = 'student_subscriptions'
--      and indexname = 'idx_student_subs_content_access_end_date';
--
-- 7. Constraint created:
--    select conname, pg_get_constraintdef(oid)
--    from pg_constraint
--    where conrelid = 'public.student_subscriptions'::regclass
--      and conname = 'ck_student_subscriptions_content_access_end_date';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 7 — Rollback
-- ════════════════════════════════════════════════════════════════════════════
-- alter table public.student_subscriptions
--   drop constraint if exists ck_student_subscriptions_content_access_end_date;
--
-- drop index if exists public.idx_student_subs_content_access_end_date;
--
-- alter table public.student_subscriptions
--   drop column if exists content_access_end_date;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 084 Subscription Content Access Window
-- ════════════════════════════════════════════════════════════════════════════
