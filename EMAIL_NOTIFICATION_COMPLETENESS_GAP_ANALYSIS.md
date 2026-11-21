# Make Me Topper — Transactional Email Notification System
## Second-Pass Completeness Audit & Gap Analysis Report

**Document Title:** `EMAIL_NOTIFICATION_COMPLETENESS_GAP_ANALYSIS.md`  
**Document Version:** 2.0.0  
**Audit Date:** November 20, 2026  
**Auditor:** Senior Principal Systems Architect & Database Engineer (Antigravity Ponytail Review)  
**Target Codebases:**  
- Website / Admin Panel: `C:\Projects\mocktest-admin`  
- Mobile Application: `C:\Projects\MockTestApp`  
- Database Backend: Supabase PostgreSQL 16 (`mocktest-admin/supabase`)  
**Audit Scope:** ANALYSIS ONLY — STRICTLY READ-ONLY (No code, migration, or infrastructure mutations)

---

## 1. Executive Summary

Following the initial architectural blueprint (*Make Me Topper — Transactional Email Notification System: Architectural Blueprint & System Design Specification*), this second-pass audit conducted a forensic, code-level completeness review across both codebases.

Our objective was to identify missing business events, eliminate false assumptions, reconcile event count discrepancies, prevent notification spam, and produce a definitive, production-ready master event matrix.

### Key Audit Findings:
1. **Resolution of Event Count Discrepancy:** The first blueprint contained an internal numerical inconsistency, listing 18 rows in its Section 4 matrix while summarizing 17 events in Section 15. The discrepancy was caused by categorizing the live-class cancellation (`ACA-02`) under academic announcements while counting categories loosely. In this second pass, we reconcile and expand the inventory to **24 rigorously verified transactional and operational email events**.
2. **Multi-Gateway Payment Gap:** The original blueprint focused almost exclusively on Razorpay webhooks. In reality, Make Me Topper operates three distinct payment gateways: **Razorpay** (Web/Android direct), **Google Play Billing** (Android IAP via `verify-google-play-purchase`), and **Apple StoreKit 2** (iOS IAP via `verify-apple-purchase` and `apple-app-store-notifications`). Digital enrollment confirmations, receipts, and refund notices must be emitted uniformly across all three gateways.
3. **Critical "Payment Under Review" Event Discovered:** In `razorpay-webhook` and `complete-course-purchase`, when a payment is captured but automated fulfillment fails (e.g. duplicate payment, course mismatch, or student ID conflict), the system transitions the order or agreement to `requires_admin_review = true` / `flagged_for_refund = true`. The student's money has been deducted, but course access is withheld. Previously, no email was planned for this state. An automated **"Payment Received — Order Under Verification"** email is vital to prevent panic and customer disputes.
4. **Phone-First Identity Invariant Verified:** Authentication is strictly phone-first via MSG91 SMS OTP (`024_phone_first_auth.sql`). Password resets are SMS-OTP gated; no email password reset workflow exists. `public.profiles.email` is nullable and unverified (collected during onboarding via `EmailCollectionScreen.tsx`). Therefore, emails cannot be sent at initial phone registration; a **Welcome Email** can only trigger when `profiles.email` is first populated. If a student's email is missing, the system must gracefully skip email delivery without interrupting business transactions.
5. **Installment Lifecycle Refinement:** The schedule generation is atomic with the initial payment in `process_installment_payment` (`219_installment_foundation_and_access_control.sql`); "Schedule Generated" is not a separate event, but part of the initial activation receipt. However, this audit confirmed two missing installment events: **"Installment Due Date Rescheduled"** (via `installment_adjustments`) and **"Arrears Cleared & Access Restored"** (when `overdue_balance` drops to zero and status returns to `active`).
6. **Notification Channel Separation:** Routine activities (practice quiz submissions, 60-day rolling timetable class materializations, daily class reminders, and interactive doubt chat messages) must **NEVER** generate emails. They belong strictly to mobile push notifications (FCM) or in-app notifications.

---

## 2. Existing Blueprint Review & Discrepancy Resolution

### 2.1 The 17 vs. 18 Event Count Discrepancy
In the initial blueprint:
- Section 4 presented 18 rows:
  - Account: `ACC-01`, `ACC-02`, `ACC-03`, `ACC-04` (4 rows)
  - Commerce/Payments: `PAY-01`, `PAY-02`, `PAY-03`, `PAY-04` (4 rows)
  - Installments: `INS-01` through `INS-07` (7 rows)
  - Examinations: `EXM-01` (1 row)
  - Academics: `ACA-01`, `ACA-02` (2 rows)
  - **Total: 4 + 4 + 7 + 1 + 2 = 18 rows.**
- Section 15 (Question 3) stated: *"17 primary events across four categories"*.
- **Root Cause:** Section 15 grouped `ACA-01` (batch assignment) into academics but inadvertently omitted `ACA-02` (emergency class cancellation) from the text summary tally.
- **Resolution:** This audit establishes a unified catalog with unambiguous, non-overlapping IDs.

### 2.2 Critical Corrective Findings on Previous Assumptions

| Domain | Initial Blueprint Assumption | Actual Code Implementation | Audit Correction |
|---|---|---|---|
| **Registration** | Welcome email sent upon student registration | Signup uses phone OTP only; `profiles.email` is NULL at account creation (`024_phone_first_auth.sql`) | Welcome email is triggered when the student first submits a non-null email in `EmailCollectionScreen.tsx`. |
| **Password Reset** | Candidate email for password reset | Auth is password/phone-OTP based (`authService.ts`). Password recovery is handled via MSG91 SMS OTP | Email-based password reset does not exist in the product. Do not create an email workflow for it. |
| **Payment Gateways** | Emitted from Razorpay webhook | Three gateways active: Razorpay, Google Play (`verify-google-play-purchase`), Apple (`verify-apple-purchase`, `248`, `249`) | Event emission must hook into shared fulfillment RPC `fulfill_standard_course_order` or Edge Function completion points. |
| **Schedule Generation** | Candidate separate event for "Schedule Generated" | `student_installment_schedule` is inserted in the exact same transaction as the initial down-payment in `process_installment_payment` | Schedule table is embedded into the Initial Payment Receipt email; no separate email is emitted. |
| **Access Restriction** | Assumed T+7 automatically restricts access | Migration 240/242 evaluates `overdue_balance > 0` at class access time via `check_installment_class_access` | T+7 email is an "Arrears Escalation & Academic Access Warning". Actual restriction is runtime-evaluated. |
| **Test Submissions** | Candidate event for test submitted | `submit_and_evaluate_mock_attempt` RPC runs on every test/quiz | Quizzes are frequent (3–5 daily). Emailing every submission causes severe inbox fatigue. Push/in-app only. |

---

## 3. Confirmed Existing Email Events

These events are fully supported by the existing architecture and verified in the database schema, RPCs, and Edge Functions:

1. **`ACC-01` — Student Welcome & Email Confirmation:** Emitted when `profiles.email` transitions from NULL to a valid email address via `updateProfileEmail` / `profiles` UPDATE (`MockTestApp/src/screens/auth/EmailCollectionScreen.tsx`).
2. **`ACC-02` — Registered Email Address Changed:** Emitted when an existing non-null `profiles.email` is modified (`studentProfileWebService.ts`).
3. **`ACC-03` — New Untrusted Device Challenged:** Emitted when `supabase/functions/device-challenge/index.ts` creates a challenge record requiring biometric/OTP approval.
4. **`ACC-04` — Account Deletion Receipt:** Emitted by `supabase/functions/user-account-delete/accountDeleteCore.ts` immediately before `delete_user_account_data` RPC cascades profile deletion.
5. **`PAY-01` — Full Course Purchase Confirmation & Tax Receipt:** Emitted after atomic fulfillment RPC `fulfill_standard_course_order` (`complete-course-purchase`, `verify-google-play-purchase`, `verify-apple-purchase`).
6. **`PAY-02` — PYQ Package Purchase Confirmation:** Emitted after `complete-pyq-purchase` verifies payment and inserts `student_pyq_purchases`.
7. **`PAY-03` — Payment Failed Notice:** Emitted when `razorpay-webhook` receives `payment.failed` with failure reason.
8. **`PAY-04` — Refund Processed Receipt:** Emitted when `razorpay-webhook` receives `refund.processed` or `apple-app-store-notifications` receives `REFUND`.
9. **`INS-01` — Initial Installment Settled & Agreement Activated:** Emitted after `complete-installment-purchase` invokes `process_installment_payment` for installment #1 (`student_course_agreements.agreement_status = 'active'`).
10. **`INS-02` — Subsequent Installment Payment Receipt:** Emitted upon subsequent payments allocating to schedule rows via `process_installment_payment`.
11. **`INS-03` — Upcoming Installment Reminder (T-3 Days):** Scheduled daily sweep for rows where `COALESCE(revised_due_date, due_date) = CURRENT_DATE + 3` and `status = 'pending'`.
12. **`INS-04` — Installment Due Today Notice (T-0 Days):** Scheduled daily sweep at 08:00 AM IST for rows where `COALESCE(revised_due_date, due_date) = CURRENT_DATE` and `status = 'pending'`.
13. **`INS-05` — Installment Overdue Notice (T+1 Day):** Scheduled daily sweep for rows where `COALESCE(revised_due_date, due_date) = CURRENT_DATE - 1` and `status = 'overdue'`.
14. **`INS-06` — Arrears Escalation & Access Restriction Warning (T+7 Days):** Scheduled sweep where `overdue_balance > 0` and earliest unpaid due date is $\ge 7$ days past.
15. **`INS-07` — Installment Plan Completed:** Emitted when `outstanding_balance = 0` and `agreement_status = 'completed'` in `process_installment_payment`.
16. **`EXM-01` — Mock Test Official Result Published:** Emitted when `mock_results.is_released` transitions to `true` (via `process_scheduled_mock_test_releases` cron or manual `release_test_results` RPC).
17. **`ACA-01` — Student Batch Assignment Welcome:** Emitted when an administrator assigns a student to a batch via `batchStudentAssignmentService.ts` (`batch_students` INSERT).
18. **`ACA-02` — Urgent Live Class Cancellation:** Emitted when a scheduled class in `live_classes` is marked `'cancelled'` within 24 hours of scheduled start.

---

## 4. Missing Email Events Discovered During Audit

The audit discovered **6 crucial business events** that exist in the codebase but were missing from the first-pass blueprint:

### 1. `PAY-05` — Payment Under Review / Manual Verification Required
* **Business Scenario:** Razorpay captures payment, but fulfillment halts because `complete-course-purchase` or `complete-installment-purchase` returns `requires_review` (e.g. duplicate payment detection, student ID mismatch, or unhandled concurrency conflict). The order is flagged `requires_admin_review = true` or `flagged_for_refund = true`.
* **Why Email is Essential:** The student's bank account was debited, but their course is not unlocked. Without an automated email, the student assumes payment fraud.
* **Email Message:** *"We have received your payment of ₹[Amount] (Payment ID: [ID]). Our academic operations team is reviewing your enrollment details. Your course access will be updated within 2–4 business hours."*
* **Trigger Location:** `mocktest-admin/supabase/functions/razorpay-webhook/index.ts` lines 866–872 and lines 1465–1470.

### 2. `PAY-06` — Cross-Platform Entitlement Revocation (Apple / Google / Admin)
* **Business Scenario:** Apple App Store sends a `REVOKE` notification (e.g. Family Sharing revoked, billing dispute, or chargeback), or an admin revokes an unearned grant (`249_apple_server_notifications.sql`).
* **Why Email is Essential:** The student unexpectedly loses access to their course or PYQ package. A formal notification explains why access was revoked and provides support contact details.
* **Trigger Location:** `mocktest-admin/supabase/migrations/249_apple_server_notifications.sql` lines 270–310 (`process_apple_notification` RPC handling `REVOKE`).

### 3. `INS-08` — Installment Due Date Rescheduled
* **Business Scenario:** An administrator or authorized counselor grants an extension on an installment, updating `revised_due_date` on `student_installment_schedule` and logging an audit row in `installment_adjustments` (`adjustment_type = 'reschedule'`).
* **Why Email is Essential:** Confirms the new agreed due date in writing. Crucially, this provides the trigger to cancel previously queued reminders for the old due date and reschedule them for the new date.
* **Trigger Location:** `public.installment_adjustments` INSERT where `adjustment_type = 'reschedule'`.

### 4. `INS-09` — Installment Waiver / Scholarship Approved
* **Business Scenario:** An administrator grants a partial or full fee waiver on a student's installment (`adjustment_type IN ('waiver', 'scholarship')` in `installment_adjustments`), reducing `amount_due` and `outstanding_balance`.
* **Why Email is Essential:** Official financial confirmation of the discount/scholarship, displaying the updated balance.
* **Trigger Location:** `public.installment_adjustments` INSERT where `adjustment_type IN ('waiver', 'scholarship')`.

### 5. `INS-10` — Arrears Cleared & Course Access Restored
* **Business Scenario:** A student who was in arrears (`agreement_status = 'in_arrears'` with restricted live-class access) makes a settlement payment. In `process_installment_payment` (`240_decouple_installment_settlement_and_access.sql` lines 748–752), `v_new_overdue` drops to 0.00 and `agreement_status` transitions back to `'active'`.
* **Why Email is Essential:** Formal legal confirmation that the default has been cured and full educational access has been restored.
* **Trigger Location:** `process_installment_payment` RPC when `OLD.agreement_status = 'in_arrears'` and `NEW.agreement_status = 'active'`.

### 6. `ACA-03` — Student Batch Transfer Confirmation
* **Business Scenario:** A student is moved from Batch A to Batch B (e.g. morning to evening, or fast-track batch). In `batchStudentAssignmentService.ts`, the student is removed from Batch A and inserted into Batch B.
* **Why Email is Essential:** Prevents the student from attending the wrong classes or missing newly scheduled live sessions. Explains: *"You have been transferred from [Batch A] to [Batch B]. Your new live class timetable and teachers are now active."*
* **Trigger Location:** `batchStudentAssignmentService.ts` when a student is reassigned.

---

## 5. Events Better Suited to Push or In-App Notifications

The audit determined that the following events should **NOT** generate emails. Emitting emails for them would cause notification fatigue, low open rates, and spam classification:

| Candidate Event | Recommended Channel | Technical & Behavioral Justification |
|---|:---:|---|
| **Routine Mock Test Submitted** | **In-App + Push** | Students frequently submit daily quizzes and practice tests. The mobile app immediately displays an on-screen submission scorecard. Emailing every test attempt clutters inboxes. |
| **New Test Available / Assigned** | **Push Notification** | Time-sensitive call to action best suited for an FCM device ping (`_shared/pushNotification.ts`). Students do not check email to start a daily quiz. |
| **Live Class Starting in 15 Min** | **Push Notification** | Highly ephemeral and time-critical. An email arriving 10 minutes late due to mail queue latency is useless. A mobile push notification with deep-link directly launches LiveKit room. |
| **Routine Timetable Materialization** | **In-App Timetable** | `timetable-materialization-daily` cron generates 60 days of rolling class occurrences (`timetable_slots` -> `live_classes`). Never notify via email; students view the schedule in `TimetableScreen.tsx`. |
| **Teacher Doubt Reply** | **In-App + Push** | Chat-style interactive academic Q&A (`doubt_messages`). Sending an email per message creates conversation clutter. Push notification alerts the student instantly. |
| **Student Unassigned from Batch (Non-Transfer)** | **In-App Feed** | Administrative adjustments should be communicated in-app or via academic counseling rather than an impersonal automated de-registration email. |
| **Password Reset Request** | **SMS OTP** | Authentication uses phone-first OTP via MSG91 (`authService.ts`). There is no email password reset workflow in the product. |

---

## 6. Events That Should Never Generate Notifications

These system operations must be completely suppressed from all student notifications:
1. **Periodic Test Auto-Save:** Background answer saves via `persist_mock_answer_live` or `persist_mock_answers_batch` (`078`, `081`, `250`).
2. **Crash Recovery Timestamp Updates:** `trg_mock_attempts_set_last_activity_at` updating `mock_attempts.last_activity_at` (`052`, `250`).
3. **Internal Payment Ledger Allocations:** FIFO allocations inside `installment_payment_allocations` (`219`). (Only the consolidated payment receipt is emailed, not internal ledger rows).
4. **Automated Timetable Slot Reconciliation:** Cron sweep `reconcile_institute_timetable` updating room IDs or slot links (`116`).
5. **Idempotent Webhook Retries:** Duplicate webhook deliveries where the order or payment is already settled.

---

## 7. Detailed Event Trigger and Evidence Mapping

This section traces every confirmed and discovered email event to its exact code implementation:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EVENT TRIGGER ARCHITECTURE                      │
├──────────────────────────┬─────────────────────────────────────────────┤
│ 1. Direct Edge Function  │ complete-course-purchase, razorpay-webhook, │
│    Completion            │ user-account-delete, device-challenge       │
├──────────────────────────┼─────────────────────────────────────────────┤
│ 2. Database Settlement   │ process_installment_payment RPC,            │
│    RPC Hook              │ fulfill_standard_course_order RPC           │
├──────────────────────────┼─────────────────────────────────────────────┤
│ 3. Scheduled Worker      │ installment-reminder-cron via pg_cron       │
│    (pg_cron Sweep)       │ (Daily 08:00 AM IST / 02:30 AM UTC)         │
├──────────────────────────┼─────────────────────────────────────────────┤
│ 4. Administrative Action │ batchStudentAssignmentService.ts,           │
│    Execution Hook        │ mockResultService.ts (releaseMockResults)   │
└──────────────────────────┴─────────────────────────────────────────────┘
```

### Detailed Mapping Table

#### A. Account & Security Events
* **`ACC-01` Student Welcome:**
  - *Trigger:* `UPDATE public.profiles SET email = ... WHERE profile_id = auth.uid()`
  - *Code Evidence:* `MockTestApp/src/screens/auth/EmailCollectionScreen.tsx` line 730; `MockTestApp/src/services/authService.ts` lines 689–737.
  - *Condition:* `OLD.email IS NULL AND NEW.email IS NOT NULL AND length(trim(NEW.email)) > 3`.
  - *Confidence:* **Confirmed.**
* **`ACC-02` Email Changed Alert:**
  - *Trigger:* `UPDATE public.profiles SET email = ...`
  - *Code Evidence:* `mocktest-admin/src/services/student/studentProfileWebService.ts` lines 309–340.
  - *Condition:* `OLD.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email`.
  - *Confidence:* **Confirmed.**
* **`ACC-03` Device Security Challenge:**
  - *Trigger:* Edge Function `device-challenge`
  - *Code Evidence:* `mocktest-admin/supabase/functions/device-challenge/index.ts`.
  - *Condition:* Challenge status created for unrecognized device token.
  - *Confidence:* **Confirmed.**
* **`ACC-04` Account Deletion Receipt:**
  - *Trigger:* Edge Function `user-account-delete`
  - *Code Evidence:* `mocktest-admin/supabase/functions/user-account-delete/accountDeleteCore.ts` lines 650–710.
  - *Condition:* OTP re-authentication verified within 300s; prior to executing `delete_user_account_data`.
  - *Confidence:* **Confirmed.**

#### B. Course & PYQ Purchase Events
* **`PAY-01` Course Purchase Confirmed:**
  - *Trigger:* Edge Function `complete-course-purchase` / `verify-apple-purchase` / `verify-google-play-purchase`
  - *Code Evidence:* `mocktest-admin/supabase/functions/complete-course-purchase/index.ts` lines 844–888; `248_apple_purchase_fulfillment.sql`.
  - *Condition:* `fulfill_standard_course_order` RPC returns `success: true`.
  - *Confidence:* **Confirmed.**
* **`PAY-02` PYQ Purchase Confirmed:**
  - *Trigger:* Edge Function `complete-pyq-purchase`
  - *Code Evidence:* `mocktest-admin/supabase/functions/complete-pyq-purchase/index.ts` lines 71–87.
  - *Condition:* Order verified, role upgraded to student, `student_pyq_purchases` inserted.
  - *Confidence:* **Confirmed.**
* **`PAY-03` Payment Failed Notice:**
  - *Trigger:* Edge Function `razorpay-webhook`
  - *Code Evidence:* `mocktest-admin/supabase/functions/razorpay-webhook/index.ts` lines 100–135.
  - *Condition:* Payload event is `payment.failed`.
  - *Confidence:* **Confirmed.**
* **`PAY-04` Refund Processed Receipt:**
  - *Trigger:* Edge Function `razorpay-webhook` / `apple-app-store-notifications`
  - *Code Evidence:* `razorpay-webhook/index.ts` line 1350 (`refund.processed`); `249_apple_server_notifications.sql` (`REFUND`).
  - *Condition:* Refund status confirmed; payments record credited.
  - *Confidence:* **Confirmed.**
* **`PAY-05` Payment Under Review (NEW):**
  - *Trigger:* Edge Function `razorpay-webhook`
  - *Code Evidence:* `razorpay-webhook/index.ts` lines 866–872; `complete-installment-purchase/index.ts` line 321.
  - *Condition:* Payment captured, but fulfillment returns `requires_review` or flags `requires_admin_review = true`.
  - *Confidence:* **Confirmed.**
* **`PAY-06` Entitlement Revoked (NEW):**
  - *Trigger:* Edge Function `apple-app-store-notifications`
  - *Code Evidence:* `mocktest-admin/supabase/migrations/249_apple_server_notifications.sql` lines 270–310 (`REVOKE`).
  - *Condition:* Gateway notification revokes order item with cross-platform protection checks verified.
  - *Confidence:* **Confirmed.**

#### C. Installment Payments & Arrears Events
* **`INS-01` Initial Installment Settled:**
  - *Trigger:* Edge Function `complete-installment-purchase`
  - *Code Evidence:* `mocktest-admin/supabase/functions/complete-installment-purchase/index.ts` lines 530–585.
  - *Condition:* `process_installment_payment` returns `success: true` and `consecutively_funded_milestone = 1`.
  - *Confidence:* **Confirmed.**
* **`INS-02` Subsequent Installment Paid:**
  - *Trigger:* Edge Function `complete-installment-purchase`
  - *Code Evidence:* `mocktest-admin/supabase/migrations/240_decouple_installment_settlement_and_access.sql` lines 580–740.
  - *Condition:* `process_installment_payment` returns `success: true` and `consecutively_funded_milestone > 1`.
  - *Confidence:* **Confirmed.**
* **`INS-03` Installment Due in 3 Days:**
  - *Trigger:* Scheduled Worker `installment-reminder-cron`
  - *Code Evidence:* `student_installment_schedule` query (`219_installment_foundation_and_access_control.sql` lines 72–100).
  - *Condition:* `COALESCE(revised_due_date, due_date) = CURRENT_DATE + INTERVAL '3 days'` AND `status = 'pending'`.
  - *Confidence:* **Confirmed.**
* **`INS-04` Installment Due Today:**
  - *Trigger:* Scheduled Worker `installment-reminder-cron`
  - *Code Evidence:* `student_installment_schedule` query.
  - *Condition:* `COALESCE(revised_due_date, due_date) = CURRENT_DATE` AND `status = 'pending'`.
  - *Confidence:* **Confirmed.**
* **`INS-05` Installment Overdue Notice (T+1):**
  - *Trigger:* Scheduled Worker `installment-reminder-cron`
  - *Code Evidence:* `student_installment_schedule.status = 'overdue'`.
  - *Condition:* `COALESCE(revised_due_date, due_date) = CURRENT_DATE - INTERVAL '1 day'` AND `status = 'overdue'`.
  - *Confidence:* **Confirmed.**
* **`INS-06` Arrears & Access Restriction Warning (T+7):**
  - *Trigger:* Scheduled Worker `installment-reminder-cron`
  - *Code Evidence:* `student_course_agreements.overdue_balance > 0` (`219`, `240`).
  - *Condition:* `overdue_balance > 0` AND agreement in `in_arrears` status for $\ge 7$ days past due.
  - *Confidence:* **Confirmed.**
* **`INS-07` Installment Plan Completed:**
  - *Trigger:* Database RPC `process_installment_payment`
  - *Code Evidence:* `240_decouple_installment_settlement_and_access.sql` line 749 (`when v_new_outstanding <= 0.00 then 'completed'`).
  - *Condition:* `v_new_outstanding = 0.00` and agreement transitions to `'completed'`.
  - *Confidence:* **Confirmed.**
* **`INS-08` Installment Due Date Rescheduled (NEW):**
  - *Trigger:* Admin Action / Stored Procedure
  - *Code Evidence:* `public.installment_adjustments` (`219` lines 129–163).
  - *Condition:* `adjustment_type = 'reschedule'` AND `revised_due_date IS NOT NULL`.
  - *Confidence:* **Confirmed.**
* **`INS-09` Installment Waiver / Scholarship Approved (NEW):**
  - *Trigger:* Admin Action / Stored Procedure
  - *Code Evidence:* `public.installment_adjustments` (`219` lines 129–163).
  - *Condition:* `adjustment_type IN ('waiver', 'scholarship')` AND `amount > 0`.
  - *Confidence:* **Confirmed.**
* **`INS-10` Arrears Cleared & Access Restored (NEW):**
  - *Trigger:* Database RPC `process_installment_payment`
  - *Code Evidence:* `240_decouple_installment_settlement_and_access.sql` lines 748–752.
  - *Condition:* `OLD.agreement_status = 'in_arrears'` AND `v_new_overdue = 0.00` (status transitions to `'active'`).
  - *Confidence:* **Confirmed.**

#### D. Examination & Academic Events
* **`EXM-01` Mock Test Result Published:**
  - *Trigger:* Database RPC `process_scheduled_mock_test_releases` / `release_test_results`
  - *Code Evidence:* `142_schedule_mock_test_result_release.sql` lines 27–77; `mockResultService.ts` lines 1033–1060.
  - *Condition:* `mock_results.is_released` transitions from `false` to `true`.
  - *Confidence:* **Confirmed.**
* **`ACA-01` Student Batch Assigned:**
  - *Trigger:* Admin Service Action `assignStudents`
  - *Code Evidence:* `mocktest-admin/src/services/admin/batchStudentAssignmentService.ts` lines 309–360.
  - *Condition:* New row successfully inserted into `public.batch_students`.
  - *Confidence:* **Confirmed.**
* **`ACA-02` Urgent Live Class Cancellation:**
  - *Trigger:* Teacher / Admin Live Class Service
  - *Code Evidence:* `live_classes.status` updated to `'cancelled'` (`mocktest-admin/supabase/migrations/108_timetable_foundation.sql`).
  - *Condition:* Class was in `'scheduled'` status and cancelled within 24 hours of `scheduled_at`.
  - *Confidence:* **Confirmed.**
* **`ACA-03` Student Batch Transfer Confirmed (NEW):**
  - *Trigger:* Admin Service Action `assignStudents` with prior batch unassignment
  - *Code Evidence:* `batchStudentAssignmentService.ts` lines 309–450.
  - *Condition:* Student moved from existing batch to new batch.
  - *Confidence:* **Confirmed.**

---

## 8. Recipient, Privacy, and Delivery Gaps

### 8.1 The Nullable, Unverified Email Invariant
- **Database Reality:** In `public.profiles`, `email` is `VARCHAR(255) NULL` (`024_phone_first_auth.sql`).
- **Mobile Workflow:** The user logs in via SMS OTP. `EmailCollectionScreen.tsx` prompts for email, but users can close the app or skip.
- **System Defense:** The email queue worker must implement a strict **Graceful Null Bypass**:
  ```typescript
  if (!recipientEmail || recipientEmail.trim() === '') {
    // Record as skipped / cancelled — NEVER throw, NEVER crash worker
    await markQueueJobCancelled(job.queue_id, 'RECIPIENT_EMAIL_MISSING');
    return;
  }
  ```

### 8.2 Old Email vs. New Email on Account Modification
When a student updates their email address (`ACC-02`):
- Security standards (NIST SP 800-63B) mandate notifying the **OLD** email address to detect unauthorized account takeovers.
- If the old email is valid, the system must dispatch a security warning: *"The email associated with your Make Me Topper account was changed to [new_email]. If you did not make this change, contact support immediately."*
- Simultaneously, a confirmation email is dispatched to the **NEW** email address.

### 8.3 Multi-Gateway Deduplication Across Razorpay, Google Play, and Apple IAP
- A student may attempt to purchase a course on the website via Razorpay, abandon it, and then complete the purchase on iOS via Apple StoreKit.
- Both gateways generate orders in `public.orders`.
- **Deduplication Rule:** The idempotency key for purchase confirmation emails must be bound to the authoritative course enrollment:
  $$\text{idempotency\_key} = \text{"enrollment\_confirmed:"} + \text{enrollment\_id}$$
  Because `enrollment_id` is unique per student/course pair (governed by `uq_course_enrollments_student_course`), exactly one confirmation email is dispatched regardless of how many webhook retries or gateway transactions occur.

### 8.4 Bounce & Complaint Suppression Architecture
- If Resend emits an `email.bounced` (hard bounce) or `email.complained` webhook:
  1. The webhook function updates `email_queue.status = 'failed'`.
  2. The email address is inserted into a new `public.email_suppressions` table.
  3. Subsequent queue worker sweeps check `email_suppressions` and automatically cancel dispatches to suppress sending, protecting Make Me Topper's domain reputation.

### 8.5 Legal Compliance & Opt-Out Stratification
- **Transactional Emails (Exempt from Opt-Out):** Purchase receipts (`PAY-01`, `PAY-02`), Installment debts & overdue notices (`INS-01`–`INS-07`), Security alerts (`ACC-02`, `ACC-03`), and Exam scorecards (`EXM-01`). By law (CAN-SPAM, Indian IT Act & DPDP Act 2023), students cannot unsubscribe from legally binding financial and security notices.
- **Operational / Academic Announcements (Opt-Out Required):** Batch announcements and general timetable notices must provide a functional 1-click notification preference link.

---

## 9. Corrected Master Email Event Matrix

This 24-event matrix supersedes all previous drafts and represents the definitive catalog for Make Me Topper:

| Event ID | Event Name | Business Trigger Scenario | Source Table | Backend Trigger Mechanism | Recipient | Email Priority | Delivery Timing | Idempotency Key Pattern |
|---|---|---|---|---|---|---|---|---|
| **`ACC-01`** | Welcome & Profile Confirmed | First non-null email saved during onboarding | `profiles` | Edge Function / Profile Hook | Student | High | Immediate | `welcome:{profile_id}` |
| **`ACC-02`** | Registered Email Changed | Existing profile email modified | `profiles` | Edge Function / Profile Hook | Student (Old & New) | Critical | Immediate | `email_change:{profile_id}:{timestamp}` |
| **`ACC-03`** | Untrusted Device Alert | New device challenged for OTP/Biometric | `device_challenges` | `device-challenge` Edge Function | Student | High | Immediate | `device_alert:{challenge_id}` |
| **`ACC-04`** | Account Deletion Receipt | Account deletion requested & verified | `profiles` | `user-account-delete` Edge Function | Student | Normal | Immediate | `acct_delete:{profile_id}` |
| **`PAY-01`** | Course Purchase Confirmed | Standard course order settled & enrolled | `orders`, `course_enrollments` | `complete-course-purchase` / IAP RPC | Student | Critical | Immediate | `course_enrolled:{enrollment_id}` |
| **`PAY-02`** | PYQ Purchase Confirmed | PYQ package purchased & unlocked | `orders`, `student_pyq_purchases` | `complete-pyq-purchase` Edge Function | Student | Critical | Immediate | `pyq_purchase:{purchase_id}` |
| **`PAY-03`** | Payment Failed Notice | Gateway reports checkout failure | `orders`, `payments` | `razorpay-webhook` Edge Function | Student | High | Immediate | `pay_failed:{payment_id}` |
| **`PAY-04`** | Refund Processed Receipt | Gateway confirms refund settlement | `payments` | `razorpay-webhook` / Apple V2 | Student | High | Immediate | `refund_settled:{refund_id}` |
| **`PAY-05`** | Payment Under Verification | Captured payment requires admin review | `orders`, `student_course_agreements` | `razorpay-webhook` Edge Function | Student | High | Immediate | `pay_review:{order_id}` |
| **`PAY-06`** | Entitlement Revoked | Apple/Google/Admin revokes access | `order_items`, `course_enrollments` | `apple-app-store-notifications` | Student | High | Immediate | `entitlement_revoked:{order_item_id}` |
| **`INS-01`** | Initial Installment Paid | Down-payment settled; plan active | `student_course_agreements` | `complete-installment-purchase` | Student | Critical | Immediate | `inst_activate:{agreement_id}` |
| **`INS-02`** | Subsequent Installment Paid | Milestone installment payment allocated | `student_installment_schedule` | `complete-installment-purchase` | Student | Critical | Immediate | `inst_payment:{payment_id}` |
| **`INS-03`** | Installment Due in 3 Days | Pending installment due in 72 hours | `student_installment_schedule` | `installment-reminder-cron` (pg_cron) | Student | High | Scheduled (08:00 IST) | `inst_due_3d:{schedule_id}:{due_date}` |
| **`INS-04`** | Installment Due Today | Pending installment due today | `student_installment_schedule` | `installment-reminder-cron` (pg_cron) | Student | Critical | Scheduled (08:00 IST) | `inst_due_0d:{schedule_id}:{due_date}` |
| **`INS-05`** | Installment Overdue (T+1) | Milestone unpaid 24h past due date | `student_installment_schedule` | `installment-reminder-cron` (pg_cron) | Student | Critical | Scheduled (08:00 IST) | `inst_od_1d:{schedule_id}:{due_date}` |
| **`INS-06`** | Arrears & Access Warning | Overdue balance unpaid $\ge 7$ days | `student_course_agreements` | `installment-reminder-cron` (pg_cron) | Student | Critical | Scheduled (08:00 IST) | `inst_arr_7d:{agreement_id}:{due_date}` |
| **`INS-07`** | Installment Plan Completed | Final balance settled; agreement closed | `student_course_agreements` | `process_installment_payment` RPC | Student | High | Immediate | `inst_completed:{agreement_id}` |
| **`INS-08`** | Installment Rescheduled | Due date revised by administrator | `installment_adjustments` | Admin Service / Stored Procedure | Student | High | Immediate | `inst_resched:{adjustment_id}` |
| **`INS-09`** | Waiver / Scholarship Approved | Partial or full fee waiver credited | `installment_adjustments` | Admin Service / Stored Procedure | Student | High | Immediate | `inst_waiver:{adjustment_id}` |
| **`INS-10`** | Arrears Cleared / Restored | Arrears paid; status returns to active | `student_course_agreements` | `process_installment_payment` RPC | Student | Critical | Immediate | `arrears_cleared:{payment_id}` |
| **`EXM-01`** | Mock Test Result Released | Scorecard released to student | `mock_results` | `process_scheduled_mock_test_releases` | Student | Normal | Async Queue Batch | `test_scorecard:{attempt_id}` |
| **`ACA-01`** | Batch Assigned Welcome | Student placed in batch by admin | `batch_students` | `batchStudentAssignmentService.ts` | Student | Normal | Async Queue Batch | `batch_assigned:{batch_id}:{student_id}` |
| **`ACA-02`** | Live Class Cancelled Urgent | Class cancelled < 24h before start | `live_classes` | Teacher / Admin Live Class Service | Batch Students | High | Immediate | `class_cancel:{class_id}` |
| **`ACA-03`** | Batch Transfer Confirmed | Student moved from Batch A to B | `batch_students` | `batchStudentAssignmentService.ts` | Student | Normal | Async Queue Batch | `batch_transfer:{new_batch_id}:{student_id}` |

---

## 10. Recommended Implementation Priorities

We recommend a four-stage execution plan prioritizing high-impact financial receipts and legal notifications:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION PRIORITY MATRIX                       │
├────────────────────────────────┬────────────────────────────────────────┤
│ TIER 1: Core Financial &       │ PAY-01, PAY-02, PAY-03, PAY-04,        │
│ Legal Receipts (Week 1–2)      │ PAY-05, PAY-06                         │
├────────────────────────────────┼────────────────────────────────────────┤
│ TIER 2: Installment Automation │ INS-01, INS-02, INS-03, INS-04,        │
│ & Reminders (Week 2–3)         │ INS-05, INS-06, INS-07, INS-10         │
├────────────────────────────────┼────────────────────────────────────────┤
│ TIER 3: Security & Identity    │ ACC-01, ACC-02, ACC-03, ACC-04         │
│ (Week 3)                       │                                        │
├────────────────────────────────┼────────────────────────────────────────┤
│ TIER 4: Academics & Waivers    │ EXM-01, ACA-01, ACA-02, ACA-03,        │
│ (Week 4)                       │ INS-08, INS-09                         │
└────────────────────────────────┴────────────────────────────────────────┘
```

1. **Tier 1 (Core Financial Receipts):** Course purchases, PYQ purchases, payment failures, refunds, and "Payment Under Review". *Why:* High student anxiety; immediate commercial necessity.
2. **Tier 2 (Installment Engine & Reminders):** Activation receipts, automated due date reminders (T-3, T-0), overdue alerts (T+1), arrears warnings (T+7), and arrears recovery confirmations. *Why:* Directly reduces platform payment default rates and recovers revenue.
3. **Tier 3 (Account & Security):** Welcome email on onboarding, email change alert, untrusted device warning, account deletion receipt. *Why:* Essential security compliance and account transparency.
4. **Tier 4 (Academics & Administrative Adjustments):** Test scorecards, batch assignment/transfers, class cancellations, installment waivers/rescheduling. *Why:* Excellent student experience, but already partially served by in-app UI.

---

## 11. Unresolved Questions & Unsupported Requirements

The following items were audited and identified as **unsupported by current product architecture**, requiring product decisions before implementation:

1. **Student Support Ticket Replies:** Currently, doubts are handled via `public.doubts` and chat messages via `public.messages`. There is no dedicated external ticketing system (like Zendesk/Freshdesk). If student queries are resolved in-app, email notifications for every chat bubble are counter-productive. *Recommendation:* Defer support ticket emails until a formal helpdesk module is introduced.
2. **Guardian Email Notifications:** Migration `040_add_guardian_fields_to_student_details.sql` introduced `guardian_email` on `student_details`. However, `guardian_email` is rarely populated during mobile onboarding. *Recommendation:* Do not create a separate guardian email pipeline yet; CC `guardian_email` on financial receipts (`PAY-01`, `INS-01`–`INS-06`) only when `guardian_email IS NOT NULL`.
3. **Offline Manual Payments:** If an administrator manually records an offline cash/NEFT payment in `payments`, the system must ensure the same payment receipt email triggers. *Recommendation:* Ensure the admin offline payment UI calls `complete-course-purchase` or `process_installment_payment` using service-role credentials.

---

## 12. Final Completeness Assessment

### 1. Are all important transactional email events covered?
**Yes.** With the addition of the 6 newly discovered events (`PAY-05` Payment Under Review, `PAY-06` Entitlement Revoked, `INS-08` Rescheduled, `INS-09` Waiver, `INS-10` Arrears Restored, and `ACA-03` Batch Transfer), all critical financial, legal, security, and academic milestones across Make Me Topper are fully covered.

### 2. Which important events were still missing from the first pass?
The most glaring omission was **`PAY-05` (Payment Under Review)**. When automated fulfillment fails or flags for manual review, money is debited but courses are withheld; communicating immediately via email is essential. In addition, multi-gateway revocation (`PAY-06`) and installment standing restoration (`INS-10`) were completely missing.

### 3. Which suggested candidate events are unnecessary?
- Routine quiz submissions (creates unbearable inbox spam).
- 15-minute live-class reminders (strictly a mobile push notification use-case).
- Routine timetable materialization (internal cron generation of future slots).
- Password reset emails (authentication uses SMS OTP; email password reset does not exist).

### 4. Which events cannot be implemented safely until business workflows are clarified?
- **Guardian notifications:** Dependent on improving mobile onboarding guardian data collection.
- **Support ticket updates:** Dependent on formalizing a helpdesk workflow outside live chat.

### 5. Is the existing email architecture sufficient for the final event list?
**Yes, completely.** The **Option C (Transactional Outbox Queue)** architecture proposed in the blueprint easily accommodates all 24 events:
- Single-event financial transactions use immediate queue dispatch (`EdgeRuntime.waitUntil`).
- Bulk result publications (`EXM-01`) and scheduled installment sweeps (`INS-03`–`INS-06`) drain through `email-worker` in controlled, rate-limited batches using `FOR UPDATE SKIP LOCKED`.
- The database schema requires only the single planned migration `251_email_notification_queue.sql` without any modifications to historical migrations `001`–`250`.

