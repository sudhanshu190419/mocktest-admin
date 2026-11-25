-- ============================================================================
-- Migration 254: Exam Result Email Notifications Infrastructure (Phase 5: EXM-01)
-- Choice 1: Strict First-Only Policy & Reservation Integrity Architecture
--
-- Implements Phase 5 transactional email notification infrastructure:
-- 1. Attempt-Level Dispatch Reservation Ledger Table:
--    - public.mock_result_email_dispatches
--    - Keyed by unique attempt_id (PRIMARY KEY) ensuring strict single-dispatch entitlement.
--    - Tracks explicit provider_outcome: 'not_dispatched', 'definitively_rejected',
--      'outcome_unknown', 'provider_accepted'.
--    - Tracks lifecycle status: 'reserved', 'consumed', 'blocked'.
-- 2. Dispatch Reservation RPCs:
--    - public.acquire_mock_result_dispatch_reservation()
--      * Atomically verifies authoritative result state on public.mock_results AND
--        acquires dispatch reservation within a single database transaction.
--      * First-insert concurrency protection via INSERT ... ON CONFLICT DO NOTHING
--        with row-level lock (FOR UPDATE) resolution.
--      * Fails closed with FIRST_NOTIFICATION_ALREADY_CONSUMED if already accepted/sent.
--      * Blocks transfer with PROVIDER_OUTCOME_UNKNOWN_BLOCKED if prior outcome is unknown.
--      * Safely transfers reservation ONLY when prior outcome was not_dispatched or
--        definitively_rejected and prior job was cancelled or failed.
--    - public.consume_mock_result_dispatch_reservation()
--      * Permanently consumes entitlement upon provider acceptance.
--    - public.release_mock_result_dispatch_reservation()
--      * Safely releases pre-dispatch reservation ONLY if outcome was not_dispatched or
--        definitively_rejected. Never deletes consumed, blocked, or unknown records.
--    - public.update_mock_result_provider_outcome()
--      * Records provider outcome classification and optional blocked status.
--    - public.record_mock_result_email_success()
--      * Atomic single transaction updating email_queue, delivery logs, and reservation ledger.
-- 3. Helper RPC: public.check_mock_result_release_eligibility()
--    - Performs database-side pre-dispatch verification with full microsecond precision.
--    - Enforces Choice 1 First-Only rule: rejects if consumed, blocked, or sent.
-- 4. Trigger function: public.handle_mock_result_released()
--    - Strict First-Only suppression: skips immediately if attempt consumed, blocked, or sent.
--    - Generation-aware duplicate suppression for identical release timestamp.
--    - Cancels obsolete pending jobs for older superseded release generations.
--    - Authoritatively resolves recipient student profile, test metadata, and attempt info.
--    - Enqueues EXM-01 job via public.enqueue_email_job inside an isolated exception block.
-- 5. Database trigger: trg_mock_results_official_release on public.mock_results
--    - Fires AFTER UPDATE OF is_released ON public.mock_results
--    - Condition: WHEN (OLD.is_released IS FALSE AND NEW.is_released IS TRUE)
--
-- Security:
--   - SECURITY DEFINER with fixed search_path = public, pg_temp.
--   - All table and function references strictly schema-qualified.
--   - Owned by postgres.
--   - EXECUTE revoked from public, anon, and authenticated; granted strictly to service_role.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Attempt-Level Dispatch Reservation Ledger Table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mock_result_email_dispatches (
    attempt_id                  uuid PRIMARY KEY,
    test_id                     uuid NOT NULL,
    reserved_by_queue_id        uuid NOT NULL,
    release_generation          text NOT NULL,
    status                      text NOT NULL DEFAULT 'reserved',
    provider_outcome            text NOT NULL DEFAULT 'not_dispatched',
    reserved_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    provider_request_started_at timestamptz NULL,
    dispatched_at               timestamptz NULL,
    consumed_at                 timestamptz NULL,
    provider_message_id         text NULL,
    last_error                  text NULL,
    reconciled_at               timestamptz NULL,
    reconciled_by               text NULL,
    reconciliation_reason       text NULL,
    created_at                  timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                  timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_mock_result_email_dispatches_status CHECK (status IN ('reserved', 'consumed', 'blocked')),
    CONSTRAINT ck_mock_result_email_dispatches_outcome CHECK (provider_outcome IN ('not_dispatched', 'definitively_rejected', 'outcome_unknown', 'provider_accepted'))
);

ALTER TABLE public.mock_result_email_dispatches ADD COLUMN IF NOT EXISTS reconciled_at timestamptz NULL;
ALTER TABLE public.mock_result_email_dispatches ADD COLUMN IF NOT EXISTS reconciled_by text NULL;
ALTER TABLE public.mock_result_email_dispatches ADD COLUMN IF NOT EXISTS reconciliation_reason text NULL;

COMMENT ON TABLE public.mock_result_email_dispatches IS
    'Durable attempt-level dispatch ledger enforcing Choice 1: at most one EXM-01 notification accepted by Resend per attempt lifetime with durable provider-outcome tracking.';

ALTER TABLE public.mock_result_email_dispatches OWNER TO postgres;
ALTER TABLE public.mock_result_email_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mock_result_email_dispatches FROM public, anon, authenticated;
GRANT ALL ON TABLE public.mock_result_email_dispatches TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: Dispatch Reservation RPCs
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.acquire_mock_result_dispatch_reservation(
    p_attempt_id uuid,
    p_test_id uuid,
    p_queue_id uuid,
    p_release_generation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing        public.mock_result_email_dispatches%ROWTYPE;
    v_reserver_job    public.email_queue%ROWTYPE;
    v_mr              public.mock_results%ROWTYPE;
    v_iso_released_at text;
    v_consumed        boolean;
BEGIN
    -- 1. Validate mandatory inputs
    IF p_attempt_id IS NULL OR p_test_id IS NULL OR p_queue_id IS NULL OR p_release_generation IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'INVALID_ARGUMENTS',
            'is_transient', false
        );
    END IF;

    -- Strict format check: queued release identity must have complete canonical UTC format with 6 fractional digits
    IF p_release_generation !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'INVALID_RELEASE_GENERATION_FORMAT',
            'is_transient', false
        );
    END IF;

    -- 2. Authoritative Result Publication Verification (Atomic verification with row lock)
    -- Lock order rule: ALWAYS lock mock_results (attempt_id) FIRST, then mock_result_email_dispatches (attempt_id)
    SELECT * INTO v_mr
    FROM public.mock_results
    WHERE attempt_id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'TEST_RESULT_NOT_FOUND',
            'is_transient', false
        );
    END IF;

    IF v_mr.test_id IS DISTINCT FROM p_test_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'TEST_RESULT_TEST_ID_MISMATCH',
            'is_transient', false
        );
    END IF;

    IF v_mr.is_released IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'TEST_RESULT_UNRELEASED',
            'is_transient', false
        );
    END IF;

    IF v_mr.released_at IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'TEST_RESULT_DATABASE_RELEASED_AT_NULL',
            'is_transient', false
        );
    END IF;

    -- Exact microsecond timestamp match verification (authoritative DB formatted with six fractional digits)
    v_iso_released_at := to_char(v_mr.released_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    IF v_iso_released_at != p_release_generation THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'TEST_RESULT_RELEASE_SUPERSEDED',
            'is_transient', false
        );
    END IF;

    -- 3. Strict First-Only Check: Has any notification already been consumed or marked sent?
    SELECT EXISTS (
        SELECT 1
        FROM public.mock_result_email_dispatches
        WHERE attempt_id = p_attempt_id
          AND status = 'consumed'
    ) OR EXISTS (
        SELECT 1
        FROM public.email_queue
        WHERE payload->>'attemptId' = p_attempt_id::text
          AND event_type = 'EXM-01'
          AND status = 'sent'
    ) INTO v_consumed;

    IF v_consumed THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'FIRST_NOTIFICATION_ALREADY_CONSUMED',
            'is_transient', false
        );
    END IF;

    -- 4. Inspect existing attempt-level dispatch ledger record (row-level lock for serialization)
    SELECT * INTO v_existing
    FROM public.mock_result_email_dispatches
    WHERE attempt_id = p_attempt_id
    FOR UPDATE;

    IF FOUND THEN
        -- Case A: Entitlement has already been permanently consumed
        IF v_existing.status = 'consumed' THEN
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'FIRST_NOTIFICATION_ALREADY_CONSUMED',
                'is_transient', false,
                'consumed_at', v_existing.consumed_at,
                'provider_message_id', v_existing.provider_message_id
            );
        END IF;

        -- Case B: Blocked state due to ambiguous outcome or manual reconciliation required
        IF v_existing.status = 'blocked' OR v_existing.provider_outcome = 'outcome_unknown' THEN
            -- If it's the SAME queue job retrying within allowed window, verify 23h safe idempotency window
            IF v_existing.reserved_by_queue_id = p_queue_id AND v_existing.status != 'blocked' THEN
                IF v_existing.provider_request_started_at IS NOT NULL AND
                   clock_timestamp() - v_existing.provider_request_started_at > INTERVAL '23 hours' THEN
                    UPDATE public.mock_result_email_dispatches
                    SET status = 'blocked',
                        last_error = 'IDEMPOTENCY_WINDOW_EXPIRED_MANUAL_RECONCILIATION_REQUIRED',
                        updated_at = clock_timestamp()
                    WHERE attempt_id = p_attempt_id;

                    RETURN jsonb_build_object(
                        'success', false,
                        'reason', 'IDEMPOTENCY_WINDOW_EXPIRED_MANUAL_RECONCILIATION_REQUIRED',
                        'is_transient', false,
                        'provider_request_started_at', to_char(v_existing.provider_request_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                    );
                END IF;

                UPDATE public.mock_result_email_dispatches
                SET updated_at = clock_timestamp()
                WHERE attempt_id = p_attempt_id;

                RETURN jsonb_build_object(
                    'success', true,
                    'reason', 'RESERVATION_RENEWED_AMBIGUOUS_RETRY',
                    'provider_request_started_at', to_char(v_existing.provider_request_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                );
            ELSE
                -- Different queue job or blocked: DO NOT allow newer generation to dispatch!
                RETURN jsonb_build_object(
                    'success', false,
                    'reason', 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED',
                    'is_transient', false,
                    'reserved_by_queue_id', v_existing.reserved_by_queue_id
                );
            END IF;
        END IF;

        -- Case C: Existing reservation is held by the SAME queue job (safe retry / idempotency)
        IF v_existing.reserved_by_queue_id = p_queue_id THEN
            IF v_existing.release_generation = p_release_generation THEN
                UPDATE public.mock_result_email_dispatches
                SET updated_at = clock_timestamp()
                WHERE attempt_id = p_attempt_id;

                RETURN jsonb_build_object(
                    'success', true,
                    'reason', 'RESERVATION_RENEWED',
                    'provider_request_started_at', to_char(v_existing.provider_request_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                );
            ELSE
                RETURN jsonb_build_object(
                    'success', false,
                    'reason', 'TEST_RESULT_RELEASE_SUPERSEDED',
                    'is_transient', false
                );
            END IF;
        END IF;

        -- Case D: Existing reservation is held by a DIFFERENT queue job
        SELECT * INTO v_reserver_job
        FROM public.email_queue
        WHERE queue_id = v_existing.reserved_by_queue_id;

        -- If the reserver job has been marked sent, confirm consumption
        IF v_reserver_job.status = 'sent' THEN
            UPDATE public.mock_result_email_dispatches
            SET status = 'consumed',
                provider_outcome = 'provider_accepted',
                consumed_at = COALESCE(v_reserver_job.sent_at, clock_timestamp()),
                provider_message_id = v_reserver_job.provider_message_id,
                updated_at = clock_timestamp()
            WHERE attempt_id = p_attempt_id;

            RETURN jsonb_build_object(
                'success', false,
                'reason', 'FIRST_NOTIFICATION_ALREADY_CONSUMED',
                'is_transient', false
            );
        END IF;

        -- CAN WE TRANSFER THE RESERVATION TO THE NEW JOB?
        -- ONLY if the provider outcome is demonstrably safe:
        -- 1. Provider request was never started ('not_dispatched'), or
        -- 2. Provider definitively rejected the request before acceptance ('definitively_rejected').
        -- AND the reserver job is in 'cancelled' or 'failed' (or missing from queue).
        IF v_existing.provider_outcome IN ('not_dispatched', 'definitively_rejected') AND
           (v_reserver_job.status IN ('cancelled', 'failed') OR NOT FOUND) THEN
            UPDATE public.mock_result_email_dispatches
            SET test_id = p_test_id,
                reserved_by_queue_id = p_queue_id,
                release_generation = p_release_generation,
                status = 'reserved',
                provider_outcome = 'not_dispatched',
                provider_request_started_at = NULL,
                reserved_at = clock_timestamp(),
                last_error = NULL,
                updated_at = clock_timestamp()
            WHERE attempt_id = p_attempt_id;

            RETURN jsonb_build_object(
                'success', true,
                'reason', 'RESERVATION_ACQUIRED_FROM_CANCELLED'
            );
        END IF;

        -- If provider outcome is unknown: BLOCK transfer permanently
        IF v_existing.provider_outcome = 'outcome_unknown' THEN
            RETURN jsonb_build_object(
                'success', false,
                'reason', 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED',
                'is_transient', false,
                'reserved_by_queue_id', v_existing.reserved_by_queue_id
            );
        END IF;

        -- Otherwise, reserver job is still actively 'processing' or 'pending'
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'CONCURRENT_DISPATCH_IN_PROGRESS',
            'is_transient', true,
            'reserved_by_queue_id', v_existing.reserved_by_queue_id
        );
    END IF;

    -- 5. No reservation exists yet for this attempt.
    -- First-insert concurrency protection: INSERT ... ON CONFLICT (attempt_id) DO NOTHING
    INSERT INTO public.mock_result_email_dispatches (
        attempt_id,
        test_id,
        reserved_by_queue_id,
        release_generation,
        status,
        provider_outcome,
        reserved_at,
        created_at,
        updated_at
    ) VALUES (
        p_attempt_id,
        p_test_id,
        p_queue_id,
        p_release_generation,
        'reserved',
        'not_dispatched',
        clock_timestamp(),
        clock_timestamp(),
        clock_timestamp()
    )
    ON CONFLICT (attempt_id) DO NOTHING;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'reason', 'RESERVATION_ACQUIRED'
        );
    END IF;

    -- If insert lost race to a concurrent worker, lock the newly inserted row FOR UPDATE
    SELECT * INTO v_existing
    FROM public.mock_result_email_dispatches
    WHERE attempt_id = p_attempt_id
    FOR UPDATE;

    IF v_existing.status = 'consumed' THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'FIRST_NOTIFICATION_ALREADY_CONSUMED',
            'is_transient', false
        );
    ELSIF v_existing.reserved_by_queue_id = p_queue_id THEN
        RETURN jsonb_build_object(
            'success', true,
            'reason', 'RESERVATION_OWNED'
        );
    ELSIF v_existing.provider_outcome = 'outcome_unknown' OR v_existing.status = 'blocked' THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'PROVIDER_OUTCOME_UNKNOWN_BLOCKED',
            'is_transient', false
        );
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'CONCURRENT_DISPATCH_IN_PROGRESS',
            'is_transient', true,
            'reserved_by_queue_id', v_existing.reserved_by_queue_id
        );
    END IF;
END;
$$;

COMMENT ON FUNCTION public.acquire_mock_result_dispatch_reservation(uuid, uuid, uuid, text) IS
    'Atomically verifies result publication state and acquires an attempt-level dispatch reservation before provider call, preventing concurrent release races.';

ALTER FUNCTION public.acquire_mock_result_dispatch_reservation(uuid, uuid, uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.acquire_mock_result_dispatch_reservation(uuid, uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_mock_result_dispatch_reservation(uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_mock_result_dispatch_reservation(
    p_attempt_id uuid,
    p_queue_id uuid,
    p_provider_message_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.mock_result_email_dispatches
    SET status = 'consumed',
        provider_outcome = 'provider_accepted',
        consumed_at = clock_timestamp(),
        provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
        updated_at = clock_timestamp()
    WHERE attempt_id = p_attempt_id
      AND reserved_by_queue_id = p_queue_id;

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.consume_mock_result_dispatch_reservation(uuid, uuid, text) IS
    'Permanently consumes an attempt-level dispatch reservation upon successful Resend provider acceptance.';

ALTER FUNCTION public.consume_mock_result_dispatch_reservation(uuid, uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.consume_mock_result_dispatch_reservation(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mock_result_dispatch_reservation(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_mock_result_dispatch_reservation(
    p_attempt_id uuid,
    p_queue_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Only delete active reservations if provider outcome was NOT dispatched or definitively rejected
    -- AND status is NOT consumed and NOT blocked!
    DELETE FROM public.mock_result_email_dispatches
    WHERE attempt_id = p_attempt_id
      AND reserved_by_queue_id = p_queue_id
      AND status = 'reserved'
      AND provider_outcome IN ('not_dispatched', 'definitively_rejected');

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_mock_result_dispatch_reservation(uuid, uuid, text) IS
    'Safely releases an unconsumed dispatch reservation ONLY if the request was never dispatched or definitively rejected.';

ALTER FUNCTION public.release_mock_result_dispatch_reservation(uuid, uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.release_mock_result_dispatch_reservation(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_mock_result_dispatch_reservation(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.update_mock_result_provider_outcome(
    p_attempt_id uuid,
    p_queue_id uuid,
    p_provider_outcome text,
    p_error text DEFAULT NULL,
    p_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rows integer;
BEGIN
    UPDATE public.mock_result_email_dispatches
    SET provider_outcome = CASE
            -- Monotonicity rule: Once a provider outcome is 'outcome_unknown',
            -- it CANNOT be downgraded to 'definitively_rejected' or 'not_dispatched' via worker update.
            -- A later HTTP rejection on a retry does NOT prove the original ambiguous request was never accepted!
            WHEN provider_outcome = 'outcome_unknown' AND p_provider_outcome = 'definitively_rejected' THEN 'outcome_unknown'
            ELSE p_provider_outcome
        END,
        status = CASE
            -- If an attempt is made to mark definitively_rejected when outcome was outcome_unknown,
            -- force status to 'blocked' to guarantee reservation is preserved and requires manual audit.
            WHEN provider_outcome = 'outcome_unknown' AND p_provider_outcome = 'definitively_rejected' THEN 'blocked'
            ELSE COALESCE(p_status, status)
        END,
        last_error = p_error,
        provider_request_started_at = COALESCE(provider_request_started_at, clock_timestamp()),
        dispatched_at = CASE
            WHEN dispatched_at IS NULL AND p_provider_outcome IN ('outcome_unknown', 'provider_accepted') THEN clock_timestamp()
            ELSE dispatched_at
        END,
        updated_at = clock_timestamp()
    WHERE attempt_id = p_attempt_id
      AND reserved_by_queue_id = p_queue_id
      AND status != 'consumed';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.update_mock_result_provider_outcome(uuid, uuid, text, text, text) IS
    'Updates provider outcome classification, sets durable immutable provider_request_started_at, and optional blocked status for an attempt reservation.';

ALTER FUNCTION public.update_mock_result_provider_outcome(uuid, uuid, text, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.update_mock_result_provider_outcome(uuid, uuid, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_mock_result_provider_outcome(uuid, uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_mock_result_email_success(
    p_queue_id uuid,
    p_attempt_id uuid,
    p_provider_message_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_queue_job   public.email_queue%ROWTYPE;
    v_disp        public.mock_result_email_dispatches%ROWTYPE;
    v_rows        integer;
BEGIN
    -- 1. Validate mandatory inputs
    IF p_queue_id IS NULL OR p_attempt_id IS NULL OR p_provider_message_id IS NULL OR trim(p_provider_message_id) = '' THEN
        RAISE WARNING 'record_mock_result_email_success: invalid arguments (queue_id=%, attempt_id=%, msg_id=%)',
            p_queue_id, p_attempt_id, p_provider_message_id;
        RETURN false;
    END IF;

    -- 2. Lock matching reservation in mock_result_email_dispatches (Level 2 in lock hierarchy)
    SELECT * INTO v_disp
    FROM public.mock_result_email_dispatches
    WHERE attempt_id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE WARNING 'record_mock_result_email_success: dispatch reservation for attempt % not found', p_attempt_id;
        RETURN false;
    END IF;

    -- 3. Lock queue row in email_queue (Level 3 in lock hierarchy)
    SELECT * INTO v_queue_job
    FROM public.email_queue
    WHERE queue_id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE WARNING 'record_mock_result_email_success: queue job % not found', p_queue_id;
        RETURN false;
    END IF;

    -- 4. Verify event_type is EXM-01
    IF v_queue_job.event_type != 'EXM-01' THEN
        RAISE WARNING 'record_mock_result_email_success: queue job % is not EXM-01 (found %)', p_queue_id, v_queue_job.event_type;
        RETURN false;
    END IF;

    -- 5. Verify payload attemptId matches p_attempt_id
    IF (v_queue_job.payload->>'attemptId')::uuid IS DISTINCT FROM p_attempt_id THEN
        RAISE WARNING 'record_mock_result_email_success: payload attemptId % does not match p_attempt_id %',
            v_queue_job.payload->>'attemptId', p_attempt_id;
        RETURN false;
    END IF;

    -- 6. Idempotency Check: if already sent and consumed with matching parameters, succeed without duplicate log
    IF v_queue_job.status = 'sent' AND
       v_queue_job.provider_message_id = p_provider_message_id AND
       v_disp.status = 'consumed' AND
       v_disp.reserved_by_queue_id = p_queue_id AND
       v_disp.provider_outcome = 'provider_accepted' AND
       v_disp.provider_message_id = p_provider_message_id THEN
        RETURN true;
    END IF;

    -- 7. Verify reservation ownership
    IF v_disp.reserved_by_queue_id IS DISTINCT FROM p_queue_id THEN
        RAISE WARNING 'record_mock_result_email_success: attempt % is reserved by queue % not caller %',
            p_attempt_id, v_disp.reserved_by_queue_id, p_queue_id;
        RETURN false;
    END IF;

    -- 8. Verify reservation status
    IF v_disp.status NOT IN ('reserved', 'blocked') THEN
        RAISE WARNING 'record_mock_result_email_success: reservation for attempt % is in unexpected status %',
            p_attempt_id, v_disp.status;
        RETURN false;
    END IF;

    -- 9. Mark email_queue row as sent
    UPDATE public.email_queue
    SET status = 'sent',
        delivery_status = 'accepted',
        sent_at = COALESCE(sent_at, clock_timestamp()),
        provider_message_id = p_provider_message_id,
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE queue_id = p_queue_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN false;
    END IF;

    -- 10. Insert provider delivery log (idempotently: avoid duplicate logs for same queue_id and provider_message_id)
    INSERT INTO public.email_delivery_logs (
        queue_id,
        provider,
        event_type,
        provider_message_id,
        payload
    )
    SELECT
        p_queue_id,
        'resend',
        'sent',
        p_provider_message_id,
        jsonb_build_object('success', true, 'recorded_at', clock_timestamp())
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.email_delivery_logs
        WHERE queue_id = p_queue_id
          AND provider_message_id = p_provider_message_id
          AND event_type = 'sent'
    );

    -- 11. Mark reservation ledger as consumed in the same atomic transaction
    UPDATE public.mock_result_email_dispatches
    SET status = 'consumed',
        provider_outcome = 'provider_accepted',
        consumed_at = clock_timestamp(),
        provider_message_id = p_provider_message_id,
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE attempt_id = p_attempt_id
      AND reserved_by_queue_id = p_queue_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.record_mock_result_email_success(uuid, uuid, text) IS
    'Atomically marks the queue job sent and the attempt reservation consumed in a single transaction adhering strictly to the global lock hierarchy (Level 2 then Level 3).';

ALTER FUNCTION public.record_mock_result_email_success(uuid, uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.record_mock_result_email_success(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mock_result_email_success(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_mock_result_dispatch_reservation(
    p_attempt_id uuid,
    p_operator text,
    p_evidence_ref text,
    p_action text,
    p_provider_message_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_disp         public.mock_result_email_dispatches%ROWTYPE;
    v_prev_outcome text;
    v_new_outcome  text;
    v_now          timestamptz := clock_timestamp();
BEGIN
    -- 1. Validate mandatory parameters
    IF p_attempt_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'reason', 'MISSING_ATTEMPT_ID');
    END IF;
    IF p_operator IS NULL OR trim(p_operator) = '' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'MISSING_OPERATOR_IDENTITY');
    END IF;
    IF p_evidence_ref IS NULL OR length(trim(p_evidence_ref)) < 10 THEN
        RETURN jsonb_build_object('success', false, 'reason', 'INVALID_EVIDENCE_REFERENCE');
    END IF;
    IF p_action NOT IN ('unblock_and_reset', 'mark_consumed') THEN
        RETURN jsonb_build_object('success', false, 'reason', 'INVALID_ACTION');
    END IF;

    -- 2. Lock reservation record (Level 2 in lock hierarchy)
    SELECT * INTO v_disp
    FROM public.mock_result_email_dispatches
    WHERE attempt_id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'RESERVATION_NOT_FOUND');
    END IF;

    -- 3. Forbid reopening consumed reservations under any circumstances
    IF v_disp.status = 'consumed' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'CANNOT_REOPEN_CONSUMED_RESERVATION');
    END IF;

    -- 4. Require blocked status for manual operator reconciliation
    IF v_disp.status != 'blocked' THEN
        RETURN jsonb_build_object('success', false, 'reason', 'RESERVATION_NOT_BLOCKED');
    END IF;

    v_prev_outcome := v_disp.provider_outcome;

    -- 5. Perform reconciliation based on verified administrative evidence
    IF p_action = 'unblock_and_reset' THEN
        -- Operator verified provider definitively NEVER received or accepted the message
        v_new_outcome := 'not_dispatched';

        UPDATE public.mock_result_email_dispatches
        SET status = 'reserved',
            provider_outcome = v_new_outcome,
            provider_request_started_at = NULL,
            reconciled_at = v_now,
            reconciled_by = p_operator,
            reconciliation_reason = p_evidence_ref,
            last_error = 'RECONCILED [unblock_and_reset] by ' || p_operator || ': ' || p_evidence_ref,
            updated_at = v_now
        WHERE attempt_id = p_attempt_id;

    ELSIF p_action = 'mark_consumed' THEN
        -- Operator verified provider DID accept and deliver the message
        IF p_provider_message_id IS NULL OR trim(p_provider_message_id) = '' THEN
            RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVIDER_MESSAGE_ID');
        END IF;

        v_new_outcome := 'provider_accepted';

        UPDATE public.mock_result_email_dispatches
        SET status = 'consumed',
            provider_outcome = v_new_outcome,
            consumed_at = v_now,
            provider_message_id = p_provider_message_id,
            reconciled_at = v_now,
            reconciled_by = p_operator,
            reconciliation_reason = p_evidence_ref,
            last_error = 'RECONCILED [mark_consumed] by ' || p_operator || ': ' || p_evidence_ref,
            updated_at = v_now
        WHERE attempt_id = p_attempt_id;
    END IF;

    -- 6. Insert audit trail into email_delivery_logs (Level 4 in lock hierarchy)
    INSERT INTO public.email_delivery_logs (
        queue_id,
        provider,
        event_type,
        provider_message_id,
        payload
    ) VALUES (
        v_disp.reserved_by_queue_id,
        'manual_reconciliation',
        'reconciled_' || p_action,
        p_provider_message_id,
        jsonb_build_object(
            'attempt_id', p_attempt_id,
            'queue_id', v_disp.reserved_by_queue_id,
            'previous_provider_outcome', v_prev_outcome,
            'new_provider_outcome', v_new_outcome,
            'operator', p_operator,
            'evidence_reference', p_evidence_ref,
            'action', p_action,
            'reconciled_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'action', p_action,
        'attempt_id', p_attempt_id,
        'queue_id', v_disp.reserved_by_queue_id,
        'previous_provider_outcome', v_prev_outcome,
        'new_provider_outcome', v_new_outcome,
        'operator', p_operator,
        'evidence_reference', p_evidence_ref,
        'reconciled_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
END;
$$;

COMMENT ON FUNCTION public.reconcile_mock_result_dispatch_reservation(uuid, text, text, text, text) IS
    'Privileged operator reconciliation RPC for blocked EXM-01 reservations. Requires verified provider audit evidence and forbids reopening consumed reservations.';

ALTER FUNCTION public.reconcile_mock_result_dispatch_reservation(uuid, text, text, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reconcile_mock_result_dispatch_reservation(uuid, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_mock_result_dispatch_reservation(uuid, text, text, text, text) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Pre-Dispatch Release Eligibility RPC
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_mock_result_release_eligibility(
    p_attempt_id uuid,
    p_test_id uuid,
    p_queued_released_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_released boolean;
    v_released_at timestamptz;
    v_test_id     uuid;
    v_consumed    boolean;
BEGIN
    -- 1. Validate mandatory inputs
    IF p_attempt_id IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_MISSING_ATTEMPT_ID');
    END IF;
    IF p_test_id IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_MISSING_TEST_ID');
    END IF;
    IF p_queued_released_at IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_MISSING_RELEASED_AT');
    END IF;

    -- 2. Choice 1: Check if an EXM-01 notification for this attempt has already been consumed or blocked
    SELECT EXISTS (
        SELECT 1
        FROM public.mock_result_email_dispatches
        WHERE attempt_id = p_attempt_id
          AND (status = 'consumed' OR status = 'blocked' OR provider_outcome = 'outcome_unknown')
    ) OR EXISTS (
        SELECT 1
        FROM public.email_queue
        WHERE payload->>'attemptId' = p_attempt_id::text
          AND event_type = 'EXM-01'
          AND status = 'sent'
    ) INTO v_consumed;

    IF v_consumed THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'FIRST_NOTIFICATION_ALREADY_CONSUMED');
    END IF;

    -- 3. Query result record by attempt_id
    SELECT mr.is_released, mr.released_at, mr.test_id
    INTO v_is_released, v_released_at, v_test_id
    FROM public.mock_results mr
    WHERE mr.attempt_id = p_attempt_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_NOT_FOUND');
    END IF;

    -- 4. Verify test_id match
    IF v_test_id IS DISTINCT FROM p_test_id THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_TEST_ID_MISMATCH');
    END IF;

    -- 5. Verify publication state
    IF v_is_released IS NOT TRUE THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_UNRELEASED');
    END IF;

    -- 6. Verify database released_at exists
    IF v_released_at IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_DATABASE_RELEASED_AT_NULL');
    END IF;

    -- 7. Exact PostgreSQL microsecond timestamp comparison
    IF v_released_at != p_queued_released_at THEN
        RETURN jsonb_build_object('eligible', false, 'cancel_reason', 'TEST_RESULT_RELEASE_SUPERSEDED');
    END IF;

    RETURN jsonb_build_object('eligible', true);
END;
$$;

COMMENT ON FUNCTION public.check_mock_result_release_eligibility(uuid, uuid, timestamptz) IS
    'Performs exact, database-side pre-dispatch verification of official mock test result publication state with full microsecond precision and Choice 1 First-Only enforcement.';

ALTER FUNCTION public.check_mock_result_release_eligibility(uuid, uuid, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.check_mock_result_release_eligibility(uuid, uuid, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_mock_result_release_eligibility(uuid, uuid, timestamptz) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: Trigger Function: handle_mock_result_released
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_mock_result_released()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_effective_released_at timestamptz;
    v_iso_released_at       text;
    v_idempotency_key       text;
    v_recipient_email       text;
    v_recipient_name        text;
    v_profile_id            uuid;
    v_test_title            text;
    v_total_marks           integer;
    v_attempt_number        integer;
    v_results_url           text;
    v_payload               jsonb;
    v_enqueue_result        jsonb;
BEGIN
    -- 1. Choice 1: Strict First-Only Policy Enforcement:
    -- If an EXM-01 notification for this attempt has already been consumed or blocked,
    -- permanently suppress all future emails for this attempt.
    IF EXISTS (
        SELECT 1
        FROM public.mock_result_email_dispatches
        WHERE attempt_id = NEW.attempt_id
          AND (status = 'consumed' OR status = 'blocked' OR provider_outcome = 'outcome_unknown')
    ) OR EXISTS (
        SELECT 1
        FROM public.email_queue
        WHERE payload->>'attemptId' = NEW.attempt_id::text
          AND event_type = 'EXM-01'
          AND status = 'sent'
    ) THEN
        RETURN NEW;
    END IF;

    -- 2. Establish effective release timestamp with microsecond UTC precision.
    -- In AFTER triggers NEW is read-only, so establish local variable.
    v_effective_released_at := COALESCE(NEW.released_at, clock_timestamp());
    v_iso_released_at := to_char(v_effective_released_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    v_idempotency_key := 'exm_res:' || NEW.attempt_id::text || ':' || to_char(v_effective_released_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US"Z"');

    -- 3. Duplicate suppression for identical release generation:
    -- If a notification for the SAME release generation (matching released_at) is already
    -- actively processing or pending in the queue, suppress duplicate trigger execution.
    IF EXISTS (
        SELECT 1
        FROM public.email_queue
        WHERE payload->>'attemptId' = NEW.attempt_id::text
          AND event_type = 'EXM-01'
          AND status IN ('processing', 'pending')
          AND payload->>'releasedAt' = v_iso_released_at
    ) THEN
        RETURN NEW;
    END IF;

    -- 4. Clean up any stale prior-generation jobs that are still pending in the queue (never claimed by worker)
    UPDATE public.email_queue
    SET status = 'cancelled',
        last_error = 'TEST_RESULT_RELEASE_SUPERSEDED',
        updated_at = clock_timestamp()
    WHERE payload->>'attemptId' = NEW.attempt_id::text
      AND event_type = 'EXM-01'
      AND status = 'pending'
      AND payload->>'releasedAt' != v_iso_released_at;

    -- 5. Resolve student profile and mock test metadata via authoritative joins
    SELECT
        p.profile_id,
        p.email,
        COALESCE(nullif(trim(p.name), ''), 'Student'),
        COALESCE(nullif(trim(mt.title), ''), 'Mock Test'),
        COALESCE(mt.total_marks, NEW.max_score::integer, 0),
        COALESCE(ma.attempt_number, 1)
    INTO
        v_profile_id,
        v_recipient_email,
        v_recipient_name,
        v_test_title,
        v_total_marks,
        v_attempt_number
    FROM public.mock_attempts ma
    JOIN public.student_details sd ON sd.student_id = ma.student_id
    JOIN public.profiles p ON p.profile_id = sd.profile_id
    JOIN public.mock_tests mt ON mt.test_id = NEW.test_id
    WHERE ma.attempt_id = NEW.attempt_id;

    -- If no matching attempt or profile found, log warning and exit cleanly
    IF v_profile_id IS NULL THEN
        RAISE WARNING 'handle_mock_result_released: Attempt % or student profile not found', NEW.attempt_id;
        RETURN NEW;
    END IF;

    -- 6. Validate recipient email syntax minimally
    v_recipient_email := lower(trim(COALESCE(v_recipient_email, '')));
    IF length(v_recipient_email) = 0 OR position('@' in v_recipient_email) = 0 THEN
        RAISE WARNING 'handle_mock_result_released: No valid recipient email found for attempt % (profile %)', NEW.attempt_id, v_profile_id;
        RETURN NEW;
    END IF;

    -- 7. Construct student scorecard URL and canonical payload
    v_results_url := 'https://makemetopper.com/student/tests/' || NEW.test_id::text || '/results/' || NEW.attempt_id::text;

    v_payload := jsonb_build_object(
        'attemptId',        NEW.attempt_id::text,
        'testId',           NEW.test_id::text,
        'studentId',        NEW.student_id::text,
        'testTitle',        v_test_title,
        'score',            NEW.total_score,
        'totalScore',       NEW.total_score,
        'maxScore',         NEW.max_score,
        'totalMarks',       v_total_marks,
        'percentage',       NEW.percentage,
        'rank',             NEW.rank,
        'percentile',       NEW.percentile,
        'correctCount',     NEW.correct_count,
        'wrongCount',       NEW.wrong_count,
        'incorrectCount',   NEW.wrong_count,
        'skippedCount',     NEW.skipped_count,
        'totalTimeSeconds', NEW.total_time_seconds,
        'attemptNumber',    v_attempt_number,
        'releasedAt',       v_iso_released_at,
        'resultsUrl',       v_results_url
    );

    -- 8. Enqueue email notification job in isolated exception block
    BEGIN
        v_enqueue_result := public.enqueue_email_job(
            p_recipient_email      => v_recipient_email,
            p_subject              => 'Official Result Published: ' || v_test_title || ' — Make Me Topper',
            p_template_id          => 'EXM-01',
            p_payload              => v_payload,
            p_recipient_profile_id => v_profile_id,
            p_recipient_name       => v_recipient_name,
            p_event_type           => 'EXM-01',
            p_priority             => 'normal'::public.email_priority,
            p_idempotency_key      => v_idempotency_key
        );

        IF (v_enqueue_result->>'success')::boolean IS NOT TRUE THEN
            RAISE WARNING 'handle_mock_result_released: enqueue_email_job returned non-success for attempt %: %', NEW.attempt_id, v_enqueue_result;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_mock_result_released: Failed to enqueue EXM-01 notification for attempt %: %', NEW.attempt_id, SQLERRM;
    END;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_mock_result_released() IS
    'Trigger function for EXM-01: enqueues transactional email notification when an official mock test result transitions to is_released = true, enforcing Choice 1 First-Only policy.';

ALTER FUNCTION public.handle_mock_result_released() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.handle_mock_result_released() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_mock_result_released() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Database Trigger on public.mock_results
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_mock_results_official_release ON public.mock_results;
CREATE TRIGGER trg_mock_results_official_release
    AFTER UPDATE OF is_released ON public.mock_results
    FOR EACH ROW
    WHEN (OLD.is_released IS FALSE AND NEW.is_released IS TRUE)
    EXECUTE FUNCTION public.handle_mock_result_released();

COMMENT ON TRIGGER trg_mock_results_official_release ON public.mock_results IS
    'Dispatches EXM-01 official result publication notification when mock_results.is_released transitions from false to true.';
