-- ============================================================================
-- Migration: 035 — Mock Test Result Release Workflow
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- RPC Functions:
--   release_test_results(p_test_id UUID)   — Release all unreleased results
--   unrelease_test_results(p_test_id UUID) — Hide all released results
--   get_test_release_status(p_test_id UUID) — Aggregate release summary
--
-- This migration adds NO new tables or columns. It only adds Postgres
-- functions called via supabase.rpc() so that released_at is always set
-- to PostgreSQL now(), never the client clock.
--
-- Depends on: Domain 05 (mock_results table) with CHECK constraints:
--   ck_mock_results_is_released:
--     (is_released = true AND released_at IS NOT NULL)
--     OR (is_released = false AND released_at IS NULL)
--   ck_mock_results_released_at:
--     released_at IS NULL OR released_at >= generated_at
--
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — release_test_results
-- ════════════════════════════════════════════════════════════════════════════
-- Updates every unreleased mock result for the given test_id:
--   is_released := true
--   released_at := now()
--
-- Only affects rows WHERE is_released = false, so the CHECK constraint
-- (ck_mock_results_is_released) and the released_at >= generated_at
-- constraint are both satisfied.
--
-- Returns the number of rows updated.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.release_test_results(p_test_id uuid)
returns table (updated_count bigint)
language plpgsql
as $$
begin
  update public.mock_results
  set
    is_released = true,
    released_at = now()
  where test_id = p_test_id
    and is_released = false;

  return query
  select count(*)::bigint as updated_count
  from public.mock_results
  where test_id = p_test_id
    and is_released = true
    and released_at is not null;
end;
$$;

comment on function public.release_test_results is
  'Releases all currently unreleased results for the given test. Sets '
  'is_released = true and released_at = now(). Returns the count of '
  'rows that were updated.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — unrelease_test_results
-- ════════════════════════════════════════════════════════════════════════════
-- Hides all released results for the given test_id:
--   is_released := false
--   released_at := null
--
-- This satisfies the CHECK constraint because both fields are set together
-- to the "not released" state.
--
-- Returns the number of rows updated.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.unrelease_test_results(p_test_id uuid)
returns table (updated_count bigint)
language plpgsql
as $$
begin
  update public.mock_results
  set
    is_released = false,
    released_at = null
  where test_id = p_test_id
    and is_released = true;

  return query
  select count(*)::bigint as updated_count
  from public.mock_results
  where test_id = p_test_id
    and is_released = false
    and released_at is null;
end;
$$;

comment on function public.unrelease_test_results is
  'Hides all currently released results for the given test. Sets '
  'is_released = false and released_at = null. Returns the count of '
  'rows that were updated.';

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — get_test_release_status
-- ════════════════════════════════════════════════════════════════════════════
-- Returns an aggregate summary of the release state for all mock_results
-- belonging to the given test_id.
--
-- Columns returned:
--   total_results        — Total number of result rows for the test
--   released_results     — Number of results with is_released = true
--   unreleased_results   — Number of results with is_released = false
--   all_released         — TRUE when all results are released
--   earliest_generated   — Min generated_at across results
--   latest_generated     — Max generated_at across results
--   first_released_at    — Min released_at (earliest release timestamp)
--   last_released_at     — Max released_at (latest release timestamp)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_test_release_status(p_test_id uuid)
returns table (
  total_results      bigint,
  released_results   bigint,
  unreleased_results bigint,
  all_released       boolean,
  earliest_generated timestamptz,
  latest_generated   timestamptz,
  first_released_at  timestamptz,
  last_released_at   timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    count(*)::bigint                                           as total_results,
    count(*) filter (where is_released = true)::bigint          as released_results,
    count(*) filter (where is_released = false)::bigint         as unreleased_results,
    bool_and(is_released)                                       as all_released,
    min(generated_at)                                           as earliest_generated,
    max(generated_at)                                           as latest_generated,
    min(released_at)                                            as first_released_at,
    max(released_at)                                            as last_released_at
  from public.mock_results
  where test_id = p_test_id;
end;
$$;

comment on function public.get_test_release_status is
  'Returns an aggregate summary of the release state for all mock results '
  'belonging to the given test. Includes counts, whether all are released, '
  'and date ranges for generated_at and released_at.';

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION — 035 Mock Test Result Release Workflow
-- ════════════════════════════════════════════════════════════════════════════
