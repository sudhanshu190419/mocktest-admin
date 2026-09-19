-- ============================================================================
-- Migration: 167 - Scheduled Mock Test Result Release Notifications
--
-- PostgreSQL 16 | Supabase Compatible | Production Ready
--
-- Description:
--   Enhances `public.process_scheduled_mock_test_releases()` to atomically
--   generate in-app result release notifications for each student whose
--   scheduled mock test result transitions to is_released = true.
--
-- Guarantees:
--   - Reuses existing notification tables (public.notifications, public.notification_recipients).
--   - Uses canonical event_type 'result_available' and reference_type 'test_result'.
--   - Scoped strictly to the student who owns the attempt.
--   - Idempotent: NOT EXISTS check prevents duplicate notifications if cron re-runs.
--   - Preserves objective-only evaluation and scheduled release logic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_scheduled_mock_test_releases()
RETURNS TABLE (
  tests_processed int,
  results_released bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_results_released bigint := 0;
  v_tests_processed int := 0;
BEGIN
  -- Identify and update unreleased results for tests that meet:
  -- 1. result_release_mode = 'scheduled'
  -- 2. result_release_at IS NOT NULL
  -- 3. result_release_at <= v_now
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
    RETURNING mr.result_id, mr.test_id, mr.student_id, mr.attempt_id, mr.institute_id
  ),
  inserted_notifications AS (
    INSERT INTO public.notifications (
      institute_id,
      title,
      body,
      channel,
      event_type,
      reference_type,
      reference_id,
      total_recipients,
      dispatched_at
    )
    SELECT
      ur.institute_id,
      'Mock Test Result Released',
      'Your result is now available. Check your My Results section.',
      'in_app'::public.notification_channel,
      'result_available'::public.notification_event_type,
      'test_result',
      ur.attempt_id,
      1,
      v_now
    FROM updated_results ur
    JOIN public.student_details sd ON sd.student_id = ur.student_id
    WHERE sd.profile_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.reference_type = 'test_result'
          AND n.reference_id = ur.attempt_id
      )
    RETURNING notification_id, reference_id, institute_id
  ),
  inserted_recipients AS (
    INSERT INTO public.notification_recipients (
      notification_id,
      profile_id,
      institute_id
    )
    SELECT
      in_notif.notification_id,
      sd.profile_id,
      in_notif.institute_id
    FROM inserted_notifications in_notif
    JOIN updated_results ur ON ur.attempt_id = in_notif.reference_id
    JOIN public.student_details sd ON sd.student_id = ur.student_id
    WHERE sd.profile_id IS NOT NULL
    RETURNING recipient_id
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
  'Atomically updates scheduled objective test mock_results to is_released = true and dispatches in-app notifications to test-takers.';

REVOKE ALL ON FUNCTION public.process_scheduled_mock_test_releases() FROM public;

GRANT EXECUTE ON FUNCTION public.process_scheduled_mock_test_releases()
  TO authenticated, service_role, postgres;
