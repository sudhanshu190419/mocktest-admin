-- ============================================================================
-- Migration 251: Transactional Email Notification Queue & Delivery Infrastructure
-- ============================================================================
--
-- PURPOSE:
--   Establishes durable queue infrastructure, suppression list, delivery logging,
--   and concurrency-safe locking RPCs for Make Me Topper transactional emails.
--
-- ARCHITECTURE & GOVERNANCE:
--   1. Durable Queue (public.email_queue):
--      - Tracks lifecycle: pending -> processing -> sent | failed | cancelled.
--      - Supports strict priority ordering: critical > high > normal > low.
--      - Deduplicates via unique idempotency_key constraint.
--      - Protects against duplicate concurrent dispatch using PostgreSQL
--        FOR UPDATE SKIP LOCKED inside claim_email_queue_batch.
--      - Recovers abandoned worker locks via recover_abandoned_email_locks.
--   2. Suppression Ledger (public.email_suppressions):
--      - Records hard bounces, user spam complaints, manual blocks, and unsubscribes.
--      - Prevents sending to addresses that damage domain sending reputation.
--   3. Delivery Audit Trail (public.email_delivery_logs):
--      - Immutable history of provider dispatch attempts, webhook events (delivered,
--        bounced, complained, clicked, opened), and error payloads.
--   4. Security & Isolation:
--      - RLS enabled across all tables.
--      - Zero access for anon and authenticated users.
--      - RPCs are SECURITY DEFINER with search_path = public, pg_temp, restricted
--        strictly to service_role.
-- ============================================================================

-- 1. Custom Types & Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_queue_status') THEN
        CREATE TYPE public.email_queue_status AS ENUM (
            'pending',
            'processing',
            'sent',
            'failed',
            'cancelled'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_delivery_status') THEN
        CREATE TYPE public.email_delivery_status AS ENUM (
            'unsent',
            'accepted',
            'delivered',
            'bounced',
            'complained'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_priority') THEN
        CREATE TYPE public.email_priority AS ENUM (
            'critical',
            'high',
            'normal',
            'low'
        );
    END IF;
END $$;

-- 2. Email Queue Table
CREATE TABLE IF NOT EXISTS public.email_queue (
    queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_profile_id uuid NULL REFERENCES public.profiles(profile_id) ON DELETE SET NULL,
    recipient_email varchar(255) NOT NULL,
    recipient_name varchar(255) NULL,
    event_type varchar(64) NOT NULL,
    subject text NOT NULL,
    template_id varchar(64) NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    priority public.email_priority NOT NULL DEFAULT 'normal',
    status public.email_queue_status NOT NULL DEFAULT 'pending',
    delivery_status public.email_delivery_status NOT NULL DEFAULT 'unsent',
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    next_retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    locked_at timestamptz NULL,
    locked_by text NULL,
    sent_at timestamptz NULL,
    provider_message_id text NULL,
    last_error text NULL,
    idempotency_key varchar(255) NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT uq_email_queue_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT ck_email_queue_attempts CHECK (attempts >= 0),
    CONSTRAINT ck_email_queue_max_attempts CHECK (max_attempts > 0)
);

-- 3. Email Suppressions Table
CREATE TABLE IF NOT EXISTS public.email_suppressions (
    email varchar(255) PRIMARY KEY,
    reason varchar(64) NOT NULL, -- 'hard_bounce', 'complaint', 'manual', 'unsubscribed'
    suppressed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    source varchar(64) NOT NULL DEFAULT 'webhook',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 4. Email Delivery Logs Table
CREATE TABLE IF NOT EXISTS public.email_delivery_logs (
    log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id uuid NULL REFERENCES public.email_queue(queue_id) ON DELETE CASCADE,
    provider varchar(64) NOT NULL DEFAULT 'resend',
    event_type varchar(64) NOT NULL,
    provider_message_id text NULL,
    svix_event_id varchar(255) NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT uq_email_delivery_logs_svix_event_id UNIQUE (svix_event_id)
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_email_queue_claim
    ON public.email_queue (priority, next_retry_at, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_email_queue_stale_locks
    ON public.email_queue (locked_at)
    WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_email_queue_recipient
    ON public.email_queue (recipient_profile_id);

CREATE INDEX IF NOT EXISTS idx_email_queue_email
    ON public.email_queue (recipient_email);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_queue
    ON public.email_delivery_logs (queue_id);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_provider_msg
    ON public.email_delivery_logs (provider_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_delivery_logs_svix_id
    ON public.email_delivery_logs (svix_event_id)
    WHERE svix_event_id IS NOT NULL;

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_logs ENABLE ROW LEVEL SECURITY;

-- Revoke all table privileges from public, anon, and authenticated
REVOKE ALL ON TABLE public.email_queue FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.email_suppressions FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.email_delivery_logs FROM public, anon, authenticated;

-- Grant full table privileges strictly to service_role
GRANT ALL ON TABLE public.email_queue TO service_role;
GRANT ALL ON TABLE public.email_suppressions TO service_role;
GRANT ALL ON TABLE public.email_delivery_logs TO service_role;

-- 7. Queue Management RPC: claim_email_queue_batch
--    Atomically claims a batch of pending email jobs using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_email_queue_batch(
    p_batch_size integer DEFAULT 20,
    p_worker_id text DEFAULT 'worker-default'
)
RETURNS SETOF public.email_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actual_batch_size integer;
BEGIN
    v_actual_batch_size := LEAST(GREATEST(COALESCE(p_batch_size, 20), 1), 50);

    RETURN QUERY
    WITH candidate_jobs AS (
        SELECT q.queue_id
        FROM public.email_queue q
        WHERE q.status = 'pending'
          AND q.next_retry_at <= clock_timestamp()
        ORDER BY
            CASE q.priority
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
                WHEN 'normal' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            q.next_retry_at ASC,
            q.created_at ASC
        LIMIT v_actual_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.email_queue eq
    SET
        status = 'processing',
        locked_at = clock_timestamp(),
        locked_by = p_worker_id,
        updated_at = clock_timestamp()
    FROM candidate_jobs cj
    WHERE eq.queue_id = cj.queue_id
    RETURNING eq.*;
END;
$$;

-- 8. Queue Management RPC: record_email_success
--    Marks a job as sent and records delivery log
CREATE OR REPLACE FUNCTION public.record_email_success(
    p_queue_id uuid,
    p_provider_message_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.email_queue
    SET
        status = 'sent',
        delivery_status = 'accepted',
        sent_at = clock_timestamp(),
        provider_message_id = p_provider_message_id,
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE queue_id = p_queue_id;

    IF FOUND THEN
        INSERT INTO public.email_delivery_logs (
            queue_id,
            provider,
            event_type,
            provider_message_id,
            payload
        ) VALUES (
            p_queue_id,
            'resend',
            'sent',
            p_provider_message_id,
            jsonb_build_object('success', true, 'recorded_at', clock_timestamp())
        );
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

-- 9. Queue Management RPC: schedule_email_retry
--    Increments attempt counter and schedules backoff or marks failed if max attempts reached
CREATE OR REPLACE FUNCTION public.schedule_email_retry(
    p_queue_id uuid,
    p_error_message text,
    p_retry_delay_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job public.email_queue%ROWTYPE;
    v_new_attempts integer;
    v_delay integer;
BEGIN
    SELECT * INTO v_job
    FROM public.email_queue
    WHERE queue_id = p_queue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
    END IF;

    v_new_attempts := v_job.attempts + 1;
    v_delay := GREATEST(COALESCE(p_retry_delay_seconds, 60), 1);

    IF v_new_attempts >= v_job.max_attempts THEN
        UPDATE public.email_queue
        SET
            status = 'failed',
            attempts = v_new_attempts,
            last_error = p_error_message,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = clock_timestamp()
        WHERE queue_id = p_queue_id;

        INSERT INTO public.email_delivery_logs (
            queue_id,
            provider,
            event_type,
            provider_message_id,
            payload
        ) VALUES (
            p_queue_id,
            'resend',
            'max_retries_exceeded',
            v_job.provider_message_id,
            jsonb_build_object('attempts', v_new_attempts, 'error', p_error_message)
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'failed',
            'attempts', v_new_attempts,
            'max_attempts', v_job.max_attempts
        );
    ELSE
        UPDATE public.email_queue
        SET
            status = 'pending',
            attempts = v_new_attempts,
            next_retry_at = clock_timestamp() + (v_delay || ' seconds')::interval,
            last_error = p_error_message,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = clock_timestamp()
        WHERE queue_id = p_queue_id;

        INSERT INTO public.email_delivery_logs (
            queue_id,
            provider,
            event_type,
            provider_message_id,
            payload
        ) VALUES (
            p_queue_id,
            'resend',
            'retry_scheduled',
            v_job.provider_message_id,
            jsonb_build_object(
                'attempts', v_new_attempts,
                'next_retry_delay', v_delay,
                'error', p_error_message
            )
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'pending',
            'attempts', v_new_attempts,
            'retry_delay_seconds', v_delay
        );
    END IF;
END;
$$;

-- 10. Queue Management RPC: mark_email_failed
--     Marks a job permanently failed (for unrecoverable 4xx or invalid data)
CREATE OR REPLACE FUNCTION public.mark_email_failed(
    p_queue_id uuid,
    p_error_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.email_queue
    SET
        status = 'failed',
        attempts = attempts + 1,
        last_error = p_error_message,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = clock_timestamp()
    WHERE queue_id = p_queue_id;

    IF FOUND THEN
        INSERT INTO public.email_delivery_logs (
            queue_id,
            provider,
            event_type,
            payload
        ) VALUES (
            p_queue_id,
            'resend',
            'permanent_failure',
            jsonb_build_object('error', p_error_message, 'failed_at', clock_timestamp())
        );
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

-- 11. Queue Management RPC: cancel_email_job
--     Cancels a job (e.g. suppressed address or missing profile email)
CREATE OR REPLACE FUNCTION public.cancel_email_job(
    p_queue_id uuid,
    p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.email_queue
    SET
        status = 'cancelled',
        last_error = p_reason,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = clock_timestamp()
    WHERE queue_id = p_queue_id;

    IF FOUND THEN
        INSERT INTO public.email_delivery_logs (
            queue_id,
            provider,
            event_type,
            payload
        ) VALUES (
            p_queue_id,
            'system',
            'cancelled',
            jsonb_build_object('reason', p_reason, 'cancelled_at', clock_timestamp())
        );
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

-- 12. Queue Management RPC: recover_abandoned_email_locks
--     Resets stranded jobs in 'processing' whose workers died
CREATE OR REPLACE FUNCTION public.recover_abandoned_email_locks(
    p_stale_seconds integer DEFAULT 300
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stale_threshold timestamptz;
    v_recovered_count integer;
BEGIN
    v_stale_threshold := clock_timestamp() - (GREATEST(COALESCE(p_stale_seconds, 300), 30) || ' seconds')::interval;

    WITH recovered AS (
        UPDATE public.email_queue
        SET
            status = 'pending',
            locked_at = NULL,
            locked_by = NULL,
            last_error = COALESCE(last_error, '') || ' [Lock recovered after worker timeout]',
            updated_at = clock_timestamp()
        WHERE status = 'processing'
          AND locked_at < v_stale_threshold
        RETURNING queue_id
    )
    SELECT count(*)::integer INTO v_recovered_count FROM recovered;

    RETURN v_recovered_count;
END;
$$;

-- 13. Queue Management RPC: enqueue_email_job
--     Idempotent enqueue helper for Edge Functions and application services
CREATE OR REPLACE FUNCTION public.enqueue_email_job(
    p_recipient_email text,
    p_subject text,
    p_template_id text,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_recipient_profile_id uuid DEFAULT NULL,
    p_recipient_name text DEFAULT NULL,
    p_event_type text DEFAULT 'GEN-01',
    p_priority public.email_priority DEFAULT 'normal',
    p_idempotency_key text DEFAULT NULL,
    p_max_attempts integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_queue_id uuid;
    v_clean_email text;
    v_existing_job public.email_queue%ROWTYPE;
BEGIN
    v_clean_email := lower(trim(COALESCE(p_recipient_email, '')));

    -- Validate email syntax minimally
    IF length(v_clean_email) = 0 OR position('@' in v_clean_email) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_RECIPIENT_EMAIL',
            'message', 'Recipient email is missing or malformed'
        );
    END IF;

    -- Check suppression list
    IF EXISTS (
        SELECT 1 FROM public.email_suppressions
        WHERE email = v_clean_email
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'RECIPIENT_SUPPRESSED',
            'message', 'Recipient is registered in the email suppression list',
            'email', v_clean_email
        );
    END IF;

    -- Check idempotency key if provided
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        SELECT * INTO v_existing_job
        FROM public.email_queue
        WHERE idempotency_key = trim(p_idempotency_key);

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'code', 'IDEMPOTENT_EXISTING',
                'queue_id', v_existing_job.queue_id,
                'status', v_existing_job.status
            );
        END IF;
    END IF;

    -- Insert new job
    INSERT INTO public.email_queue (
        recipient_profile_id,
        recipient_email,
        recipient_name,
        event_type,
        subject,
        template_id,
        payload,
        priority,
        status,
        max_attempts,
        idempotency_key,
        next_retry_at
    ) VALUES (
        p_recipient_profile_id,
        v_clean_email,
        nullif(trim(COALESCE(p_recipient_name, '')), ''),
        p_event_type,
        trim(p_subject),
        trim(p_template_id),
        COALESCE(p_payload, '{}'::jsonb),
        COALESCE(p_priority, 'normal'),
        'pending',
        GREATEST(COALESCE(p_max_attempts, 5), 1),
        nullif(trim(COALESCE(p_idempotency_key, '')), ''),
        clock_timestamp()
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET updated_at = public.email_queue.updated_at
    RETURNING queue_id INTO v_queue_id;

    RETURN jsonb_build_object(
        'success', true,
        'code', 'ENQUEUED',
        'queue_id', v_queue_id,
        'status', 'pending'
    );
END;
$$;

-- 14. Webhook Event Ledger RPC: record_email_webhook_delivery
--     Idempotently processes incoming Svix webhook deliveries and deduplicates via svix_event_id
CREATE OR REPLACE FUNCTION public.record_email_webhook_delivery(
    p_svix_event_id text,
    p_event_type text,
    p_provider_message_id text,
    p_recipient_email text DEFAULT NULL,
    p_delivery_status text DEFAULT NULL,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_bounce_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_queue_id uuid;
    v_clean_email text;
    v_already_processed boolean;
BEGIN
    -- 1. Deduplication check via svix_event_id
    IF p_svix_event_id IS NOT NULL AND length(trim(p_svix_event_id)) > 0 THEN
        SELECT EXISTS (
            SELECT 1 FROM public.email_delivery_logs
            WHERE svix_event_id = trim(p_svix_event_id)
        ) INTO v_already_processed;

        IF v_already_processed THEN
            RETURN jsonb_build_object(
                'success', true,
                'action', 'IGNORED_DUPLICATE_EVENT',
                'svix_event_id', trim(p_svix_event_id)
            );
        END IF;
    END IF;

    -- 2. Lookup matching queue_id by provider_message_id if available
    IF p_provider_message_id IS NOT NULL AND length(trim(p_provider_message_id)) > 0 THEN
        SELECT queue_id INTO v_queue_id
        FROM public.email_queue
        WHERE provider_message_id = trim(p_provider_message_id)
        LIMIT 1;
    END IF;

    -- 3. Update delivery_status on email_queue if matched
    IF v_queue_id IS NOT NULL AND p_delivery_status IS NOT NULL THEN
        UPDATE public.email_queue
        SET
            delivery_status = p_delivery_status::public.email_delivery_status,
            updated_at = clock_timestamp()
        WHERE queue_id = v_queue_id;
    END IF;

    -- 4. Apply suppressions if hard bounce or complaint
    v_clean_email := lower(trim(COALESCE(p_recipient_email, '')));
    IF length(v_clean_email) > 0 THEN
        IF p_event_type = 'email.bounced' AND (p_bounce_type IS NULL OR p_bounce_type = 'permanent' OR p_bounce_type = 'undetermined') THEN
            INSERT INTO public.email_suppressions (email, reason, source, metadata)
            VALUES (v_clean_email, 'hard_bounce', 'webhook', jsonb_build_object('svix_event_id', p_svix_event_id, 'provider_message_id', p_provider_message_id))
            ON CONFLICT (email) DO UPDATE
            SET reason = 'hard_bounce', suppressed_at = clock_timestamp();
        ELSIF p_event_type = 'email.complained' THEN
            INSERT INTO public.email_suppressions (email, reason, source, metadata)
            VALUES (v_clean_email, 'complaint', 'webhook', jsonb_build_object('svix_event_id', p_svix_event_id, 'provider_message_id', p_provider_message_id))
            ON CONFLICT (email) DO UPDATE
            SET reason = 'complaint', suppressed_at = clock_timestamp();
        END IF;
    END IF;

    -- 5. Insert delivery log with unique svix_event_id
    INSERT INTO public.email_delivery_logs (
        queue_id,
        provider,
        event_type,
        provider_message_id,
        svix_event_id,
        payload
    ) VALUES (
        v_queue_id,
        'resend',
        p_event_type,
        nullif(trim(COALESCE(p_provider_message_id, '')), ''),
        nullif(trim(COALESCE(p_svix_event_id, '')), ''),
        COALESCE(p_payload, '{}'::jsonb)
    )
    ON CONFLICT (svix_event_id) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'action', 'PROCESSED',
        'event_type', p_event_type,
        'queue_id', v_queue_id,
        'svix_event_id', p_svix_event_id
    );
END;
$$;

-- 15. Grants & Execution Permissions for RPCs
REVOKE ALL ON FUNCTION public.claim_email_queue_batch(integer, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_email_success(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_email_retry(uuid, text, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_email_failed(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_email_job(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_abandoned_email_locks(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_email_job(text, text, text, jsonb, uuid, text, text, public.email_priority, text, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_email_webhook_delivery(text, text, text, text, text, jsonb, text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_email_queue_batch(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_email_success(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_email_retry(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_email_failed(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_email_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_abandoned_email_locks(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email_job(text, text, text, jsonb, uuid, text, text, public.email_priority, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_email_webhook_delivery(text, text, text, text, text, jsonb, text) TO service_role;

