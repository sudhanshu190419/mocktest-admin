-- ============================================================================
-- Migration: 100 — Mock Tests: publish guard for question snapshots
--
-- PostgreSQL 16 | Supabase Compatible | Idempotent
--
-- PROBLEM
-- -------
-- Mock tests could reach status = 'published' without a single
-- question_snapshot row being populated (bare status flips in the admin /
-- teacher panels that skipped the publish workflow). The mobile app then
-- renders "Question content is empty or unavailable" for every question.
--
-- FIX (server-side, fail-closed)
-- ------------------------------
-- A BEFORE UPDATE trigger on mock_tests forbids ANY transition to
-- status = 'published' while at least one assigned question in
-- mock_test_questions has question_snapshot IS NULL (or no questions are
-- assigned at all). The application layer routes every publish through
-- publishMockTestWorkflow() which generates and verifies snapshots first;
-- this trigger is the last line of defense that makes the invariant
-- unbreakable regardless of code path, including direct SQL / API writes.
--
-- DESIGN
-- ------
--   * Trigger function is SECURITY DEFINER so the snapshot check sees all
--     rows even when the invoking role lacks RLS visibility on
--     mock_test_questions.
--   * Fires on INSERT and UPDATE. On UPDATE it triggers only when the row
--     actually targets 'published' (NEW.status = 'published' AND
--     OLD.status IS DISTINCT FROM NEW.status), so editing title/duration of
--     an already-published test is unaffected.
--   * Archive / unpublish / restore transitions are NOT blocked: restore
--     (archived → published) is allowed ONLY when snapshots exist, which is
--     exactly the required invariant.
--   * No RLS policies are changed. No application logic is changed.
--
-- NOTE on seed data: migration 023 seeds one 'published' mock test WITHOUT
-- question_snapshot rows. Because migrations apply in order, that seed runs
-- BEFORE this trigger exists, so the guard does not block it. The one-time
-- backfill script (supabase/backfill_mock_question_snapshots.sql) repairs
-- that legacy row (and any real production rows) after deployment.
--
-- Dependencies:
--   - Migration 006 (Domain 05 — Assessment): mock_tests, mock_test_questions
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Trigger function (idempotent)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_mock_tests_block_publish_without_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_count bigint;
  v_missing_count  bigint;
begin
  -- Guard INSERT (test created already published) and the UPDATE
  -- transition INTO published.
  if NEW.status = 'published' and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status) then
    -- 1. The test must have at least one assigned question.
    select count(*) into v_question_count
      from public.mock_test_questions
     where test_id = NEW.test_id;

    if v_question_count = 0 then
      raise exception 'Cannot publish mock test %: no questions are assigned.', NEW.test_id
        using errcode = 'P0001';
    end if;

    -- 2. Every assigned question must have a frozen question_snapshot.
    select count(*) into v_missing_count
      from public.mock_test_questions
     where test_id = NEW.test_id
       and question_snapshot is null;

    if v_missing_count > 0 then
      raise exception 'Cannot publish mock test %: % assigned question(s) have no frozen question_snapshot. Run the publish workflow (publishMockTestWorkflow) or the snapshot backfill first.', NEW.test_id, v_missing_count
        using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;

comment on function public.fn_mock_tests_block_publish_without_snapshots() is
  'Fail-closed guard: mock_tests.status may only become published when every '
  'assigned question in mock_test_questions has a non-null question_snapshot.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Trigger (idempotent)
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_mock_tests_block_publish_without_snapshots on public.mock_tests;

create trigger trg_mock_tests_block_publish_without_snapshots
  before insert or update on public.mock_tests
  for each row
  execute function public.fn_mock_tests_block_publish_without_snapshots();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Verification Queries
--
-- 3a. Confirm the trigger exists:
--     select tgname, pg_get_triggerdef(oid)
--     from pg_trigger
--     where tgname = 'trg_mock_tests_block_publish_without_snapshots';
--
-- 3b. Sanity check — this UPDATE must FAIL (test has NULL snapshots):
--     update public.mock_tests
--        set status = 'published'
--      where test_id = '<test-with-null-snapshots>';
--     Expected: ERROR  P0001 — Cannot publish mock test ...
--
-- 3c. After the backfill script runs, the SAME update must SUCCEED.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 100 Mock Tests publish snapshot guard
-- ════════════════════════════════════════════════════════════════════════════
