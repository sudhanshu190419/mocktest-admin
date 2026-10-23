# GOOGLE PLAY SUBSCRIPTION PAYMENT RECORDING FIX & RETRY SAFETY AUDIT

**Target Function**: `supabase/functions/verify-google-play-purchase/index.ts`  
**Mobile Project**: `C:\Projects\MockTestApp`  
**Admin / Database Project**: `C:\Projects\mocktest-admin`  
**Database**: Supabase PostgreSQL (Project ID: `ocolfottogbybitfpdqy`)  
**Status**: Local Implementation & Testing Complete — Ready for Operator Review (No production deployment or migration applied)

---

## 1. Confirmed Root Cause

During production testing of the first Google Play subscription purchase (`sub_fe232782d73440dab01b92a9cc27c47c`), Google Play Developer API returned `HTTP 200` with `SUBSCRIPTION_STATE_ACTIVE`. The backend successfully resolved the student and course, committed an `orders` record and an `order_items` record, but failed when inserting into `payments`:

```
new row for relation "payments" violates check constraint "ck_payments_paid_at"
```

### Technical Cause:
The PostgreSQL check constraint on `public.payments` (defined in `008_domain_07_commerce.sql`, line 230) is:
```sql
constraint ck_payments_paid_at check (paid_at is null or paid_at >= created_at)
```

In `verify-google-play-purchase/index.ts`:
1. The `payments.insert` payload supplied:
   ```ts
   paid_at: new Date().toISOString()
   ```
2. The payload **omitted** `created_at`.
3. PostgreSQL automatically populated `created_at` using its column default `now()`.
4. Because `new Date().toISOString()` was evaluated in the Deno runtime **prior** to the SQL query traversing the network and reaching PostgreSQL, PostgreSQL's local transaction clock `now()` was evaluated ~20ms to 150ms **after** the Deno timestamp.
5. Consequently, in PostgreSQL:
   $$\text{paid\_at} < \text{created\_at}$$
6. Because $\text{paid\_at}$ was non-null and strictly earlier than $\text{created\_at}$, the `ck_payments_paid_at` constraint rejected the insertion with an unhandled database exception.
7. Furthermore, because Google Play acknowledgement was executed prior to database commit:
   - `orders` row was left committed in `status = 'confirmed'`.
   - `order_items` row was left committed.
   - `payments` row was aborted.
   - `student_subscriptions` and `course_enrollments` were never reached.
   - Google Play had already been acknowledged, leaving the student charged on Google Play but locked out in the app.

---

## 2. Timestamp Semantics

### Domain Semantics in Schema:
According to migration comments in `008_domain_07_commerce.sql`:
- `payments.created_at`: The UTC timestamp when the payment attempt record was instantiated in our system.
- `payments.paid_at`: The UTC timestamp of successful payment capture. NULL until captured.
- `payments.gateway_response`: The authoritative audit trail capturing raw gateway metadata (e.g. Google Play's `startTime`, `expiryTime`, `purchaseTimeMillis`, `orderId`, and `purchaseToken`).

### Two Payment Lifecycles Compared:
1. **Razorpay Lifecycle (2-stage checkout)**:
   - `create-payment-order` inserts `payments` in `status = 'pending'` with `paid_at = null`. Because `paid_at is null`, `ck_payments_paid_at` passes.
   - When the user finishes checkout, `razorpay-webhook` receives the capture event and updates `status = 'captured'` with `paid_at = now()` ($\text{paid\_at} \gg \text{created\_at}$).
2. **Google Play Mobile Billing Lifecycle (1-stage backend capture)**:
   - The user is charged directly on the device within Google Play before the backend is notified.
   - When our backend verifies the Google receipt, the payment record is created directly in the `captured` status.
   - Both creation and capture occur at the exact same logical event in our system.

### Implemented Correction:
We assign one consistent `transactionTimestamp = new Date().toISOString()` to both `created_at` and `paid_at`:
```ts
const transactionTimestamp = new Date().toISOString();
...
created_at: transactionTimestamp,
paid_at: transactionTimestamp,
```
- **Constraint Satisfaction**: $\text{paid\_at} \ge \text{created\_at}$ is mathematically guaranteed ($\text{transactionTimestamp} \ge \text{transactionTimestamp}$).
- **Data Integrity**: We do not invent arbitrary timestamps. The capture time accurately records the moment our backend verified and accepted the payment.
- **Authoritative Google Play Timestamps**: Google Play's exact `startTime`, `purchaseTimeMillis`, and `expiryTime` are fully preserved without loss inside `gateway_response` (JSONB) and `orders.notes`.

---

## 3. Exact Code Changes

### A. Edge Function: `C:\Projects\MockTestApp\supabase\functions\verify-google-play-purchase\index.ts`
1. **Post-Commit Acknowledgement**:
   Google Play acknowledgement (`:acknowledge`) was moved from step 2.F (pre-commit) to step 7 (**post-commit**). Google Play is now acknowledged ONLY AFTER the database transaction has successfully committed orders, payments, subscriptions, and course enrollments.
2. **Replay Check Enhancement**:
   Checks `effectiveOrderId` across both `gateway_payment_id` and `gateway_order_id`, plus `purchaseToken` in `gateway_order_id`. Re-issues `:acknowledge` if an earlier acknowledge timed out.
3. **Strict Atomic RPC Fallback Condition**:
   Attempts `complete_google_play_purchase` RPC first. Fallback to client table operations is permitted **ONLY** when the function is missing in PostgreSQL (SQLSTATE `42883`, `PGRST202`). Any other database error (constraint, authorization, deadlock) or business rejection (`ACCOUNT_MISMATCH`) fails closed immediately without entering fallback.
4. **Unfulfilled Order Reuse**:
   Queries existing orders for the student to find any unfulfilled order matching the `purchaseToken` or `orderId` in `notes`. Reuses the order rather than creating duplicate orders.
5. **Structured Order Notes**:
   Stores Google Play correlation metadata in `orders.notes`:
   ```ts
   notes: JSON.stringify({
     gateway: "google_play",
     purchaseToken,
     orderId: effectiveOrderId,
     productId,
     itemType: resolvedItemType,
     courseId: resolvedCourseId || null,
     planId: resolvedPlanId || null,
     packageId: resolvedPackageId || null,
   })
   ```
6. **Timestamp Constraint Fix**:
   Passes `created_at: transactionTimestamp` and `paid_at: transactionTimestamp` to `payments.insert`.
7. **Migration 086 Subscription Invariant**:
   Checks if an `active` or `grace` subscription row already exists for `(student_id, plan_id)`. If present, updates it in place; otherwise inserts.
8. **Migration 096 Lifetime Ownership Preservation**:
   Checks if the student holds `enrollment_type = 'purchase'`. If so, maintains permanent lifetime purchase access; never overwrites or downgrades to `'subscription'`.

### B. Shared Billing Core: `C:\Projects\MockTestApp\supabase\functions\verify-google-play-purchase\billingCore.ts`
Exported verified domain helpers:
- `validatePaymentTimestampConstraint(createdAt, paidAt)`: Direct verification of `ck_payments_paid_at`.
- `buildGooglePlayPaymentPayload(params)`: Payload constructor enforcing matching timestamps.
- `resolveCourseEnrollmentType(currentType, newType)`: Permanent ownership preservation guard.
- `findMatchingUnfulfilledOrder(orders, token, orderId)`: Unambiguous order correlation resolver.
- `resolveSubscriptionAction(subscriptions, planId)`: Active/grace update-or-insert director.
- `isRpcMissingError(err)`: Strictly scopes RPC fallback to missing functions (`42883`, `PGRST202`).
- `validateSubscriptionCourseIntegrity(planCourseId, orderCourseId, expectedCourseId)`: Ensures correct course mapping (`b1b09176-fabe-4d05-80e4-ca4fa08f937f`).

---

## 4. Schema and Local Migration

### Local Migration: `C:\Projects\mocktest-admin\supabase\migrations\203_atomic_google_play_purchase_rpc.sql`
- **Function**: `public.complete_google_play_purchase(...)`
- **Privilege / Permissions**: Explicitly restricted to `service_role` via internal `auth.role()` check and `REVOKE ALL FROM public, anon, authenticated; GRANT EXECUTE TO service_role`.
- **Defensive Student Resolution**: Resolves `student_details.student_id` from `profile_id` to guarantee valid foreign key targets for subscriptions and enrollments.
- **ACID Transaction**: Single PL/pgSQL function preventing partial writes.
- **Enum Guard**: Includes idempotent check for `'google_play'` in `public.payment_gateway` enum.

---

## 5. Recovery Plan for the Already Acknowledged Subscription

### Target Transaction Details:
- **Student Profile ID**: `66d9f563-5180-401e-9adc-193c0f9963c7`
- **Plan ID**: `fe232782-d734-40da-b01b-92a9cc27c47c`
- **Target Course ID**: `b1b09176-fabe-4d05-80e4-ca4fa08f937f` (validated from `subscription_plans`)

### Dedicated Script:
[`reconcile_acknowledged_google_play_subscription.sql`](file:///C:/Projects/mocktest-admin/supabase/migrations/reconcile_acknowledged_google_play_subscription.sql)

**Safe Reconciliation Workflow**:
1. Validates that plan `fe232782-d734-40da-b01b-92a9cc27c47c` maps to course `b1b09176-fabe-4d05-80e4-ca4fa08f937f`.
2. Resolves `student_details.student_id` from `profile_id`.
3. Identifies the unfulfilled order by filtering `NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = o.order_id AND p.status = 'captured')`.
4. Fixes `order_items.course_id` if missing.
5. Updates `orders.notes` with Google Play correlation metadata.
6. Inserts captured payment with `created_at = now(), paid_at = now()`.
7. Activates `student_subscriptions` record for course `b1b09176-fabe-4d05-80e4-ca4fa08f937f`.
8. Upserts `course_enrollments` for course `b1b09176-fabe-4d05-80e4-ca4fa08f937f`, preserving lifetime ownership if present.
9. Idempotent and safe to execute multiple times.

---

## 6. Automated Test Results

- **Suite**: `googlePlayPaymentRecording.test.ts`
- **Result**: **22 / 22 PASSED (100%)**
- **Lifecycle Suite**: `playBillingCatalogMapping.test.ts`
- **Result**: **60 / 60 PASSED (100%)**
- **Total Tests Passing**: **82 / 82 Tests**
