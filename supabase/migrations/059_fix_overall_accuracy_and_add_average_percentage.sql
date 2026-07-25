-- ============================================================================
-- Migration 059: Fix overallAccuracy and add averagePercentage
--
-- The existing get_student_dashboard_summary() RPC (from migration 036)
-- already computes overall_accuracy correctly as:
--   (total_correct / (total_correct + total_wrong)) * 100
--
-- This migration adds a new field "average_percentage" that exposes the
-- average of each test's percentage score (AVG(mock_results.percentage)),
-- which was confused with accuracy in a previous version of the RPC.
--
-- The new response includes both metrics so the UI can display them
-- side by side for comparison.
--
-- Backward compatible: all existing keys are preserved unchanged.
-- The function signature (returns json) is unchanged.
-- Idempotent: uses create or replace function.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Update Function
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
  v_average_percentage    numeric;
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
    coalesce(sum(r.wrong_count), 0)::int,
    round(coalesce(avg(r.percentage), 0), 2)
  into
    v_tests_attempted,
    v_average_score,
    v_best_score,
    v_total_correct,
    v_total_wrong,
    v_average_percentage
  from public.mock_results r
  where r.student_id = v_student_id
    and r.is_released = true;

  -- ── Compute overall accuracy (true accuracy: correct / (correct + wrong))
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
    'tests_attempted',      v_tests_attempted,
    'average_score',        v_average_score,
    'best_score',           v_best_score,
    'overall_accuracy',     v_overall_accuracy,
    'average_percentage',   v_average_percentage,
    'latest_result',        v_latest_result,
    'continue_practice',    v_continue_practice
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Updated Comment
-- ════════════════════════════════════════════════════════════════════════════

comment on function public.get_student_dashboard_summary() is
  'Returns a single JSON object with the authenticated student''s dashboard '
  'summary: tests_attempted, average_score, best_score, overall_accuracy '
  '(correct / (correct + wrong) × 100), average_percentage (AVG of each '
  'test''s percentage score), latest_result (most recent released mock result), '
  'and continue_practice (the first in-progress attempt found). The student_id '
  'is resolved from the session via get_my_student_id() — the function accepts '
  'no parameters. SECURITY DEFINER ensures RLS bypass for aggregated reads, '
  'but the caller can only see their own data because student_id is derived '
  'from auth.uid().';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 059 Fix overallAccuracy and add averagePercentage
-- ════════════════════════════════════════════════════════════════════════════
