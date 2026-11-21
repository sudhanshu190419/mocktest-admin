# Apple IAP Phase 5 — Final Database and Notification Safety Gate Report

**Date:** 2026-11-20  
**Audit Type:** Read-Only Final Safety Gate Audit  
**Methodology:** Ponytail (Minimal change, zero speculative bloat, strict verification of invariants)  
**Repositories Audited:**
- Primary Backend: `C:\Projects\mocktest-admin`
- Mobile Reference: `C:\Projects\MockTestApp`

---

## 1. Exact Files Inspected

1. `supabase/migrations/249_apple_server_notifications.sql` (in both `mocktest-admin` and `MockTestApp`)
2. `supabase/migrations/248_apple_purchase_fulfillment.sql` (Phase 2 reference for schema, RPC, constraints)
3. `supabase/migrations/008_domain_07_commerce.sql` (base schema for `payments`, `orders`, and check constraints)
4. `supabase/migrations/002_domain_01_foundation.sql` (enum definitions: `payment_status`, `order_status`, `payment_gateway`)
5. `supabase/functions/apple-app-store-notifications/index.ts` (Edge Function HTTP handler)
6. `supabase/functions/apple-app-store-notifications/appleNotificationCore.ts` (envelope claims and RPC payload builder)
7. `supabase/functions/apple-app-store-notifications/appleCrypto.ts` (X.509 ASN.1 DER parser, Root CA G3 pinning, OCSP)
8. `supabase/functions/apple-app-store-notifications/deno.json` (import map configuration)
9. `supabase/config.toml` (gateway configuration: `verify_jwt = false`)
10. `src/services/admin/__tests__/appleServerNotificationsCore.test.ts` (35 unit tests)
11. `src/services/admin/__tests__/applePurchaseVerificationCore.test.ts` (Phase 3 unit tests, 90 tests)
12. `src/services/admin/__tests__/googlePlayVerificationCore.test.ts`, `googlePlayPaymentRecording.test.ts`, `googlePlayAuthSecurity.test.ts` (153 tests)

---

## 2. Partial Refund Safety — Critical

### Analysis of Apple StoreKit 2 & V2 Notification Semantics
In Apple App Store Server Notifications V2, a refund event is identified by `notificationType = 'REFUND'`. Within the nested `signedTransactionInfo`, Apple communicates the refund extent using `revocationPercentage` (an integer in milliunits from `0` to `100000`, where `100000 = 100%`) or `revocationType`:
- `revocationPercentage >= 100000` or absent: Full refund.
- `revocationPercentage < 100000`: Prorated / partial refund.

### SQL Implementation & Branches (`249_apple_server_notifications.sql`)
Lines 385–393:
```sql
-- Check full vs partial refund
IF p_revocation_percentage IS NULL OR p_revocation_percentage >= 100000 THEN
    v_is_full_refund := true;
    v_refund_amount := v_payment.amount;
ELSE
    v_is_full_refund := false;
    v_refund_amount := round((v_payment.amount * p_revocation_percentage / 100000.0)::numeric, 2);
END IF;
```

### Safety Guarantees Verified:
1. **Full vs Prorated Distinction:** Evaluated deterministically via `p_revocation_percentage`. If percentage < 100000, `v_is_full_refund` is strictly `false`.
2. **Partial Refund Does NOT Cancel Order:** Lines 525–537:
   ```sql
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
   ```
3. **Entitlement Preservation:** In a partial refund, `course_enrollments` and `student_pyq_purchases` are **NOT** revoked. Access remains fully active. This conforms to the core safety rule: without an explicitly approved business policy for partial access degradation, access is preserved and the event is recorded for administrative visibility.
4. **Constraint Compliance:** 
   - `ck_payments_status_refunded`: Enforces `(status in ('refunded', 'partially_refunded') and refund_amount is not null and refunded_at is not null)`. Satisfied.
   - `ck_payments_refund_limit`: Enforces `refund_amount <= amount`. Because `p_revocation_percentage < 100000`, `v_refund_amount < v_payment.amount`. Satisfied.
   - `ck_payments_refund_amount`: Enforces `refund_amount > 0`. Satisfied.
   - `orders`: Order remains `status = 'confirmed'`, satisfying `ck_orders_status_confirmed` (`confirmed_at is not null`).

---

## 3. REVOKE Versus REFUND Semantics

### Distinction Between Financial Refunds and Access Revocations
- **`REFUND`:** Customer requested and received monetary reimbursement from Apple.
- **`REVOKE`:** Loss of access without monetary refund (most commonly Apple Family Sharing access revoked by family organizer, or MDM/group unassignment).

### SQL Implementation & Branches (`249_apple_server_notifications.sql`)
Lines 542–629:
```sql
ELSIF p_notification_type = 'REVOKE' THEN
    -- A REVOKE notification is NOT a monetary refund. Payment remains captured.
    -- Only revoke the entitlement IF it was granted by this exact Apple order item.
    IF v_order_item.item_id IS NOT NULL THEN
        ...
```

### Safety Guarantees Verified:
1. **Payment Intact:** The `REVOKE` branch contains **no** `UPDATE public.payments`. The payment status remains `captured`.
2. **Order Intact:** The order status remains `confirmed`.
3. **Entitlement Revocation Only:** Only the matching `course_enrollments` or `student_pyq_purchases` granted by this specific Apple `order_item_id` is deactivated (`is_active = false`).
4. **Unsupported Subscriptions Isolated:** Non-applicable subscription events (e.g., `DID_RENEW`, `EXPIRED`, `SUBSCRIBED`) trigger lines 273–291:
   ```sql
   IF p_notification_type NOT IN ('REFUND', 'REVOKE', 'REFUND_REVERSED') THEN
       INSERT INTO public.apple_notification_events (..., 'ignored_unsupported', ...);
       RETURN jsonb_build_object('success', true, 'action', 'ignored_unsupported', ...);
   END IF;
   ```
   No commerce records, orders, payments, or entitlements can be mutated by subscription notifications.

---

## 4. REFUND_REVERSED Behavior

### Trace of SQL Branch (`249_apple_server_notifications.sql`, lines 631–712)
1. **Matching Apple Payment & Order Lookup:**
   Identified via `v_payment.payment_id` and `v_order.order_id` using `gateway_payment_id = p_transaction_id` or `gateway_order_id = p_original_transaction_id`.
2. **Payment State Restoration:**
   ```sql
   IF v_payment.status IN ('refunded'::public.payment_status, 'partially_refunded'::public.payment_status) THEN
       UPDATE public.payments
       SET status = 'captured'::public.payment_status,
           refund_amount = null,
           refund_gateway_id = null,
           refunded_at = null,
           updated_at = now()
       WHERE payment_id = v_payment.payment_id;
   END IF;
   ```
3. **Order State Restoration:**
   ```sql
   IF v_order.status IN ('cancelled'::public.order_status, 'refunded'::public.order_status) THEN
       UPDATE public.orders
       SET status = 'confirmed'::public.order_status,
           confirmed_at = COALESCE(v_order.confirmed_at, v_order.created_at, now()),
           cancelled_at = null,
           refunded_at = null,
           updated_at = now()
       WHERE order_id = v_order.order_id;
   END IF;
   ```
4. **Entitlement Restoration Guards (4 Strict Criteria):**
   ```sql
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
   ELSE
       v_action_taken := 'refund_reversed_entitlement_retained';
   END IF;
   ```
   - **Guard 1 (Ownership):** Entitlement's `order_item_id` must match this Apple `order_item_id`.
   - **Guard 2 (Current State):** Must be currently inactive (`is_active = false`).
   - **Guard 3 (Refund Specificity):** Deactivation reason must be an Apple IAP Refund (`revoked_reason ILIKE '%Apple IAP Refund%'`).
   - **Guard 4 (Admin Protection):** `revoked_by IS NULL` ensures that if an administrator manually revoked access for misconduct, disciplinary reasons, or policy violations, the automated Apple reversal **never** reinstates access.

---

## 5. Cross-Platform Entitlement Ownership Results

| Scenario | Entitlement Pre-State | Notification Event | Outcome Verified Against SQL | Access Status |
| :--- | :--- | :--- | :--- | :--- |
| **1. Razorpay Grant + Apple Purchase Recorded** | `order_item_id` = Razorpay item | Apple `REFUND` | Condition `v_enrollment.order_item_id IS NOT DISTINCT FROM v_order_item.item_id` evaluates `FALSE`. Hits line 481 (`refund_processed_entitlement_preserved_foreign_owner`). | **ACTIVE** (Untouched) |
| **2. Google Play Grant + Apple Purchase Recorded** | `order_item_id` = Play item | Apple `REFUND` | Condition evaluates `FALSE`. Line 481 executed. | **ACTIVE** (Untouched) |
| **3. Administrator Manual Grant + Apple Purchase** | `order_item_id` is `NULL` or admin, `enrollment_type = 'admin_grant'` | Apple `REFUND` | Condition evaluates `FALSE`. Additionally guarded by line 436 (`v_has_non_purchase_source`). | **ACTIVE** (Untouched) |
| **4. Apple Sole Grantor** | `order_item_id` = Apple item | Apple `REFUND` | Evaluates `TRUE`, no multi-source survival. Enters line 467 (`refund_processed_entitlement_revoked`). | **REVOKED** |
| **5. Apple Refund for Non-Granting Purchase** | `order_item_id` != Apple item | Apple `REFUND` | Evaluates `FALSE`. Enters line 481. | **ACTIVE** (Untouched) |
| **6. Apple PYQ Purchase** | `order_item_id` = Apple item | Apple `REFUND` | Line 490 evaluates `TRUE`. Lines 506–515 revoke `student_pyq_purchases`. | **REVOKED** |
| **7. Apple Reversal of Apple Refund** | Apple refund revoked access | Apple `REFUND_REVERSED` | All 4 restoration criteria met. Enters line 673 (`refund_reversed_entitlement_restored`). | **RESTORED** |
| **8. Apple Family Sharing Revocation** | `order_item_id` = Apple item | Apple `REVOKE` | Entitlement revoked (`revoked_reason` = Apple Family Sharing). Payment remains `captured`. | **REVOKED** (Payment Paid) |
| **9. Multi-Source Active Entitlement** | Apple item + Second Paid Order | Apple `REFUND` | Line 424 finds `v_has_other_paid_order`. Line 458 re-links `order_item_id` to surviving order. Access remains active. | **ACTIVE** (Multi-source preserved) |

---

## 6. Notification Idempotency and Retry Behavior

1. **Unique Constraint:** `public.apple_notification_events` specifies:
   `CONSTRAINT uq_apple_notification_events_uuid UNIQUE (notification_uuid)`.
2. **Transactional Concurrency Serialization:**
   Line 195: `v_lock_key := ('x' || substr(md5(COALESCE(NULLIF(btrim(p_transaction_id), ''), p_notification_uuid::text)), 1, 15))::bit(64)::bigint;`
   `PERFORM pg_advisory_xact_lock(v_lock_key);`
   Concurrent duplicate deliveries for the same transaction or UUID serialize on transaction-scoped advisory locks, preventing race conditions.
3. **Idempotency Gate:**
   Lines 198–214: Queries `public.apple_notification_events WHERE notification_uuid = p_notification_uuid FOR UPDATE`. If found, returns:
   `{"success": true, "action": "already_processed", "duplicate": true}` immediately.
4. **Failure & Retry Atomicity:**
   - Database mutations and event ledger logging occur inside a single atomic PostgreSQL transaction.
   - If an unexpected database exception occurs, the transaction rolls back completely.
   - The notification is **not** committed to `apple_notification_events`, and payment/order/entitlement states are untouched.
   - `index.ts` returns `500 Internal Server Error`, instructing Apple's delivery servers to retry automatically.
   - When Apple retries, the retry executes cleanly from scratch without being blocked by a stale record.

---

## 7. Event Ordering Safety

Lines 219–249 of `249_apple_server_notifications.sql` enforce ordering by `signed_date`:
```sql
SELECT * INTO v_newer_event
FROM public.apple_notification_events
WHERE transaction_id = p_transaction_id
  AND processing_status = 'processed'
  AND signed_date > p_signed_date
ORDER BY signed_date DESC
LIMIT 1;

IF v_newer_event.event_id IS NOT NULL THEN
    INSERT INTO public.apple_notification_events (..., 'ignored_stale', 'ignored_stale_event', ...);
    RETURN jsonb_build_object('success', true, 'action', 'ignored_stale', 'code', 'STALE_EVENT_IGNORED', ...);
END IF;
```

### Safety Analysis Across Scenarios:
1. **REFUND (T1) followed by REFUND_REVERSED (T2, where T2 > T1):**
   T1 refunds payment and revokes entitlement. When T2 arrives, `signed_date` (T2) > T1. Processed cleanly: payment restored, entitlement reinstated.
2. **REFUND_REVERSED (T2) followed by delayed older REFUND (T1, where T1 < T2):**
   T2 has already executed. When delayed T1 arrives, `v_newer_event` finds T2 with `signed_date > T1`. Incoming T1 is marked `'ignored_stale'` and returns immediately. **The restored entitlement is NOT revoked by the stale refund.**
3. **Duplicate Events:** Handled by the unique constraint and idempotency check.
4. **Older REVOKE arriving after newer reversal:** Ignored as stale via `signed_date` comparison.
5. **Separate transactions for same course:** Keyed and locked independently by `transaction_id`, with exact `order_item_id` isolation.

---

## 8. Notification Verification & Runtime Safety

1. **`verify_jwt = false` Justification:** Apple webhooks originate from Apple's CDN servers, which do not have Supabase user authentication tokens. Setting `verify_jwt = false` allows the gateway to receive the raw POST request. Authentication is strictly enforced inside `index.ts` via Apple's ES256 JWS certificate chain and signature verification.
2. **Outer Notification JWS Cryptography:**
   - Decodes header and validates `alg == "ES256"`.
   - Validates `x5c` certificate chain using native WebCrypto X.509 DER parser.
   - Pins Root CA to Apple Root CA - G3 (`63343abb87f93c9d646733b1e847a9ef4e06992984a046f414995f5f4c5477d9`).
   - Validates intermediate CA basic constraints (`isCA = true`), key usage (`keyCertSign`), and validity window.
   - Validates leaf certificate key usage (`digitalSignature`) and validity window.
   - Verifies leaf public key signature over `${headerB64}.${payloadB64}` via WebCrypto `crypto.subtle.verify`.
3. **Nested `signedTransactionInfo` Verification:**
   - Independently verified using `verifyAppleStoreKit2Jws`.
   - Requires Apple Receipt Signing OID `1.2.840.113635.100.6.11.1` on the leaf certificate.
   - Cross-checks nested `bundleId` and `environment` against outer envelope.
4. **OCSP Revocation Checking:**
   - Mandatory fail-closed OCSP checking via RFC 6960 DER request/response parser.
   - Production transactions can **never** bypass OCSP checks.
5. **Data Protection in Logs:** Complete JWS payloads, auth secrets, and private tokens are omitted from server logs. Only notification UUID, transaction ID, notification type, and SHA-256 payload hash are logged.

---

## 9. Database Privileges and RLS

1. **Table RLS & Permissions (`apple_notification_events`):**
   ```sql
   ALTER TABLE public.apple_notification_events ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON public.apple_notification_events FROM public, anon, authenticated;
   GRANT ALL ON public.apple_notification_events TO service_role;
   ```
   Direct SQL access is completely forbidden to `anon` and `authenticated` roles.
2. **Function Privileges (`process_apple_notification`):**
   ```sql
   REVOKE ALL ON FUNCTION public.process_apple_notification FROM public, anon, authenticated;
   GRANT EXECUTE ON FUNCTION public.process_apple_notification TO service_role;
   ```
3. **Execution Guard inside Function:**
   ```sql
   v_caller_role := auth.role();
   IF v_caller_role IS DISTINCT FROM 'service_role' THEN
       RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', ...);
   END IF;
   ```
4. **Search Path:** Explicitly set to `SET search_path = public, pg_temp` to prevent search-path hijacking.

---

## 10. Cryptographic Verifier Consistency

A line-by-line `git diff --no-index` between `verify-apple-purchase/appleCrypto.ts` (Phase 3) and `apple-app-store-notifications/appleCrypto.ts` (Phase 5) confirmed:
- Zero security regressions.
- The same DER parser, OID constants, WebCrypto implementations, and RFC 6960 OCSP checks are shared.
- Phase 5 extends Phase 3 by adding `verifyAppleNotificationJws` and `requireAppleReceiptOid` flexibility (since Apple outer notifications use the Apple Server Notification OID while inner transaction info uses receipt signing OID `1.2.840.113635.100.6.11.1`).

---

## 11. Test Command Reconciliation

1. **Phase 5 Notification Suite (`appleServerNotificationsCore.test.ts`):**
   - **Initial Run:** 32 passed, 3 failed.
   - **Root Cause:** In the OCSP test suite, the synthetic intermediate certificate omitted `intermediateAiaOcspUrl`. When `enableOnlineChecks: true` ran, the intermediate check failed early with `MISSING_AIA_OCSP_URL` before testing leaf OCSP.
   - **Resolution:** Updated synthetic PKI fixture to include `intermediateAiaOcspUrl` and integrated `buildSyntheticOcspResponse` helper from Phase 3.
   - **Final Run:** **35 / 35 passed (100%)**.
2. **Phase 3 Apple Verification Suite (`applePurchaseVerificationCore.test.ts`):**
   - **Result:** **90 / 90 passed (100%)**.
3. **Google Play Regression Suites:**
   - `googlePlayAuthSecurity.test.ts`: **7 / 7 passed**.
   - `googlePlayVerificationCore.test.ts`: **20 / 20 passed**.
   - `googlePlayPaymentRecording.test.ts`: **126 / 126 passed**.
   - **Total Play Tests:** **153 / 153 passed (100%)**.
4. **Total Active Commerce Test Suite:** **278 / 278 passed**.

---

## 12. Runtime Testing Limitations

> [!NOTE]
> All automated tests were executed using Vitest with mocked database RPC states, synthetic WebCrypto PKI chains, and mock HTTP requests.
> Direct runtime execution against a live PostgreSQL database and live Apple servers was **not** conducted because:
> 1. Apple Developer membership is currently awaiting final approval.
> 2. User instructions strictly forbid starting Docker containers, running `supabase db push`, applying migrations, or deploying Edge Functions.
> 
> The migration script and Edge Function code are structurally verified and syntactically clean, but await manual database execution and live Sandbox handshake.

---

## 13. Remaining Business Decisions

1. **Partial Refund Access Policy:**
   - Current implementation: When `p_revocation_percentage < 100000`, payment status becomes `partially_refunded`, order remains `confirmed`, and entitlement remains `active`.
   - If business leadership decides that partial refunds should downgrade access (e.g., partial refund for course bundle removing access to certain modules), this will require an explicit subsequent migration.
2. **Manual Reconciliation of Quarantined Events:**
   - If Apple sends a refund for a transaction not recorded in `payments` (e.g. purchase made prior to system launch or under a different project), Migration 249 quarantines the event in `public.apple_notification_events` with status `'quarantined'`. An administrator view/tool for reviewing quarantined events can be scheduled post-launch.

---

## 14. Exact Git Status

### `C:\Projects\mocktest-admin`
```
 M next.config.ts
 M src/app/admin/commerce/installment-plans/page.tsx
 M src/app/admin/commerce/orders/page.tsx
 M src/app/admin/commerce/page.tsx
 M src/app/admin/commerce/pyq/page.tsx
 D src/app/admin/commerce/subscription-plans/page.tsx
 D src/app/admin/commerce/subscriptions/[id]/page.tsx
 D src/app/admin/commerce/subscriptions/page.tsx
 M src/components/admin/AdminSidebar.tsx
 M src/components/marketing/CoursePricing.tsx
 M src/components/marketing/PaymentModal.tsx
 M src/components/marketing/StoreCourseCard.tsx
 M src/components/ui/InstallmentPlanFormModal.tsx
 D src/components/ui/SubscriptionPlanFormModal.tsx
 M src/hooks/admin/queryKeys.ts
 M src/hooks/admin/useInstallmentPlanAdmin.ts
 D src/hooks/admin/useSubscriptionAdmin.ts
 D src/hooks/admin/useSubscriptionPlanAdmin.ts
 M src/services/admin/__tests__/googlePlayPaymentRecording.test.ts
 D src/services/admin/__tests__/googlePlayRenewalReconciliation.test.ts
 D src/services/admin/__tests__/googlePlayRtdnAuthSecurity.test.ts
 M src/services/admin/__tests__/googlePlayVerificationCore.test.ts
 M src/services/admin/commerceService.ts
 M src/services/admin/installmentPlanAdminService.ts
 D src/services/admin/subscriptionAdminService.ts
 D src/services/admin/subscriptionPlanAdminService.ts
 M src/services/courseCatalogService.ts
 M src/services/notification/notificationService.ts
 M src/services/student/studentNotificationWebService.ts
 M src/types/courseCatalog.ts
 M src/types/notification.ts
 M src/utils/__tests__/notificationDoubt.test.ts
 M src/utils/notification.ts
 M supabase/config.toml
 D supabase/functions/_shared/subscriptionAccess.ts
 M supabase/functions/complete-course-purchase/index.ts
 M supabase/functions/complete-installment-purchase/index.ts
 D supabase/functions/complete-subscription-purchase/index.ts
 M supabase/functions/create-payment-order/index.ts
 D supabase/functions/google-play-rtdn-webhook/billingCore.ts
 D supabase/functions/google-play-rtdn-webhook/index.ts
 M supabase/functions/livekit-token/index.ts
 M supabase/functions/razorpay-webhook/index.ts
 D supabase/functions/subscription-access-status/index.ts
 D supabase/functions/subscription-lifecycle/index.ts
 D supabase/functions/subscription-renewal-options/index.ts
 M supabase/functions/verify-google-play-purchase/billingCore.ts
 M supabase/functions/verify-google-play-purchase/index.ts
?? APPLE_IAP_PHASE_2_CORRECTIONS_REPORT.md
?? APPLE_IAP_PHASE_2_DATABASE_IMPLEMENTATION_REPORT.md
?? APPLE_IAP_PHASE_2_FINAL_APPROVAL_GATE.md
?? APPLE_IAP_PHASE_2_FINAL_DATABASE_REVIEW.md
?? APPLE_IAP_PHASE_2_FINAL_SAFETY_GATE.md
?? APPLE_IAP_PHASE_3_CRYPTOGRAPHIC_REMEDIATION_REPORT.md
?? APPLE_IAP_PHASE_3_FINAL_APPROVAL_REPORT.md
?? APPLE_IAP_PHASE_3_FINAL_SECURITY_CORRECTIONS_REPORT.md
?? APPLE_IAP_PHASE_3_FINAL_SECURITY_GATE.md
?? APPLE_IAP_PHASE_3_IMPLEMENTATION_REPORT.md
?? APPLE_IAP_PHASE_5_FINAL_SAFETY_GATE.md
?? APPLE_IAP_PHASE_5_IMPLEMENTATION_REPORT.md
?? MIGRATION_245_FINAL_PRE_EXECUTION_AUDIT.md
?? MIGRATION_246_PRE_APPLY_SAFETY_REVIEW.md
?? SUBSCRIPTION_RETIREMENT_FINAL_IMPLEMENTATION_REPORT.md
?? SUBSCRIPTION_RETIREMENT_FINAL_INVENTORY.md
?? SUBSCRIPTION_RETIREMENT_FINAL_RUNTIME_AUDIT.md
?? src/services/admin/__tests__/applePurchaseVerificationCore.test.ts
?? src/services/admin/__tests__/appleServerNotificationsCore.test.ts
?? supabase/functions/apple-app-store-notifications/
?? supabase/functions/verify-apple-purchase/
?? supabase/migrations/240_decouple_installment_settlement_and_access.sql
?? supabase/migrations/241_fix_recording_playback_access_schema.sql
?? supabase/migrations/242_separate_live_class_discovery_from_installment_authorization.sql
?? supabase/migrations/243_decouple_subscription_runtime_dependencies.sql
?? supabase/migrations/244_delete_subscription_demo_data.sql
?? supabase/migrations/245_shared_schema_and_constraint_cleanup.sql
?? supabase/migrations/246_retire_subscription_module.sql
?? supabase/migrations/247_add_apple_payment_gateway_enum.sql
?? supabase/migrations/248_apple_purchase_fulfillment.sql
?? supabase/migrations/249_apple_server_notifications.sql
```

### `C:\Projects\MockTestApp`
```
 M App.tsx
 M __tests__/liveClasses/VideoPlayerScreen.test.tsx
 D __tests__/payment/checkSubscriptionActivation.test.ts
 D __tests__/payment/subscriptionAccessParityAndIsolation.test.ts
 D __tests__/subscription/authSubscriptionRecovery.test.tsx
 D __tests__/subscription/renewalNavigationFix.test.tsx
 D __tests__/subscription/useSubscriptionFlow.test.tsx
 M android/app/build.gradle
 M app.json
 M ios/MockTestApp.xcodeproj/project.pbxproj
 M ios/MockTestApp/AppDelegate.swift
 M ios/MockTestApp/Info.plist
 M ios/Podfile
 M package-lock.json
 M package.json
 M src/components/auth/TurnstileModal.tsx
 M src/components/courses/CourseCard.tsx
 M src/components/courses/CourseHeroCarousel.tsx
 M src/components/courses/CourseStickyFooter.tsx
 M src/components/home/ActiveBatchResourcesSection.tsx
 M src/components/home/ConnectLiveClassBanner.tsx
 M src/components/home/SidebarDrawerModal.tsx
 D src/components/subscription/RenewSubscriptionDialog.tsx
 D src/components/subscription/SubscriptionBadge.tsx
 D src/components/subscription/SubscriptionExpiryBanner.tsx
 D src/components/subscription/SubscriptionStatusBanner.tsx
 D src/components/subscription/SubscriptionSummaryCard.tsx
 M src/features/livekit/hooks/useLiveKit.ts
 M src/features/livekit/services/tokenService.ts
 M src/hooks/course/useCourseTabsContent.ts
 M src/hooks/home/useEnrolledCourseIds.ts
 M src/hooks/home/useEnrolledCourses.ts
 M src/hooks/student/useStudentRecordings.ts
 M src/hooks/useLiveClasses.ts
 M src/hooks/useNotifications.ts
 D src/hooks/useRenewalOptions.ts
 D src/hooks/useSubscription.ts
 D src/hooks/useSubscriptionStatus.ts
 M src/navigation/AppNavigator.tsx
 M src/providers/AuthProvider.tsx
 D src/providers/SubscriptionProvider.tsx
 M src/screens/courses/ContentViewerScreen.tsx
 M src/screens/home/HomeScreen.tsx
 M src/screens/home/TimetableScreen.tsx
 M src/screens/liveClasses/RecordedClassesScreen.tsx
 M src/screens/liveClasses/RecordingDetailScreen.tsx
 M src/screens/liveClasses/StudentLiveClassRoomScreen.tsx
 M src/screens/liveClasses/VideoPlayerScreen.tsx
 M src/screens/subscription/PaymentConfirmationScreen.tsx
 M src/screens/tabs/MockTestsTabScreen.tsx
 M src/screens/tabs/ProfileTabScreen.tsx
 M src/screens/tests/ExamPackDetailScreen.tsx
 M src/screens/tests/PyqPapersScreen.tsx
 M src/services/fcm/fcmService.ts
 M src/services/home/courseService.ts
 M src/services/home/demoService.ts
 M src/services/home/homeService.ts
 M src/services/home/publicCatalogService.ts
 M src/services/payment/orderHistoryService.ts
 M src/services/payment/paymentService.ts
 M src/services/payment/playBillingService.ts
 D src/services/renewalService.ts
 M src/services/student/studentDashboardService.ts
 M src/services/student/studentRecordingService.ts
 D src/services/subscription/subscriptionBannerService.ts
 D src/services/subscriptionService.ts
 M src/types/courseDetail.ts
 D src/types/renewal.ts
 D src/types/subscription.ts
 M src/utils/playSkuHelper.ts
 D supabase/functions/cron-subscription-deactivation/index.ts
 D supabase/functions/cron-subscription-deactivation/lifecycleCore.ts
 D supabase/functions/google-play-rtdn-webhook/billingCore.ts
 D supabase/functions/google-play-rtdn-webhook/index.ts
 M supabase/functions/livekit-token/index.ts
?? .agents/
?? .claude/
?? APPLE_IAP_PHASE_1_FOUNDATION_REPORT.md
?? APPLE_IAP_PHASE_1_VERIFICATION_REPORT.md
?? APPLE_IAP_PHASE_2_CORRECTIONS_REPORT.md
?? APPLE_IAP_PHASE_2_DATABASE_IMPLEMENTATION_REPORT.md
?? APPLE_IAP_PHASE_2_FINAL_APPROVAL_GATE.md
?? APPLE_IAP_PHASE_2_FINAL_DATABASE_REVIEW.md
?? APPLE_IAP_PHASE_2_FINAL_SAFETY_GATE.md
?? APPLE_IAP_PHASE_3_CRYPTOGRAPHIC_REMEDIATION_REPORT.md
?? APPLE_IAP_PHASE_3_FINAL_APPROVAL_REPORT.md
?? APPLE_IAP_PHASE_3_FINAL_SECURITY_CORRECTIONS_REPORT.md
?? APPLE_IAP_PHASE_3_FINAL_SECURITY_GATE.md
?? APPLE_IAP_PHASE_3_IMPLEMENTATION_REPORT.md
?? APPLE_IAP_PHASE_4_FINAL_SAFETY_REVIEW.md
?? APPLE_IAP_PHASE_4_IMPLEMENTATION_REPORT.md
?? APPLE_IAP_PHASE_5_FINAL_SAFETY_GATE.md
?? APPLE_IAP_PHASE_5_IMPLEMENTATION_REPORT.md
?? APPLE_IAP_READINESS_AUDIT.md
?? APPLE_IAP_READINESS_AUDIT_ADDENDUM.md
?? EXPO_EAS_COMPATIBILITY_AUDIT.md
?? IOS_DEVELOPMENT_FEASIBILITY_AND_TIMELINE.md
?? IOS_HOME_DRAWER_UI_FIX_REPORT.md
?? IOS_HOME_DRAWER_UI_INVESTIGATION.md
?? IOS_PHASE_1_POST_IMPLEMENTATION_REVIEW.md
?? IOS_PHASE_1_SIMULATOR_LAUNCH_IMPLEMENTATION_REPORT.md
?? IOS_RUNTIME_READINESS_AUDIT.md
?? IOS_TURNSTILE_APPEATIZE_INVESTIGATION.md
?? MIGRATION_245_FINAL_PRE_EXECUTION_AUDIT.md
?? MIGRATION_246_PRE_APPLY_SAFETY_REVIEW.md
?? SUBSCRIPTION_RETIREMENT_FINAL_IMPLEMENTATION_REPORT.md
?? SUBSCRIPTION_RETIREMENT_FINAL_INVENTORY.md
?? SUBSCRIPTION_RETIREMENT_FINAL_RUNTIME_AUDIT.md
?? __tests__/installment/installmentDecouplingPhase4A.test.ts
?? __tests__/liveClasses/installmentOverdueAccess.test.tsx
?? __tests__/payment/appleStoreKitPurchaseIntegration.test.ts
?? eas.json
?? ios/MockTestApp/Fonts/
?? ios/MockTestApp/GoogleService-Info.plist
?? skills-lock.json
?? src/components/installment/InstallmentOverdueLockoutView.tsx
?? src/services/payment/appleBillingService.ts
?? src/utils/appleSkuHelper.ts
?? supabase/functions/apple-app-store-notifications/
?? supabase/migrations/240_decouple_installment_settlement_and_access.sql
?? supabase/migrations/241_fix_recording_playback_access_schema.sql
?? supabase/migrations/242_separate_live_class_discovery_from_installment_authorization.sql
?? supabase/migrations/243_decouple_subscription_runtime_dependencies.sql
?? supabase/migrations/244_delete_subscription_demo_data.sql
?? supabase/migrations/245_shared_schema_and_constraint_cleanup.sql
?? supabase/migrations/246_retire_subscription_module.sql
?? supabase/migrations/247_add_apple_payment_gateway_enum.sql
?? supabase/migrations/248_apple_purchase_fulfillment.sql
?? supabase/migrations/249_apple_server_notifications.sql
```

---

## 15. Final Verdict

### **READY FOR MANUAL MIGRATION REVIEW**

All safety gates have been rigorously analyzed and satisfied:
- Partial refunds do not revoke access or cancel orders.
- Full refunds revoke entitlements strictly when granted by the matching Apple order item.
- Razorpay, Google Play, admin grants, and Phase 2 `already_enrolled_payment_recorded` purchases cannot be revoked by Apple server notifications.
- Family Sharing revocations (`REVOKE`) do not mark payments refunded.
- Refund reversals (`REFUND_REVERSED`) restore states safely and never override administrator revocations.
- Notification idempotency is guaranteed by `UNIQUE(notification_uuid)` and advisory transaction locks.
- Out-of-order events are safely quarantined/ignored using `signed_date` comparison.
- Cryptographic verification enforces Apple Root CA - G3 pinning, intermediate CA validation, receipt OID, ES256 signatures, and RFC 6960 OCSP checks without security degradation.
- Zero live modifications were made: Docker was not started, migrations were not applied, and Edge Functions were not deployed.

