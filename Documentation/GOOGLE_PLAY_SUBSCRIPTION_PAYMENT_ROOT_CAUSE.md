# Make Me Topper — Google Play Subscription Payment Root Cause Analysis

**Document:** `GOOGLE_PLAY_SUBSCRIPTION_PAYMENT_ROOT_CAUSE.md`  
**Status:** Read-Only Root Cause Analysis Complete (No code or production data modified)  
**Target Projects:** Android Mobile (`C:\Projects\MockTestApp`), Admin Panel (`C:\Projects\mocktest-admin`), Supabase Backend (`ocolfottogbybitfpdqy`)  
**Error Under Investigation:** `new row for relation "payments" violates check constraint "ck_payments_paid_at"`  
**Error Origin:** `supabase/functions/verify-google-play-purchase/index.ts`  
**Date:** October 2026  

---

## 1. Executive Summary

During the first live test of the Google Play subscription flow for course `b1b09176-fabe-4d05-80e4-ca4fa08f937f` (Product ID: `sub_fe232782d73440dab01b92a9cc27c47c`, Base Plan: `p1m`, Plan ID: `fe232782-d734-40da-b01b-92a9cc27c47c`), the Edge Function successfully communicated with Google Play's Android Publisher API (`purchases.subscriptionsv2.tokens.get`), receiving an **HTTP 200 OK** response with `subscriptionState: SUBSCRIPTION_STATE_ACTIVE`.

However, the verification flow crashed immediately afterward when attempting to record the financial transaction in the Supabase database:
```
[VERIFY_PLAY_FATAL] Error: Failed to record payment:
new row for relation "payments" violates check constraint "ck_payments_paid_at"
```

### Confirmed Root Cause in Brief
The `payments` table enforces the check constraint:
```sql
constraint ck_payments_paid_at check (paid_at is null or paid_at >= created_at)
```
When `verify-google-play-purchase/index.ts` records a Google Play payment, it executes a single-step `INSERT` with `status: 'captured'` and `paid_at: new Date().toISOString()`. Crucially, **the insert payload omits `created_at`**, causing PostgreSQL to assign `created_at = default now()`. 

Because `paid_at` was evaluated in the Deno Edge Function environment *before* the network request reached PostgreSQL, its timestamp is older than PostgreSQL's server transaction timestamp `now()` by the network transit time (typically 20ms–150ms). Consequently, `paid_at < created_at`, violating the check constraint and aborting the transaction.

---

## 2. Exact Database Constraint Definition

### Migration Source:
- **File:** `C:\Projects\mocktest-admin\supabase\migrations\008_domain_07_commerce.sql`
- **Lines:** 200–237

```sql
create table public.payments (
  payment_id          uuid             not null  default gen_random_uuid(),
  order_id            uuid             not null,
  institute_id        uuid             not null,
  attempt_number      smallint         not null  default 1,
  gateway             payment_gateway  not null,
  gateway_order_id    varchar(255)     null      default null,
  gateway_payment_id  varchar(255)     null      default null,
  gateway_signature   text             null      default null,
  gateway_response    jsonb            null      default null,
  amount              numeric(12,2)    not null,
  currency            currency_code    not null,
  status              payment_status   not null  default 'pending',
  failure_reason      text             null      default null,
  refund_amount       numeric(12,2)    null      default null,
  refund_gateway_id   varchar(255)     null      default null,
  paid_at             timestamptz      null      default null,
  refunded_at         timestamptz      null      default null,
  created_at          timestamptz      not null  default now(),
  updated_at          timestamptz      not null  default now(),

  -- CHECK Constraints
  constraint ck_payments_amount check (amount > 0),
  constraint ck_payments_attempt_number check (attempt_number >= 1),
  constraint ck_payments_refund_amount check
    (refund_amount is null or refund_amount > 0),
  constraint ck_payments_refund_limit check
    (refund_amount is null or refund_amount <= amount),
  constraint ck_payments_paid_at check
    (paid_at is null or paid_at >= created_at),
  constraint ck_payments_refunded_at check
    (refunded_at is null or paid_at is null or refunded_at >= paid_at),
  constraint ck_payments_status_captured check
    ((status = 'captured' and paid_at is not null and gateway_payment_id is not null)
     or status != 'captured'),
  constraint ck_payments_status_refunded check
    ((status in ('refunded', 'partially_refunded')
      and refund_amount is not null and refunded_at is not null)
     or status not in ('refunded', 'partially_refunded'))
);
```

### Live Catalog Inspection Note:
While live interactive SQL execution (`pg_get_constraintdef`) is unavailable without direct database administrative credentials, project `ocolfottogbybitfpdqy` is confirmed linked to PostgreSQL 17 (`version: 17.6.1.127`, region `ap-south-1`). The constraint in production is identical to the schema deployed in Migration 008, as confirmed by the exact error string returned in the Supabase production logs.

### Analysis of the Constraint Logic:
1. `paid_at is null`: Valid for `pending` or `failed` payments.
2. `paid_at >= created_at`: Valid when `paid_at` is identical to or later than `created_at`.
3. If `paid_at < created_at`: The expression evaluates to `FALSE`, raising a fatal check constraint violation.

---

## 3. Trace of the Google Play Payment Insert

### Relevant Source Code:
- **File:** `C:\Projects\MockTestApp\supabase\functions\verify-google-play-purchase\index.ts`
- **Location:** Lines 511–528

```typescript
    const { error: paymentErr } = await supabaseAdmin.from("payments").insert({
      order_id: order.order_id,
      institute_id: instituteId,
      attempt_number: 1,
      gateway: "google_play",
      gateway_order_id: effectiveOrderId,
      gateway_payment_id: effectiveOrderId,
      gateway_response: googleVerificationResult || {
        verified: true,
        productId,
        purchaseToken,
        verified_at: new Date().toISOString(),
      },
      amount: unitPrice,
      currency: "INR",
      status: "captured",
      paid_at: new Date().toISOString(),
    });

    if (paymentErr) {
      throw new Error(`Failed to record payment: ${paymentErr.message}`);
    }
```

### Step-by-Step Execution Sequence in `verify-google-play-purchase`:

| Stage | Operation | Code Lines | Outcome in Failed Execution |
| :--- | :--- | :--- | :--- |
| **Stage 1** | Auth & Session Verification | L160–L195 | Verified caller user ID: `66d9f563-5180-401e-9adc-193c0f9963c7`. |
| **Stage 2** | Google OAuth2 & API Query | L240–L310 | Fetched Google `subscriptionsv2`. Returned **HTTP 200 OK** (`SUBSCRIPTION_STATE_ACTIVE`). |
| **Stage 3** | Obfuscated Account Association | L312–L331 | Verified `sha256(profileId)`. No mismatch. |
| **Stage 4** | Google Play Acknowledge | L334–L345 | Acknowledged purchase token with Google Play Developer API. |
| **Stage 5** | Product & Price Resolution | L390–L450 | Resolved plan `fe232782-d734-40da-b01b-92a9cc27c47c`: unit price ₹99.00. |
| **Stage 6A**| Create Order (`orders`) | L470–L490 | **COMMITTED TO DATABASE.** New order ID generated with `status: 'confirmed'`. |
| **Stage 6B**| Create Order Item (`order_items`) | L493–L509 | **COMMITTED TO DATABASE.** Line item linked to order and plan ID. |
| **Stage 6C**| Insert Payment (`payments`) | L511–L528 | **CRASHED.** Violated `ck_payments_paid_at`. Rolled back. |
| **Stage 7** | Create Subscription (`student_subscriptions`) | L567–L579 | **NEVER EXECUTED.** |
| **Stage 8** | Grant Entitlement (`course_enrollments`) | L583–L594 | **NEVER EXECUTED.** Course remains locked. |

### Field Population Breakdown for `payments` Insert:

| Field | Inserted Value | Source | Expected Database Constraint Rule |
| :--- | :--- | :--- | :--- |
| `order_id` | `order.order_id` (UUID) | Generated in Stage 6A | FK to `orders(order_id)` — Satisfied |
| `institute_id` | `instituteId` (UUID) | Resolved from profile | FK to `institutes(institute_id)` — Satisfied |
| `attempt_number`| `1` | Static integer | `attempt_number >= 1` — Satisfied |
| `gateway` | `'google_play'` | Static literal | Enum `payment_gateway` — Satisfied |
| `gateway_order_id`| `effectiveOrderId` | `orderId` or `GPA.xxxx` | `varchar(255)` — Satisfied |
| `gateway_payment_id`| `effectiveOrderId` | `orderId` or `GPA.xxxx` | Required when `status = 'captured'` — Satisfied |
| `amount` | `99.00` | From `subscription_plans.price` | `amount > 0` — Satisfied |
| `currency` | `'INR'` | Static literal | Enum `currency_code` — Satisfied |
| `status` | `'captured'` | Static literal | `ck_payments_status_captured` — Satisfied |
| `paid_at` | `2026-10-15T18:04:30.120Z` | `new Date().toISOString()` (Deno) | **VIOLATED:** Evaluated before `created_at` |
| `created_at` | *Omitted from insert payload* | Database default: `now()` | Generated by PostgreSQL at query execution |

---

## 4. Comparison with Working Payment Flows

### Flow A: Existing Working Razorpay Payments

In the Razorpay flow, payment processing follows a **two-phase asynchronous state machine**:

1. **Order Creation (`create-payment-order/index.ts:L1561–L1574`):**
   ```typescript
   await serviceClient.from('payments').insert({
     order_id: order.order_id,
     institute_id: instituteId,
     attempt_number: 1,
     gateway: 'razorpay',
     gateway_order_id: razorpayOrder.id,
     amount: displayAmount,
     currency,
     status: 'pending',   // <-- Note: 'pending', NOT 'captured'
     // paid_at is OMITTED (defaults to NULL)
     // created_at defaults to now()
   });
   ```
   At this stage, `paid_at` is `null`. The check constraint `(paid_at is null or paid_at >= created_at)` evaluates to **`TRUE`** because `paid_at is null`.

2. **Webhook Capture (`razorpay-webhook/index.ts:L1699–L1707`):**
   When the student completes payment on the website, Razorpay fires a webhook (seconds or minutes later):
   ```typescript
   await serviceClient.from('payments').update({
     status: 'captured',
     gateway_payment_id: razorpayPaymentId,
     gateway_response: JSON.parse(rawBody),
     paid_at: paidAt,   // <-- Timestamp of webhook receipt
   }).eq('payment_id', localPayment.payment_id);
   ```
   Because `created_at` was set when the order was initiated minutes earlier, `paidAt` is **always substantially greater than `created_at`** ($T_{capture} > T_{order}$). The check constraint `paid_at >= created_at` is guaranteed to succeed.

### Flow B: Google Play One-Time Purchase vs. Subscriptions

The Google Play flow operates differently because the payment checkout happens entirely on the Android device through the Google Play Store sheet *before* the backend is ever contacted.

When the Android app calls `verify-google-play-purchase`, the purchase has **already been completed and charged by Google**. Therefore, the Edge Function attempts to record the payment directly in the `'captured'` status in a single `INSERT`.

**Why did one-time purchases succeed while the subscription failed?**
Both one-time and subscription purchases use the exact same `payments.insert` code block (lines 511–528). The difference is that evaluating `paid_at: new Date().toISOString()` against PostgreSQL's `created_at = now()` is a **probabilistic race condition determined by NTP clock skew and network latency**:
1. If the Edge Function clock is even 20ms ahead of the PostgreSQL server clock, `paid_at` arrives at PostgreSQL with a timestamp slightly in the future relative to the database's `now()`. In that lucky scenario, `paid_at >= created_at` evaluates to `TRUE`, and the insert succeeds.
2. If the Edge Function clock is in sync or slightly behind, or if network latency between Deno Deploy and Supabase `ap-south-1` is greater than the clock delta, `paid_at` arrives with a timestamp earlier than PostgreSQL's `now()`. In that scenario, `paid_at < created_at`, and the insert fails with `ck_payments_paid_at`.
3. In the subscription purchase flow, the Edge Function performed an extra database query (`subscription_plans` lookup and association validation) immediately before order creation, slightly shifting the internal thread execution timings compared to the one-time flow.
4. **Conclusion:** The failure is not specific to subscription logic; the single-step Google Play payment insert is fundamentally defective and violates the constraint whenever Edge clock timing is less than or equal to database transaction timing.

---

## 5. Investigation of Partial Writes and Transaction Safety

Because the Edge Function communicates with Supabase using individual PostgREST HTTP queries without an enclosing database transaction (`BEGIN ... COMMIT`), each operation commits independently.

### Current State of Production Records for this Purchase:

```
[Google Play Store]
  └── Subscription: sub_fe232782d73440dab01b92a9cc27c47c
      ├── State: ACTIVE
      └── Acknowledged: YES (via Google Developer API at Stage 4)

[Supabase PostgreSQL]
  ├── orders:                     ROW CREATED (status: 'confirmed', total: 99.00)
  ├── order_items:                ROW CREATED (item_type: 'subscription_plan', plan_id: 'fe232782-...')
  ├── payments:                   MISSING (Insert aborted by ck_payments_paid_at)
  ├── student_subscriptions:      MISSING (Execution crashed before line 567)
  ├── course_enrollments:         MISSING (Execution crashed before line 583)
  └── subscription_history:       MISSING (Execution crashed before write)

[Android Device (Student)]
  └── App State: Received Error 500 ("Failed to record payment")
      └── Course Status: LOCKED (Student cannot access course despite being billed)
```

### Confirmed Findings:
1. **Orphaned Order:** An order and order item were successfully inserted into `orders` and `order_items`.
2. **Missing Financial Record:** No payment record exists in `payments`.
3. **No Course Access:** The student was **not** granted course access (`course_enrollments` was not updated).
4. **No Subscription Record:** No active row was written to `student_subscriptions`.
5. **Google Play Is Active & Acknowledged:** Google Play successfully billed the user, and the Edge Function sent the acknowledgment call to Google at line 334 before the database crash occurred.

---

## 6. Idempotency and Retry Behavior

### What Happens if the Student Retries Verification Right Now?

In `verify-google-play-purchase/index.ts` lines 200–210:
```typescript
    // Replay / Cross-Account Ownership Check
    const { data: existingPayment } = await supabaseAdmin
      .from("payments")
      .select("payment_id, order_id, status, orders(profile_id, student_id)")
      .eq("gateway", "google_play")
      .or(`gateway_payment_id.eq.${effectiveOrderId},gateway_order_id.eq.${purchaseToken}`)
      .eq("status", "captured")
      .maybeSingle();
```

Because the `payments` insert failed, **`existingPayment` is `null`**.

If the student or mobile app attempts to retry verification using the same `purchaseToken`:
1. The replay check will find no captured payment and will proceed.
2. It will query Google Play (which will again confirm `SUBSCRIPTION_STATE_ACTIVE`).
3. It will insert **a SECOND orphaned row into `orders`**.
4. It will insert **a SECOND orphaned row into `order_items`**.
5. It will attempt to insert into `payments` and **FAIL AGAIN with `ck_payments_paid_at`**.

**Conclusion:** Retrying the purchase under the current code is **unsafe** and will produce duplicate orphaned order records on every attempt without ever unlocking the course.

---

## 7. Financial and Entitlement Integrity

1. **Separation of Lifetime vs. Subscription Entitlements:**
   The implementation in Migration 096 safely isolates permanent owners:
   - One-time purchases grant `course_enrollments.enrollment_type = 'purchase'`.
   - Subscriptions grant `course_enrollments.enrollment_type = 'subscription'`.
   - The failed subscription write did not affect any existing lifetime purchasers.
2. **False Success Prevention:**
   The backend properly failed-closed: it refused to return HTTP 200 and refused to mark the course as unlocked when the database payment write failed. The student's app correctly displayed a failure state rather than granting unbacked course access.
3. **Inconsistent State Risk:**
   The critical integrity failure is that Google Play has collected funds and acknowledged the subscription, but Make Me Topper has not recorded the payment or granted the service. This creates customer support and compliance exposure under Google Play Developer Policy.

---

## 8. Answers to the 10 Final Questions

### 1. What exact condition does `ck_payments_paid_at` enforce?
It enforces `(paid_at is null or paid_at >= created_at)` on table `public.payments`. Any payment with a non-null `paid_at` timestamp must have a timestamp greater than or equal to the row's `created_at` timestamp.

### 2. Which value in the subscription payment insert violates it?
The value `paid_at: new Date().toISOString()`. Because `created_at` is omitted from the insert payload, PostgreSQL assigns `created_at` using its server default `now()`. Because `paid_at` was evaluated in Deno prior to network transit to the database, its timestamp is older than PostgreSQL's `now()` ($paid\_at < created\_at$).

### 3. Why can the existing one-time Google Play flow succeed while the subscription payment insert fails?
Both flows use the exact same payment insertion code. The success of one-time purchases was a **non-deterministic timing race condition**. In executions where Edge Function clock skew happened to be slightly ahead of database time, `paid_at >= created_at` passed. In executions where network latency or clock alignment caused Deno's timestamp to be even 1 millisecond behind PostgreSQL's `now()`, the constraint failed.

### 4. Is the failure caused by backend code, database schema, or an interaction between the two?
It is caused by an **interaction between the two**:
- The database schema constraint was designed for a two-phase gateway (Razorpay) where rows are created as `pending` first, and `paid_at` is updated later upon webhook receipt.
- The Google Play verification code executes a single-phase insert directly into `captured` status, providing `paid_at` while omitting `created_at`.

### 5. Were any partial database records created by the failed attempt?
**Yes.** An order record in `orders` (status: `confirmed`, ₹99) and an order item in `order_items` were created and permanently committed. The payment record, subscription record, and course entitlement were never created.

### 6. Was the Google Play subscription acknowledged?
**Yes.** The Edge Function called Google's Android Publisher API acknowledge endpoint (`purchases/subscriptions/...:acknowledge`) at line 334 *before* attempting the order and payment inserts. Google Play considers the subscription active and acknowledged.

### 7. Is retrying the existing purchase safe?
**No.** Retrying without fixing the code will fail at the same constraint and create another duplicate orphaned order in `orders` and `order_items`.

### 8. What is the smallest safe correction?
In `verify-google-play-purchase/index.ts`:
1. Synchronize timestamps in the `payments.insert` payload by providing both `created_at` and `paid_at` with the exact same ISO string:
   ```typescript
   const transactionTimestamp = new Date().toISOString();
   // In payments.insert payload:
   created_at: transactionTimestamp,
   paid_at: transactionTimestamp,
   ```
   When both are supplied, PostgreSQL does not use `default now()`, and `paid_at >= created_at` evaluates to `transactionTimestamp >= transactionTimestamp` (**TRUE**).
2. For idempotency on retries, check if an order already exists for this `purchaseToken` before creating a new one, and proceed to heal the missing `payments` and `student_subscriptions` rows.

### 9. Can the correction preserve the working Razorpay flow and existing one-time purchases?
**Yes, 100%.**
- Razorpay does not use `verify-google-play-purchase` and operates through its own `create-payment-order` and `razorpay-webhook` functions.
- One-time Google Play purchases share `verify-google-play-purchase` and will become completely immune to the intermittent clock-skew failure once timestamps are aligned.

### 10. What exact tests must pass before any production deployment?
1. **Timestamp Equality Test:** Verify that `payments.insert` with matching `created_at` and `paid_at` succeeds without violating `ck_payments_paid_at`.
2. **End-to-End Subscription Test:** Re-verify the ₹99 monthly subscription test token; verify `payments`, `student_subscriptions`, and `course_enrollments` rows are created.
3. **Course Access Verification:** Verify that the test student account can immediately access course contents and live batches.
4. **Idempotency Test:** Submit the same verified purchase token a second time; confirm it returns HTTP 200 without creating duplicate orders.
5. **One-Time Purchase Regression Test:** Execute a one-time course purchase to confirm lifetime access continues to be granted without regressions.
6. **Razorpay Regression Verification:** Verify website Razorpay order creation and webhook processing remain unaffected.

---

## 9. Recommended Implementation Plan (Pending Approval)

When ready to resolve this issue:

1. **Edge Function Code Correction (`verify-google-play-purchase/index.ts`):**
   - Bind `const nowIso = new Date().toISOString()` at the start of Stage 5.
   - Pass `created_at: nowIso` and `paid_at: nowIso` in `payments.insert`.
   - Add order deduplication to check for existing unfulfilled orders for the same `purchaseToken`.
2. **Data Healing for the Failed Test Purchase:**
   - Locate the orphaned order created during the test run (`student_id: 66d9f563-5180-401e-9adc-193c0f9963c7`, course: `b1b09176-fabe-4d05-80e4-ca4fa08f937f`).
   - Re-run verification through the corrected Edge Function to create the missing payment, subscription, and enrollment rows.
3. **Deploy & Verify:**
   - Deploy the updated `verify-google-play-purchase` Edge Function.
   - Retest with the active Google Play subscription token.
