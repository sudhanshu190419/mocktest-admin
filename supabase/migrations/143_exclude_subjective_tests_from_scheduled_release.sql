-- ============================================================================
-- Migration: 143 - Exclude Subjective Tests from Scheduled Auto-Release
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Updates:
--   1. RPC function `public.process_scheduled_mock_test_releases()`
--      - Finds all tests where:
--        * result_release_mode = 'scheduled'
--        * result_release_at IS NOT NULL
--        * result_release_at <= now()
--        * NO subjective questions exist in the test (authoritative check against mock_test_questions.question_snapshot)
--      - Atomically updates all unreleased mock_results rows for those objective-only tests
--        to is_released = true, released_at = now()
--      - Excludes any test containing at least one 'subjective' question,
--        requiring manual Admin release for all subjective tests.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_scheduled_mock_test_releases()
RETURNS TABLE (
  tests_processed int,
  results_released bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_results_released bigint := 0;
  v_tests_processed int := 0;
BEGIN
  -- Identify and update unreleased results for tests that meet:
  -- 1. result_release_mode = 'scheduled'
  -- 2. result_release_at IS NOT NULL
  -- 3. result_release_at <= now()
  -- 4. Contains NO subjective questions (mock_test_questions.question_snapshot)
  -- 5. is_released = false

  WITH due_objective_tests AS (
    SELECT mt.test_id
    FROM public.mock_tests mt
    WHERE mt.result_release_mode = 'scheduled'
      AND mt.result_release_at IS NOT NULL
      AND mt.result_release_at <= v_now
      AND NOT EXISTS (
        SELECT 1
        FROM public.mock_test_questions mtq
        WHERE mtq.test_id = mt.test_id
          AND (
            mtq.question_snapshot->>'questionType' = 'subjective'
            OR mtq.question_snapshot->>'question_type' = 'subjective'
          )
      )
  ),
  updated_results AS (
    UPDATE public.mock_results mr
    SET
      is_released = true,
      released_at = v_now
    FROM due_objective_tests dt
    WHERE mr.test_id = dt.test_id
      AND mr.is_released = false
    RETURNING mr.result_id, mr.test_id
  )
  SELECT
    coalesce(count(DISTINCT test_id), 0)::int,
    coalesce(count(*), 0)::bigint
  INTO
    v_tests_processed,
    v_results_released
  FROM updated_results;

  RETURN QUERY SELECT v_tests_processed, v_results_released;
END;
$$;

COMMENT ON FUNCTION public.process_scheduled_mock_test_releases IS
  'Identifies all objective-only mock tests configured for scheduled release where result_release_at <= now(), '
  'and atomically updates all pending mock_results to is_released = true and released_at = now(). '
  'Strictly excludes tests containing subjective questions, which require Admin release.';

REVOKE ALL ON FUNCTION public.process_scheduled_mock_test_releases() FROM public;

GRANT EXECUTE ON FUNCTION public.process_scheduled_mock_test_releases()
  TO authenticated, service_role, postgres;
