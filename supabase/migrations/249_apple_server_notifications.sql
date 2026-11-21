-- ============================================================================
-- Migration 249: Apple App Store Server Notifications V2 Processing
-- ============================================================================
--
-- PURPOSE:
--   Implements durable notification event tracking and atomic, idempotent
--   database RPC for Apple App Store Server Notifications V2 on Make Me Topper.
--
-- GOVERNANCE & BUSINESS RULES:
--   1. Notification Event Ledger:
--      - Durably records every verified notification in public.apple_notification_events.
--      - Enforces unique constraint on notification_uuid for idempotent delivery.
--   2. Atomic RPC (public.process_apple_notification):
--      - SECURITY DEFINER with search_path = public, pg_temp.
--      - Strictly guarded: caller must possess service_role privileges.
--      - Advisory locking on transaction ID / notification UUID to serialize concurrent requests.
--      - Handles REFUND, REVOKE, REFUND_REVERSED, TEST, and unsupported notification types.
--   3. Critical Cross-Platform Entitlement Protection:
--      - Before revoking an entitlement, verifies that its order_item_id matches
--        the exact Apple order item associated with the refunded/revoked Apple transaction.
--      - If a student owns a course or PYQ package through Razorpay, Google Play,
--        offline payment, admin grant, or earlier order (including the Phase 2
--        already_enrolled_payment_recorded outcome), Apple notifications NEVER revoke access.
--      - Multi-source survival: if a student has another active paid order or admin grant,
--        access remains active and order_item_id is re-linked to the surviving order.
--   4. Partial Refunds:
--      - When revocationPercentage < 100000, updates payment to partially_refunded and
--        records refund_amount without cancelling the order or revoking entitlements.
--   5. REVOKE Handling:
--      - Treats REVOKE (e.g. Family Sharing revoked) as access revocation, NOT a monetary refund.
--      - Payment status remains captured; only the matching Apple-owned entitlement is revoked.
--   6. REFUND_REVERSED:
--      - Reverses previously recorded Apple refund on payment and order.
--      - Restores the Apple-owned entitlement ONLY if it was previously deactivated specifically
--        due to an Apple refund and has no subsequent administrator revocation.
--   7. TEST & Unsupported Notifications:
--      - TEST notifications are verified, recorded, and acknowledged without modifying commerce data.
--      - Unsupported subscription notifications are recorded with status 'ignored_unsupported'
--        and acknowledged without reintroducing retired subscription modules.
-- ============================================================================

-- 1. Notification Event Ledger Table
CREATE TABLE IF NOT EXISTS public.apple_notification_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_uuid uuid NOT NULL,
    notification_type text NOT NULL,
    subtype text NULL,
    environment text NOT NULL,
    bundle_id text NOT NULL,
    app_apple_id bigint NULL,
    transaction_id text NULL,
    original_transaction_id text NULL,
    product_id text NULL,
    signed_date timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz NULL,
    processing_status text NOT NULL,
    payment_id uuid NULL REFERENCES public.payments(payment_id) ON DELETE SET NULL,
    order_id uuid NULL REFERENCES public.orders(order_id) ON DELETE SET NULL,
    action_taken text NULL,
    error_message text NULL,
    payload_hash text NOT NULL,
    raw_payload jsonb NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_apple_notification_events_uuid UNIQUE (notification_uuid),
    CONSTRAINT ck_apple_notification_events_status CHECK (
        processing_status IN (
            'pending',
            'processed',
            'ignored_unsupported',
            'ignored_duplicate',
            'ignored_stale',
            'quarantined',
            'failed'
        )
    ),
    CONSTRAINT ck_apple_notification_events_env CHECK (
        environment IN ('Production', 'Sandbox')
    )
);

-- Indexes for performance & auditing
CREATE INDEX IF NOT EXISTS idx_apple_notification_events_tx
    ON public.apple_notification_events (transaction_id);

CREATE INDEX IF NOT EXISTS idx_apple_notification_events_orig_tx
    ON public.apple_notification_events (original_transaction_id);

CREATE INDEX IF NOT EXISTS idx_apple_notification_events_status
    ON public.apple_notification_events (processing_status);

CREATE INDEX IF NOT EXISTS idx_apple_notification_events_payment_id
    ON public.apple_notification_events (payment_id);

CREATE INDEX IF NOT EXISTS idx_apple_notification_events_tx_signed_date
    ON public.apple_notification_events (transaction_id, signed_date DESC);

-- Enable RLS & Restrict Access exclusively to service_role
ALTER TABLE public.apple_notification_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.apple_notification_events FROM public, anon, authenticated;
GRANT ALL ON public.apple_notification_events TO service_role;


-- 2. Atomic Notification Processing RPC
CREATE OR REPLACE FUNCTION public.process_apple_notification(
    p_notification_uuid uuid,
    p_notification_type text,
    p_subtype text,
    p_environment text,
    p_bundle_id text,
    p_app_apple_id bigint,
    p_signed_date timestamptz,
    p_payload_hash text,
    p_raw_payload jsonb DEFAULT null,
    p_transaction_id text DEFAULT null,
    p_original_transaction_id text DEFAULT null,
    p_product_id text DEFAULT null,
    p_app_account_token uuid DEFAULT null,
    p_revocation_date timestamptz DEFAULT null,
    p_revocation_reason int DEFAULT null,
    p_revocation_percentage int DEFAULT null,
    p_revocation_type text DEFAULT null,
    p_in_app_ownership_type text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_role               text;
    v_lock_key                  bigint;
    v_existing_event            public.apple_notification_events%ROWTYPE;
    v_newer_event               public.apple_notification_events%ROWTYPE;
    v_payment                   public.payments%ROWTYPE;
    v_order                     public.orders%ROWTYPE;
    v_order_item                public.order_items%ROWTYPE;
    v_enrollment                public.course_enrollments%ROWTYPE;
    v_pyq_purchase              public.student_pyq_purchases%ROWTYPE;
    v_refund_amount             numeric(12,2);
    v_is_full_refund            boolean;
    v_has_other_paid_order      boolean;
    v_other_item_id             uuid;
    v_has_non_purchase_source   boolean;
    v_action_taken              text;
    v_revocation_timestamp      timestamptz;
BEGIN
    -- 0. Security Guard: Caller must possess service_role privileges
    v_caller_role := auth.role();
    IF v_caller_role IS DISTINCT FROM 'service_role' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'FORBIDDEN',
            'error', 'Unauthorized: process_apple_notification requires service_role privileges'
        );
    END IF;

    -- 1. Validate required notification envelope fields
    IF p_notification_uuid IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_PARAMETERS',
            'error', 'p_notification_uuid is required.'
        );
    END IF;

    IF p_notification_type IS NULL OR btrim(p_notification_type) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_PARAMETERS',
            'error', 'p_notification_type is required.'
        );
    END IF;

    IF p_environment NOT IN ('Production', 'Sandbox') THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_PARAMETERS',
            'error', 'p_environment must be either Production or Sandbox.'
        );
    END IF;

    IF p_signed_date IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_PARAMETERS',
            'error', 'p_signed_date is required.'
        );
    END IF;

    -- 2. Advisory lock on transaction ID or notification UUID to serialize concurrent webhook runs
    v_lock_key := ('x' || substr(md5(COALESCE(NULLIF(btrim(p_transaction_id), ''), p_notification_uuid::text)), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- 3. Idempotency Check on notification_uuid
    SELECT * INTO v_existing_event
    FROM public.apple_notification_events
    WHERE notification_uuid = p_notification_uuid
    FOR UPDATE;

    IF v_existing_event.event_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'action', 'already_processed',
            'code', 'ALREADY_PROCESSED',
            'duplicate', true,
            'notification_uuid', p_notification_uuid,
            'processing_status', v_existing_event.processing_status,
            'action_taken', v_existing_event.action_taken
        );
    END IF;

    -- 4. Out-of-Order / Event Ordering Guard
    -- If an event for the same transaction has already been processed with a strictly newer signed_date,
    -- record the incoming notification as ignored_stale to prevent retrograding newer state.
    IF p_transaction_id IS NOT NULL AND btrim(p_transaction_id) <> '' THEN
        SELECT * INTO v_newer_event
        FROM public.apple_notification_events
        WHERE transaction_id = p_transaction_id
          AND processing_status = 'processed'
          AND signed_date > p_signed_date
        ORDER BY signed_date DESC
        LIMIT 1;

        IF v_newer_event.event_id IS NOT NULL THEN
            INSERT INTO public.apple_notification_events (
                notification_uuid, notification_type, subtype, environment, bundle_id, app_apple_id,
                transaction_id, original_transaction_id, product_id, signed_date,
                processing_status, action_taken, error_message, payload_hash, raw_payload, processed_at
            ) VALUES (
                p_notification_uuid, p_notification_type, p_subtype, p_environment, p_bundle_id, p_app_apple_id,
                p_transaction_id, p_original_transaction_id, p_product_id, p_signed_date,
                'ignored_stale', 'ignored_stale_event',
                'Newer event ' || v_newer_event.notification_uuid::text || ' with signed_date ' || v_newer_event.signed_date::text || ' was already processed.',
                p_payload_hash, p_raw_payload, now()
            );

            RETURN jsonb_build_object(
                'success', true,
                'action', 'ignored_stale',
                'code', 'STALE_EVENT_IGNORED',
                'notification_uuid', p_notification_uuid,
                'newer_signed_date', v_newer_event.signed_date
            );
        END IF;
    END IF;

    -- 5. Branch: TEST Notification
    IF p_notification_type = 'TEST' THEN
        INSERT INTO public.apple_notification_events (
            notification_uuid, notification_type, subtype, environment, bundle_id, app_apple_id,
            transaction_id, original_transaction_id, product_id, signed_date,
            processing_status, action_taken, payload_hash, raw_payload, processed_at
        ) VALUES (
            p_notification_uuid, p_notification_type, p_subtype, p_environment, p_bundle_id, p_app_apple_id,
            p_transaction_id, p_original_transaction_id, p_product_id, p_signed_date,
            'processed', 'test_acknowledged', p_payload_hash, p_raw_payload, now()
        );

        RETURN jsonb_build_object(
            'success', true,
            'action', 'test_acknowledged',
            'code', 'TEST_NOTIFICATION_ACKNOWLEDGED',
            'notification_uuid', p_notification_uuid
        );
    END IF;

    -- 6. Branch: Unsupported Notification Types (e.g. Subscriptions, Consumption, etc.)
    -- Subscriptions have been retired. Durably record and safely acknowledge without side-effects.
    IF p_notification_type NOT IN ('REFUND', 'REVOKE', 'REFUND_REVERSED') THEN
        INSERT INTO public.apple_notification_events (
            notification_uuid, notification_type, subtype, environment, bundle_id, app_apple_id,
            transaction_id, original_transaction_id, product_id, signed_date,
            processing_status, action_taken, payload_hash, raw_payload, processed_at
        ) VALUES (
            p_notification_uuid, p_notification_type, p_subtype, p_environment, p_bundle_id, p_app_apple_id,
            p_transaction_id, p_original_transaction_id, p_product_id, p_signed_date,
            'ignored_unsupported', 'ignored_unsupported_type', p_payload_hash, p_raw_payload, now()
        );

        RETURN jsonb_build_object(
            'success', true,
            'action', 'ignored_unsupported',
            'code', 'UNSUPPORTED_NOTIFICATION_TYPE_IGNORED',
            'notification_type', p_notification_type,
            'notification_uuid', p_notification_uuid
        );
    END IF;

    -- 7. For REFUND, REVOKE, and REFUND_REVERSED: transaction_id is required
    IF p_transaction_id IS NULL OR btrim(p_transaction_id) = '' THEN
        INSERT INTO public.apple_notification_events (
            notification_uuid, notification_type, subtype, environment, bundle_id, app_apple_id,
            transaction_id, original_transaction_id, product_id, signed_date,
            processing_status, action_taken, error_message, payload_hash, raw_payload, processed_at
        ) VALUES (
            p_notification_uuid, p_notification_type, p_subtype, p_environment, p_bundle_id, p_app_apple_id,
            p_transaction_id, p_original_transaction_id, p_product_id, p_signed_date,
            'failed', 'rejected_missing_transaction_id',
            'Notification type ' || p_notification_type || ' requires transaction_id.',
            p_payload_hash, p_raw_payload, now()
        );

        RETURN jsonb_build_object(
            'success', false,
            'code', 'MISSING_TRANSACTION_ID',
            'error', 'Notification requires transaction_id in nested transaction payload.'
        );
    END IF;

    -- 8. Lookup Apple Payment Row
    SELECT * INTO v_payment
    FROM public.payments
    WHERE gateway = 'apple'::public.payment_gateway
      AND (
          gateway_payment_id = p_transaction_id
          OR (p_original_transaction_id IS NOT NULL AND gateway_order_id = p_original_transaction_id)
      )
    LIMIT 1
    FOR UPDATE;

    -- 9. If Payment Row is NOT Found: Quarantine Event for Later Reconciliation
    IF v_payment.payment_id IS NULL THEN
        INSERT INTO public.apple_notification_events (
            notification_uuid, notification_type, subtype, environment, bundle_id, app_apple_id,
            transaction_id, original_transaction_id, product_id, signed_date,
            processing_status, action_taken, error_message, payload_hash, raw_payload, processed_at
        ) VALUES (
            p_notification_uuid, p_notification_type, p_subtype, p_environment, p_bundle_id, p_app_apple_id,
            p_transaction_id, p_original_transaction_id, p_product_id, p_signed_date,
            'quarantined', 'quarantined_payment_not_found',
            'No matching Apple payment found for transactionId ' || p_transaction_id,
            p_payload_hash, p_raw_payload, now()
        );

        RETURN jsonb_build_object(
            'success', true,
            'quarantined', true,
            'action', 'quarantined_payment_not_found',
            'code', 'PAYMENT_NOT_FOUND_QUARANTINED',
            'message', 'Refund/revocation event quarantined pending payment reconciliation.'
        );
    END IF;

    -- 10. Lookup Associated Order and Order Item
    SELECT * INTO v_order
    FROM public.orders
    WHERE order_id = v_payment.order_id
    FOR UPDATE;

    IF v_order.order_id IS NULL THEN
        INSERT INTO public.apple_notification_events (
            notification_uuid, notification_type, subtype, environment, bundle_id, app_apple_id,
            transaction_id, original_transaction_id, product_id, signed_date,
            processing_status, action_taken, error_message, payload_hash, raw_payload, processed_at
        ) VALUES (
            p_notification_uuid, p_notification_type, p_subtype, p_environment, p_bundle_id, p_app_apple_id,
            p_transaction_id, p_original_transaction_id, p_product_id, p_signed_date,
            'failed', 'order_not_found',
            'Payment ' || v_payment.payment_id::text || ' references non-existent order ' || v_payment.order_id::text,
            p_payload_hash, p_raw_payload, now()
        );

        RETURN jsonb_build_object(
            'success', false,
            'code', 'ORDER_NOT_FOUND',
            'error', 'Associated order for Apple payment was not found.'
        );
    END IF;

    SELECT * INTO v_order_item
    FROM public.order_items
    WHERE order_id = v_order.order_id
    LIMIT 1;

    v_revocation_timestamp := COALESCE(p_revocation_date, p_signed_date, now());

    -- ═════════════════════════════════════════════════════════════════════════
    -- 11. Branch: REFUND
    -- ═════════════════════════════════════════════════════════════════════════
    IF p_notification_type = 'REFUND' THEN
        -- Check full vs partial refund
        IF p_revocation_percentage IS NULL OR p_revocation_percentage >= 100000 THEN
            v_is_full_refund := true;
            v_refund_amount := v_payment.amount;
        ELSE
            v_is_full_refund := false;
            v_refund_amount := round((v_payment.amount * p_revocation_percentage / 100000.0)::numeric, 2);
        END IF;

        IF v_is_full_refund THEN
            -- Full Refund: Update Payment Row
            UPDATE public.payments
            SET status = 'refunded'::public.payment_status,
                refund_amount = v_refund_amount,
                refund_gateway_id = p_notification_uuid::text,
                refunded_at = v_revocation_timestamp,
                updated_at = now()
            WHERE payment_id = v_payment.payment_id;

            -- Full Refund: Update Order Row (set confirmed_at = null, cancelled_at to timestamp)
            UPDATE public.orders
            SET status = 'cancelled'::public.order_status,
                cancelled_at = v_revocation_timestamp,
                confirmed_at = null,
                refunded_at = null,
                updated_at = now()
            WHERE order_id = v_order.order_id;

            -- Full Refund: Entitlement Revocation with Cross-Platform Ownership Rule
            IF v_order_item.item_id IS NOT NULL THEN
                IF v_order_item.item_type = 'course'::public.item_type THEN
                    SELECT * INTO v_enrollment
                    FROM public.course_enrollments
                    WHERE course_id = v_order_item.course_id
                      AND student_id = v_order.student_id;

                    -- CRITICAL OWNERSHIP CHECK: Revoke ONLY if this Apple order item granted the access
                    IF v_enrollment.order_item_id IS NOT DISTINCT FROM v_order_item.item_id THEN
                        -- Check if student has another surviving source of access for this course
                        SELECT exists (
                            SELECT 1
                            FROM public.order_items oi2
                            JOIN public.orders o2 ON o2.order_id = oi2.order_id
                            JOIN public.payments p2 ON p2.order_id = o2.order_id
                            WHERE o2.student_id = v_order.student_id
                              AND o2.order_id <> v_order.order_id
                              AND o2.status = 'confirmed'::public.order_status
                              AND oi2.course_id = v_order_item.course_id
                              AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
                        ) INTO v_has_other_paid_order;

                        SELECT coalesce(bool_or(ce.enrollment_type IN ('admin_grant', 'free')), false)
                        INTO v_has_non_purchase_source
                        FROM public.course_enrollments ce
                        WHERE ce.course_id = v_order_item.course_id
                          AND ce.student_id = v_order.student_id
                          AND ce.is_active = true;

                        IF v_has_other_paid_order OR v_has_non_purchase_source THEN
                            -- Re-link order_item_id to surviving order if available, leaving access active
                            IF v_has_other_paid_order THEN
                                SELECT oi2.item_id INTO v_other_item_id
                                FROM public.order_items oi2
                                JOIN public.orders o2 ON o2.order_id = oi2.order_id
                                JOIN public.payments p2 ON p2.order_id = o2.order_id
                                WHERE o2.student_id = v_order.student_id
                                  AND o2.order_id <> v_order.order_id
                                  AND o2.status = 'confirmed'::public.order_status
                                  AND oi2.course_id = v_order_item.course_id
                                  AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
                                ORDER BY o2.created_at DESC
                                LIMIT 1;

                                UPDATE public.course_enrollments
                                SET order_item_id = coalesce(v_other_item_id, order_item_id),
                                    updated_at = now()
                                WHERE course_id = v_order_item.course_id
                                  AND student_id = v_order.student_id;
                            END IF;
                            v_action_taken := 'refund_processed_entitlement_preserved_multisource';
                        ELSE
                            -- No surviving source: revoke Apple-granted entitlement
                            UPDATE public.course_enrollments
                            SET is_active = false,
                                revoked_at = v_revocation_timestamp,
                                revoked_reason = 'Apple IAP Refund: tx_' || p_transaction_id || ' (reason: ' || COALESCE(p_revocation_reason::text, '0') || ')',
                                revoked_by = null,
                                updated_at = now()
                            WHERE course_id = v_order_item.course_id
                              AND student_id = v_order.student_id;

                            v_action_taken := 'refund_processed_entitlement_revoked';
                        END IF;
                    ELSE
                        -- Entitlement belongs to a different channel (Razorpay, Google Play, or prior order)
                        -- DO NOT REVOKE!
                        v_action_taken := 'refund_processed_entitlement_preserved_foreign_owner';
                    END IF;

                ELSIF v_order_item.item_type = 'pyq_package'::public.item_type THEN
                    SELECT * INTO v_pyq_purchase
                    FROM public.student_pyq_purchases
                    WHERE package_id = v_order_item.package_id
                      AND student_id = v_order.student_id;

                    IF v_pyq_purchase.order_item_id IS NOT DISTINCT FROM v_order_item.item_id THEN
                        SELECT exists (
                            SELECT 1
                            FROM public.order_items oi2
                            JOIN public.orders o2 ON o2.order_id = oi2.order_id
                            JOIN public.payments p2 ON p2.order_id = o2.order_id
                            WHERE o2.student_id = v_order.student_id
                              AND o2.order_id <> v_order.order_id
                              AND o2.status = 'confirmed'::public.order_status
                              AND oi2.package_id = v_order_item.package_id
                              AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
                        ) INTO v_has_other_paid_order;

                        IF v_has_other_paid_order THEN
                            v_action_taken := 'refund_processed_entitlement_preserved_multisource';
                        ELSE
                            UPDATE public.student_pyq_purchases
                            SET is_active = false,
                                revoked_at = v_revocation_timestamp,
                                revoked_reason = 'Apple IAP Refund: tx_' || p_transaction_id || ' (reason: ' || COALESCE(p_revocation_reason::text, '0') || ')',
                                updated_at = now()
                            WHERE package_id = v_order_item.package_id
                              AND student_id = v_order.student_id;

                            v_action_taken := 'refund_processed_entitlement_revoked';
                        END IF;
                    ELSE
                        v_action_taken := 'refund_processed_entitlement_preserved_foreign_owner';
                    END IF;
                END IF;
            ELSE
                v_action_taken := 'refund_processed_no_order_item';
            END IF;

        ELSE
            -- Partial Refund: Update Payment to partially_refunded
            UPDATE public.payments
            SET status = 'partially_refunded'::public.payment_status,
                refund_amount = v_refund_amount,
                refund_gateway_id = p_notification_uuid::text,
                refunded_at = v_revocation_timestamp,
                updated_at = now()
            WHERE payment_id = v_payment.payment_id;

            -- Order status remains confirmed
            -- Entitlement remains active
            v_action_taken := 'partial_refund_processed_entitlement_preserved';
        END IF;

    -- ═════════════════════════════════════════════════════════════════════════
    -- 12. Branch: REVOKE (e.g. Family Sharing access revoked)
    -- ═════════════════════════════════════════════════════════════════════════
    ELSIF p_notification_type = 'REVOKE' THEN
        -- A REVOKE notification is NOT a monetary refund. Payment remains captured.
        -- Only revoke the entitlement IF it was granted by this exact Apple order item.
        IF v_order_item.item_id IS NOT NULL THEN
            IF v_order_item.item_type = 'course'::public.item_type THEN
                SELECT * INTO v_enrollment
                FROM public.course_enrollments
                WHERE course_id = v_order_item.course_id
                  AND student_id = v_order.student_id;

                IF v_enrollment.order_item_id IS NOT DISTINCT FROM v_order_item.item_id THEN
                    SELECT exists (
                        SELECT 1
                        FROM public.order_items oi2
                        JOIN public.orders o2 ON o2.order_id = oi2.order_id
                        JOIN public.payments p2 ON p2.order_id = o2.order_id
                        WHERE o2.student_id = v_order.student_id
                          AND o2.order_id <> v_order.order_id
                          AND o2.status = 'confirmed'::public.order_status
                          AND oi2.course_id = v_order_item.course_id
                          AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
                    ) INTO v_has_other_paid_order;

                    SELECT coalesce(bool_or(ce.enrollment_type IN ('admin_grant', 'free')), false)
                    INTO v_has_non_purchase_source
                    FROM public.course_enrollments ce
                    WHERE ce.course_id = v_order_item.course_id
                      AND ce.student_id = v_order.student_id
                      AND ce.is_active = true;

                    IF v_has_other_paid_order OR v_has_non_purchase_source THEN
                        v_action_taken := 'revocation_processed_entitlement_preserved_multisource';
                    ELSE
                        UPDATE public.course_enrollments
                        SET is_active = false,
                            revoked_at = v_revocation_timestamp,
                            revoked_reason = 'Apple IAP Revocation: tx_' || p_transaction_id || ' (type: ' || COALESCE(p_revocation_type, 'REVOKE') || ', reason: ' || COALESCE(p_revocation_reason::text, '0') || ')',
                            revoked_by = null,
                            updated_at = now()
                        WHERE course_id = v_order_item.course_id
                          AND student_id = v_order.student_id;

                        v_action_taken := 'revocation_processed_entitlement_revoked';
                    END IF;
                ELSE
                    v_action_taken := 'revocation_processed_entitlement_preserved_foreign_owner';
                END IF;

            ELSIF v_order_item.item_type = 'pyq_package'::public.item_type THEN
                SELECT * INTO v_pyq_purchase
                FROM public.student_pyq_purchases
                WHERE package_id = v_order_item.package_id
                  AND student_id = v_order.student_id;

                IF v_pyq_purchase.order_item_id IS NOT DISTINCT FROM v_order_item.item_id THEN
                    SELECT exists (
                        SELECT 1
                        FROM public.order_items oi2
                        JOIN public.orders o2 ON o2.order_id = oi2.order_id
                        JOIN public.payments p2 ON p2.order_id = o2.order_id
                        WHERE o2.student_id = v_order.student_id
                          AND o2.order_id <> v_order.order_id
                          AND o2.status = 'confirmed'::public.order_status
                          AND oi2.package_id = v_order_item.package_id
                          AND p2.status IN ('captured'::public.payment_status, 'partially_refunded'::public.payment_status)
                    ) INTO v_has_other_paid_order;

                    IF v_has_other_paid_order THEN
                        v_action_taken := 'revocation_processed_entitlement_preserved_multisource';
                    ELSE
                        UPDATE public.student_pyq_purchases
                        SET is_active = false,
                            revoked_at = v_revocation_timestamp,
                            revoked_reason = 'Apple IAP Revocation: tx_' || p_transaction_id || ' (type: ' || COALESCE(p_revocation_type, 'REVOKE') || ', reason: ' || COALESCE(p_revocation_reason::text, '0') || ')',
                            updated_at = now()
                        WHERE package_id = v_order_item.package_id
                          AND student_id = v_order.student_id;

                        v_action_taken := 'revocation_processed_entitlement_revoked';
                    END IF;
                ELSE
                    v_action_taken := 'revocation_processed_entitlement_preserved_foreign_owner';
                END IF;
            END IF;
        ELSE
            v_action_taken := 'revocation_processed_no_order_item';
        END IF;

    -- ═════════════════════════════════════════════════════════════════════════
    -- 13. Branch: REFUND_REVERSED
    -- ═════════════════════════════════════════════════════════════════════════
    ELSIF p_notification_type = 'REFUND_REVERSED' THEN
        -- Apple reversed a previous refund. Restore payment and order to captured/confirmed.
        IF v_payment.status IN ('refunded'::public.payment_status, 'partially_refunded'::public.payment_status) THEN
            UPDATE public.payments
            SET status = 'captured'::public.payment_status,
                refund_amount = null,
                refund_gateway_id = null,
                refunded_at = null,
                updated_at = now()
            WHERE payment_id = v_payment.payment_id;
        END IF;

        IF v_order.status IN ('cancelled'::public.order_status, 'refunded'::public.order_status) THEN
            UPDATE public.orders
            SET status = 'confirmed'::public.order_status,
                confirmed_at = COALESCE(v_order.confirmed_at, v_order.created_at, now()),
                cancelled_at = null,
                refunded_at = null,
                updated_at = now()
            WHERE order_id = v_order.order_id;
        END IF;

        -- Restore entitlement ONLY if:
        -- 1. This Apple order item was the original owner
        -- 2. Entitlement is currently inactive
        -- 3. Entitlement was deactivated specifically due to an Apple refund
        -- 4. Entitlement was NOT revoked by an administrator
        IF v_order_item.item_id IS NOT NULL THEN
            IF v_order_item.item_type = 'course'::public.item_type THEN
                SELECT * INTO v_enrollment
                FROM public.course_enrollments
                WHERE course_id = v_order_item.course_id
                  AND student_id = v_order.student_id;

                IF v_enrollment.order_item_id IS NOT DISTINCT FROM v_order_item.item_id
                   AND v_enrollment.is_active = false
                   AND v_enrollment.revoked_reason ILIKE '%Apple IAP Refund%'
                   AND v_enrollment.revoked_by IS NULL THEN

                    UPDATE public.course_enrollments
                    SET is_active = true,
                        revoked_at = null,
                        revoked_reason = null,
                        revoked_by = null,
                        updated_at = now()
                    WHERE course_id = v_order_item.course_id
                      AND student_id = v_order.student_id;

                    v_action_taken := 'refund_reversed_entitlement_restored';
                ELSE
                    v_action_taken := 'refund_reversed_entitlement_retained';
                END IF;

            ELSIF v_order_item.item_type = 'pyq_package'::public.item_type THEN
                SELECT * INTO v_pyq_purchase
                FROM public.student_pyq_purchases
                WHERE package_id = v_order_item.package_id
                  AND student_id = v_order.student_id;

                IF v_pyq_purchase.order_item_id IS NOT DISTINCT FROM v_order_item.item_id
                   AND v_pyq_purchase.is_active = false
                   AND v_pyq_purchase.revoked_reason ILIKE '%Apple IAP Refund%' THEN

                    UPDATE public.student_pyq_purchases
                    SET is_active = true,
                        revoked_at = null,
                        revoked_reason = null,
                        updated_at = now()
                    WHERE package_id = v_order_item.package_id
                      AND student_id = v_order.student_id;

                    v_action_taken := 'refund_reversed_entitlement_restored';
                ELSE
                    v_action_taken := 'refund_reversed_entitlement_retained';
                END IF;
            END IF;
        ELSE
            v_action_taken := 'refund_reversed_no_order_item';
        END IF;
    END IF;

    -- 14. Durably Record Processed Notification Event
    INSERT INTO public.apple_notification_events (
        notification_uuid, notification_type, subtype, environment, bundle_id, app_apple_id,
        transaction_id, original_transaction_id, product_id, signed_date,
        processing_status, payment_id, order_id, action_taken, payload_hash, raw_payload, processed_at
    ) VALUES (
        p_notification_uuid, p_notification_type, p_subtype, p_environment, p_bundle_id, p_app_apple_id,
        p_transaction_id, p_original_transaction_id, p_product_id, p_signed_date,
        'processed', v_payment.payment_id, v_order.order_id, v_action_taken, p_payload_hash, p_raw_payload, now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'action', v_action_taken,
        'code', 'NOTIFICATION_PROCESSED',
        'notification_uuid', p_notification_uuid,
        'paymentId', v_payment.payment_id,
        'orderId', v_order.order_id,
        'transactionId', p_transaction_id
    );
END;
$$;

COMMENT ON FUNCTION public.process_apple_notification IS
    'Atomically processes verified Apple App Store Server Notifications V2 (REFUND, REVOKE, REFUND_REVERSED, TEST). Enforces transactional advisory locking, notification idempotency, out-of-order event ordering protection, cross-platform entitlement ownership validation, multi-source entitlement survival, and durable event ledger auditing.';

-- 3. Grants & Permissions: Revoke from public, anon, authenticated; grant strictly to service_role
REVOKE ALL ON FUNCTION public.process_apple_notification FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_apple_notification TO service_role;

