-- ============================================================================
-- Migration: 144 - Guard release_test_results Until All Subjective Evaluations Complete
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Updates:
--   1. RPC function `public.release_test_results(p_test_id UUID)`
--      - Checks whether the test contains any subjective questions.
--      - If subjective questions exist, verifies that NO submitted attempt
--        for that test has `evaluation_status = 'pending'`.
--      - If any pending evaluations exist:
--        RAISES EXCEPTION 'Cannot release results: subjective evaluations are still pending.'
--        (0 rows updated, atomic rollback).
--      - If all subjective evaluations are complete (or test is objective-only):
--        releases all unreleased results atomically.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.release_test_results(p_test_id uuid)
RETURNS TABLE (updated_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_subjective boolean := false;
  v_has_pending boolean := false;
BEGIN
  -- 1. Check if the test contains any subjective questions
  SELECT EXISTS (
    SELECT 1
    FROM public.mock_test_questions mtq
    WHERE mtq.test_id = p_test_id
      AND (
        mtq.question_snapshot->>'questionType' = 'subjective'
        OR mtq.question_snapshot->>'question_type' = 'subjective'
      )
  ) INTO v_has_subjective;

  -- 2. If test contains subjective questions, verify all submitted attempts are evaluated
  IF v_has_subjective THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.mock_answers ma
      JOIN public.mock_attempts att ON att.attempt_id = ma.attempt_id
      WHERE att.test_id = p_test_id
        AND att.status = 'submitted'
        AND ma.evaluation_status = 'pending'
    ) INTO v_has_pending;

    IF v_has_pending THEN
      RAISE EXCEPTION 'Cannot release results: subjective evaluations are still pending.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 3. Release results
  UPDATE public.mock_results
  SET
    is_released = true,
    released_at = now()
  WHERE test_id = p_test_id
    AND is_released = false;

  RETURN QUERY
  SELECT count(*)::bigint AS updated_count
  FROM public.mock_results
  WHERE test_id = p_test_id
    AND is_released = true
    AND released_at IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.release_test_results IS
  'Releases all currently unreleased results for the given test. '
  'Strictly guards subjective tests: raises an exception if any submitted attempt has pending subjective evaluations.';

REVOKE ALL ON FUNCTION public.release_test_results(uuid) FROM public;

GRANT EXECUTE ON FUNCTION public.release_test_results(uuid)
  TO authenticated, service_role, postgres;
