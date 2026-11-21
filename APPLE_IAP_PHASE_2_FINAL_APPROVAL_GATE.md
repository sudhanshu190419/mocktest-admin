# Apple In-App Purchase (StoreKit 2) Phase 2 — Final Approval Gate Report

**Date:** 2026-11-19  
**Platform:** Make Me Topper (iOS / Supabase Backend)  
**Repositories Under Audit:**
- Backend: `C:\Projects\mocktest-admin`
- Mobile: `C:\Projects\MockTestApp`
**Target Migrations:**
- `supabase/migrations/247_add_apple_payment_gateway_enum.sql`
- `supabase/migrations/248_apple_purchase_fulfillment.sql`
**Methodology:** Ponytail Senior Developer Pre-Flight Audit (Read-Only Static Analysis)

---

## 1. Original vs. Corrected Function Signatures

Three revisions of the `public.complete_apple_purchase` function signature have existed across Phase 2:

### Revision 1 (Initial Preliminary Draft)
Defined with loose defaults and catalog fallbacks:
```sql
CREATE OR REPLACE FUNCTION public.complete_apple_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_student_id uuid DEFAULT null,
    p_item_type text DEFAULT 'course',
    p_course_id uuid DEFAULT null,
    p_package_id uuid DEFAULT null,
    p_item_name text DEFAULT null,
    p_amount numeric DEFAULT 0.00,
    p_currency text DEFAULT 'INR',
    p_transaction_id text DEFAULT null,
    p_original_transaction_id text DEFAULT null,
    p_product_id text DEFAULT null,
    p_environment text DEFAULT null,
    p_gateway_response jsonb DEFAULT null,
    p_transaction_timestamp timestamptz DEFAULT now(),
    p_billing_name text DEFAULT null,
    p_billing_email text DEFAULT null
)
```
- **PostgreSQL Argument Types:** `(uuid, uuid, uuid, text, uuid, uuid, text, numeric, text, text, text, text, text, jsonb, timestamptz, text, text)`

---

### Revision 2 (Intermediate Reordered Draft)
Made `p_amount`, `p_currency`, `p_transaction_id`, and `p_transaction_timestamp` mandatory, but left `p_product_id` and `p_environment` optional at positions 13 and 14:
```sql
CREATE OR REPLACE FUNCTION public.complete_apple_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_item_type text,
    p_amount numeric,
    p_currency text,
    p_transaction_id text,
    p_transaction_timestamp timestamptz,
    p_student_id uuid DEFAULT null,
    p_course_id uuid DEFAULT null,
    p_package_id uuid DEFAULT null,
    p_item_name text DEFAULT null,
    p_original_transaction_id text DEFAULT null,
    p_product_id text DEFAULT null,
    p_environment text DEFAULT null,
    p_gateway_response jsonb DEFAULT null,
    p_billing_name text DEFAULT null,
    p_billing_email text DEFAULT null
)
```
- **PostgreSQL Argument Types:** `(uuid, uuid, text, numeric, text, text, timestamptz, uuid, uuid, uuid, text, text, text, text, jsonb, text, text)`

---

### Revision 3 (Current Corrected Migration 248)
Elevated `p_product_id` and `p_environment` to mandatory non-default parameters at positions 8 and 9 (immediately following `p_transaction_timestamp`):
```sql
CREATE OR REPLACE FUNCTION public.complete_apple_purchase(
    p_profile_id uuid,
    p_institute_id uuid,
    p_item_type text,
    p_amount numeric,
    p_currency text,
    p_transaction_id text,
    p_transaction_timestamp timestamptz,
    p_product_id text,
    p_environment text,
    p_student_id uuid DEFAULT null,
    p_course_id uuid DEFAULT null,
    p_package_id uuid DEFAULT null,
    p_item_name text DEFAULT null,
    p_original_transaction_id text DEFAULT null,
    p_gateway_response jsonb DEFAULT null,
    p_billing_name text DEFAULT null,
    p_billing_email text DEFAULT null
)
```
- **PostgreSQL Argument Types:** `(uuid, uuid, text, numeric, text, text, timestamptz, text, text, uuid, uuid, uuid, text, text, jsonb, text, text)`

---

## 2. Obsolete Overload Findings

### The PostgreSQL Function Replacement Mechanism
In PostgreSQL:
- Functions are uniquely identified in the system catalog (`pg_proc`) by their **function name** AND their **ordered list of input argument types**.
- Argument names and parameter default expressions are **not** part of the function's identity.
- When `CREATE OR REPLACE FUNCTION` is executed, PostgreSQL will overwrite an existing function **only if the argument types match exactly in order**.
- If the argument types differ in any position, PostgreSQL does **not** replace the function; instead, it defines an **additional function overload**.

### Analysis of Revision 2 vs. Revision 3
Comparing the 8th argument:
- Revision 2: 8th argument was `uuid` (`p_student_id`).
- Revision 3: 8th argument is `text` (`p_product_id`).

Because `uuid` $\neq$ `text`, `CREATE OR REPLACE FUNCTION` in Revision 3 **will NOT replace Revision 2 or Revision 1** if either was previously created in a database.

### Risk Assessment:
1. **Fresh Production Database:**
   - Because Migrations 247 and 248 have **never been executed in production**, a fresh run of Migration 248 will create Revision 3 as the only function. No overload conflict occurs on a fresh database.
2. **Development / Staging Environments:**
   - If a developer or staging CI environment previously ran Revision 1 or Revision 2, applying current Migration 248 without an explicit `DROP FUNCTION` will leave both Revision 2 and Revision 3 in `pg_proc`.

### Dependency Check:
- A recursive search across all migrations, edge functions, backend services, and mobile code confirmed that **zero database objects, views, triggers, foreign keys, or client functions depend on Revision 1 or Revision 2**.

### Recommended Minimal Preamble for Migration 248:
To prevent any possibility of orphaned overloads or PostgREST ambiguity in any environment, Migration 248 should include a safe, non-cascading drop preamble targeting the previous draft signatures prior to `CREATE OR REPLACE FUNCTION`:
```sql
-- Safely remove any obsolete draft overloads from prior staging runs
DROP FUNCTION IF EXISTS public.complete_apple_purchase(
  uuid, uuid, uuid, text, uuid, uuid, text, numeric, text, text, text, text, text, jsonb, timestamptz, text, text
);
DROP FUNCTION IF EXISTS public.complete_apple_purchase(
  uuid, uuid, text, numeric, text, text, timestamptz, uuid, uuid, uuid, text, text, text, text, jsonb, text, text
);
```

---

## 3. Permission and RPC Resolution Findings

1. **Explicit Permission Grants:**
   At the end of Migration 248:
   ```sql
   REVOKE ALL ON FUNCTION public.complete_apple_purchase(
     uuid, uuid, text, numeric, text, text, timestamptz, text, text, uuid, uuid, uuid, text, text, jsonb, text, text
   ) FROM public, anon, authenticated;

   GRANT EXECUTE ON FUNCTION public.complete_apple_purchase(
     uuid, uuid, text, numeric, text, text, timestamptz, text, text, uuid, uuid, uuid, text, text, jsonb, text, text
   ) TO service_role;
   ```
   - Privileges are strictly restricted to `service_role`. Anonymous and authenticated client users cannot invoke this function directly.

2. **Overload Permission Leakage (if old overload exists):**
   - If Revision 2 remains in `pg_proc` in a staging environment, its execute permissions were previously granted to `service_role`.
   - The `REVOKE ALL` statement in Revision 3 targets only the Revision 3 signature; it does not revoke permissions from Revision 2. Dropping the obsolete signature (as recommended above) eliminates this vulnerability.

3. **PostgREST RPC Resolution Ambiguity:**
   - PostgREST maps RPC endpoints (`/rest/v1/rpc/complete_apple_purchase`) by matching JSON keys to parameter names.
   - If both Revision 2 and Revision 3 exist simultaneously, PostgREST will fail with HTTP 300 / code `PGRST203: Could not choose a best candidate function. You might need to add explicit type casts.`
   - Dropping obsolete overloads guarantees unambiguous resolution.

---

## 4. Cross-Platform Entitlement Scenario Results

Static code tracing was performed across the 5 cross-platform entitlement scenarios:

| Scenario | Existing Record | New Order Created? | New Payment Created? | New Entitlement Inserted? | Existing Record Modified? | RPC Return Code & Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Active Course from Razorpay** | `course_enrollments` (`is_active = true, revoked_at = null, order_item_id` $\rightarrow$ Razorpay) | **YES** (`status = 'confirmed'`) | **YES** (`gateway = 'apple'`, `status = 'captured'`) | **NO** (Bypassed at Step 17) | **NO** (Untouched) | `success: true`<br>`outcome: 'already_enrolled_payment_recorded'`<br>`alreadyEnrolled: true` |
| **2. Active Course from Google Play** | `course_enrollments` (`is_active = true, revoked_at = null, order_item_id` $\rightarrow$ Play) | **YES** (`status = 'confirmed'`) | **YES** (`gateway = 'apple'`, `status = 'captured'`) | **NO** (Bypassed at Step 17) | **NO** (Untouched) | `success: true`<br>`outcome: 'already_enrolled_payment_recorded'`<br>`alreadyEnrolled: true` |
| **3. Active PYQ Package from Web/Play** | `student_pyq_purchases` (`is_active = true, revoked_at = null`) | **YES** (`status = 'confirmed'`) | **YES** (`gateway = 'apple'`, `status = 'captured'`) | **NO** (Bypassed at Step 17) | **NO** (Untouched) | `success: true`<br>`outcome: 'already_enrolled_payment_recorded'`<br>`alreadyEnrolled: true` |
| **4. Active Admin / Complimentary Grant** | `course_enrollments` (`enrollment_type = 'admin_grant'`) | **YES** (`status = 'confirmed'`) | **YES** (`gateway = 'apple'`, `status = 'captured'`) | **NO** (Bypassed at Step 17) | **NO** (`enrollment_type` and grant data untouched) | `success: true`<br>`outcome: 'already_enrolled_payment_recorded'`<br>`alreadyEnrolled: true` |
| **5. Inactive / Admin-Revoked Entitlement** | `course_enrollments` or `student_pyq_purchases` (`is_active = false OR revoked_at IS NOT NULL`) | **NO** (Aborts at Step 10B) | **NO** (Aborts at Step 10B) | **NO** (Aborts at Step 10B) | **NO** (Untouched) | `success: false`<br>`code: 'ENTITLEMENT_REVOKED'`<br>`error: '...deactivated or revoked by an administrator...'` |

### Invariant Verification:
1. **Never Silently Reactivates Revoked Access:** Step 10B aborts before order or payment creation. Under no circumstances can a student repurchase a course or package they were banned from.
2. **Never Overwrites or Duplicates Active Entitlements:** If active, Step 10B sets `v_entitlement_already_active := true`, Step 17 skips the `INSERT`, and Step 19 returns `already_enrolled_payment_recorded`.

---

## 5. Duplicate Apple Purchase Behavior

### Outcome Differentiation
The RPC strictly separates purchase outcomes:
- `purchase_recorded`: A new Apple purchase where payment was captured, order confirmed, and entitlement was freshly granted (`alreadyEnrolled: false` / omitted).
- `already_enrolled_payment_recorded`: A new Apple purchase where payment was captured and order created for bookkeeping, but the entitlement was already held by the student and preserved untouched (`alreadyEnrolled: true`, `alreadyProcessed: false`).
- `entitlement_repaired`: A receipt replay where an existing Apple payment was captured but entitlement was missing; entitlement successfully repaired (`alreadyProcessed: true`).
- `already_recorded`: An idempotent receipt replay where both payment and entitlement were already in place (`alreadyProcessed: true`).

### Mobile Client Implications
- **Financial Risk:** If a user purchases on the web or Android, and later logs into the iOS app, the Apple StoreKit sandbox/production environment has no native awareness of external purchases.
- If the mobile app allows the student to tap "Buy Course" on iOS, Apple will charge the user's card.
- The RPC will fulfill the accounting record (`already_enrolled_payment_recorded`), but the student has now paid twice.
- **Client Mitigation Requirement (Phase 4):**
  The iOS application UI must check the user's existing active entitlements (`useEnrolledCourses`, `student_pyq_purchases`) before rendering the Apple StoreKit purchase button. If already enrolled, the UI must replace the purchase button with "Enrolled" / "Go to Course".

---

## 6. Concurrency and Race Condition Safety

1. **Advisory Lock (Step 4):**
   `hashtext('apple_transaction:' || p_transaction_id)` serializes concurrent requests presenting the **same** transaction ID (e.g. rapid network retries).
2. **Profile Row Lock (Step 5):**
   ```sql
   SELECT p.role, p.institute_id, p.name, p.email
   FROM public.profiles p
   WHERE p.profile_id = p_profile_id
   FOR UPDATE;
   ```
   If two **different** Apple transaction IDs are submitted concurrently for the same student:
   - Transaction 1 locks the `profiles` row.
   - Transaction 2 is blocked at Step 5 until Transaction 1 commits.
   - Transaction 1 finishes and inserts the entitlement.
   - Transaction 2 unblocks, reads the newly committed enrollment at Step 10B, sets `v_entitlement_already_active := true`, and records payment without attempting a duplicate entitlement insertion.
3. **Table Constraint Safety Net (Step 17):**
   - `public.course_enrollments` is protected by `uq_course_enrollments_course_student UNIQUE (course_id, student_id)`.
   - `public.student_pyq_purchases` is protected by `uq_student_pyq_purchases_student_package UNIQUE (student_id, package_id)`.
   - Both insert statements use `ON CONFLICT (...) DO NOTHING`. PostgreSQL matches composite unique targets regardless of column specification order.

---

## 7. Migration Checksum Verification

Both repositories were verified for byte-for-byte identity:

| File | SHA-256 Checksum | Match Status |
| :--- | :--- | :--- |
| `mocktest-admin/supabase/migrations/247_add_apple_payment_gateway_enum.sql` | `A4CDB7563DCF95BBB2833258F731809B962DF8C2643D11B2B1C3503B82A02139` | **IDENTICAL** |
| `MockTestApp/supabase/migrations/247_add_apple_payment_gateway_enum.sql` | `A4CDB7563DCF95BBB2833258F731809B962DF8C2643D11B2B1C3503B82A02139` | **IDENTICAL** |
| `mocktest-admin/supabase/migrations/248_apple_purchase_fulfillment.sql` | `725DA0E12FCF35E6B03C5C2514DE87D3ACE759705EE8DD2885B3ED069D287A18` | **IDENTICAL** |
| `MockTestApp/supabase/migrations/248_apple_purchase_fulfillment.sql` | `725DA0E12FCF35E6B03C5C2514DE87D3ACE759705EE8DD2885B3ED069D287A18` | **IDENTICAL** |

---

## 8. Remaining Blockers & Next Action

There are **zero algorithmic or security blockers** in the SQL logic.

**Single Pre-Apply Housekeeping Item:**
Before running Migration 248 in staging/production, prepend the two safe `DROP FUNCTION IF EXISTS` statements (documented in Section 2) to eliminate any obsolete development overloads.

---

## 9. Final Verdict

### **READY FOR MANUAL MIGRATION APPLICATION**
*(With recommended inclusion of obsolete draft drop preamble prior to live execution)*

- **Migration 247:** Must be applied and committed first to establish the `apple` enum value.
- **Migration 248:** Must be applied second to create the hardened, atomic fulfillment RPC.
- **Phase 3 Ready:** Once applied, the backend database layer is 100% prepared for Supabase Edge Function development (`verify-apple-purchase`).
