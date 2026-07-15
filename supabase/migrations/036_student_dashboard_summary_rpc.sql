-- ============================================================================
-- Migration: 036 — Student Dashboard Summary RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Creates a single PostgreSQL RPC function, get_student_dashboard_summary(),
-- that returns all six fields needed by the Student Dashboard home screen
-- in a single database round-trip.
--
-- This replaces the previous TypeScript orchestration (three separate service
-- calls) with an atomic, shareable SQL function that both the website and
-- the mobile app can call via supabase.rpc().
--
-- ## Why an RPC?
--
--   1. Single source of truth — one function, both platforms
--   2. Atomic — consistent snapshot; no data drift between sub-queries
--   3. Faster — 1 DB round-trip instead of 3
--   4. No new tables or columns — reuses existing mock_results + mock_attempts
--
-- ## Security
--
--   • SECURITY DEFINER to bypass RLS (needed to read data across tables)
--   • Student identity is resolved from the session via get_my_student_id()
--     so the caller can only see their own data
--   • No parameters accepted — student_id is derived from auth.uid()
--
-- Depends on:
--   Domain 01 — public.get_my_student_id() — resolves student_id from auth.uid()
--   Domain 05 — public.mock_results table
--   Domain 05 — public.mock_attempts table
--
-- Returns: JSON object with keys:
--   tests_attempted      int
--   average_score        numeric
--   best_score           numeric
--   overall_accuracy     numeric | null
--   latest_result        json | null
--   continue_practice    json | null
--
-- Usage:
--   Website:  supabase.rpc('get_student_dashboard_summary')
--   Mobile:   supabase.rpc('get_student_dashboard_summary')
--
-- @module migrations/036
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create Function
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_student_dashboard_summary()
returns json
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_student_id            uuid;
  v_tests_attempted       int;
  v_average_score         numeric;
  v_best_score            numeric;
  v_total_correct         int;
  v_total_wrong           int;
  v_overall_accuracy      numeric;
  v_latest_result         json;
  v_continue_practice     json;
begin
  -- ── Resolve the caller's student_id from the auth session ────────────
  v_student_id := public.get_my_student_id();

  if v_student_id is null then
    return json_build_object(
      'error', 'Authenticated user is not a student or has no student_details row.'
    );
  end if;

  -- ── Aggregate metrics from mock_results ─────────────────────────────
  select
    count(*)::int,
    round(coalesce(avg(r.total_score), 0), 2),
    coalesce(max(r.total_score), 0),
    coalesce(sum(r.correct_count), 0)::int,
    coalesce(sum(r.wrong_count), 0)::int
  into
    v_tests_attempted,
    v_average_score,
    v_best_score,
    v_total_correct,
    v_total_wrong
  from public.mock_results r
  where r.student_id = v_student_id;

  -- ── Compute overall accuracy ────────────────────────────────────────
  if (v_total_correct + v_total_wrong) > 0 then
    v_overall_accuracy := round(
      (v_total_correct::numeric / (v_total_correct + v_total_wrong)) * 100, 2
    );
  else
    v_overall_accuracy := null;
  end if;

  -- ── Latest released result ──────────────────────────────────────────
  select json_build_object(
    'result_id',        lr.result_id,
    'attempt_id',       lr.attempt_id,
    'test_id',          lr.test_id,
    'total_score',      lr.total_score,
    'max_score',        lr.max_score,
    'percentage',       lr.percentage,
    'correct_count',    lr.correct_count,
    'wrong_count',      lr.wrong_count,
    'skipped_count',    lr.skipped_count,
    'rank',             lr.rank,
    'percentile',       lr.percentile,
    'generated_at',     lr.generated_at,
    'released_at',      lr.released_at
  ) into v_latest_result
  from public.mock_results lr
  where lr.student_id = v_student_id
    and lr.is_released = true
  order by lr.generated_at desc
  limit 1;

  -- ── In-progress attempt (Continue Practice) ─────────────────────────
  select json_build_object(
    'attempt_id',               ca.attempt_id,
    'test_id',                  ca.test_id,
    'status',                   ca.status,
    'started_at',               ca.started_at,
    'time_remaining_seconds',   ca.time_remaining_seconds
  ) into v_continue_practice
  from public.mock_attempts ca
  where ca.student_id = v_student_id
    and ca.status = 'in_progress'
  order by ca.started_at desc
  limit 1;

  -- ── Return the complete dashboard summary ───────────────────────────
  return json_build_object(
    'tests_attempted',     v_tests_attempted,
    'average_score',       v_average_score,
    'best_score',          v_best_score,
    'overall_accuracy',    v_overall_accuracy,
    'latest_result',       v_latest_result,
    'continue_practice',   v_continue_practice
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on function public.get_student_dashboard_summary() is
  'Returns a single JSON object with the authenticated student''s dashboard '
  'summary: tests_attempted, average_score, best_score, overall_accuracy, '
  'latest_result (most recent released mock result), and continue_practice '
  '(the first in-progress attempt found). The student_id is resolved from '
  'the session via get_my_student_id() — the function accepts no parameters. '
  'SECURITY DEFINER ensures RLS bypass for aggregated reads, but the caller '
  'can only see their own data because student_id is derived from auth.uid().';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 036 Student Dashboard Summary RPC
-- ════════════════════════════════════════════════════════════════════════════
