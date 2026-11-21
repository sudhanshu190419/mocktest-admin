# Apple IAP Phase 5 — App Store Server Notifications V2 Implementation Report

**Date:** 2026-11-20  
**Methodology:** Ponytail (Minimal surgical changes, zero speculative redesign, complete business protection)  
**Repositories:**  
- Backend: `C:\Projects\mocktest-admin`  
- Mobile Reference: `C:\Projects\MockTestApp`

---

## 1. `supabase/config.toml` Configuration

### Complete File Path
`C:\Projects\mocktest-admin\supabase\config.toml`

### Exact Configuration Added
```toml
[functions.apple-app-store-notifications]
verify_jwt = false
```

### Purpose & Security
App Store Server Notifications V2 are inbound HTTPS webhooks pushed directly by Apple servers. Apple does not possess Supabase project JWT tokens. Setting `verify_jwt = false` permits the gateway to accept Apple's signed notification payloads, where authentication is performed through cryptographic X.509 leaf certificate validation, Apple Root CA - G3 fingerprint pinning, and ES256 JWS signature verification.

---

## 2. Migration 249: SQL Implementation

### Complete File Paths
- Backend: `C:\Projects\mocktest-admin\supabase\migrations\249_apple_server_notifications.sql`
- Mobile Parity: `C:\Projects\MockTestApp\supabase\migrations\249_apple_server_notifications.sql`

### Database Verification Status
> [!IMPORTANT]
> **Safety Notice:** In strict accordance with user directives, Migration 249 has **NOT** been applied to the live database. It is staged and verified ready for manual inspection and deployment.

### Exact SQL Implementation
```sql
-- Migration 249: Apple App Store Server Notifications V2 Processing
--
-- Supports:
-- 1. Notification event ledger table (apple_notification_events) for idempotency and auditing.
-- 2. Transactional processing RPC (public.process_apple_notification) handling:
--    - REFUND (revoking Apple entitlements and marking order/payment cancelled/refunded)
--    - REVOKE (Family Sharing non-monetary revocation)
--    - REFUND_REVERSED (restoring entitlements and confirmed/paid status)
--    - TEST & unsupported notification types (safe acknowledgement)
--    - Advisory locking and out-of-order event ordering.
--    - Cross-platform entitlement protection (never revoking Razorpay/Play entitlements).

-- ============================================================================
-- 1. Notification Event Ledger Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.apple_notification_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_uuid uuid NOT NULL,
    notification_type text NOT NULL,
    subtype text,
    environment text NOT NULL,
    signed_date timestamptz NOT NULL,
    original_transaction_id text,
    transaction_id text,
    product_id text,
    raw_payload jsonb NOT NULL,
    processing_status text NOT NULL DEFAULT 'pending',
    processing_error text,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_apple_notification_events_uuid UNIQUE (notification_uuid),
    CONSTRAINT ck_apple_notification_events_status CHECK (
        processing_status IN ('pending', 'processed', 'ignored', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS idx_apple_notification_events_orig_tx 
    ON public.apple_notification_events (original_transaction_id) 
    WHERE original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_apple_notification_events_signed_date 
    ON public.apple_notification_events (signed_date DESC);

-- RLS: service_role only
ALTER TABLE public.apple_notification_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Service role can manage apple_notification_events" ON public.apple_notification_events;
    CREATE POLICY "Service role can manage apple_notification_events"
        ON public.apple_notification_events
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
END $$;

-- ============================================================================
-- 2. Notification Processing RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_apple_notification(
    p_notification_uuid uuid,
    p_notification_type text,
    p_subtype text,
    p_environment text,
    p_signed_date timestamptz,
    p_raw_payload jsonb,
    p_transaction_id text DEFAULT NULL,
    p_original_transaction_id text DEFAULT NULL,
    p_product_id text DEFAULT NULL,
    p_revocation_date timestamptz DEFAULT NULL,
    p_revocation_reason integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lock_key bigint;
    v_existing_event record;
    v_latest_signed_date timestamptz;
    v_payment record;
    v_order record;
    v_order_item record;
    v_course_id uuid;
    v_package_id uuid;
    v_clean_hex text;
    v_enrollment record;
    v_pyq_purchase record;
    v_reason_str text;
    v_action_taken text := 'ignored';
    v_refund_amount numeric(10,2) := 0;
BEGIN
    -- Validate required parameters
    IF p_notification_uuid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_notification_uuid is required');
    END IF;
    IF p_notification_type IS NULL OR length(trim(p_notification_type)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_notification_type is required');
    END IF;
    IF p_environment IS NULL OR p_environment NOT IN ('Sandbox', 'Production', 'Xcode') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid p_environment: ' || coalesce(p_environment, 'null'));
    END IF;
    IF p_signed_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_signed_date is required');
    END IF;

    -- Map numeric Apple revocation reason to readable text
    IF p_revocation_reason = 1 THEN
        v_reason_str := 'apple_issue_or_unintentional';
    ELSIF p_revocation_reason = 0 THEN
        v_reason_str := 'apple_other';
    ELSIF p_notification_type = 'REVOKE' THEN
        v_reason_str := 'apple_family_sharing_revoked';
    ELSE
        v_reason_str := 'apple_refunded';
    END IF;

    -- Concurrency serialization via advisory lock
    IF p_original_transaction_id IS NOT NULL AND length(trim(p_original_transaction_id)) > 0 THEN
        v_lock_key := ('x' || substr(md5('apple_notif_' || p_original_transaction_id), 1, 15))::bit(64)::bigint;
    ELSE
        v_lock_key := ('x' || substr(md5('apple_notif_uuid_' || p_notification_uuid::text), 1, 15))::bit(64)::bigint;
    END IF;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- 1. Idempotency Check
    SELECT * INTO v_existing_event
    FROM public.apple_notification_events
    WHERE notification_uuid = p_notification_uuid;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', v_existing_event.processing_status,
            'notification_uuid', p_notification_uuid,
            'message', 'Notification previously recorded and processed'
        );
    END IF;

    -- 2. Insert event ledger record as pending
    INSERT INTO public.apple_notification_events (
        notification_uuid,
        notification_type,
        subtype,
        environment,
        signed_date,
        original_transaction_id,
        transaction_id,
        product_id,
        raw_payload,
        processing_status
    ) VALUES (
        p_notification_uuid,
        p_notification_type,
        p_subtype,
        p_environment,
        p_signed_date,
        p_original_transaction_id,
        p_transaction_id,
        p_product_id,
        coalesce(p_raw_payload, '{}'::jsonb),
        'pending'
    );

    -- 3. Out-of-Order Check: Ensure we don't apply an event older than the latest processed event
    IF p_original_transaction_id IS NOT NULL THEN
        SELECT max(signed_date) INTO v_latest_signed_date
        FROM public.apple_notification_events
        WHERE original_transaction_id = p_original_transaction_id
          AND notification_uuid <> p_notification_uuid
          AND processing_status = 'processed';

        IF v_latest_signed_date IS NOT NULL AND p_signed_date < v_latest_signed_date THEN
            UPDATE public.apple_notification_events
            SET processing_status = 'ignored',
                processing_error = 'Out-of-order notification (signed_date precedes latest processed event)',
                processed_at = timezone('utc'::text, now())
            WHERE notification_uuid = p_notification_uuid;

            RETURN jsonb_build_object(
                'success', true,
                'status', 'ignored',
                'reason', 'OUT_OF_ORDER',
                'message', 'Notification signed_date is older than latest processed event'
            );
        END IF;
    END IF;

    -- 4. Branch by Notification Type
    IF p_notification_type = 'TEST' THEN
        v_action_taken := 'test_acknowledged';
        UPDATE public.apple_notification_events
        SET processing_status = 'processed',
            processed_at = timezone('utc'::text, now())
        WHERE notification_uuid = p_notification_uuid;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'processed',
            'action', v_action_taken,
            'notification_type', p_notification_type
        );

    ELSIF p_notification_type IN ('REFUND', 'REVOKE') THEN
        -- Find the corresponding Apple payment record
        SELECT * INTO v_payment
        FROM public.payments
        WHERE payment_gateway = 'apple'
          AND (
            gateway_payment_id = p_transaction_id
            OR gateway_order_id = p_original_transaction_id
            OR gateway_payment_id = p_original_transaction_id
          )
        ORDER BY created_at DESC
        LIMIT 1;

        IF NOT FOUND THEN
            UPDATE public.apple_notification_events
            SET processing_status = 'ignored',
                processing_error = 'No matching Apple payment found for transaction',
                processed_at = timezone('utc'::text, now())
            WHERE notification_uuid = p_notification_uuid;

            RETURN jsonb_build_object(
                'success', true,
                'status', 'ignored',
                'reason', 'PAYMENT_NOT_FOUND',
                'message', 'No matching Apple payment found in database'
            );
        END IF;

        -- Find the corresponding order
        SELECT * INTO v_order
        FROM public.orders
        WHERE id = v_payment.order_id;

        IF NOT FOUND THEN
            UPDATE public.apple_notification_events
            SET processing_status = 'failed',
                processing_error = 'Order not found for payment ' || v_payment.id::text,
                processed_at = timezone('utc'::text, now())
            WHERE notification_uuid = p_notification_uuid;

            RETURN jsonb_build_object(
                'success', false,
                'error', 'Order not found for payment'
            );
        END IF;

        -- Identify SKU & parse entity UUID
        IF p_product_id IS NOT NULL THEN
            IF p_product_id LIKE 'com.makemetopper.course.%' THEN
                v_clean_hex := replace(p_product_id, 'com.makemetopper.course.', '');
                IF length(v_clean_hex) = 32 THEN
                    v_course_id := (
                        substr(v_clean_hex, 1, 8) || '-' ||
                        substr(v_clean_hex, 9, 4) || '-' ||
                        substr(v_clean_hex, 13, 4) || '-' ||
                        substr(v_clean_hex, 17, 4) || '-' ||
                        substr(v_clean_hex, 21, 12)
                    )::uuid;
                END IF;
            ELSIF p_product_id LIKE 'com.makemetopper.pyq.%' THEN
                v_clean_hex := replace(p_product_id, 'com.makemetopper.pyq.', '');
                IF length(v_clean_hex) = 32 THEN
                    v_package_id := (
                        substr(v_clean_hex, 1, 8) || '-' ||
                        substr(v_clean_hex, 9, 4) || '-' ||
                        substr(v_clean_hex, 13, 4) || '-' ||
                        substr(v_clean_hex, 17, 4) || '-' ||
                        substr(v_clean_hex, 21, 12)
                    )::uuid;
                END IF;
            END IF;
        END IF;

        -- Find specific order item
        SELECT * INTO v_order_item
        FROM public.order_items
        WHERE order_id = v_order.id
          AND (
            (v_course_id IS NOT NULL AND item_id = v_course_id AND item_type = 'course')
            OR (v_package_id IS NOT NULL AND item_id = v_package_id AND item_type = 'pyq_package')
            OR (v_course_id IS NULL AND v_package_id IS NULL)
          )
        LIMIT 1;

        -- Entitlement Revocation Logic
        -- CRITICAL: Only revoke entitlements where order_item_id matches Apple order item!
        IF v_order_item.id IS NOT NULL THEN
            IF v_order_item.item_type = 'course' THEN
                SELECT * INTO v_enrollment
                FROM public.course_enrollments
                WHERE order_item_id = v_order_item.id
                  AND is_active = true;

                IF FOUND THEN
                    UPDATE public.course_enrollments
                    SET is_active = false,
                        revoked_at = coalesce(p_revocation_date, timezone('utc'::text, now())),
                        revoked_reason = v_reason_str,
                        revoked_by = NULL
                    WHERE id = v_enrollment.id;

                    v_action_taken := 'course_entitlement_revoked';
                ELSE
                    v_action_taken := 'no_active_course_entitlement_found';
                END IF;
            ELSIF v_order_item.item_type = 'pyq_package' THEN
                SELECT * INTO v_pyq_purchase
                FROM public.student_pyq_purchases
                WHERE order_item_id = v_order_item.id
                  AND is_active = true;

                IF FOUND THEN
                    UPDATE public.student_pyq_purchases
                    SET is_active = false,
                        revoked_at = coalesce(p_revocation_date, timezone('utc'::text, now())),
                        revoked_reason = v_reason_str,
                        revoked_by = NULL
                    WHERE id = v_pyq_purchase.id;

                    v_action_taken := 'pyq_entitlement_revoked';
                ELSE
                    v_action_taken := 'no_active_pyq_entitlement_found';
                END IF;
            END IF;
        END IF;

        -- Financial Ledger Updates (REFUND vs REVOKE)
        IF p_notification_type = 'REFUND' THEN
            -- Update payment record
            UPDATE public.payments
            SET status = 'refunded',
                refund_reason = v_reason_str,
                refund_amount = coalesce(amount, 0),
                refunded_at = coalesce(p_revocation_date, timezone('utc'::text, now()))
            WHERE id = v_payment.id;

            -- Update order record
            UPDATE public.orders
            SET status = 'cancelled',
                cancelled_at = coalesce(p_revocation_date, timezone('utc'::text, now())),
                confirmed_at = NULL,
                cancellation_reason = v_reason_str
            WHERE id = v_order.id;

            v_refund_amount := v_payment.amount;
        ELSIF p_notification_type = 'REVOKE' THEN
            -- Non-monetary revocation: log revocation on payment notes but do not mark payment refunded
            UPDATE public.payments
            SET notes = coalesce(notes, '') || ' [Apple Family Sharing Revoked at ' || timezone('utc'::text, now())::text || ']'
            WHERE id = v_payment.id;

            UPDATE public.orders
            SET notes = coalesce(notes, '') || ' [Apple Family Sharing Revoked at ' || timezone('utc'::text, now())::text || ']'
            WHERE id = v_order.id;
        END IF;

        -- Mark event processed
        UPDATE public.apple_notification_events
        SET processing_status = 'processed',
            processed_at = timezone('utc'::text, now())
        WHERE notification_uuid = p_notification_uuid;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'processed',
            'action', v_action_taken,
            'notification_type', p_notification_type,
            'payment_id', v_payment.id,
            'order_id', v_order.id,
            'refund_amount', v_refund_amount
        );

    ELSIF p_notification_type = 'REFUND_REVERSED' THEN
        -- Find the refunded Apple payment
        SELECT * INTO v_payment
        FROM public.payments
        WHERE payment_gateway = 'apple'
          AND (
            gateway_payment_id = p_transaction_id
            OR gateway_order_id = p_original_transaction_id
            OR gateway_payment_id = p_original_transaction_id
          )
        ORDER BY created_at DESC
        LIMIT 1;

        IF NOT FOUND THEN
            UPDATE public.apple_notification_events
            SET processing_status = 'ignored',
                processing_error = 'No matching payment for refund reversal',
                processed_at = timezone('utc'::text, now())
            WHERE notification_uuid = p_notification_uuid;

            RETURN jsonb_build_object('success', true, 'status', 'ignored', 'reason', 'PAYMENT_NOT_FOUND');
        END IF;

        SELECT * INTO v_order
        FROM public.orders
        WHERE id = v_payment.order_id;

        -- Restore payment & order
        UPDATE public.payments
        SET status = 'paid',
            refund_reason = NULL,
            refund_amount = NULL,
            refunded_at = NULL
        WHERE id = v_payment.id;

        UPDATE public.orders
        SET status = 'confirmed',
            cancelled_at = NULL,
            confirmed_at = coalesce(v_order.created_at, timezone('utc'::text, now())),
            cancellation_reason = NULL
        WHERE id = v_order.id;

        -- Restore entitlement ONLY if previously revoked due to Apple refund/issue
        SELECT * INTO v_order_item
        FROM public.order_items
        WHERE order_id = v_order.id
        LIMIT 1;

        IF v_order_item.id IS NOT NULL THEN
            IF v_order_item.item_type = 'course' THEN
                SELECT * INTO v_enrollment
                FROM public.course_enrollments
                WHERE order_item_id = v_order_item.id
                  AND is_active = false
                  AND revoked_reason IN ('apple_refunded', 'apple_issue_or_unintentional', 'apple_other');

                IF FOUND THEN
                    UPDATE public.course_enrollments
                    SET is_active = true,
                        revoked_at = NULL,
                        revoked_reason = NULL,
                        revoked_by = NULL
                    WHERE id = v_enrollment.id;

                    v_action_taken := 'course_entitlement_restored';
                END IF;
            ELSIF v_order_item.item_type = 'pyq_package' THEN
                SELECT * INTO v_pyq_purchase
                FROM public.student_pyq_purchases
                WHERE order_item_id = v_order_item.id
                  AND is_active = false
                  AND revoked_reason IN ('apple_refunded', 'apple_issue_or_unintentional', 'apple_other');

                IF FOUND THEN
                    UPDATE public.student_pyq_purchases
                    SET is_active = true,
                        revoked_at = NULL,
                        revoked_reason = NULL,
                        revoked_by = NULL
                    WHERE id = v_pyq_purchase.id;

                    v_action_taken := 'pyq_entitlement_restored';
                END IF;
            END IF;
        END IF;

        UPDATE public.apple_notification_events
        SET processing_status = 'processed',
            processed_at = timezone('utc'::text, now())
        WHERE notification_uuid = p_notification_uuid;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'processed',
            'action', v_action_taken,
            'notification_type', p_notification_type,
            'payment_id', v_payment.id,
            'order_id', v_order.id
        );

    ELSE
        -- Subscription / other notification types: safely ignored
        UPDATE public.apple_notification_events
        SET processing_status = 'ignored',
            processing_error = 'Notification type ' || p_notification_type || ' ignored (no action required for non-consumable goods)',
            processed_at = timezone('utc'::text, now())
        WHERE notification_uuid = p_notification_uuid;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'ignored',
            'notification_type', p_notification_type,
            'message', 'Notification type ignored safely'
        );
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        UPDATE public.apple_notification_events
        SET processing_status = 'failed',
            processing_error = SQLERRM,
            processed_at = timezone('utc'::text, now())
        WHERE notification_uuid = p_notification_uuid;

        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM,
            'sqlstate', SQLSTATE
        );
END;
$$;

-- Revoke public access and grant strictly to authenticated and service_role
REVOKE ALL ON FUNCTION public.process_apple_notification(uuid, text, text, text, timestamptz, jsonb, text, text, text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_apple_notification(uuid, text, text, text, timestamptz, jsonb, text, text, text, timestamptz, integer) TO service_role;
```

---

## 3. `deno.json` Configuration

### Complete File Paths
- Backend: `C:\Projects\mocktest-admin\supabase\functions\apple-app-store-notifications\deno.json`
- Mobile Parity: `C:\Projects\MockTestApp\supabase\functions\apple-app-store-notifications\deno.json`

### Contents
```json
{
  "imports": {
    "supabase": "jsr:@supabase/supabase-js@2"
  }
}
```

---

## 4. `appleCrypto.ts`: Cryptographic Implementation

### Complete File Paths
- Backend: `C:\Projects\mocktest-admin\supabase\functions\apple-app-store-notifications\appleCrypto.ts`
- Mobile Parity: `C:\Projects\MockTestApp\supabase\functions\apple-app-store-notifications\appleCrypto.ts`

### Cryptographic Security Logic
1. **WebCrypto X.509 DER Parser:** Custom RFC 5280 DER decoder extracting serial number, issuer, subject, validity, public key SPKI, Subject Alternative Names, Key Usage, Basic Constraints, AIA OCSP responder URL, and Apple OID extensions without native OpenSSL/Node dependencies.
2. **Apple Root CA - G3 Pinning:** Verifies that the chain terminates at Apple Root CA - G3 by SHA-256 fingerprint matching (`63343ab...b9840`).
3. **Chain of Trust Verification:**
   - Intermediate certificate signed by Root CA via ECDSA P-384 / P-256.
   - Leaf certificate signed by Intermediate CA via ECDSA P-256.
   - Both certificates checked for time validity (`notBefore` <= now <= `notAfter`).
4. **X.509 Extension Enforcement:**
   - Intermediate CA must have Basic Constraints `isCA = true` and Key Usage `keyCertSign`.
   - Leaf certificate must have Key Usage `digitalSignature` and MUST NOT have `isCA = true`.
   - Leaf certificate must possess the mandatory Apple Receipt / Server Notification Signing OID `1.2.840.113635.100.6.11.1`.
5. **ES256 Signature Verification:** Verified via WebCrypto `crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, leafPublicKey, signature, signingInput)`.
6. **Online OCSP Revocation Checking (RFC 6960):**
   - Extracts OCSP responder URL from AIA extension.
   - Builds binary DER OCSP request with SHA-1 `CertID` (`hashAlgorithm`, `issuerNameHash`, `issuerKeyHash`, `serialNumber`).
   - Parses DER OCSP response, verifies signature and validity window, and enforces fail-closed behavior on revoked, unknown, or network failure.

---

## 5. `appleNotificationCore.ts`: Business Logic & Validation

### Complete File Paths
- Backend: `C:\Projects\mocktest-admin\supabase\functions\apple-app-store-notifications\appleNotificationCore.ts`
- Mobile Parity: `C:\Projects\MockTestApp\supabase\functions\apple-app-store-notifications\appleNotificationCore.ts`

### Validation Flow
```
Inbound Notification JWS
    │
    ▼
[validateNotificationEnvelope]
    ├── notificationType in (REFUND, REFUND_REVERSED, REVOKE, TEST, etc.)
    ├── notificationUUID format (valid UUID regex)
    ├── version == "2.0"
    ├── signedDate bounds (now - 24h <= signedDate <= now + 1h)
    └── bundleId == "com.makemetopper.app"
    │
    ▼
[verifyAppleNotificationJws] (Cryptographic Chain & Signature)
    │
    ▼
[validateNestedTransactionClaims] (If signedTransactionInfo present)
    ├── ES256 & Certificate Chain of nested JWS
    ├── Cross-Check: bundleId matches outer envelope
    ├── Cross-Check: environment matches outer envelope
    └── SKU format: com.makemetopper.course.{uuid} OR com.makemetopper.pyq.{uuid}
    │
    ▼
[buildProcessNotificationRpcPayload] -> RPC Args
```

---

## 6. Edge Function HTTP Handler (`index.ts`)

### Complete File Paths
- Backend: `C:\Projects\mocktest-admin\supabase\functions\apple-app-store-notifications\index.ts`
- Mobile Parity: `C:\Projects\MockTestApp\supabase\functions\apple-app-store-notifications\index.ts`

### Response Codes & Handling
| Scenario | HTTP Status | Response Body |
| :--- | :--- | :--- |
| Valid Notification & Processed | `200 OK` | `{"success": true, "status": "processed", ...}` |
| Idempotent Duplicate | `200 OK` | `{"success": true, "idempotent": true, ...}` |
| Ignored (Unsupported / Out of Order / No Match) | `200 OK` | `{"success": true, "status": "ignored", ...}` |
| TEST Notification | `200 OK` | `{"success": true, "status": "processed", "action": "test_acknowledged"}` |
| Malformed JSON / Invalid Envelope | `400 Bad Request` | `{"error": "INVALID_ENVELOPE", "message": "..."}` |
| Cryptographic Verification Failed | `401 Unauthorized`| `{"error": "VERIFICATION_FAILED", "message": "..."}` |
| Environment Mismatch | `401 Unauthorized`| `{"error": "ENVIRONMENT_MISMATCH", "message": "..."}` |
| Database / RPC Connection Failure | `500 Internal Error`| `{"error": "DATABASE_ERROR", "message": "Processing failed"}` |

---

## 7. Database RPC: Concurrency & Idempotency

1. **Advisory Locking:** Computes 64-bit integer hash from MD5 of `apple_notif_` + `p_original_transaction_id` (or notification UUID). Acquired using `pg_advisory_xact_lock(v_lock_key)`. Serializes concurrent webhooks for the same Apple customer purchase.
2. **Ledger Table Idempotency:** Queries `apple_notification_events` on `notification_uuid`. Returns instant `200 OK` (`idempotent: true`) if already recorded.
3. **Out-of-Order Safety:** Before applying status updates, checks `max(signed_date)` of previously processed notifications for the same `original_transaction_id`. If incoming `p_signed_date < latest_signed_date`, marks status as `ignored` (`OUT_OF_ORDER`) to prevent stale states.

---

## 8. Detailed Breakdown: `REFUND` Processing

1. **Payment Lookup:** Finds `payments` record where `payment_gateway = 'apple'` matching `gateway_payment_id = transaction_id` or `gateway_order_id = original_transaction_id`.
2. **Order Lookup:** Retrieves `orders` record matching `payment.order_id`.
3. **Order Item Identification:** Matches `order_items` record using resolved `v_course_id` or `v_package_id`.
4. **Entitlement Revocation (Ownership Guard):**
   - For Courses: Deactivates `course_enrollments` WHERE `order_item_id = v_order_item.id AND is_active = true`.
   - For PYQ Packages: Deactivates `student_pyq_purchases` WHERE `order_item_id = v_order_item.id AND is_active = true`.
   - Sets `revoked_at = p_revocation_date`, `revoked_reason = v_reason_str`, `revoked_by = NULL`.
5. **Financial Records:**
   - `payments`: `status = 'refunded'`, `refund_amount = amount`, `refunded_at = revocation_date`, `refund_reason = v_reason_str`.
   - `orders`: `status = 'cancelled'`, `cancelled_at = revocation_date`, `confirmed_at = NULL`, `cancellation_reason = v_reason_str`.

---

## 9. Detailed Breakdown: `REVOKE` Processing (Family Sharing)

- Triggered when Apple revokes Family Sharing access for a family member.
- **Entitlement Revocation:** Locates and revokes the entitlement attached to that specific `order_item_id`.
- **Payment & Order Preservation:** Non-monetary revocation. The purchaser did NOT receive a refund. The payment status remains `paid` and order status remains `confirmed`. Notes are appended indicating Family Sharing revocation.

---

## 10. Detailed Breakdown: `REFUND_REVERSED` Processing

- Triggered if an Apple refund decision is successfully reversed or disputed.
- **Payment & Order Restoration:**
  - `payments`: `status = 'paid'`, `refund_amount = NULL`, `refunded_at = NULL`, `refund_reason = NULL`.
  - `orders`: `status = 'confirmed'`, `cancelled_at = NULL`, `confirmed_at = created_at`, `cancellation_reason = NULL`.
- **Entitlement Restoration Guard:**
  - Looks for deactivated entitlement attached to the Apple `order_item_id`.
  - **CRITICAL SAFETY GUARD:** ONLY restores if `revoked_reason IN ('apple_refunded', 'apple_issue_or_unintentional', 'apple_other')`.
  - Entitlements revoked by administrators (`admin_manual_revocation`, `terms_violation`, etc.) are **NEVER** re-activated.

---

## 11. Multi-Channel & Cross-Platform Safety

```
┌────────────────────────────────────────────────────────────────────────┐
│                      ISOLATION SAFETY MATRIX                           │
├───────────────────────┬────────────────────────┬───────────────────────┤
│ Entitlement Origin    │ Incoming Apple REFUND  │ Resulting Entitlement │
├───────────────────────┼────────────────────────┼───────────────────────┤
│ Razorpay Web Purchase │ order_item_id != Apple │ UNTOUCHED (ACTIVE)    │
│ Google Play Purchase  │ order_item_id != Apple │ UNTOUCHED (ACTIVE)    │
│ Admin Manual Grant    │ order_item_id IS NULL  │ UNTOUCHED (ACTIVE)    │
│ Phase 2 Re-enrollment │ order_item_id = Razor/ │ UNTOUCHED (ACTIVE)    │
│ (already_enrolled...) │ Play                   │                       │
│ Apple IAP Purchase    │ order_item_id = Apple  │ REVOKED               │
└───────────────────────┴────────────────────────┴───────────────────────┘
```
**Architectural Proof:** All revocation operations in `process_apple_notification` specify `WHERE order_item_id = v_order_item.id`. Because Razorpay, Google Play, admin grants, and Phase 2 `already_enrolled_payment_recorded` purchases do not have their entitlements linked to the Apple order item, they are mathematically immune to Apple refund cancellations.

---

## 12. Partial Refund & Multi-Item Orders

In the current Make Me Topper catalog, each Apple transaction represents a single non-consumable course or PYQ pack purchase. However, the database schema handles multi-item isolation:
- SKU parsing isolates the target course or PYQ package UUID.
- Entitlement revocation targets only the specific matching `order_item`.
- If an order contained multiple items and only one was refunded, only that item's entitlement is revoked.

---

## 13. Automated Test Suite

### Path
`C:\Projects\mocktest-admin\src\services\admin\__tests__\appleServerNotificationsCore.test.ts`

### Test Categories (35 Total Tests)
1. **Outer JWS & Certificate Chain (5 tests):** Valid JWS, invalid signature, corrupted payload, expired signedDate, invalid bundle ID.
2. **Certificate Chain Security (4 tests):** Untrusted root CA, intermediate not a CA, missing receipt OID, leaf validity period expired.
3. **Outer Envelope Validation (4 tests):** Valid envelope, invalid UUID, unsupported version, missing notificationType.
4. **Nested Transaction Claims (5 tests):** Valid nested JWS, missing transaction info, bundle ID cross-check mismatch, environment mismatch, invalid SKU prefix.
5. **Deterministic SKU & Entity Parsing (4 tests):** Course SKU parsing, PYQ SKU parsing, uppercase normalization, invalid SKU formats.
6. **Notification Subtypes & Edge Cases (3 tests):** Voluntary refund, unintentional refund, initial buy ignored safely.
7. **Production App ID Enforcement (2 tests):** Valid appAppleId accepted, mismatched appAppleId rejected.
8. **Online OCSP Revocation Checking (3 tests):** Certificate revoked fails, status unknown fails, network unavailable fails closed.
9. **Database RPC Invariants & Multi-Channel Protection (5 tests):** Full course refund, PYQ refund, Razorpay isolation, Family Sharing revocation, refund reversal with admin guard.

---

## 14. Test Output

```
> mocktest-admin@0.1.0 test
> vitest run src/services/admin/__tests__/appleServerNotificationsCore.test.ts

 RUN  v3.2.7 C:/Projects/mocktest-admin

 ✓ src/services/admin/__tests__/appleServerNotificationsCore.test.ts (35 tests) 318ms

 Test Files  1 passed (1)
      Tests  35 passed (35)
   Start at  01:52:41
   Duration  1.26s (transform 193ms, setup 0ms, collect 387ms, tests 318ms, environment 0ms, prepare 112ms)
```

---

## 15. Existing Unit Test Regression Verification

### Apple Phase 3 Verification Suite
```
> vitest run src/services/admin/__tests__/applePurchaseVerificationCore.test.ts

 RUN  v3.2.7 C:/Projects/mocktest-admin

 ✓ src/services/admin/__tests__/applePurchaseVerificationCore.test.ts (90 tests) 409ms

 Test Files  1 passed (1)
      Tests  90 passed (90)
   Duration  1.36s
```

### Google Play Billing Suite
```
> vitest run src/services/admin/__tests__/googlePlayVerificationCore.test.ts src/services/admin/__tests__/googlePlayPaymentRecording.test.ts src/services/admin/__tests__/googlePlayAuthSecurity.test.ts

 RUN  v3.2.7 C:/Projects/mocktest-admin

 ✓ src/services/admin/__tests__/googlePlayAuthSecurity.test.ts (7 tests) 8ms
 ✓ src/services/admin/__tests__/googlePlayVerificationCore.test.ts (20 tests) 10ms
 ✓ src/services/admin/__tests__/googlePlayPaymentRecording.test.ts (126 tests) 61ms

 Test Files  3 passed (3)
      Tests  153 passed (153)
   Duration  957ms
```
**Total Passing Regression Tests:** 278 tests (100% pass rate).

---

## 16. Database Table Schemas & Constraints Alignment

- `public.apple_notification_events`: Contains `uq_apple_notification_events_uuid` unique constraint on `notification_uuid`, ensuring at-most-once processing.
- `public.payments`: Satisfies `ck_payments_status` with `'refunded'` and `'paid'`.
- `public.orders`: Adheres to `ck_orders_status_cancelled` (`cancelled_at IS NOT NULL` when `cancelled`) and `ck_orders_status_confirmed` (`confirmed_at IS NOT NULL` when `confirmed`, `confirmed_at IS NULL` when not `confirmed`).
- `public.course_enrollments`: Adheres to `ck_course_enrollments_revocation` (`is_active = false`, `revoked_at IS NOT NULL`, `revoked_reason IS NOT NULL`).
- `public.student_pyq_purchases`: Adheres to `ck_student_pyq_purchases_revocation` with identical guarantees.

---

## 17. Function Signature and Return Value

### Installed Signature
```sql
public.process_apple_notification(
    p_notification_uuid uuid,
    p_notification_type text,
    p_subtype text,
    p_environment text,
    p_signed_date timestamptz,
    p_raw_payload jsonb,
    p_transaction_id text DEFAULT NULL,
    p_original_transaction_id text DEFAULT NULL,
    p_product_id text DEFAULT NULL,
    p_revocation_date timestamptz DEFAULT NULL,
    p_revocation_reason integer DEFAULT NULL
)
RETURNS jsonb
```

### JSON Return Structure
```json
{
  "success": true,
  "status": "processed",
  "action": "course_entitlement_revoked",
  "notification_type": "REFUND",
  "payment_id": "c1f7b8d0-...",
  "order_id": "e2a4c6e8-...",
  "refund_amount": 999.00
}
```

---

## 18. Edge Function Deployment Readiness

### Required Supabase Secrets
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key to access `apple_notification_events` and invoke `process_apple_notification`.
- `APPLE_BUNDLE_ID`: `com.makemetopper.app`.
- `APPLE_APP_ID`: `6742337777` (configured upon App Store Connect approval).
- `APPLE_ENVIRONMENT`: `Sandbox` (initial) or `Production`.
- `APPLE_ENABLE_ONLINE_CHECKS`: `true` (enables OCSP certificate revocation checks).

### Deployment Command
```bash
supabase functions deploy apple-app-store-notifications --no-verify-jwt
```

### App Store Connect Configuration
In App Store Connect -> **App Information** -> **App Store Server Notifications**:
- **Production Server URL:** `https://<project-ref>.supabase.co/functions/v1/apple-app-store-notifications`
- **Sandbox Server URL:** `https://<project-ref>.supabase.co/functions/v1/apple-app-store-notifications`
- **Version:** Version 2 Notifications

---

## 19. Production vs Sandbox Configuration

- The function inspects `APPLE_ENVIRONMENT` environment variable.
- In `Sandbox` mode, both `Sandbox` and `Xcode` environment notifications are accepted.
- In `Production` mode, `Sandbox` notifications are rejected with `401 Unauthorized` (`ENVIRONMENT_MISMATCH`).
- App Store Connect allows separate URLs for Production and Sandbox, which may both route to this endpoint because the function validates the incoming `data.environment` against its operational configuration.

---

## 20. Security Considerations

1. **Replay Attack Defense:** Protected by the unique constraint on `notification_uuid` and advisory locks on `original_transaction_id`. Replays return cached `200 OK` with zero database modifications.
2. **Spoofing Defense:** Untrusted inbound requests fail closed at leaf certificate verification against Apple Root CA - G3. Non-Apple root certificates or corrupted signatures are rejected with `401 Unauthorized`.
3. **Timing Attack Protection:** Cryptographic operations execute via native WebCrypto APIs.
4. **DoS Mitigation:** Supabase edge runtime enforces request payload body size caps.
5. **Data Protection:** Database RPC runs as `SECURITY DEFINER` with search path `public, pg_temp`. Public execute permissions are explicitly revoked.

---

## 21. Remaining Pre-Production Tasks

1. **Apple Developer Approval:** Await final account approval from Apple Developer Support.
2. **App Store Connect Credentials:**
   - Configure App Store Server Notification V2 URL in App Store Connect.
   - Send Apple Test Notification via App Store Connect to verify live webhook handshake.
3. **Database Migration:** Review and apply `supabase/migrations/249_apple_server_notifications.sql`.
4. **Edge Function Deployment:** Deploy `apple-app-store-notifications` and set secrets.
5. **Mobile Readiness:** Re-enable mobile purchase gate via `setAppleIapReadiness(true)` once live Sandbox end-to-end purchase is confirmed.

---

## 22. Repository Parity Check

| Component | `mocktest-admin` Path | `MockTestApp` Path | Status |
| :--- | :--- | :--- | :--- |
| Migration 249 | `supabase/migrations/249_apple_server_notifications.sql` | `supabase/migrations/249_apple_server_notifications.sql` | **Identical** |
| Edge Function | `supabase/functions/apple-app-store-notifications/` | `supabase/functions/apple-app-store-notifications/` | **Identical** |
| Test Suite | `src/services/admin/__tests__/appleServerNotificationsCore.test.ts` | Reference in Report | **Passed (35/35)** |

---

## 23. Safety Confirmations

- [x] **Database Safe:** Migration 249 has **NOT** been applied to the live database.
- [x] **Container Safe:** No Docker containers were launched or modified.
- [x] **Cloud Safe:** No Supabase Edge Functions were deployed to remote environments.
- [x] **Repository Safe:** All pre-existing uncommitted modifications remain preserved.
- [x] **Mobile Safe:** Apple checkout in `MockTestApp` remains locked until Developer Account approval and live Sandbox validation are concluded.

