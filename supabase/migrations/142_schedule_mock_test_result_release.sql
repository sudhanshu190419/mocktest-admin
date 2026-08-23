-- ============================================================================
-- Migration: 142 — Scheduled Mock Test Result Release
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Adds:
--   1. RPC function `public.process_scheduled_mock_test_releases()`
--      - Finds all tests where result_release_mode = 'scheduled'
--        AND result_release_at IS NOT NULL
--        AND result_release_at <= now()
--      - Atomically updates all unreleased mock_results rows for those tests
--        to is_released = true, released_at = now()
--      - Returns the count of distinct tests processed and results released
--   2. pg_cron job `release-scheduled-mock-tests`
--      - Runs every 1 minute: `* * * * *`
--      - Invokes `select public.process_scheduled_mock_test_releases();`
--
-- Safety Guarantees:
--   - Does NOT release manual tests (result_release_mode = 'manual')
--   - Does NOT release future scheduled tests (result_release_at > now())
--   - Does NOT touch already released results (is_released = true)
--   - Satisfies ck_mock_results_is_released and ck_mock_results_released_at
-- ============================================================================

-- ── SECTION 1 — RPC: process_scheduled_mock_test_releases ───────────────────

create or replace function public.process_scheduled_mock_test_releases()
returns table (
  tests_processed int,
  results_released bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_results_released bigint := 0;
  v_tests_processed int := 0;
begin
  -- Identify and update all unreleased results for tests that meet:
  -- 1. result_release_mode = 'scheduled'
  -- 2. result_release_at IS NOT NULL
  -- 3. result_release_at <= now()
  -- 4. is_released = false
  --
  -- We set released_at = v_now (satisfying ck_mock_results_is_released and
  -- ck_mock_results_released_at >= generated_at because generated_at <= submission_time < now()).

  with due_tests as (
    select test_id
    from public.mock_tests
    where result_release_mode = 'scheduled'
      and result_release_at is not null
      and result_release_at <= v_now
  ),
  updated_results as (
    update public.mock_results mr
    set
      is_released = true,
      released_at = v_now
    from due_tests dt
    where mr.test_id = dt.test_id
      and mr.is_released = false
    returning mr.result_id, mr.test_id
  )
  select
    coalesce(count(distinct test_id), 0)::int,
    coalesce(count(*), 0)::bigint
  into
    v_tests_processed,
    v_results_released
  from updated_results;

  return query select v_tests_processed, v_results_released;
end;
$$;

comment on function public.process_scheduled_mock_test_releases is
  'Identifies all mock tests configured for scheduled release where result_release_at <= now(), '
  'and atomically updates all pending mock_results to is_released = true and released_at = now(). '
  'Returns the count of distinct tests processed and results released.';

-- ── SECTION 2 — Privileges ──────────────────────────────────────────────────

revoke all on function public.process_scheduled_mock_test_releases() from public;

grant execute on function public.process_scheduled_mock_test_releases()
  to authenticated, service_role, postgres;

-- ── SECTION 3 — pg_cron Registration ────────────────────────────────────────

create extension if not exists pg_cron;

do $migration$
begin
  -- Unschedule previous instance of this cron job if it already exists
  if exists (select 1 from cron.job where jobname = 'release-scheduled-mock-tests') then
    perform cron.unschedule('release-scheduled-mock-tests');
  end if;

  -- Schedule the release sweep to run every 1 minute UTC
  perform cron.schedule(
    'release-scheduled-mock-tests',
    '* * * * *',
    'select public.process_scheduled_mock_test_releases();'
  );

  raise notice 'CRON_JOB_SCHEDULED: job=release-scheduled-mock-tests schedule=* * * * * (1 minute)';
end
$migration$;
