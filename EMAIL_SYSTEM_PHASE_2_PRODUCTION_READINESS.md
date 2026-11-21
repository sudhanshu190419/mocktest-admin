# Make Me Topper — Transactional Email Notification System
## Phase 2: Final Production Deployment Readiness Audit

**Status:** Independent Technical Audit Complete  
**Date:** 2026-11-20  
**Target Repository:** `C:\Projects\mocktest-admin`  
**Mobile Reference:** `C:\Projects\MockTestApp` (Read-only, verified untouched)  
**Authoritative Supabase Project:** `ocolfottogbybitfpdqy`  
**Auditor Mode:** STRICTLY READ-ONLY  

---

## Executive Summary & Final Verdict

### Audit Verdict: **READY AFTER SPECIFIED CORRECTIONS**

Phase 2 introduces automated transactional emails for the **8 core commerce and financial events** (`PAY-01` to `PAY-06`, `INS-01` to `INS-02`). The underlying architecture is sound, adheres to asynchronous database queuing via `public.enqueue_email_job`, maintains complete isolation from payment transactions, and enforces deterministic idempotency.

However, production deployment must be gated until **two essential content corrections** and **cross-provider boundary clarifications** are applied:
1. **PAY-03 Refund Promise:** The template currently makes an absolute, legally binding promise that debited funds *"will automatically be refunded within 5–7 business days"*. This guarantee is outside platform control and invalid for Apple IAP, Google Play, and certain card banking networks. It must be revised to an advisory notice.
2. **INS-02 Permanent Ownership Clarity:** The completion template celebrates "permanent full ownership" without reiterating that live-class batch allocation and timetables remain administratively scheduled. This risks student confusion regarding instant live-class admittance.
3. **Mobile In-App Purchase Email Parity:** Native iOS StoreKit 2 and Android Google Play purchases in `verify-apple-purchase` and `verify-google-play-purchase` fulfill database entitlements, but are not yet wired to `enqueueEmailSafe`. This boundary must be explicitly recognized prior to release.

---

## 1. Exhaustive Verification of All Eight Events

Every event trigger, condition, recipient resolution path, and idempotency mechanism in the actual codebase was inspected:

### 1.1. PAY-01: Course Purchase Confirmed
- **File:** `supabase/functions/complete-course-purchase/index.ts` (lines 948–992)
- **Backend Trigger:** In Step 11, immediately after database enrollment creation and in-app notifications (`course_purchased` and `course_enrolled`).
- **Trigger Condition:** Strictly conditional upon `fulfill_standard_course_order` returning `success = true`. If fulfillment fails, is duplicate, or requires review, `PAY-01` is never enqueued.
- **Recipient Resolution:** `recipientProfileId: profileId`, `studentId: studentId`. `enqueueEmailSafe` resolves authoritative email and name directly from `public.profiles`.
- **Idempotency Key:** `course_enrolled:${enrollmentId}`. The unique UUID of the committed `course_enrollments` row prevents duplicate delivery on webhook retries.
- **Product Truthfulness:** Features an explicit callout that live-class timetables and batch allocations are scheduled by the academic administration.

### 1.2. PAY-02: PYQ Package Purchase Confirmed
- **File:** `supabase/functions/complete-pyq-purchase/index.ts` (lines 860–905)
- **Backend Trigger:** In Step 12, following successful execution of `fulfill_standard_pyq_order` RPC and in-app notifications (`pyq_purchased` and `pyq_access_granted`).
- **Trigger Condition:** Fulfills only when `fulfillData.success` is true.
- **Recipient Resolution:** `recipientProfileId: profileId`, `studentId: studentId` $\rightarrow$ resolved from `profiles`.
- **Idempotency Key:** `pyq_purchase:${purchaseId}`. Unique UUID of the created `student_pyq_purchases` record.
- **Product Truthfulness:** Accurately promises immediate question paper and solutions access in mobile and web apps.

### 1.3. PAY-03: Payment Failed
- **File:** `supabase/functions/razorpay-webhook/index.ts` (lines 2627, 2900, 2946)
- **Backend Trigger:** Inside `handleRazorpayPaymentFailed` when an authoritative `payment.failed` webhook event is processed for:
  1. An existing pending payment row updated to `failed`.
  2. A pending order placeholder attempt marked `failed`.
  3. A new subsequent failed attempt recorded via `create_standard_payment_attempt`.
- **Anti-Downgrade Safeguard:** Before calling `sendPaymentFailedEmail`, the webhook checks:
  1. If payment was already captured (`existingPaymentByGatewayId.status === 'captured'`), failure event is ignored.
  2. If order already has any captured attempt (`orderPayments.find(p => p.status === 'captured')`), failure event is recorded solely for audit; no email is sent.
  3. Inside `sendPaymentFailedEmail`: Queries `orders.status`. If `confirmed` or `completed`, the email is completely suppressed.
- **Recipient Resolution:** Resolved via `orders.profile_id` through `enqueueEmailSafe`.
- **Idempotency Key:** `pay_failed:${razorpayPaymentId}`. Protects against redundant webhook redeliveries.

### 1.4. PAY-04: Refund Processed
- **Files:**
  1. `supabase/functions/razorpay-webhook/index.ts` (lines 2032, 2088)
  2. `supabase/functions/apple-app-store-notifications/index.ts` (lines 295–320)
- **Backend Trigger:**
  - **Razorpay Standard:** Triggered when `reconcile_standard_refund` RPC succeeds and `targetStatus === 'processed'`.
  - **Razorpay Installments:** Triggered when `installment_adjustments` row is inserted and `payments.refund_amount` updated with `targetStatus === 'processed'`.
  - **Apple IAP:** Triggered when `process_apple_notification` RPC finishes with `action` starting with `refund_processed`.
- **Trigger Condition:** Strictly gated on `targetStatus === 'processed'`. Preliminary `refund.created` (initiated) or `refund.failed` events do NOT trigger customer refund emails.
- **Recipient Resolution:** Resolved from `orders.profile_id` or `orders.student_id`.
- **Idempotency Key:** `pay_refund:${refundId}` (e.g. `rfnd_xxx` or Apple `transactionId`).

### 1.5. PAY-05: Payment Received — Under Verification
- **Files:**
  1. `supabase/functions/complete-course-purchase/index.ts` (line 872)
  2. `supabase/functions/complete-pyq-purchase/index.ts` (line 770)
  3. `supabase/functions/razorpay-webhook/index.ts` (line 4015)
- **Backend Trigger:** Triggered when a payment has been captured by the gateway, but product onboarding cannot complete automatically (e.g. duplicate payment, superseded plan conflict, order mismatch, or `ORDER_REQUIRES_ADMIN_REVIEW`).
- **Trigger Condition:** Gated on `code === 'ORDER_REQUIRES_ADMIN_REVIEW'` or `onboardingResult.requiresReview === true`.
- **Recipient Resolution:** `recipientProfileId: profileId` / `order.profile_id`.
- **Idempotency Key:** `pay_review:${orderId}`. Guarantees that multiple conflicting callbacks for the same order only enqueue a single verification notice.
- **Content:** Reassures student that payment was captured and prominently warns: `⚠️ PLEASE DO NOT PAY AGAIN`.

### 1.6. PAY-06: Entitlement Revoked
- **File:** `supabase/functions/apple-app-store-notifications/index.ts` (lines 322–345)
- **Backend Trigger:** App Store Server Notification V2 `REVOKE` event.
- **Trigger Condition:** Gated strictly on `outerPayload.notificationType === 'REVOKE'` AND `rpcData.action === 'revocation_processed_entitlement_revoked'`.
  - If the entitlement belongs to a foreign owner or was preserved under multi-source protection (`revocation_processed_entitlement_preserved_foreign_owner` or `revocation_processed_entitlement_preserved_multisource`), no email is sent!
- **Recipient Resolution:** `rpcData.orderId -> orders.profile_id -> profiles`.
- **Idempotency Key:** `entitlement_revoked:${txPayload.transactionId || outerPayload.notificationUUID}`.

### 1.7. INS-01: Initial Installment Paid
- **File:** `supabase/functions/complete-installment-purchase/index.ts` (lines 610–630)
- **Backend Trigger:** Triggered after `process_installment_payment` database settlement succeeds and `syncCourseEnrollment` confirms active status.
- **Trigger Condition:** Gated on `isInitialInstallment = !existingAgreement || existingAgreement.agreement_status === 'pending_initial_payment'`.
- **Recipient Resolution:** `recipientProfileId: body.profileId`, `studentId: studentId`.
- **Idempotency Key:** `inst_init:${agreementId}`.
- **Content:** Full plan breakdown: initial payment amount, total fee, outstanding balance, and next installment due date.

### 1.8. INS-02: Subsequent Installment Paid
- **File:** `supabase/functions/complete-installment-purchase/index.ts` (lines 631–655)
- **Backend Trigger:** Triggered after successful installment payment allocation on an already active agreement (`isInitialInstallment === false`).
- **Trigger Condition:** Gated on `isInitialInstallment === false` and `parsedSettlement.success === true`.
- **Recipient Resolution:** `recipientProfileId: body.profileId`, `studentId: studentId`.
- **Idempotency Key:** `inst_payment:${body.paymentId}`.
- **Content:** Milestone number (`Installment #k`), amount paid, remaining balance, next due date, and permanent ownership transition flag (`isCompleted`).

---

## 2. Payment Safety & Financial Invariance Audit

| Safety Principle | Implementation Audit Findings | Status |
| :--- | :--- | :--- |
| **No Email Before Verification** | All confirmation emails (`PAY-01`, `PAY-02`, `INS-01`, `INS-02`) trigger strictly AFTER payment capture, signature verification, and atomic database RPC execution. | **VERIFIED** |
| **Anti-Downgrade Protection** | In `razorpay-webhook`, captured payments are immune to delayed `payment.failed` notifications. Both gateway check and local order status check suppress failure emails if already captured. | **VERIFIED** |
| **Confirmed Refunds Only** | `PAY-04` triggers only when `targetStatus === 'processed'`. Initiated (`created`) and failed refund events do not generate refund confirmation emails. | **VERIFIED** |
| **Review Deduplication** | `PAY-05` uses deterministic idempotency key `pay_review:${orderId}`. Redelivered webhooks or multiple conflict flags return existing queue jobs without re-enqueuing. | **VERIFIED** |
| **Genuine Apple Revocation** | `PAY-06` triggers only when `process_apple_notification` returns `revocation_processed_entitlement_revoked`. Entitlements preserved via multi-source payment are not emailed. | **VERIFIED** |
| **Transaction Invariance** | `enqueueEmailSafe` wraps all operations in `try/catch`. Enqueue failures, RPC timeouts, or missing profile rows NEVER throw or rollback financial transactions. | **VERIFIED** |

---

## 3. Content Truthfulness & Legal/Operational Analysis

### 3.1. The 5–7 Business-Day Automatic Refund Promise in PAY-03
In `supabase/functions/_shared/email/templates.ts` (lines 474–478):
```html
<div class="warning-card">
  <div style="font-weight: 600; margin-bottom: 4px;">Important: What if money was debited?</div>
  <div style="font-size: 13px; line-height: 1.5;">
    If your bank account or card was charged for this failed attempt, please rest assured that the funds are held by your bank and will automatically be refunded back to your account within <strong>5–7 business days</strong>.
  </div>
</div>
```

#### Operational & Legal Analysis:
1. **Unsupported Guarantee:** Make Me Topper did not collect the funds on a failed attempt; the funds are held by the issuing bank or payment gateway. Making an unqualified promise that funds *"will automatically be refunded within 5–7 business days"* creates a binding representation that Make Me Topper cannot guarantee.
2. **Provider Discrepancies:**
   - **UPI (India):** Under NPCI guidelines, auto-reversals typically occur in T+1 to T+5 days.
   - **Credit Cards / Net Banking:** Bank turnaround frequently extends to 7–10 business days.
   - **Apple App Store:** In-app purchase failures or authorization holds are governed entirely by Apple and card networks, which can take up to 30 days for authorization holds to expire.
3. **Required Correction:** Soften the guarantee to an advisory statement:
   > *"If your bank account or card was charged for this failed attempt, the funds are held by your banking institution and are typically released or reversed within 5 to 7 business days depending on your bank's reconciliation cycle. If you do not see the reversal after this period, please contact your bank or reach out to our support team."*

---

### 3.2. INS-02 Permanent Course Ownership & Batch Boundaries
In `supabase/functions/_shared/email/templates.ts` (lines 876–878):
```html
<div style="margin: 20px 0; padding: 14px; background-color: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 4px; font-size: 14px; color: #166534;">
  <strong>Permanent Ownership:</strong> Your enrollment status has been upgraded to permanent full ownership. You will enjoy continuous access to all course resources.
</div>
```

#### Operational Analysis:
1. **Batch Assignment Boundary:** In Make Me Topper, full permanent ownership (`enrollment_type = 'purchase'`) unlocks curriculum videos, notes, mock tests, and recordings. However, live-class batch assignment, timetable integration, and teacher-student batch allocations are **always managed and assigned manually by the institute/admin**.
2. **Missing Batch Notice:** `PAY-01` and `INS-01` explicitly state that live classes and batch allocations are scheduled by the academic team. `INS-02` omitted this notice when completing installment payments.
3. **Required Correction:** Add the standard batch disclaimer to the completion state of `INS-02`:
   > *"Note on Batch & Live Classes: Live class batch assignments and timetables continue to be scheduled and allocated by the academic team. You will be notified in your student portal when batch schedules are published."*

---

## 4. Email Queue Reliability & Pre-Enqueue Failure Analysis

### 4.1. Behavior Under Edge-Case Failures
Inspection of `enqueueEmailSafe` (`supabase/functions/_shared/email/enqueue.ts`):

| Scenario | Behavior in `enqueueEmailSafe` | Business Impact |
| :--- | :--- | :--- |
| **Queue Insertion Fails (RPC Error)** | Caught in `if (rpcError)`. Returns `{ success: false, error }`. Structured log warning recorded. | Caller does NOT crash. Financial transaction succeeds. |
| **Supabase Unavailable / Timeout** | Caught in outer `catch (err)`. Returns `{ success: false, error }`. Structured log error recorded. | Caller does NOT crash. Financial transaction succeeds. |
| **Missing or Malformed Recipient Email** | Validates email syntax. If empty or no `@`, logs `EMAIL_ENQUEUE_SKIPPED_NO_RECIPIENT_EMAIL` and returns `{ success: true, skipped: true }`. | Caller does NOT crash. Unsent state acknowledged cleanly. |
| **Duplicate Webhook / Callback** | Passes `p_idempotency_key` to `enqueue_email_job`. Postgres returns existing row `{ status: 'existing' }`. | Zero duplicate jobs created. |

### 4.2. Risk of Pre-Enqueue Permanent Loss
- **Vulnerability Identified:** Because email enqueueing is a secondary, non-transactional RPC call executed AFTER the primary database RPC has committed, an Edge Function crash or network disruption between fulfillment and `enqueue_email_job` could result in a permanent failure to enqueue the email. The student is enrolled, but the email job never enters `public.email_queue`.
- **Recommended Self-Healing Reconciliation Mechanism:**
  Create an automated background reconciliation query (or Supabase cron job) run every 60 minutes:
  ```sql
  -- Identify confirmed course enrollments missing from email_queue
  SELECT e.enrollment_id, e.student_id, e.course_id, e.created_at
  FROM public.course_enrollments e
  LEFT JOIN public.email_queue q 
    ON q.idempotency_key = 'course_enrolled:' || e.enrollment_id
  WHERE q.queue_id IS NULL
    AND e.created_at > now() - interval '24 hours';
  ```
  Because `enqueue_email_job` is idempotent, this reconciliation query can safely re-invoke `enqueue_email_job` without any risk of duplicate emails.

---

## 5. Cross-Provider Coverage Matrix

An evidence-based audit of source code across payment gateways:

| Business Event | Razorpay (Web / Admin) | Apple App Store (iOS) | Google Play (Android) | Technical Reality & Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **PAY-01** (Course Purchase) | **IMPLEMENTED** | **PARTIALLY IMPLEMENTED** | **PARTIALLY IMPLEMENTED** | Web checkout is fully wired via `complete-course-purchase`. In-app purchases in `verify-apple-purchase` and `verify-google-play-purchase` fulfill in database via RPC, but email enqueue is not yet wired. |
| **PAY-02** (PYQ Purchase) | **IMPLEMENTED** | **PARTIALLY IMPLEMENTED** | **PARTIALLY IMPLEMENTED** | Web checkout fully wired via `complete-pyq-purchase`. Native IAP verification functions lack email enqueue calls. |
| **PAY-03** (Payment Failed) | **IMPLEMENTED** | **NOT APPLICABLE** | **NOT APPLICABLE** | Gateway payment failures are authoritatively reported via `razorpay-webhook`. Apple and Google Play handle payment failures entirely client-side; no server failure event exists for non-subscriptions. |
| **PAY-04** (Refund Processed) | **IMPLEMENTED** | **IMPLEMENTED** | **UNSUPPORTED** | Fully implemented in `razorpay-webhook` (standard & installment refunds) and `apple-app-store-notifications` (`REFUND` type). Google Play has no active RTDN webhook in the repository to ingest refund events. |
| **PAY-05** (Payment Under Verification) | **IMPLEMENTED** | **NOT APPLICABLE** | **NOT APPLICABLE** | Triggered on Razorpay order conflicts and duplicate payments. Apple and Google IAP settle synchronously or fail; no asynchronous admin verification state exists for IAP. |
| **PAY-06** (Entitlement Revoked) | **NOT APPLICABLE** | **IMPLEMENTED** | **UNSUPPORTED** | StoreKit 2 Family Sharing revocations are handled in `apple-app-store-notifications`. Razorpay does not feature entitlement revocation; Google Play lacks a revocation webhook. |
| **INS-01** (Initial Installment) | **IMPLEMENTED** | **NOT APPLICABLE** | **NOT APPLICABLE** | Installment plans are exclusive to Make Me Topper's custom engine via Razorpay. |
| **INS-02** (Subsequent Installment) | **IMPLEMENTED** | **NOT APPLICABLE** | **NOT APPLICABLE** | Installment plans are exclusive to Make Me Topper's custom engine via Razorpay. |

---

## 6. Deployment Requirements

### 6.1. Edge Functions Modified and Requiring Deployment

The following **7 Edge Functions** must be deployed to Supabase project `ocolfottogbybitfpdqy`:

1. `complete-course-purchase` — Modified (wired to `enqueueEmailSafe` for PAY-01 and PAY-05).
2. `complete-pyq-purchase` — Modified (wired to `enqueueEmailSafe` for PAY-02 and PAY-05).
3. `complete-installment-purchase` — Modified (wired to `enqueueEmailSafe` for INS-01, INS-02, and PAY-05).
4. `razorpay-webhook` — Modified (wired to `enqueueEmailSafe` for PAY-03, PAY-04, and PAY-05).
5. `apple-app-store-notifications` — Modified (wired to `enqueueEmailSafe` for PAY-04 and PAY-06).
6. `email-worker` — **MANDATORY REDEPLOYMENT**:
   - `email-worker` imports `renderEmail` from `../_shared/email/templates.ts`. In Phase 1, `templates.ts` only included `test_email`. Without redeploying `email-worker`, the background worker would render generic fallback text instead of the newly authored Phase 2 commerce templates.
   - `emailWorkerCore.ts` default reply-to was updated to `support@inovoxy.com`.
7. `email-webhook` — New endpoint receiving Svix delivery, bounce, and complaint webhooks from Resend.

### 6.2. Shared Dependency Bundling
Each Edge Function bundles its local copy of `supabase/functions/_shared/` at deployment time. Modifying `_shared/email/enqueue.ts` and `_shared/email/templates.ts` automatically incorporates into all 7 deployed functions.

### 6.3. Database Migration Status
- **Status:** **Zero new migrations required.**
- **Verification:** Migration 251 (`251_email_notification_queue.sql`) was already manually applied to the production database and contains all required tables (`email_queue`, `email_suppressions`, `email_delivery_logs`) and the `public.enqueue_email_job(...)` RPC. Historical migrations `001` through `251` remain completely immutable.

---

## 7. Automated Test Evaluation & Delivery Realism

### 7.1. Test Suite Execution
Execution of the combined test suites:
```bash
cd C:\Projects\mocktest-admin
npx vitest run src/services/admin/__tests__/emailCommercePhase2.test.ts src/services/admin/__tests__/emailQueueWorkerCore.test.ts
```
**Results:**
- `emailCommercePhase2.test.ts`: **19/19 passed**
- `emailQueueWorkerCore.test.ts`: **34/34 passed**
- **Total:** **53/53 passed (100%)**

### 7.2. Test Reality vs. Production Delivery
1. **Mock Provider vs. Live Resend:** All unit tests execute against `MockEmailProvider` or in-memory mock clients. **No test sends real emails through `api.resend.com`**.
2. **DNS & Deliverability Prerequisites:** Successful test execution does not prove inbox deliverability. Production delivery depends on active, verified DNS records (`SPF`, `DKIM`, and `DMARC`) for `makemetopper.com` in the Resend dashboard.
3. **Database Concurrency:** In-memory mock tests do not test Postgres transaction isolation levels or row locks. However, Migration 251’s `claim_email_queue_batch` RPC uses `FOR UPDATE SKIP LOCKED`, which is proven concurrency-safe in PostgreSQL 16.

---

## 8. Exact Production Deployment Commands

*(DO NOT EXECUTE UNTIL CONTENT CORRECTIONS ARE APPLIED)*

```bash
# 1. Authenticate and link project
supabase link --project-ref ocolfottogbybitfpdqy

# 2. Deploy all modified Edge Functions
supabase functions deploy complete-course-purchase --no-verify-jwt
supabase functions deploy complete-pyq-purchase --no-verify-jwt
supabase functions deploy complete-installment-purchase --no-verify-jwt
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy apple-app-store-notifications --no-verify-jwt
supabase functions deploy email-worker --no-verify-jwt
supabase functions deploy email-webhook --no-verify-jwt

# 3. Verify production secrets
supabase secrets set EMAIL_FROM="Make Me Topper <info@makemetopper.com>"
supabase secrets set EMAIL_REPLY_TO="support@inovoxy.com"
```

---

## 9. Required Corrections Before Deployment

Before triggering the deployment commands above, the following two edits should be made in `supabase/functions/_shared/email/templates.ts`:

1. **PAY-03 Template:** Change *"will automatically be refunded back to your account within 5–7 business days"* to advisory phrasing:
   > *"If your bank account or card was charged for this failed attempt, please rest assured that the funds are held by your banking institution and are typically released or reversed within 5 to 7 business days depending on your bank's reconciliation cycle."*
2. **INS-02 Template:** In the permanent ownership block (`isCompleted === true`), append the standard academic scheduling notice:
   > *"Note on Batch & Live Classes: Live class batch assignments and timetables continue to be scheduled and allocated by the academic team. You will be notified in your student portal as soon as your batch is scheduled."*

Once these two wording refinements are committed, the system is fully approved and ready for production deployment.

