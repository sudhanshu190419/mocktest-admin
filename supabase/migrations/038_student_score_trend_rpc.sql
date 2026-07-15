-- ============================================================================
-- Migration: 038 — Student Score Trend RPC
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Creates a PostgreSQL RPC function, get_student_score_trend(), that returns
-- one record for every released mock test result in chronological order,
-- suitable for plotting directly on a line chart.
--
-- ## Why an RPC?
--
--   1. Single source of truth — one function consumed by both Website and
--      Mobile App (C:\Projects\MockTestApp)
--   2. Server-side ordering — returns data ordered by attemptedOn ASC so
--      no client-side sorting is required
--   3. Minimal payload — returns only the fields needed by the trend graph
--   4. No new tables or columns — reuses existing mock_results + mock_attempts
--      + mock_tests
--
-- ## Security
--
--   • SECURITY DEFINER to bypass RLS (needed to read across tables)
--   • Student identity is resolved from the session via get_my_student_id()
--     so the caller can only see their own data
--   • No parameters accepted — student_id is derived from auth.uid()
--
-- Depends on:
--   Domain 01 — public.get_my_student_id() — resolves student_id from auth.uid()
--   Domain 05 — public.mock_results table
--   Domain 05 — public.mock_attempts table
--   Domain 05 — public.mock_tests table
--
-- Returns: JSON array of objects, each with:
--   resultId       text (UUID)
--   attemptId      text (UUID)
--   testId         text (UUID)
--   testName       text
--   attemptedOn    text (ISO 8601 timestamp)
--   score          numeric
--   maxScore       numeric
--   percentage     numeric
--   accuracy       numeric | null
--   rank           int | null
--   percentile     numeric | null
--
-- Usage:
--   Website:  supabase.rpc('get_student_score_trend')
--   Mobile:   supabase.rpc('get_student_score_trend')
--
-- @module migrations/038
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Create Function
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_student_score_trend()
returns json
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_student_id uuid;
begin
  -- ── Resolve the caller's student_id from the auth session ────────────
  v_student_id := public.get_my_student_id();

  if v_student_id is null then
    return json_build_object(
      'error', 'Authenticated user is not a student or has no student_details row.'
    );
  end if;

  -- ── Return all released results ordered chronologically ──────────────
  return (
    select coalesce(
      json_agg(
        json_build_object(
          'result_id',     r.result_id::text,
          'attempt_id',    r.attempt_id::text,
          'test_id',       r.test_id::text,
          'test_name',     mt.title,
          'attempted_on',  a.submitted_at,
          'score',         r.total_score,
          'max_score',     r.max_score,
          'percentage',    r.percentage,
          'accuracy',      case
                             when (r.correct_count + r.wrong_count) > 0
                             then round(
                               (r.correct_count::numeric / (r.correct_count + r.wrong_count)) * 100, 2
                             )
                             else null
                           end,
          'rank',          r.rank,
          'percentile',    r.percentile
        )
        order by a.submitted_at asc
      ),
      '[]'::json
    )
    from public.mock_results r
    join public.mock_attempts a
      on a.attempt_id = r.attempt_id
    join public.mock_tests mt
      on mt.test_id = r.test_id
    where r.student_id = v_student_id
      and r.is_released = true
      and a.submitted_at is not null
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Comments
-- ════════════════════════════════════════════════════════════════════════════

comment on function public.get_student_score_trend() is
  'Returns a JSON array of all released mock test results for the authenticated '
  'student, ordered by attempted_on ASC for direct chart plotting. Each element '
  'contains result_id, attempt_id, test_id, test_name, attempted_on, score, '
  'max_score, percentage, accuracy (reusing the same correct/(correct+wrong) '
  'formula used elsewhere in analytics), rank, and percentile. The student_id '
  'is resolved from the session via get_my_student_id() — the function accepts '
  'no parameters. SECURITY DEFINER ensures RLS bypass for aggregated reads, but '
  'the caller can only see their own data. Consumed by both the Website and the '
  'Mobile App without duplicating business logic.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 038 Student Score Trend RPC
-- ════════════════════════════════════════════════════════════════════════════
