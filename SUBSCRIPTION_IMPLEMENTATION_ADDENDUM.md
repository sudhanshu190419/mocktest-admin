# Make Me Topper: Comprehensive Fixed-Course-Fee Installment Architecture (Revision 34)

**Document Reference:** `MMT-AUDIT-2026-ADDENDUM-31-DISPUTE-HISTORY-LIFECYCLE-ORDERING-CURRENCY`  
**Date:** October 28, 2026  
**Status:** **PHASE 1 DISPUTE FINANCIAL HISTORY, LIFECYCLE ORDERING, CURRENCY INTEGRITY & LEDGER RECONCILIATION AUDIT COMPLETE — NOT DEPLOYED TO PRODUCTION — AWAITING REVIEW**  
**Governing Source-of-Truth:** [`subscription_rule.md`](file:///C:/Projects/mocktest-admin/subscription_rule.md)  
**Related Documents:**
- [`REVISION_31_FINANCIAL_STATE_INTEGRITY_AUDIT.md`](file:///C:/Projects/MockTestApp/REVISION_31_FINANCIAL_STATE_INTEGRITY_AUDIT.md)
- [`REVISION_30_PAYMENT_LIFECYCLE_AND_CURRENCY_AUDIT.md`](file:///C:/Projects/MockTestApp/REVISION_30_PAYMENT_LIFECYCLE_AND_CURRENCY_AUDIT.md)
- [`SUBSCRIPTION_IMPLEMENTATION_READINESS_REVIEW.md`](file:///C:/Projects/mocktest-admin/SUBSCRIPTION_IMPLEMENTATION_READINESS_REVIEW.md)
- [`SUBSCRIPTION_BILLING_MODEL_ANALYSIS.md`](file:///c:/Projects/MockTestApp/SUBSCRIPTION_BILLING_MODEL_ANALYSIS.md)
- [`SUBSCRIPTION_RULE_VERIFICATION_REPORT.md`](file:///c:/Projects/MockTestApp/SUBSCRIPTION_RULE_VERIFICATION_REPORT.md)

---

## 1. Executive Summary & Targeted Corrections Applied

This document represents the **authoritative, consolidated technical specification and implementation record** for Make Me Topper's **Fixed Course Fee Paid Through Manual Installments** architecture. Revision 31 formalizes immutable dispute financial history, refund lifecycle ordering and anti-downgrade protections, offline currency conversion verification, and cumulative refund summary identifier semantics:

1. **Targeted Correction 1: Separation of Historical Dispute Debit from Current Reduction (Revision 31):**  
   - Added `restored_amount numeric(10,2) not null default 0.00 check (restored_amount >= 0.00 and restored_amount <= amount)` to `public.installment_adjustments`.
   - `amount`: Retains the **immutable historical gross amount debited / deducted** by the provider. It is never overwritten to 0.00 when a dispute is won or closed.
   - `restored_amount`: Records the **verified funds returned / credited** to the merchant upon winning a dispute.
   - Current active credit reduction is calculated dynamically as `greatest(0.00, amount - restored_amount)`.
   - An open dispute with `amount_deducted = 0` records `amount = 0.00, restored_amount = 0.00`, creating zero reduction and no phantom debit.
   - A subsequent verified restoration sets `restored_amount = amount`, clearing the reduction without erasing the original debit evidence.
2. **Targeted Correction 2: Dispute Closed State Must Not Erase Real Debits (Revision 31):**  
   - A dispute transitioning to `status = 'closed'` retains its historical debit (`amount = 400.00`) and existing `restored_amount = 0.00`.
   - The database triggers and RPC evaluate active reversals across `status in ('processed', 'lost', 'closed', 'under_review', 'won')` using `greatest(0.00, amount - restored_amount)`. Moving to `closed` preserves confirmed debits and does not silently erase allocation deficits.
   - If a dispute is won but provider settlement has not verified returned funds (`restored_amount = 0.00`), the reduction remains in effect and flags `requires_admin_review = true`.
3. **Targeted Correction 3: Refund Lifecycle Ordering & Anti-Downgrade Protection (Revision 31):**  
   - Webhook handler enforces a strict state transition matrix to handle out-of-order notification delivery:
     - Stale events (e.g. delayed `refund.created` arriving after `refund.processed` or `refund.failed`) are rejected from downgrading the verified state and acknowledged idempotently.
     - Unexpected transitions (e.g. `refund.processed` arriving after `refund.failed`) are flagged for review without corrupting the terminal failure record.
     - `refund.speed_changed` is handled as an informational event with zero financial modification.
4. **Targeted Correction 4: Isolated Offline Unit Test for Currency Conversion (Revision 31):**  
   - Extracted `convertPaiseToRupees()` into standalone module `supabase/functions/razorpay-webhook/currency.ts`.
   - Verified via isolated offline unit tests in `src/services/admin/__tests__/razorpayCurrencyConversion.test.ts` across exact boundary cases: 50,000 paise = ₹500.00, 39,000 paise = ₹390.00, 40,000 paise = ₹400.00, 0 paise = ₹0.00, null/undefined/negative/NaN safely guarded.
5. **Targeted Correction 5: Authoritative `refund_gateway_id` Semantics (Revision 31):**  
   - `payments.refund_gateway_id` explicitly represents the **most recently processed refund transaction ID**, not the initial partial refund ID.
   - Clarified that one scalar ID cannot prove the identity of every transaction in a cumulative refund summary; `public.installment_adjustments` remains the sole authoritative, itemized transaction ledger.
6. **Targeted Correction 6: Fail-Closed Refund Reconciliation Model (Revision 29):**  
   - Cumulative summary in `payments.refund_amount` and granular itemized ledger in `public.installment_adjustments` must match ($R_{\text{summary}} = \Sigma_{\text{adj}}$) with matching `refund_gateway_id`.
   - Any unitemized discrepancy ($R_{\text{summary}} > \Sigma_{\text{adj}}$), stale summary ($R_{\text{summary}} < \Sigma_{\text{adj}}$), or conflicting gateway event ID blocks new installment allocations (`code = 'PAYMENT_REFUND_RECONCILIATION_REQUIRED'`) and flags administrative review (`requires_admin_review = true`).
   - Prior allocations and student subscription access are preserved pending administrative review.

---

## 2. Approved Business Rules

Do not change:
- Fixed contractual installment schedule.
- Zero grace for overdue installments.
- Manual Razorpay installment payments on the website.
- Google Play Billing for Android full-course purchases.
- Existing manual batch assignment.
- Existing live-class, recording and content-access rules.
- Existing ownership policy.
- No late fees.
- No automatic reallocation of prior payment allocations.
- No automatic entitlement revocation due to a financial reversal.
- No unapproved refund, withdrawal, cancellation or permanent-ownership policy.

---

## 3. Scenarios of Refund, Reversal & Dispute Accounting (Fail-Closed Model)

| Scenario | Gateway Summary ($R_{\text{summary}}$) | Ledger Adjustments (Status & Type) | Confirmed Reduction | Net Available Credit | Allocation & Administrative Review Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A. Single Consistent Refund** | ₹300.00 (`rfnd_a`) | ₹300.00 (`gateway_refund`, `processed`) | ₹300.00 | ₹1,000 - ₹300 = **₹700.00** | Reconciled! Allocation proceeds normally. Agreement active. |
| **B. Multiple Itemized Refunds** | ₹890.00 (`rfnd_unit_002`) | ₹500 (`rfnd_unit_001`) + ₹390 (`rfnd_unit_002`) | ₹890.00 | ₹1,000 - ₹890 = **₹110.00** | Reconciled! Latest ID stored in summary. Allocation proceeds normally. |
| **C. Summary > Ledger (Unitemized)** | ₹500.00 (`rfnd_sum_c`) | ₹200 (`rfnd_c1`, `processed`) | Discrepancy ($\Delta = ₹300$) | Unverified / Ambiguous | **FAIL-CLOSED:** Allocation BLOCKED (`PAYMENT_REFUND_RECONCILIATION_REQUIRED`). Flags review. Prior allocations preserved. |
| **D. Ledger > Summary (Stale Summary)** | ₹200.00 (`rfnd_d1`) | ₹200 (`rfnd_d1`) + ₹300 (`rfnd_d2`) | Discrepancy ($\Delta = ₹300$) | Unverified / Ambiguous | **FAIL-CLOSED:** Allocation BLOCKED (`PAYMENT_REFUND_RECONCILIATION_REQUIRED`). Flags review. Prior allocations preserved. |
| **E. Conflicting Gateway Event IDs** | ₹500.00 (`rfnd_alpha`) | ₹500.00 (`rfnd_beta`, `processed`) | Discrepancy (conflicting IDs) | Unverified / Ambiguous | **FAIL-CLOSED:** Allocation BLOCKED (`PAYMENT_REFUND_RECONCILIATION_REQUIRED`). Flags review. Prior allocations preserved. |
| **F. Reconciled Refund + Reversal** | ₹300.00 (`rfnd_f1`) | ₹300 (`rfnd_f1`, `processed`) + ₹400 (`disp_f1`, `lost`) | ₹700.00 (300 ref + 400 rev) | ₹1,000 - ₹700 = **₹300.00** | Reconciled! Distinct reductions summed. Allocation succeeds for ₹300.00. |
| **G. Post-Allocation Reversal (Deficit)** | ₹0.00 | ₹600.00 (`disp_g1`, `lost`) | ₹600.00 reversal | Already alloc ₹800 > Available ₹400 | Deficit condition (₹400). Reports `PAYMENT_REVERSED_ALLOCATION_DEFICIT`. Flags review. Prior allocations preserved. |
| **H. Duplicate Event Delivery** | Duplicate delivery of existing ID | Unique violation on `uq_installment_adjustments_gateway_event` | N/A | Unchanged | DB blocks duplicate insert. Webhook catches `23505` and returns idempotent HTTP 200. |
| **I. Open Dispute (Zero Deduction)** | ₹0.00 | `amount = 0.00, restored = 0.00, under_review` | ₹0.00 | ₹1,000.00 | Zero deduction; no phantom reduction; no premature review flag. |
| **J. Closed Dispute (Unrestored Debit)** | ₹0.00 | `amount = 400.00, restored = 0.00, closed` | ₹400.00 | ₹600.00 | Confirmed debit preserved upon closing; does not erase reduction. |
| **K. Won Dispute (Verified Restored)** | ₹0.00 | `amount = 400.00, restored = 400.00, won` | ₹0.00 | ₹1,000.00 | Historical debit retained; restoration verified; net reduction clears to ₹0.00. |
| **L. Won Dispute (Unverified Return)** | ₹0.00 | `amount = 400.00, restored = 0.00, won` | ₹400.00 | ₹600.00 | Discrepancy! Debit remains in effect until provider settlement; flags review. |
| **M. Out-of-Order Stale Refund** | ₹350.00 (`rfnd_ord_001`) | `amount = 350.00, status = 'processed'` | ₹350.00 | ₹650.00 | Delayed `created` event rejected by anti-downgrade logic; state preserved. |

---

## 4. Normalized Payment Allocation Model & Event Idempotency

```
[public.payments: Authoritative Gateway Record]
       │
       ▼ (1:M / M:N)
[public.installment_payment_allocations: Normalized Allocation Ledger]
       ├── allocation_id        UUID PRIMARY KEY DEFAULT gen_random_uuid()
       ├── payment_id          UUID NOT NULL REFERENCES public.payments(payment_id) ON DELETE RESTRICT
       ├── schedule_id         UUID NOT NULL REFERENCES public.student_installment_schedule(schedule_id) ON DELETE RESTRICT
       ├── agreement_id        UUID NOT NULL REFERENCES public.student_course_agreements(agreement_id) ON DELETE RESTRICT
       ├── allocated_amount    NUMERIC(10,2) NOT NULL CHECK (allocated_amount > 0)
       ├── allocated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
       ├── CONSTRAINT uq_payment_schedule_allocation UNIQUE (payment_id, schedule_id)
       └── CONSTRAINT fk_allocations_agreement_schedule FOREIGN KEY (agreement_id, schedule_id)
             REFERENCES public.student_installment_schedule (agreement_id, schedule_id) ON DELETE RESTRICT
       │
       ▼ (M:1)
[public.student_installment_schedule: Milestone Schedule]
       ├── schedule_id         UUID PRIMARY KEY DEFAULT gen_random_uuid()
       ├── agreement_id        UUID NOT NULL REFERENCES public.student_course_agreements(agreement_id) ON DELETE RESTRICT
       ├── installment_index   SMALLINT NOT NULL CHECK (installment_index >= 1)
       ├── due_date            DATE NOT NULL
       ├── revised_due_date    DATE NULL
       ├── amount_due          NUMERIC(10,2) NOT NULL CHECK (amount_due > 0)
       ├── amount_paid         NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0)
       ├── waiver_amount       NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (waiver_amount >= 0)
       ├── status              TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'overdue', 'waived', 'payment_reversed'))
       ├── paid_at             TIMESTAMPTZ NULL
       ├── payment_id          UUID NULL REFERENCES public.payments(payment_id) ON DELETE RESTRICT
       └── CONSTRAINT uq_schedule_agreement_schedule UNIQUE (agreement_id, schedule_id)
       │
       ▼ (Audit Ledger)
[public.installment_adjustments: Adjustments & Gateway Reversals]
       ├── adjustment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid()
       ├── agreement_id         UUID NOT NULL REFERENCES public.student_course_agreements(agreement_id) ON DELETE RESTRICT
       ├── installment_index    SMALLINT NULL
       ├── adjustment_type      TEXT NOT NULL CHECK (adjustment_type IN ('waiver', 'scholarship', 'reschedule', 'admin_credit', 'duplicate_charge_refund', 'gateway_refund', 'gateway_reversal'))
       ├── amount               NUMERIC(10,2) NOT NULL DEFAULT 0.00 (Historical Gross Debit)
       ├── restored_amount      NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (restored_amount >= 0.00 AND restored_amount <= amount)
       ├── status               TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('created', 'processed', 'failed', 'under_review', 'won', 'lost', 'closed'))
       ├── reference_payment_id UUID NULL REFERENCES public.payments(payment_id) ON DELETE RESTRICT
       ├── gateway_event_id     VARCHAR(255) NULL
       ├── reason               TEXT NOT NULL
       ├── approved_by_admin_id UUID NULL REFERENCES public.profiles(profile_id) ON DELETE RESTRICT
       ├── CONSTRAINT uq_installment_adjustments_gateway_event UNIQUE (gateway_event_id)
       ├── CONSTRAINT ck_adjustment_audit_identity CHECK (
             (adjustment_type in ('gateway_refund', 'duplicate_charge_refund', 'gateway_reversal') 
                and reference_payment_id is not null 
                and gateway_event_id is not null 
                and length(trim(gateway_event_id)) > 0)
             or (adjustment_type = 'admin_credit' and reference_payment_id is not null)
             or (approved_by_admin_id is not null)
           )
       └── CONSTRAINT ck_adjustment_gateway_linkage CHECK (
             (adjustment_type not in ('gateway_refund', 'duplicate_charge_refund', 'gateway_reversal'))
             or (reference_payment_id is not null 
                 and gateway_event_id is not null 
                 and length(trim(gateway_event_id)) > 0)
           )
```

---

## 5. Implementation & Test Verification Status

### 5.1 Deliverables Completed Locally
- [x] Edge function capture timestamp, refund lifecycle anti-downgrade logic, dispute financial history separation, and currency conversion module implemented:
  - `C:\Projects\mocktest-admin\supabase\functions\razorpay-webhook\currency.ts`
  - `C:\Projects\mocktest-admin\supabase\functions\razorpay-webhook\index.ts`
- [x] Isolated offline unit test for currency conversion created and executed:
  - `C:\Projects\mocktest-admin\src\services\admin\__tests__\razorpayCurrencyConversion.test.ts`
- [x] Migration 219 updated and synchronized in both repositories:
  - `C:\Projects\mocktest-admin\supabase\migrations\219_installment_foundation_and_access_control.sql`
  - `C:\Projects\MockTestApp\supabase\migrations\219_installment_foundation_and_access_control.sql`
- [x] Database integration test suite expanded to 32 tests covering dispute history preservation, closed state debits, latest refund_gateway_id, and refund lifecycle ordering:
  - `C:\Projects\mocktest-admin\supabase\tests\installment_foundation_and_access_control_test.sql`
  - `C:\Projects\MockTestApp\supabase\tests\installment_foundation_and_access_control_test.sql`
- [x] Canonical business rules synchronized:
  - `C:\Projects\mocktest-admin\subscription_rule.md`
  - `C:\Projects\MockTestApp\subscription_rule.md`
- [x] Specification addendum updated to Revision 31:
  - `C:\Projects\MockTestApp\SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md`
  - `C:\Projects\mocktest-admin\SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md`

### 5.2 Test Suite Coverage (Tests 28 to 32)
1. **Test 28:** Refund lifecycle state transitions & failed refund handling (created $ightarrow$ processed $ightarrow$ failed).
2. **Test 29 (Revision 31):** Dispute lifecycle, historical debit preservation, closed state, and deduction accounting:
   - Stage A: Open dispute with `amount_deducted = 0` (`status = 'under_review'`, `amount = 0.00`, `restored = 0.00`) $ightarrow$ 0.00 reduction, net credit = 1000.00, review flag = false.
   - Stage B: Confirmed debit of ₹400.00 (`status = 'lost'`, `amount = 400.00`, `restored = 0.00`) $ightarrow$ reduction = 400.00, net credit = 600.00.
   - Stage C: Dispute closed without restoration (`status = 'closed'`, `amount = 400.00`, `restored = 0.00`) $ightarrow$ reduction preserved at 400.00, net credit = 600.00. Moving to closed does NOT erase debit!
   - Stage D: Inconsistent status and evidence (`status = 'won'`, `restored = 0.00`) $ightarrow$ reduction remains 400.00 until provider verified.
   - Stage E: Verified fund restoration (`status = 'won'`, `amount = 400.00`, `restored = 400.00`) $ightarrow$ reduction drops to 0.00, net credit restored to 1000.00, historical debit evidence in `amount` preserved.
3. **Test 30 (Revision 31):** Currency unit integrity & authoritative `refund_gateway_id` semantics:
   - 50,000 paise converts to ₹500.00 (`rfnd_unit_001`); 39,000 paise converts to ₹390.00 (`rfnd_unit_002`).
   - Verified that `payments.refund_gateway_id` updates to the **most recently processed refund transaction ID** (`rfnd_unit_002`).
   - Total ledger and summary = ₹890.00. Net available credit = ₹110.00. Allocation of 120.00 fails trigger; allocation of 110.00 succeeds.
4. **Test 31:** Financial event classification:
   - Generic `gateway_refund` and `duplicate_charge_refund` succeed with `approved_by_admin_id = null`.
   - Missing gateway linkage fails closed under `ck_adjustment_gateway_linkage`.
5. **Test 32 (Revision 31):** Refund lifecycle ordering & stale event protection:
   - Stage A: `refund.processed` arrives first (`rfnd_ord_001`, ₹350.00). Active reduction = 350.00, net credit = 650.00.
   - Stage B: Delayed stale `refund.created` arrives $ightarrow$ anti-downgrade logic preserves `processed` state.
   - Stage C: `refund.speed_changed` arrives $ightarrow$ informational event; zero financial alteration.
   - Stage D: `refund.failed` arrives $ightarrow$ updates to `failed`, preserves audit record, recalculates summary to 0.00, restores credit to 1000.00.
   - Stage E: Subsequent delayed `created` event after failure $ightarrow$ rejected by anti-downgrade logic. Duplicate delivery rejected by unique constraint.

---

## 6. Implementation Status

### **STATUS: PHASE 1 DISPUTE FINANCIAL HISTORY, LIFECYCLE ORDERING, CURRENCY INTEGRITY & LEDGER RECONCILIATION AUDIT COMPLETE — NOT DEPLOYED TO PRODUCTION — AWAITING REVIEW**

*All Phase 1 database schema definitions, triggers, RPCs, access control functions, edge function timestamp mappings, security policies, and automated test suites have been updated with the targeted payment integrity and accounting corrections. In accordance with strict operational restrictions, no Docker containers or Supabase services were started, no migrations applied, no Edge Functions deployed, and no production systems or data modified.*

---

# Revision 32 Addendum: Refund Status Reconciliation, Strict Currency Validation and Dispute Audit Integrity

## 1. Contradictory Refund Failure Reconciliation (Issue 1)

### 1.1 Problem Statement
When an instant refund fails at the beneficiary bank after having been marked `processed`, Razorpay delivers a subsequent `refund.failed` event. Under Revision 31, Test 32:
1. ₹350 refund processed $\rightarrow$ credit reduced from ₹1,000 to ₹650.
2. Contradictory `refund.failed` arrived $\rightarrow$ adjustment marked `failed`, `payments.refund_amount` recalculated to ₹0.00, credit prematurely restored to ₹1,000.
This transition restored financial credit to the student without establishing whether the funds had authoritatively returned to the merchant's account.

### 1.2 Reconciliation Rules & Fail-Closed Protection
1. **Transition to `under_review`:** When `currentStatus === 'processed'` and incoming event is `refund.failed`, the adjustment status transitions to `under_review` (not `failed`).
2. **Preserve Confirmed Financial Evidence:** `payments.refund_amount` remains at ₹350.00. Payment credit is **NOT** automatically restored.
3. **Database-Level Allocation Blocking:** 
   - `payments.refund_amount` = ₹350.00.
   - Active ledger refund adjustments (`status = 'processed'`) = ₹0.00.
   - Strict reconciliation condition `(coalesce(payments.refund_amount, 0.00) = v_refund_adjustments)` evaluates to **`false`**.
   - Triggers `trg_enforce_allocation_limits` and `process_installment_payment` automatically block any new allocations from this payment with `check_violation`.
4. **Preserve Student Entitlements:** Prior allocations (e.g. ₹500.00) and course access remain intact; no automatic revocation occurs.
5. **Idempotent Webhook Retries:** Subsequent duplicate `refund.failed` deliveries while `under_review` are acknowledged with HTTP 200 without altering state.
6. **Authoritative Conflict Resolution:** When an administrator verifies provider bank settlement:
   - If refund genuinely failed: Admin transactionally sets `payments.refund_amount = 0.00` and adjustment `status = 'failed'`. Reconciled! Credit safely returns to ₹1,000.00.
   - If refund actually succeeded: Admin sets adjustment `status = 'processed'`. Reconciled! Credit remains ₹650.00.

---

## 2. Strict Currency Validation at Ingestion Boundary (Issue 2)

### 2.1 Problem Statement
Revision 31's `convertPaiseToRupees` silently substituted `0.00` for `null`, `undefined`, `NaN`, `Infinity`, and negative amounts. This masked malformed payload data and could produce invalid zero-value ledger entries.

### 2.2 Strict Ingestion Boundary (`convertPaiseToRupeesStrict`)
1. **Numeric Integrity:** Must be a finite number; non-numeric types, `NaN`, and `Infinity` throw `InvalidCurrencyValueError`.
2. **Safe Integer Minor Units:** Razorpay paise cannot be fractional. Non-safe integers or fractional floats throw `InvalidCurrencyValueError`.
3. **Non-Negative:** Negative inputs throw `InvalidCurrencyValueError`.
4. **Currency Code:** Must match expected provider currency (`INR`). Non-INR codes throw `InvalidCurrencyValueError`.
5. **Transaction Boundary:** Value must not exceed maximum supported limit (100,000,000 paise / ₹10,00,000).
6. **Operation-Specific Zero Allowance:**
   - Refunds: `allowZero = false` (a refund cannot be ₹0.00; throws `InvalidCurrencyValueError`).
   - Disputes: `allowZero = true` for `amount_deducted` (open dispute with zero initial deduction is valid). Claimed dispute amount requires `allowZero = false`.
7. **Webhook Boundary Handling:** Any thrown `InvalidCurrencyValueError` is caught and returned as HTTP 400 with structured diagnostic error, preventing corruption of database state.

---

## 3. Dispute Historical Debit Immutability & Restoration Audit (Issue 3)

### 3.1 Problem Statement
While documentation designated `amount` as immutable historical debit, PostgreSQL tables lacked a database-level trigger enforcing this invariant. An update could alter an established debit amount without constraint.

### 3.2 Database Enforcement Trigger (`trg_enforce_adjustment_immutability`)
Implemented on `public.installment_adjustments` as a `BEFORE UPDATE` trigger:
1. **Historical Debit Immutability:** Once `OLD.amount > 0.00`, any update attempting `NEW.amount <> OLD.amount` throws `check_violation`.
2. **Permitted Initial Confirmation:** When an open dispute is initially recorded with zero deduction (`OLD.amount = 0.00`), transitioning to a confirmed debit (`NEW.amount > 0.00`) is explicitly permitted.
3. **Monotonic Restoration:** `NEW.restored_amount` cannot decrease (`NEW.restored_amount >= OLD.restored_amount`). Verified funds returned cannot vanish without audit trail.
4. **Ceiling Invariant:** `NEW.restored_amount <= NEW.amount`.
5. **Structural Linkage Protection:** `agreement_id`, `reference_payment_id`, `gateway_event_id`, and `adjustment_type` cannot be modified.

---

## 4. Revision 32 Test Verification Summary

| Test Case | Scenario Description | Numerical Expected Result | Verification Engine |
| :--- | :--- | :--- | :--- |
| **Test 29.A** | Open dispute with zero deduction | `amount = 0.00`, `restored = 0.00` $\rightarrow$ active deduction = ₹0.00 | SQL Assertion |
| **Test 29.B** | Provider confirms lost dispute debit | `amount = 400.00`, `restored = 0.00` $\rightarrow$ active deduction = ₹400.00 | SQL Assertion |
| **Test 29.B2** | Unexplained modification of confirmed debit | Attempt `UPDATE amount = 250.00` $\rightarrow$ blocked by `check_violation` | Trigger `trg_enforce_adjustment_immutability` |
| **Test 29.C** | Dispute closed without verified restoration | `status = 'closed'`, `amount = 400.00` $\rightarrow$ deduction preserved at ₹400.00 | SQL Assertion |
| **Test 29.D** | Dispute won without verified restoration | `status = 'won'`, `restored = 0.00` $\rightarrow$ deduction preserved at ₹400.00 | SQL Assertion |
| **Test 29.D2** | Partial verified restoration of ₹150.00 | `amount = 400.00`, `restored = 150.00` $\rightarrow$ active deduction = ₹250.00 | SQL Assertion |
| **Test 29.D3** | Attempt to decrease `restored_amount` | Attempt `UPDATE restored = 50.00` $\rightarrow$ blocked by `check_violation` | Trigger `trg_enforce_adjustment_immutability` |
| **Test 29.D4** | Repeated restoration notification | `restored = 150.00` repeated $\rightarrow$ idempotent success | SQL Assertion |
| **Test 29.E** | Full verified restoration of ₹400.00 | `amount = 400.00`, `restored = 400.00` $\rightarrow$ active deduction = ₹0.00 | SQL Assertion |
| **Test 32.A** | Processed refund of ₹350 on ₹1,000 payment | `payments.refund = 350.00`, ledger = 350.00 $\rightarrow$ credit = ₹650.00 | SQL Assertion |
| **Test 32.B** | Delayed stale `refund.created` | Ignored; state preserved at `processed` | Anti-downgrade logic |
| **Test 32.C** | Informational `speed_changed` | Acknowledged; zero financial change | SQL Assertion |
| **Test 32.D** | Contradictory `refund.failed` after processed | Adjustment transitions to `under_review`, `payments.refund = 350.00` preserved, agreement flagged for review | Webhook Handler |
| **Test 32.D2** | Allocation attempt during unreconciled state | New allocation of ₹100.00 $\rightarrow$ BLOCKED by `check_violation` | Database Trigger `trg_enforce_allocation_limits` |
| **Test 32.D3** | Entitlement preservation during conflict | Existing ₹500 allocation remains intact; student access not revoked | SQL Assertion |
| **Test 32.E** | Duplicate contradictory failure delivery | Acknowledged with HTTP 200; remains `under_review` | Webhook Idempotency |
| **Test 32.F** | Authoritative conflict resolution | Admin clears refund to ₹0.00 and marks `failed` $\rightarrow$ credit = ₹1,000.00, allocation of ₹100 succeeds | Transactional SQL |
| **Test 32.G** | Duplicate insert of refund event ID | Re-insert `rfnd_ord_001` $\rightarrow$ blocked by `unique_violation` | Schema Constraint |
| **Vitest (18/18)** | Offline unit test suite for strict currency | Valid values, zero-rules, malformed inputs, safe integers, currency check | Vitest Runner |

---

# Revision 33 Addendum: Webhook Reliability, Dispute Restoration Audit and Reconciliation Recovery

## 1. Webhook Reliability & Authenticated Malformed Event Quarantine (Issue 1)

### 1.1 Problem Statement & Operational Provider Risk
In Revision 32, malformed currency values were rejected with HTTP 400. While strict validation is essential, returning non-2xx HTTP responses to an authenticated Razorpay webhook has dangerous operational consequences:
- Razorpay treats any non-2xx response as a delivery failure and enters automated retry backoff (retrying for up to 24 hours).
- After repeated consecutive delivery failures, Razorpay **automatically deactivates the merchant webhook endpoint** in the production dashboard, halting all payment processing.
- A client-side or payload formatting bug at the provider level would thus cause a catastrophic outage of legitimate payment capture events.

### 1.2 Categorized Response Policy (`determineWebhookResponsePolicy`)
The implementation strictly distinguishes four operational states:

1. **Unauthenticated Request (Invalid / Missing Signature):**
   - Rejected immediately with **HTTP 401**. Razorpay retries any non-2xx status code for up to 24 hours. The local application never accepts or persists unauthenticated events. Operational alert raised.
2. **Malformed JSON Payload Syntax:**
   - Rejected with **HTTP 400**. Razorpay treats 400 as a delivery failure and retries for up to 24 hours. Operational alert raised.
3. **Authenticated Event with Malformed Financial Fields (Paise < 0, NaN, Non-Integer, Wrong Currency, or 0 when invalid):**
   - Signature is authentic, but financial content cannot be safely processed.
   - **No Silent Zero Substitution:** The malformed amount is explicitly rejected.
   - **Durable Quarantine:** The event is durably recorded for administrator review:
     - Student agreement is flagged: `student_course_agreements.requires_admin_review = true`.
     - Payment record logs failure: `payments.failure_reason = 'MALFORMED_..._QUARANTINE: ...'`.
   - **Delivery Acknowledged:** Returns **HTTP 200** with `{ success: true, quarantined: true }`. No financial credit, refund, or reversal is applied.
   - **Database Failure Fallback:** If the database call to record the quarantine fails, the webhook returns **HTTP 500**, preserving a retryable failure path so the event is not lost during transient database downtime.
4. **Valid Financial Event:**
   - Processed transactionally; acknowledged with **HTTP 200**.

---

## 2. Event-Level Auditability for Dispute Restorations (Issue 2)

### 2.1 Problem Statement
Revision 32 maintained a scalar `restored_amount` on `installment_adjustments`. However, a scalar field alone cannot distinguish an individual webhook delivery event from the dispute entity, nor can it prevent double-counting if a webhook is redelivered.

### 2.2 Dispute Restoration Event Ledger (`public.installment_dispute_restorations`)
A dedicated event-level ledger was established in Migration 219 (Section 5d):
```sql
create table if not exists public.installment_dispute_restorations (
    restoration_id       uuid primary key default gen_random_uuid(),
    adjustment_id        uuid not null references public.installment_adjustments(adjustment_id) on delete restrict,
    dispute_id           varchar(255) not null,
    gateway_event_id     varchar(255) not null,
    amount               numeric(10,2) not null check (amount > 0.00),
    restored_at          timestamptz not null default now(),
    reason               text null,
    created_at           timestamptz not null default now(),
    constraint uq_dispute_restorations_event unique (gateway_event_id)
);
```

### 2.3 Event Synchronization & Ceilings (`trg_sync_dispute_restoration`)
- **Entity vs. Event ID Distinction:** The parent adjustment holds the dispute entity ID (`gateway_event_id = 'disp_xxx'`), while individual restorations hold the webhook event ID (`gateway_event_id = 'evt_rst_xxx'`).
- **Idempotency & Anti-Double-Counting:** `uq_dispute_restorations_event` guarantees that the same webhook delivery event ID can never be inserted twice. Repeated delivery is caught with `unique_violation` and acknowledged idempotently without adding funds twice.
- **Incremental Separate Restorations:** Distinct verified events (e.g. ₹150 via `evt_rst_001` and ₹100 via `evt_rst_002`) are recorded independently. The trigger synchronizes `installment_adjustments.restored_amount = sum(amount) = 250.00`.
- **Gross Debit Ceiling:** If total restorations exceed original gross debit (`sum(amount) > v_gross_debit`), the trigger throws `check_violation`.
- **Unverifiable Restorations:** Notifications lacking verifiable provider settlement proof do not create restoration records; the conservative financial reduction is preserved, and agreement review is flagged.

---

## 3. Reconciliation Recovery & Admin-Review Flag Lifecycle (Issue 3)

### 3.1 Review Flag Independence
- **Review Flag Setting:** When a refund discrepancy, reversed allocation deficit, or contradictory failure occurs, `student_course_agreements.requires_admin_review` is set to `true`.
- **No Automatic Clearing:** Correcting payment or adjustment amounts does **NOT** automatically clear `requires_admin_review`. This guarantees that concurrent or unrelated review conditions (e.g. academic status, chargeback investigation, or unpaid gaps) are not silently dropped.
- **Supported Administrative Clearance:** Once the administrator completes reconciliation, the review flag is explicitly cleared:
  ```sql
  -- Note: Direct SQL execution is superseded in Revision 34 by the authorized RPC:
  select public.resolve_agreement_admin_review(:agreement_id, 'Audit resolution notes');
  ```
- **Allocation Unblocking:** New allocations are unlocked as soon as `v_is_reconciled = true` (`payments.refund_amount = v_refund_adjustments`). Existing allocations and student access remain intact throughout.

---

## 4. Complete Test Suite Matrix (Tests 28 to 33)

| Test | Suite Name & Focus | Key Invariant Verified |
| :--- | :--- | :--- |
| **Test 28** | Refund Lifecycle State Transitions | `created` $\rightarrow$ `processed` $\rightarrow$ `failed` with active reduction accounting. |
| **Test 29** | Dispute Event-Level Restoration Ledger (Rev 33) | Historical debit preserved; ₹150 event recorded; duplicate delivery blocked by unique constraint; separate ₹100 event counted; excessive restoration blocked by ceiling check; unverifiable restoration retains conservative reduction; full restoration verified. |
| **Test 30** | Currency Conversion & Latest Gateway ID | Single conversion boundary (paise / 100); latest processed refund ID tracked in `refund_gateway_id`. |
| **Test 31** | Automated Gateway Audit Identity | Automated events succeed with `approved_by_admin_id = null`; missing linkage fails `ck_adjustment_gateway_linkage`. |
| **Test 32** | Contradictory Refund Failure & Fail-Closed Blocking | Processed refund followed by `refund.failed` transitions to `under_review`, preserves ₹350 refund amount, and blocks new allocations via `check_violation`. |
| **Test 33** | Reconciliation Recovery & Explicit Admin Clearance (Rev 33) | Genuine refund discrepancy blocks allocations; financial reconciliation restores `v_is_reconciled`; `requires_admin_review` is NOT cleared automatically; explicit admin clearance succeeds; subsequent allocation succeeds; existing allocations intact. |
| **Vitest (24/24)** | Offline Unit Suite (Currency & Webhook Policy) | Strict currency validation, zero rules, safe integers, and webhook response policy determination. |

# Revision 34 Addendum: Verified Dispute Restoration, Durable Webhook Quarantine and Authorized Reconciliation

## 1. Verified Dispute Restoration & Evidence Architecture (Issue 1)

### 1.1 Root Cause & Provider Payload Limitations
In Revision 33, receipt of a webhook with event ID `evt_rst_xxx` or a status change to `won` / `closed` with `amount_deducted = 0` was used to increment `restored_amount` on dispute adjustments. However, in Razorpay's API architecture:
- Razorpay dispute webhook entities (`payment.dispute.won`, `payment.dispute.closed`) represent **dispute status lifecycle notifications**, NOT bank settlement credits.
- Razorpay dispute entities do not include bank credit transfer numbers, settlement IDs, or accounting batch identifiers.
- A unique webhook event ID merely identifies an individual HTTP webhook transmission; it does not prove that an independent financial restoration of funds took place.
- Two distinct webhook notifications for the same underlying dispute (e.g., status changes or redeliveries) could incorrectly double-count restorations if event ID uniqueness alone was trusted.

### 1.2 Non-Inference Rules & Authoritative Settlement Reference
Under Revision 34:
1. **Never Infer Restoration Amount:** The system strictly refuses to infer money restoration solely from:
   - A dispute changing to `won`.
   - A dispute changing to `closed`.
   - Incoming payload stating `amount_deducted = 0`.
   - Receipt of a previously unseen webhook event ID.
2. **Conservative Financial Retention:** When a dispute webhook arrives with `won` or `closed`:
   - The adjustment status updates to `won` or `closed`.
   - The historical gross debit (`amount`) is strictly preserved.
   - `restored_amount` is **NOT** increased automatically.
   - The net financial reduction (`amount - restored_amount`) remains in effect against payment credit.
   - The agreement is flagged for review (`requires_admin_review = true`).
   - Existing payment allocations and student course entitlements are preserved intact.
3. **Authoritative Financial Settlement Proof:** Restoration records in `public.installment_dispute_restorations` require an authoritative settlement transfer identifier:
   - Column: `provider_reference_id varchar(255) not null`.
   - Unique Constraint: `constraint uq_dispute_restorations_provider_ref unique (provider_reference_id)`.
   - If two distinct webhook event IDs reference the same underlying settlement credit (`setl_xxx`), the second insert is strictly rejected by the database unique constraint, preventing double-counting.

---

## 2. Durable Quarantine Ledger for Authenticated Malformed Events (Issue 2)

### 2.1 Problem Statement
Revision 33 attempted quarantine by updating `requires_admin_review = true` on agreements and writing a string to `payments.failure_reason`. This had critical durability and audit gaps:
- Events for payments not yet in the database or unlinked to an installment agreement had no persistent storage.
- `payments.failure_reason` is a scalar string that gets overwritten on subsequent failures and cannot store the raw payload.
- Investigation and administrative reconciliation were impossible without the original authenticated payload.

### 2.2 Dedicated Quarantine Table (`public.webhook_quarantine_events`)
Migration 219 (Section 5e) establishes a dedicated quarantine ledger:
```sql
create table if not exists public.webhook_quarantine_events (
    quarantine_id        uuid primary key default gen_random_uuid(),
    gateway_event_id     varchar(255) not null,
    event_type           varchar(100) not null,
    entity_id            varchar(255) null,
    gateway_payment_id   varchar(255) null,
    payment_id           uuid null references public.payments(payment_id) on delete set null,
    agreement_id         uuid null references public.student_course_agreements(agreement_id) on delete set null,
    failure_code         varchar(100) not null,
    failure_reason       text not null,
    payload              jsonb not null,
    created_at           timestamptz not null default now(),
    constraint uq_webhook_quarantine_event unique (gateway_event_id)
);
```

### 2.3 Quarantine Invariants
1. **Authenticated Only:** Webhooks with invalid signatures are rejected immediately with HTTP 401; unauthenticated payloads are never quarantined.
2. **Zero Financial Impact:** Quarantined malformed events create ZERO rows in `installment_adjustments` and modify NO financial fields.
3. **Idempotent Retry:** `uq_webhook_quarantine_event` guarantees that provider redeliveries of the same malformed event are caught with `unique_violation` and acknowledged with HTTP 200 without creating duplicate quarantine rows.
4. **Unlinked Purchases:** Quarantines succeed cleanly even when `payment_id` or `agreement_id` cannot be resolved, ensuring complete event capture.
5. **Fail-Closed Retryable Path:** If the database write to `webhook_quarantine_events` fails, the webhook returns **HTTP 500**, preserving a retryable delivery path so Razorpay will retry when the database recovers.
6. **Delivery Acknowledgment:** Only after durable persistence succeeds is the event acknowledged with **HTTP 200** (`quarantined: true`), halting provider retries and protecting webhook endpoint health.

---

## 3. Accurate Razorpay Delivery Retry Behavior (Issue 3)

### 3.1 Provider Delivery Invariants
Razorpay treats **ALL** non-2xx HTTP responses as delivery failures.
- Razorpay retries failed webhook deliveries according to an exponential backoff schedule for **24 hours**.
- Razorpay does NOT distinguish between 4xx and 5xx status codes: both **HTTP 400 (Bad Request)** and **HTTP 401 (Unauthorized)** are retried.
- Continuous delivery failures will result in Razorpay **automatically disabling the webhook endpoint** in the merchant dashboard.
- Therefore, documentation and comments must never claim that 400 or 401 are "non-retryable" from the provider's perspective.
- Non-retryable from an application perspective means the application cannot process the request without external intervention (correcting secrets or payload formatting); but the gateway will continue retrying until 24h expires or 2xx is returned.

### 3.2 Operational Response Matrix

| Request State | HTTP Status | Application Retryable | Razorpay Will Retry? | Quarantine Required? | Financial Processing? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Invalid Signature** | `401` | No | **Yes (24h)** | No | None |
| **Malformed JSON** | `400` | No | **Yes (24h)** | No | None |
| **Signed Malformed Financials (DB OK)** | `200` | No | **No (Acknowledged)** | **Yes (webhook_quarantine_events)** | None |
| **Signed Malformed Financials (DB Down)** | `500` | Yes | **Yes (24h)** | Yes (attempted) | None |
| **Valid Financial Event (DB Down)** | `500` | Yes | **Yes (24h)** | No | None |
| **Valid Financial Event (DB OK)** | `200` | No | **No (Acknowledged)** | No | Full Processing |

---

## 4. Authorized Reconciliation Review Clearance (Issue 4)

### 4.1 Security Vulnerability of Direct SQL
Direct SQL execution (`UPDATE student_course_agreements SET requires_admin_review = false`) is not an acceptable administrative workflow in production:
- Bypasses application RBAC controls and audit trail requirements.
- Does not validate whether all outstanding review conditions have been addressed.
- Vulnerable to accidental blanket updates.

### 4.2 Authorized Clearance RPC (`public.resolve_agreement_admin_review`)
Migration 219 (Section 5f) establishes a dedicated, secure RPC:
```sql
select public.resolve_agreement_admin_review(
    p_agreement_id => '...',
    p_resolution_notes => 'Verified ₹350 refund against bank settlement statement. Discrepancy resolved.'
);
```

### 4.3 Governance Rules
1. **Strict RBAC:** Restricted to callers where `public.is_admin()` is true or `auth.role() = 'service_role'`. Unauthorized calls (students, anon) fail with SQLSTATE `42501 (insufficient_privilege)`.
2. **Mandatory Resolution Notes:** `p_resolution_notes` cannot be null or empty string.
3. **Canonical Audit Trail:** Safely records the resolution action to `public.write_audit_log`.
4. **Persistent Block on New Allocations:** In both `process_installment_payment` and `trg_enforce_allocation_limits`, new allocations remain strictly blocked while `requires_admin_review = true`, even after financial records are reconciled.
5. **No Automatic Clearance:** Financial reconciliation of payment records alone does **NOT** clear unrelated review conditions on the agreement.
6. **Entitlement Preservation:** Existing allocations and student access are strictly preserved throughout review and resolution.

---

## 5. Revision 34 Comprehensive Test Suite Matrix (Tests 28 to 34)

| Test | Suite Name & Focus | Key Invariant Verified |
| :--- | :--- | :--- |
| **Test 28** | Refund Lifecycle State Transitions | `created` $\rightarrow$ `processed` $\rightarrow$ `failed` with active reduction accounting. |
| **Test 29** | Verified Dispute Restoration (Rev 34, Issue 1) | Confirmed debit of ₹400; won dispute without settlement proof keeps 400 debit; notification reporting 0 deducted keeps 400 debit; verified restoration of ₹150 with `setl_rev34_001` drops deduction to 250; duplicate event delivery blocked by unique event ID; distinct event ID with same settlement ID blocked by `uq_dispute_restorations_provider_ref`; separate restoration of ₹100 with `setl_rev34_002` drops deduction to 150; excessive restoration blocked by ceiling trigger; full verified restoration drops deduction to 0; historical debit evidence intact. |
| **Test 30** | Currency Conversion & Latest Gateway ID | Single conversion boundary (paise / 100); latest processed refund ID tracked in `refund_gateway_id`. |
| **Test 31** | Automated Gateway Audit Identity | Automated events succeed with `approved_by_admin_id = null`; missing linkage fails `ck_adjustment_gateway_linkage`. |
| **Test 32** | Contradictory Refund Failure & Fail-Closed Blocking | Processed refund followed by `refund.failed` transitions to `under_review`, preserves ₹350 refund amount, and blocks new allocations via `check_violation`. |
| **Test 33** | Authorized Review Clearance (Rev 34, Issue 4) | Genuine refund discrepancy blocks allocations; financial reconciliation restores financial match; `requires_admin_review` remains set; unauthorized clearance attempt by student fails with `insufficient_privilege`; allocations remain blocked while review flag is true; authorized clearance via `resolve_agreement_admin_review` succeeds; subsequent allocation succeeds; prior allocations intact. |
| **Test 34** | Durable Webhook Quarantine Ledger (Rev 34, Issue 2) | Signed malformed event durably persisted to `webhook_quarantine_events` with failure code and raw payload; zero financial adjustments created; duplicate delivery of quarantined event blocked by `uq_webhook_quarantine_event`; unlinked purchase event persisted without foreign key error; database write failure triggers retryable error path. |
| **Vitest (24/24)** | Offline Unit Suite (Currency & Webhook Policy) | Strict currency validation, zero rules, safe integers, and webhook response policy with accurate Razorpay delivery retry expectations (`providerWillRetry`). |
