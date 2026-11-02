# Make Me Topper — Revision 29: Fail-Closed Refund Reconciliation and Gateway Processing Audit

**Document Reference:** `MMT-AUDIT-2026-REVISION-29-REFUND-RECONCILIATION-AND-WEBHOOK-AUDIT`  
**Date:** October 28, 2026  
**Repositories:**
- Backend / Admin Panel: `C:\Projects\mocktest-admin`
- Android Client App: `C:\Projects\MockTestApp`
**Primary Files Updated:**
- `supabase/migrations/219_installment_foundation_and_access_control.sql` (Both repos)
- `supabase/tests/installment_foundation_and_access_control_test.sql` (Both repos)
- `supabase/functions/razorpay-webhook/index.ts` (`mocktest-admin`)
- `SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md` (Both repos)
**Status:** **PHASE 1 IMPLEMENTATION AUDITED & CORRECTED LOCALLY — FAIL-CLOSED REFUND RECONCILIATION ENFORCED, AMBIGUOUS ALLOCATIONS BLOCKED, REAL RAZORPAY WEBHOOK INTEGRATED WITH 23505 IDEMPOTENCY — NOT DEPLOYED TO ANY DATABASE — LOCAL SOURCE INSPECTION ONLY**

---

## 1. Exact Root Cause of Each Remaining Issue

### Issue 1: Unresolved Partial-Overlap Refund Accounting & Ambiguous Credit Allocation
- **Root Cause:** In Revision 28, the formula `GREATEST(payments.refund_amount, SUM(duplicate_charge_refund adjustments))` was used to determine the confirmed refund amount. While this formula prevents double-counting when both fields represent the exact same refund transaction, it assumed an arbitrary overlap when the two sources contained partial overlaps or different subsets of refund events.
  - *Example:* Captured payment ₹1,000; summary `payments.refund_amount` = ₹300; ledger refund total = ₹200; separate reversal = ₹400.
    - If the ₹200 ledger refund is already inside the ₹300 summary, total reductions are ₹700 (net available = ₹300).
    - If the ₹200 ledger refund is disjoint from the ₹300 summary, total reductions are ₹900 (net available = ₹100).
    - Aggregate amounts alone cannot prove which interpretation is correct.
- **Defect in Prior Implementation:** Although Revision 28 detected the discrepancy ($Delta = |R_{\text{summary}} - \Sigma_{\text{adj}}| > 0$) and set `requires_admin_review = true`, `process_installment_payment()` continued to compute available credit using `GREATEST()` and proceeded to allocate the unverified balance to student installment obligations! This violated the foundational principle of financial integrity by treating unverified, ambiguous payment credit as usable credit.

### Issue 2: Real Razorpay Webhook Integration Status
- **Root Cause:** In the backend Edge Function `supabase/functions/razorpay-webhook/index.ts`, the handler explicitly checked `if (payload.event !== 'payment.captured')` and immediately returned HTTP 200 with message `Event ignored. Only "payment.captured" is processed.`.
  - While database constraints (`ck_adjustment_gateway_linkage`, `uq_installment_adjustments_gateway_event`) and SQL test cases had been implemented in Revision 28, the webhook integration code itself did **not** process incoming `refund.processed`, `refund.created`, or `payment.dispute.created` events into `installment_adjustments`.
  - Without an explicit webhook handler, provider deliveries for refunds and dispute reversals were acknowledged and discarded without creating database adjustment records or updating payment refund summaries. Furthermore, if database constraints threw uniqueness violation `23505` on duplicate deliveries, an unhandled database error would trigger HTTP 500 responses, causing Razorpay to enter endless retry loops.

---

## 2. Verified Meaning of `payments.refund_amount`

Inspection of `008_domain_07_commerce.sql` and `public.payments` schema establishes:
1. **Cumulative Summary Field:** `payments.refund_amount numeric(12,2)` is an aggregate summary column representing the total cumulative amount refunded against the captured payment row.
   - Column comment (line 599 of `008_domain_07_commerce.sql`):  
     *`Amount refunded. Only populated on the captured payment row when status transitions to refunded or partially_refunded.`*
2. **Single Scalar Gateway Identifier:** `payments` contains a single scalar column `refund_gateway_id varchar(255)`.
   - Column comment (line 603 of `008_domain_07_commerce.sql`):  
     *`Gateway refund transaction ID. Required for refund reconciliation and tracking.`*
   - Because `payments` holds only one scalar `refund_gateway_id`, when multiple partial refunds occur over time, `payments` cannot store an itemized list of all refund IDs.
3. **Commerce Lifecycle Coupling:** Under constraint `ck_payments_status_refunded`, `refund_amount` and `refunded_at` must be populated when and only when `status` is `'partially_refunded'` or `'refunded'`.
4. **Summary vs. Ledger Distinction:** `payments.refund_amount` is an aggregate commerce summary. It is **not** an itemized ledger. The itemized ledger of record for installment payment adjustments is `public.installment_adjustments`.

---

## 3. Authoritative Source of Truth for Each Distinct Financial Event

| Financial Event Type | Authoritative Record | Transaction Identifier Column | Audit Approval Policy |
| :--- | :--- | :--- | :--- |
| **Captured Payment** | `public.payments` | `gateway_payment_id` (e.g. `pay_xxx`) | Gateway webhook verification (`paid_at`) |
| **Duplicate-Charge Refund** | `public.installment_adjustments` | `gateway_event_id` (e.g. `rfnd_xxx`) | Automated gateway event (`approved_by_admin_id = null`) |
| **Gateway Reversal / Dispute** | `public.installment_adjustments` | `gateway_event_id` (e.g. `disp_xxx`) | Automated gateway event (`approved_by_admin_id = null`) |
| **Administrative Concession** | `public.installment_adjustments` | `adjustment_id` (UUID) | Explicit admin identity (`approved_by_admin_id IS NOT NULL`) |
| **Installment Allocation** | `public.installment_payment_allocations` | `allocation_id` (UUID), composite `(payment_id, schedule_id)` | Transaction-safe RPC (`process_installment_payment`) |

- **Proof of Consistency:** The database can prove that `payments.refund_amount` and `installment_adjustments` represent the same underlying events **if and only if**:
  1. $R_{\text{summary}} = \sum_{\text{ledger}} \text{amount}$ (amounts match exactly), AND
  2. If `payments.refund_gateway_id` is populated, that exact identifier exists as a `gateway_event_id` in `installment_adjustments` for that payment.
- If amounts differ ($R_{\text{summary}} \ne \Sigma_{\text{adj}}$) or if `refund_gateway_id` conflicts with the ledger, consistency is **unprovable**, and the database must fail closed.

---

## 4. Conditions That Block Allocation and Permit It to Resume

### Conditions That Block Allocation (Fail-Closed Enforcement)
In `process_installment_payment()` and database trigger `trg_enforce_installment_allocation_limits`, new installment allocations from a payment are **strictly blocked** if any of the following conditions occur:
1. **Summary > Ledger ($R_{\text{summary}} > \Sigma_{\text{adj}}$):** An unitemized refund was recorded on the payment summary that has not been itemized in the adjustment ledger.
2. **Ledger > Summary ($\Sigma_{\text{adj}} > R_{\text{summary}}$):** The itemized adjustment ledger records verified refunds that have not yet been synchronized into the payment summary.
3. **Conflicting Gateway Identifiers:** Aggregate amounts match ($R_{\text{summary}} = \Sigma_{\text{adj}}$), but `payments.refund_gateway_id` does not match any `gateway_event_id` in the adjustment ledger.
4. **Post-Allocation Deficit ($\text{already\_allocated} > \text{net\_available}$):** A subsequent refund or reversal arrives after prior allocations were committed.

When blocked:
- `student_course_agreements.requires_admin_review` is set to `true`.
- `process_installment_payment()` returns:
  ```json
  {
    "success": false,
    "code": "PAYMENT_REFUND_RECONCILIATION_REQUIRED",
    "error": "Payment refund summary and adjustment ledger cannot be reconciled reliably. New installment allocation is blocked until administrator reconciliation.",
    "requires_admin_review": true,
    "summary_refund_amount": 500.00,
    "ledger_refund_amount": 200.00,
    "summary_refund_gateway_id": "rfnd_sum_c",
    "refund_discrepancy": 300.00,
    "unallocated_amount": 0.00
  }
  ```
- Trigger `trg_enforce_installment_allocation_limits` raises SQL exception `check_violation` on any direct allocation attempt.
- Existing allocations in `installment_payment_allocations` remain 100% intact.
- Student subscription status and paid-through dates are preserved without automatic revocation.

### Specific Condition That Allows Processing to Resume
Processing resumes **without inventing new workflows or schemas** when the administrator reconciles the records:
1. **If Summary > Ledger:** The administrator inspects provider records and inserts the missing itemized refund adjustment into `public.installment_adjustments` with its provider transaction ID (`gateway_event_id`) and `reference_payment_id`.
2. **If Ledger > Summary or Conflicting ID:** The administrator updates `public.payments` so that `refund_amount = (select sum(amount) from installment_adjustments where reference_payment_id = payments.payment_id and adjustment_type = 'duplicate_charge_refund')` and sets `refund_gateway_id` to match the verified provider ID.
3. Once $R_{\text{summary}} = \Sigma_{\text{adj}}$ and gateway IDs match, the reconciliation condition is satisfied ($V_{\text{is\_reconciled}} = \text{true}$).
4. Calling `process_installment_payment()` computes the verified net available credit and resumes standard FIFO allocation.
5. Once balances are confirmed, the administrator clears `student_course_agreements.requires_admin_review = false`.

---

## 5. Numerical Expected Results for All Tested Scenarios

| Scenario | Test ID | Captured Payment | Gateway Summary | Ledger Adjustments | Reversal Adjustments | Net Available Credit | Result / Code |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A. Single Consistent Refund** | Test 12 | ₹1,000.00 | ₹300.00 (`rfnd_dup_123`) | ₹300.00 (`rfnd_dup_123`) | ₹0.00 | **₹700.00** | `success = true`, ₹700 allocated. |
| **B. Multiple Itemized Refunds** | Test 12b | ₹1,000.00 | ₹500.00 (`rfnd_b_2`) | ₹200 (`rfnd_b_1`) + ₹300 (`rfnd_b_2`) | ₹0.00 | **₹500.00** | `success = true`, ₹500 allocated. |
| **C. Summary > Ledger (Unitemized)** | Test 15 | ₹1,000.00 | ₹500.00 (`rfnd_sum_c`) | ₹200.00 (`rfnd_c1`) | ₹0.00 | **₹0.00** (Blocked) | `PAYMENT_REFUND_RECONCILIATION_REQUIRED`, 0 allocated, review flagged. |
| **D. Ledger > Summary (Stale Summary)** | Test 16 | ₹1,000.00 | ₹200.00 (`rfnd_d1`) | ₹200 (`rfnd_d1`) + ₹300 (`rfnd_d2`) | ₹0.00 | **₹0.00** (Blocked) | `PAYMENT_REFUND_RECONCILIATION_REQUIRED`, 0 allocated, review flagged. |
| **E. Conflicting Gateway Event IDs** | Test 16b | ₹1,000.00 | ₹500.00 (`rfnd_alpha`) | ₹500.00 (`rfnd_beta`) | ₹0.00 | **₹0.00** (Blocked) | `PAYMENT_REFUND_RECONCILIATION_REQUIRED`, 0 allocated, review flagged. |
| **F. Reconciled Refund + Reversal** | Test 17 | ₹1,000.00 | ₹300.00 (`rfnd_f1`) | ₹300.00 (`rfnd_f1`) | ₹400.00 (`disp_f1`) | **₹300.00** | `success = true`, ₹300 allocated, reductions = ₹700. |
| **G. Post-Allocation Deficit** | Test 19 | ₹1,000.00 | ₹0.00 | ₹0.00 | ₹600.00 (`disp_g1`) | Deficit: ₹400.00 | `PAYMENT_REVERSED_ALLOCATION_DEFICIT`, prior ₹800 preserved. |
| **H. Repeated Event Delivery** | Test 14c/d | N/A | N/A | Duplicate `gateway_event_id` | N/A | N/A | Unique violation `uq_installment_adjustments_gateway_event` (23505). |

---

## 6. Actual Status of Razorpay Refund/Reversal Webhook Integration

### Prior Status
Prior to Revision 29, `supabase/functions/razorpay-webhook/index.ts` only handled `payment.captured`. Any other event type was acknowledged with HTTP 200 and ignored. No refund or reversal handling existed in any Edge Function.

### Revision 29 Implementation
In `supabase/functions/razorpay-webhook/index.ts`:
1. **Extended Payload Types:** Added `RazorpayRefundEntity` and `RazorpayDisputeEntity` to `RazorpayWebhookPayload`.
2. **Dedicated Handlers:**
   - `handleRazorpayRefund(serviceClient, payload, meta)`: Handles `refund.processed` and `refund.created`.
   - `handleRazorpayDispute(serviceClient, payload, meta)`: Handles `payment.dispute.created`.
3. **Transaction Identifiers:** Extracts `refundEntity.id` (`rfnd_xxx`) or `disputeEntity.id` (`disp_xxx`) and stores it directly as `gateway_event_id`.
4. **Automated Audit Identity:** Inserts into `public.installment_adjustments` with `approved_by_admin_id = null`.
5. **Database Duplicate Protection & Webhook Idempotency:**
   - When duplicate deliveries or retries occur, the database raises error `23505` (`unique_violation` on `uq_installment_adjustments_gateway_event`).
   - The handler intercepts error `23505`, logs `DUPLICATE_REFUND_EVENT_ACKNOWLEDGED` / `DUPLICATE_DISPUTE_EVENT_ACKNOWLEDGED`, and returns **HTTP 200**.
   - This prevents Razorpay from entering endless retry loops while ensuring duplicate reductions cannot occur.
6. **Commerce Ledger Updates:** For installment refunds, `public.payments` is updated with `refund_amount = refund_amount + amount`, `refund_gateway_id = refundId`, and status transitioned to `'partially_refunded'` or `'refunded'`.

---

## 7. Exact Source Files Changed

1. **`supabase/migrations/219_installment_foundation_and_access_control.sql`** (Updated in both repos)
   - Added strict reconciliation check in `trg_enforce_allocation_limits()`: blocks direct allocations if payment refund summary and ledger disagree.
   - Added reconciliation verification in `trg_installment_adjustment_audit()`: flags agreement for review if an unreconciled adjustment is inserted.
   - Hardened `process_installment_payment()`: selects `p.refund_gateway_id`, checks for exact summary/ledger agreement and gateway ID matching; fails closed with `PAYMENT_REFUND_RECONCILIATION_REQUIRED` if unreconciled.
2. **`supabase/tests/installment_foundation_and_access_control_test.sql`** (Updated in both repos)
   - Updated Test 12 with `refund_gateway_id` matching ledger.
   - Added Test 12b (Scenario B: multiple fully itemized refunds).
   - Updated Test 13: unreconciled refund summary with reversal fails closed pending admin review.
   - Replaced Test 15 (Scenario C: Summary > Ledger fails closed with `PAYMENT_REFUND_RECONCILIATION_REQUIRED`).
   - Replaced Test 16 (Scenario D: Ledger > Summary fails closed with `PAYMENT_REFUND_RECONCILIATION_REQUIRED`).
   - Added Test 16b (Scenario E: Conflicting gateway IDs fails closed with `PAYMENT_REFUND_RECONCILIATION_REQUIRED`).
   - Replaced Test 17 (Scenario F: Reconciled refund + reversal succeeds for ₹300).
3. **`supabase/functions/razorpay-webhook/index.ts`** (Updated in `mocktest-admin`)
   - Added payload interfaces for refund and dispute entities.
   - Implemented `handleRazorpayRefund` and `handleRazorpayDispute`.
   - Wired Step 8 routing for `refund.processed`, `refund.created`, and `payment.dispute.created`.
   - Intercepted PostgreSQL unique violation `23505` to return idempotent HTTP 200.
4. **`SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md`** (Updated in both repos)
   - Advanced version to Revision 29.
   - Documented fail-closed reconciliation model, 8-scenario accounting table, and webhook integration details.

---

## 8. Unresolved Provider or Business Decisions Left Explicitly Pending

1. **Non-Installment Full-Course / PYQ Refunds:**
   - When a refund event arrives for a non-installment product (full course purchase or PYQ package), the webhook updates `payments.refund_amount`, but does not alter course enrollments or access grants. Business confirmation is required on whether full-course refunds should automatically deactivate enrollments via an RPC or require manual administrative processing.
2. **Refund Classification (Duplicate Charge vs Goodwill):**
   - Razorpay refund payloads contain an optional `notes` dictionary but do not have an automated standard enum distinguishing "duplicate accidental charge" from administrative goodwill refunds. Currently all installment refunds are recorded as `duplicate_charge_refund` adjustments under the governing no-refund policy. Any alternative taxonomy requires formal policy approval.
3. **Multi-Item Order Split Refunds:**
   - In rare cases where an order contains both an installment item and another item, Razorpay refunds the payment as a single lump sum. Granular attribution across order items requires administrator review.

---

## 9. Static Checks Performed and Their Limitations

### Static Checks Performed
1. **PL/pgSQL Syntax & Token Balancing:**
   - Migration 219: 952 single quotes, 12 dollar quotes, 432 parentheses — perfectly balanced.
   - Test File: 942 single quotes, 2 dollar quotes, 367 parentheses — perfectly balanced.
2. **TypeScript Offline Transpilation Check:**
   - `razorpay-webhook/index.ts` verified offline using project TypeScript compiler (`C:/Projects/mocktest-admin/node_modules/typescript`).
   - Transpiled 75,162 bytes with **zero diagnostics errors**.
3. **Cryptographic SHA-256 Parity:**
   - Verified that all synchronized files are byte-identical across `mocktest-admin` and `MockTestApp`.

### Limitations
- Static parsing validates lexical balance and TypeScript type syntax only. It does not execute SQL against a running database engine or validate query execution plans.
- Database integration tests remain strictly **PENDING REVIEW** until local Supabase services are authorized to start.

---

## 10. Repository Parity Results

| File Path | SHA-256 Checksum (Both Repositories) | Status |
| :--- | :--- | :--- |
| `supabase/migrations/219_installment_foundation_and_access_control.sql` | `7629933366647864ABA0CF804173188FB8E0E35C9674D56AD791A744476C2BF0` | **BYTE-IDENTICAL** |
| `supabase/tests/installment_foundation_and_access_control_test.sql` | `85BDF5C2BF8E67E08DAF6D5C41DEAF53E36D2646CFE7FDF1CD75B23FDE4117B6` | **BYTE-IDENTICAL** |
| `SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md` | `CB5BBBFB87E00A8BF0AE4CC55508D12CEA6E6F90B204317D34262295EF01C47A` | **BYTE-IDENTICAL** |

---

## 11. Explicit Confirmation of Operational Restrictions

1. **Docker Desktop:** Neither started, stopped, inspected, nor modified.
2. **Local Supabase Services:** Neither started, stopped, restarted, nor configured.
3. **Database Execution:** Zero SQL statements or migrations were applied to local, staging, or production databases.
4. **Edge Functions Deployment:** No functions were deployed to Supabase Edge Runtime or remote hosts.
5. **Provider Configuration & Live Data:** No payment gateway settings, webhook secrets, or production data were altered.
6. **Working Tree Changes:** All unrelated modifications in both repositories (Play Billing, MSG91, Turnstile, Account Deletion) remain intact and uncommitted.

---
