# Make Me Topper — Revision 30: Razorpay Refund Lifecycle, Dispute Accounting, and Currency Integrity

**Document Reference:** `MMT-AUDIT-2026-REV30-PAYMENT-LIFECYCLE-AND-CURRENCY-INTEGRITY`  
**Date:** October 28, 2026  
**Status:** **PHASE 1 IMPLEMENTED & STATICALLY VALIDATED — READY FOR REVIEW — NOT DEPLOYED TO PRODUCTION**  
**Governing Documents:**
- [`subscription_rule.md`](file:///C:/Projects/mocktest-admin/subscription_rule.md)
- [`SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md`](file:///C:/Projects/MockTestApp/SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md)
- [`REVISION_29_REFUND_RECONCILIATION_AND_WEBHOOK_AUDIT.md`](file:///C:/Projects/MockTestApp/REVISION_29_REFUND_RECONCILIATION_AND_WEBHOOK_AUDIT.md)

---

## 1. Exact Root Cause of Every Issue

### Issue 1: Unhandled Refund Lifecycle States & Risk of Premature / Phantom Financial Reductions
- **Root Cause:** In Revision 29, webhook events `refund.created` and `refund.processed` were both mapped directly to `handleRazorpayRefund`. The table `installment_adjustments` lacked a `status` field, causing any recorded refund row to immediately act as a confirmed financial debit regardless of its actual processing state at the provider. If an initial `refund.created` event was stored and the refund subsequently failed (`refund.failed`) at the issuing bank, the database retained the row as a permanent reduction of available payment credit. Furthermore, the global unique constraint `uq_installment_adjustments_gateway_event` on `gateway_event_id` blocked subsequent lifecycle transitions (e.g. `refund.created` followed by `refund.processed`) when retried with the same refund entity ID, conflating legitimate state transitions with duplicate deliveries.

### Issue 2: Inaccurate Dispute Accounting & Phantom Deductions for Zero-Deduction Disputes
- **Root Cause:** In Revision 29, `payment.dispute.created` recorded a reversal adjustment for the full disputed `amount` reported by Razorpay. However, Razorpay's dispute payload reports both `amount` (the claimed dispute amount) and `amount_deducted` (the funds actually deducted by Razorpay from the merchant's account). For open or under-review disputes, `amount_deducted` is frequently `0`. Treating the claim amount as an immediate financial debit produced phantom reversals and falsely triggered `requires_admin_review = true` on student agreements where no merchant funds had been lost. Additionally, provider dispute lifecycle events (`payment.dispute.under_review`, `payment.dispute.won`, `payment.dispute.lost`, `payment.dispute.closed`) were not tracked, preventing fund restoration when disputes were won.

### Issue 3: Currency Unit Ambiguity Between Minor Units (Paise) and Decimal Rupees
- **Root Cause:** Razorpay webhook payloads deliver monetary amounts as integer minor units (paise in INR; e.g. ₹500.00 is delivered as `50000`). The database columns across `public.payments`, `public.installment_adjustments`, and `public.installment_payment_allocations` are typed as `numeric(10,2)` representing whole Indian Rupees with two decimal places. Without explicit, single-boundary conversion and automated unit validation tests, there was a risk of raw minor units being stored directly as whole rupees (e.g., 50000 interpreted as ₹50,000.00) or undergoing duplicate conversions.

### Issue 4: Misclassification of Gateway Refunds as Duplicate Charge Refunds
- **Root Cause:** Revision 29 recorded all incoming installment refund events with `adjustment_type = 'duplicate_charge_refund'` because the provider's generic refund event does not specify a business reason. This violated accounting veracity by attributing arbitrary refund actions to duplicate charges without supporting operational evidence. The `adjustment_type` check constraint lacked a generic `gateway_refund` classification.

### Issue 5: Single `refund_gateway_id` Limitation vs Itemized Ledger Reconciliation
- **Root Cause:** `payments.refund_gateway_id` stores a single text identifier on the aggregate payment record. In cases where multiple partial refunds occur on the same payment, a single scalar column cannot hold every individual refund ID. The system required clear architectural clarification that `payments.refund_gateway_id` holds the most recently processed refund transaction ID, while `public.installment_adjustments` serves as the authoritative, itemized ledger tracking all individual transactions.

---

## 2. Refund Lifecycle Design and Expected State Transitions

### State Machine Definition
The `status` column on `public.installment_adjustments` governs the lifecycle:
`check (status in ('created', 'processed', 'failed', 'under_review', 'won', 'lost', 'closed'))` with default `'processed'`.

```
          [refund.created]
                 │
                 ▼
          ┌─────────────┐
          │   created   │  ── (zero financial reduction, payments.refund_amount unchanged)
          └─────────────┘
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
[refund.processed]    [refund.failed]
      │                     │
      ▼                     ▼
┌─────────────┐       ┌─────────────┐
│  processed  │       │   failed    │  ── (audit evidence preserved; excluded from reductions;
└─────────────┘       └─────────────┘     summary recalculated to exclude failed amount)
      │
(confirmed financial reduction;
 payments.refund_amount synchronized)
```

### State Semantics
1. **`refund.created`**:
   - Webhook checks if row exists for `gateway_event_id`. If not, inserts record with `status = 'created'`, `adjustment_type = 'gateway_refund'`, `amount = amount_paise / 100.0`.
   - **Financial Effect:** 0.00 reduction. The database triggers (`trg_enforce_allocation_limits`, `trg_installment_adjustment_audit`) and RPC (`process_installment_payment`) strictly filter active refunds: `where adjustment_type in ('gateway_refund', 'duplicate_charge_refund') and status = 'processed'`.
   - `payments.refund_amount` is **not** incremented.
2. **`refund.processed`**:
   - Webhook locates existing record by `gateway_event_id`. If found, updates `status = 'processed'`, `reason = 'Refund processed by gateway'`. If not previously seen, inserts directly as `status = 'processed'`.
   - Webhook recalculates `payments.refund_amount` as the exact sum of all `processed` refunds on that payment.
   - Sets `payments.refund_gateway_id` to this refund ID.
   - **Financial Effect:** Confirmed reduction of net available credit. Reconciled with `payments.refund_amount`.
3. **`refund.failed`**:
   - Webhook locates existing record by `gateway_event_id`. Updates `status = 'failed'`, `reason = 'Refund failed at issuing bank'`.
   - If no existing record exists, inserts with `status = 'failed'`.
   - **Financial Evidence Preservation:** The record is **never** deleted.
   - Webhook recalculates `payments.refund_amount` using `where status = 'processed'`, ensuring failed amounts are excluded from summary totals.
   - **Financial Effect:** 0.00 reduction. Restores net payment credit if previously counted.
4. **`refund.speed_changed`**:
   - Purely operational speed-tier adjustment (instant vs normal).
   - Webhook acknowledges event with HTTP 200 and structured log; zero financial adjustment.

---

## 3. Dispute Lifecycle Design and Financial Treatment

### State Machine & Actual Provider Deductions
In Razorpay dispute payloads:
- `payload.dispute.entity.amount`: The claimed disputed amount (in paise).
- `payload.dispute.entity.amount_deducted`: The amount Razorpay actually debited from the merchant account (in paise).

```
       [payment.dispute.created / under_review / action_required]
                                   │
                                   ▼
                            ┌──────────────┐
                            │ under_review │  ── (if amount_deducted = 0: amount = 0.00; zero reduction)
                            └──────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
          [payment.dispute.lost]        [payment.dispute.won]
                    │                             │
                    ▼                             ▼
             ┌─────────────┐               ┌─────────────┐
             │    lost     │               │     won     │
             └─────────────┘               └─────────────┘
                    │                             │
        (amount = amount_deducted;         (amount reset to 0.00;
         confirmed debit applied;           reversal reduction dropped;
         flags admin review if deficit)     funds restored to merchant)
```

### Financial Treatment Rules
1. **Open Dispute with `amount_deducted = 0` (`payment.dispute.created` / `under_review`):**
   - Webhook records `adjustment_type = 'gateway_reversal'`, `status = 'under_review'`, and `amount = 0.00`.
   - Stored `reason` records the claim amount for audit context.
   - Database filters: reversals only sum where `status in ('processed', 'lost')`.
   - **Financial Effect:** No reduction of student payment credit. No premature administrative review flag.
2. **Confirmed Provider Debit (`payment.dispute.lost` or positive `amount_deducted`):**
   - Status updates to `'lost'` and `amount` is updated to `amount_deducted / 100.0`.
   - Active reversal sum increases. If already allocated amount exceeds post-reversal net payment, `trg_installment_adjustment_audit` automatically sets `requires_admin_review = true`.
   - **Preservation Rule:** Existing payment allocations and student access entitlements are preserved; zero automatic revocation.
3. **Restored Merchant Funds (`payment.dispute.won`):**
   - Status updates to `'won'` and `amount` is reset to `0.00`.
   - Active reversal sum drops by the previously deducted amount, restoring net available credit on the payment.
4. **Duplicate Dispute Events:**
   - Webhook checks existing dispute by `gateway_event_id`. Identical repeated status is acknowledged idempotently; status changes execute safe in-place state transitions.

---

## 4. Verified Currency Units and Conversion Points

| Entity / System | Field / Column | Raw Representation | Canonical Unit | Exact Conversion Point |
| :--- | :--- | :--- | :--- | :--- |
| **Razorpay Payment Entity** | `amount` | Integer (e.g. `100000`) | Paise (minor units) | Webhook: `entity.amount / 100.0` $ightarrow$ `payments.amount` |
| **Razorpay Payment Entity** | `amount_refunded` | Integer (e.g. `30000`) | Paise (minor units) | Webhook: `entity.amount_refunded / 100.0` $ightarrow$ `payments.refund_amount` |
| **Razorpay Refund Entity** | `amount` | Integer (e.g. `50000`) | Paise (minor units) | Webhook: `entity.amount / 100.0` $ightarrow$ `installment_adjustments.amount` |
| **Razorpay Dispute Entity** | `amount` | Integer (e.g. `40000`) | Paise (minor units) | Webhook: audit logging / claim context |
| **Razorpay Dispute Entity** | `amount_deducted` | Integer (e.g. `40000`) | Paise (minor units) | Webhook: `entity.amount_deducted / 100.0` $ightarrow$ `installment_adjustments.amount` |
| **Database: Payments** | `amount` | Decimal | `numeric(10,2)` INR | Authoritative captured payment rupees |
| **Database: Payments** | `refund_amount` | Decimal | `numeric(10,2)` INR | Authoritative cumulative refund summary |
| **Database: Adjustments** | `amount` | Decimal | `numeric(10,2)` INR | Itemized reduction rupees |
| **Database: Allocations** | `allocated_amount` | Decimal | `numeric(10,2)` INR | Itemized allocation rupees |
| **Database: Schedule** | `amount_due`, `amount_paid` | Decimal | `numeric(10,2)` INR | Milestone installment rupees |

- **Single-Boundary Rule:** Conversion occurs strictly once at the webhook ingestion boundary. No raw minor units are ever stored in `numeric(10,2)` columns. No repeated divisions occur downstream.

---

## 5. Correct Gateway Refund Classification

### Schema Revision
`public.installment_adjustments.adjustment_type` check constraint updated in Migration 219:
```sql
adjustment_type text not null check (adjustment_type in (
  'waiver', 'scholarship', 'reschedule', 'admin_credit', 
  'duplicate_charge_refund', 'gateway_refund', 'gateway_reversal'
))
```

### Classification Taxonomy
1. **`gateway_refund`**: Default classification for all standard provider refund webhooks (`refund.created`, `refund.processed`, `refund.failed`). Requires non-null `reference_payment_id` and non-null `gateway_event_id`. Permitted with `approved_by_admin_id = null`.
2. **`duplicate_charge_refund`**: Strictly reserved for refunds where affirmative administrative or system evidence confirms an accidental double-charge.
3. **`gateway_reversal`**: Strictly reserved for provider dispute/chargeback debits.
4. **`admin_credit`**, **`waiver`**, **`scholarship`**, **`reschedule`**: Explicit concessions requiring administrator approval (`approved_by_admin_id is not null`).

---

## 6. Idempotency Behavior for Retries vs Legitimate Lifecycle Changes

### Distinction Matrix
| Event Scenario | Existing Record in Ledger | Action Taken | Financial Result |
| :--- | :--- | :--- | :--- |
| **A. Identical Webhook Retry** (e.g. `refund.processed` redelivered) | Exists with `status = 'processed'` | Unique constraint `uq_installment_adjustments_gateway_event` or status check detects match. Webhook returns HTTP 200 `already_processed = true`. | Zero change. No duplicate reduction. |
| **B. Legitimate State Transition** (e.g. `refund.created` $ightarrow$ `refund.processed`) | Exists with `status = 'created'` | Webhook executes `UPDATE public.installment_adjustments SET status = 'processed', ... WHERE gateway_event_id = :id`. | Status transitions. Confirmed reduction takes effect. |
| **C. Failed Refund Transition** (e.g. `refund.created` $ightarrow$ `refund.failed`) | Exists with `status = 'created'` or `'processed'` | Webhook executes `UPDATE public.installment_adjustments SET status = 'failed' ... WHERE gateway_event_id = :id`. Recalculates `payments.refund_amount`. | Status transitions to failed. Failed amount excluded from active reductions. |
| **D. Separate Legitimate Refund** (e.g. Second partial refund on same payment) | Does not exist for this new refund ID | Webhook executes `INSERT INTO public.installment_adjustments` with new distinct `gateway_event_id`. | Distinct second reduction recorded and summed. |

### Error Code Filtering
The webhook catches only PostgreSQL error code `23505` where the violated constraint is specifically `uq_installment_adjustments_gateway_event`:
```typescript
const isEventUniqueViolation = 
  dbErr?.code === '23505' && 
  (dbErr?.message?.includes('uq_installment_adjustments_gateway_event') || 
   dbErr?.details?.includes('gateway_event_id'));
```
Any other unique violation (e.g. on order items, agreements, or profiles) or foreign key error throws visibly and fails the webhook request with HTTP 500.

---

## 7. Numerical Expected Results for the New Tests

### Test 28: Refund Lifecycle State Transitions & Failed Refund Handling
- **Setup:** Payment ₹1,000.00.
- **Stage A (`refund.created` for ₹300.00):**
  - Ledger: 1 row with `amount = 300.00`, `status = 'created'`.
  - Active refund reductions: **₹0.00** (`status = 'processed'` check).
  - Summary: **₹0.00**.
  - Net payment available: **₹1,000.00**.
- **Stage B (Duplicate Delivery of `refund.created`):**
  - Unique violation `uq_installment_adjustments_gateway_event` triggered and verified.
- **Stage C (`refund.processed` for ₹300.00):**
  - Ledger updated: `status = 'processed'`.
  - Active refund reductions: **₹300.00**.
  - Summary updated: `payments.refund_amount = 300.00`.
  - Net payment available: ₹1,000.00 - ₹300.00 = **₹700.00**.
- **Stage D (`refund.failed` for ₹200.00):**
  - Ledger: 1 row with `amount = 200.00`, `status = 'failed'`.
  - Active refund reductions: **₹300.00** (failed refund excluded).
  - Failed audit row preserved: exists in database.
  - Net payment available: **₹700.00** (NOT ₹500.00).

### Test 29: Dispute Lifecycle & Financial Deduction Integrity
- **Setup:** Payment ₹1,000.00.
- **Stage A (Open dispute with `amount_deducted = 0`):**
  - Ledger: `status = 'under_review'`, `amount = 0.00`.
  - Active reversals: **₹0.00** (`status in ('processed', 'lost')` check).
  - Net payment available: **₹1,000.00**.
  - Review flag: `requires_admin_review = false`.
- **Stage B (Dispute Lost, Confirmed Debit of ₹400.00):**
  - Ledger updated: `status = 'lost'`, `amount = 400.00`.
  - Active reversals: **₹400.00**.
  - Net payment available: ₹1,000.00 - ₹400.00 = **₹600.00**.
- **Stage C (Dispute Won, Provider Restores Funds):**
  - Ledger updated: `status = 'won'`, `amount = 0.00`.
  - Active reversals: **₹0.00**.
  - Net payment available: restored to **₹1,000.00**.

### Test 30: Currency Unit Integrity (Minor Units to Decimal Rupees)
- **Inputs:** 50,000 paise (₹500.00) and 39,000 paise (₹390.00).
- **Payment:** ₹1,000.00.
- **Itemized Ledger Sum:** ₹500.00 + ₹390.00 = **₹890.00**.
- **Payment Cumulative Summary:** **₹890.00**.
- **Net Available Credit:** ₹1,000.00 - ₹890.00 = **₹110.00**.
- **Allocation Checks:**
  - Attempting to allocate ₹120.00 (> ₹110.00 available): triggers check violation in `trg_enforce_allocation_limits`.
  - Allocating exactly ₹110.00: succeeds cleanly.

### Test 31: Financial Event Classification
- Generic `gateway_refund` with `approved_by_admin_id = null`: succeeds (`ck_adjustment_audit_identity` satisfied).
- Verified `duplicate_charge_refund` with `approved_by_admin_id = null`: succeeds (`ck_adjustment_audit_identity` satisfied).
- Omission of `reference_payment_id` or `gateway_event_id`: fails closed (`ck_adjustment_gateway_linkage`).

---

## 8. Exact Files Modified

1. [`supabase/migrations/219_installment_foundation_and_access_control.sql`](file:///C:/Projects/mocktest-admin/supabase/migrations/219_installment_foundation_and_access_control.sql):
   - Added `gateway_refund` to `adjustment_type` check constraint.
   - Added `status` column to `installment_adjustments` with allowed values `('created', 'processed', 'failed', 'under_review', 'won', 'lost', 'closed')`.
   - Updated `ck_adjustment_audit_identity` and `ck_adjustment_gateway_linkage` to include `gateway_refund`.
   - Updated `trg_enforce_allocation_limits`, `trg_installment_adjustment_audit`, and `process_installment_payment` to evaluate active refunds strictly where `status = 'processed'` and active reversals where `status in ('processed', 'lost')`.
   - Updated schedule due balance calculation to filter adjustments where `status = 'processed'`.
2. [`supabase/functions/razorpay-webhook/index.ts`](file:///C:/Projects/mocktest-admin/supabase/functions/razorpay-webhook/index.ts):
   - Extended `RazorpayRefundEntity` (`status: 'created' | 'processed' | 'failed'`, `speed_processed`).
   - Extended `RazorpayDisputeEntity` (`amount_deducted?: number`, `status: 'open' | 'under_review' | 'action_required' | 'won' | 'lost' | 'closed'`).
   - Rewrote `handleRazorpayRefund` to support complete lifecycle state transitions (`created`, `processed`, `failed`, `speed_changed`), preserve failed audit evidence, recalculate `payments.refund_amount` strictly from processed refunds, and record generic refunds as `gateway_refund`.
   - Rewrote `handleRazorpayDispute` to distinguish claimed `amount` from `amount_deducted`, handle zero deduction for open disputes, confirmed debits for lost disputes, and fund restorations for won disputes.
   - Filtered database error handling to intercept strictly `23505` violations on `uq_installment_adjustments_gateway_event`.
   - Updated event router to route `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`, and all `payment.dispute.*` lifecycle events.
3. [`supabase/tests/installment_foundation_and_access_control_test.sql`](file:///C:/Projects/mocktest-admin/supabase/tests/installment_foundation_and_access_control_test.sql):
   - Added declared variables for Revision 30 test suite.
   - Added Tests 28, 29, 30, and 31.
4. [`SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md`](file:///C:/Projects/MockTestApp/SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md):
   - Advanced specification to Revision 30.
   - Documented refund lifecycle, dispute accounting, currency unit integrity, and classification rules.
   - Updated scenarios table and test suite coverage descriptions.
5. [`REVISION_30_PAYMENT_LIFECYCLE_AND_CURRENCY_AUDIT.md`](file:///C:/Projects/MockTestApp/REVISION_30_PAYMENT_LIFECYCLE_AND_CURRENCY_AUDIT.md):
   - Complete technical audit deliverable created.

---

## 9. Remaining Unresolved Provider or Business Questions

1. **Provider Batch Refund Synchronization:**
   - In rare bulk-refund scenarios where multiple partial refunds are processed in rapid succession, webhook arrival order may vary. While `public.installment_adjustments` records each transaction independently by its unique `gateway_event_id`, `payments.refund_gateway_id` reflects the most recently received event. The system fail-closed mechanism guarantees that if any discrepancy arises between the aggregate summary and itemized ledger, new allocations are safely held for administrator review without corrupting existing allocations.
2. **Dispute Fee Accounting:**
   - Razorpay may assess dispute/chargeback service fees on lost disputes. The current implementation records only the debited principal in `installment_adjustments`. Business sign-off is required if dispute administrative fees should be segregated into a dedicated fee ledger or absorbed as operational merchant expense.
3. **Withdrawal Educational Access Policy:**
   - Formal policy sign-off remains pending regarding whether a student who withdraws after completing partial installments retains access to completed milestone content through $D_k^{\text{end}} + 30\text{d}$ or experiences immediate revocation.

---

## 10. Static Validation Results and Limitations

### Static Checks Performed
1. **TypeScript Transpilation Check:**
   - Command: Transpiled `supabase/functions/razorpay-webhook/index.ts` via TypeScript compiler (`typescript@5.8.2`).
   - Result: **SUCCESS (Transpiled length: 82,197 bytes; 0 diagnostic errors)**.
2. **PL/pgSQL Syntactic Balance Check:**
   - `219_installment_foundation_and_access_control.sql`: Single quotes (1012), Dollar pairs (12), Parentheses (443 open / 443 close) **100% BALANCED**.
   - `installment_foundation_and_access_control_test.sql`: Single quotes (1172), Dollar pairs (2), Parentheses (446 open / 446 close) **100% BALANCED**.
3. **Constraint Linkage & AST Inspection:**
   - Verified that `gateway_refund` is included in all check constraints (`ck_adjustment_audit_identity`, `ck_adjustment_gateway_linkage`) and trigger queries.
   - Verified that `status = 'processed'` is enforced across all allocation reduction calculations.

### Limitations
- In accordance with mandatory operational restrictions, no Docker containers or Supabase services were started, no migrations were applied, and no SQL was executed against a live database engine. Runtime execution against live Supabase PostgreSQL will take place when authorized by the user.

---

## 11. Repository Parity Results

| File Path | mocktest-admin SHA-256 | MockTestApp SHA-256 | Status |
| :--- | :--- | :--- | :--- |
| `supabase/migrations/219_installment_foundation_and_access_control.sql` | `71b88118718a3caa4ca4d2da6665151d77473aca21246173227127727c156395` | `71b88118718a3caa4ca4d2da6665151d77473aca21246173227127727c156395` | **100% IDENTICAL** |
| `supabase/tests/installment_foundation_and_access_control_test.sql` | `0ccd111e71397c65837ca97f388a709ec1160ad42fb13675fdd30e212c569b11` | `0ccd111e71397c65837ca97f388a709ec1160ad42fb13675fdd30e212c569b11` | **100% IDENTICAL** |
| `SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md` | `d73cc1347dd5c83f7285fca91d3ca526e0b66b29d72f7680d0b5f287b15bfa98` | `d73cc1347dd5c83f7285fca91d3ca526e0b66b29d72f7680d0b5f287b15bfa98` | **100% IDENTICAL** |
| `subscription_rule.md` | `4b14d8c764a88bc3b53a479b1227092823a073ce02047cb5c8a2ce47ceb4bfa4` | `4b14d8c764a88bc3b53a479b1227092823a073ce02047cb5c8a2ce47ceb4bfa4` | **100% IDENTICAL** |

---

## 12. Explicit Confirmation of Operational Restrictions

In strict adherence to the project instructions:
1. **Docker Desktop:** Not started, stopped, or modified.
2. **Supabase Local Services:** Not started, stopped, or restarted.
3. **Database Execution:** Zero SQL statements executed against any database.
4. **Database Migrations:** Zero migrations applied to local, staging, or production databases.
5. **Edge Functions:** Zero Edge Functions deployed to local, staging, or production environments.
6. **Payment Provider Configuration:** Zero changes made to payment provider settings or live data.
7. **Runtime Validation:** No claim of runtime database execution or passing live integration tests is made.
8. **Working Tree:** All unrelated working-tree changes preserved.
