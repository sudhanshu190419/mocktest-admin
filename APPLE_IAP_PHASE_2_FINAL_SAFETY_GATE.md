# Apple IAP Phase 2 — Final Entitlement and SQL Safety Gate Report

**Date:** 2026-11-19  
**Review Type:** Deep Static SQL Audit, Branch Trace & Safety Gate  
**Author:** Antigravity (Ponytail Senior Engineering Mode)  
**Repositories:**
- Backend: `C:\Projects\mocktest-admin`
- Mobile Client & Migration Copy: `C:\Projects\MockTestApp`
- Files Audited: `supabase/migrations/248_apple_purchase_fulfillment.sql` (in both repositories)

---

## 1. Exact SQL Branches Inspected

Every executable branch in `public.complete_apple_purchase(...)` in [248_apple_purchase_fulfillment.sql](file:///c:/Projects/mocktest-admin/supabase/migrations/248_apple_purchase_fulfillment.sql) was audited line by line:

1. **Lines 108–116 (Security Guard):** `IF auth.role() IS DISTINCT FROM 'service_role'` → rejects unauthorized callers with `FORBIDDEN`.
2. **Lines 118–133 (Payload Guard):** Validates non-null `p_profile_id` and `p_institute_id` → rejects with `INVALID_PURCHASE_PAYLOAD`.
3. **Lines 135–177 (Transaction Integrity Guard):**
   - `p_amount IS NULL OR p_amount <= 0.00` → rejects with `INVALID_AMOUNT`.
   - `p_currency IS NULL OR upper(p_currency) NOT IN ('INR','USD','AED','GBP')` → rejects with `MISSING_CURRENCY` / `UNSUPPORTED_CURRENCY`.
   - `p_transaction_id IS NULL OR btrim(p_transaction_id) = ''` → rejects with `INVALID_TRANSACTION_ID`.
   - `p_transaction_timestamp IS NULL` → rejects with `MISSING_TRANSACTION_TIMESTAMP`.
4. **Lines 179–186 (Subscription Guard):** `p_item_type = 'subscription_plan'` → rejects with `SUBSCRIPTIONS_RETIRED`.
5. **Lines 188–198 (Advisory Locks):** Serializes requests via `pg_advisory_xact_lock(hashtext('apple_transaction:' || p_transaction_id))`.
6. **Lines 200–213 (Profile Lock):** `SELECT ... FROM public.profiles FOR UPDATE` → locks profile row or returns `PROFILE_NOT_FOUND`.
7. **Lines 215–233 (Staff Role Guard):** Checks `admin_roles`, `teacher_details`, `profiles.role` → rejects staff with `FORBIDDEN_ROLE`.
8. **Lines 235–243 (Institute Guard):** Verifies profile institute matches requested institute → rejects with `INSTITUTE_MISMATCH`.
9. **Lines 245–320 (Catalog Integrity Guard):** Verifies `courses` / `pyq_packages` row existence and institute ownership → rejects missing items with `COURSE_NOT_FOUND` / `PACKAGE_NOT_FOUND`.
10. **Lines 322–343 (Student Resolution):** Resolves existing `student_details` or validates consistency of supplied `p_student_id`.
11. **Lines 345–505 (Existing Payment & Idempotency Branch):**
    - Line 360: Rejects cross-account receipt claims with `ACCOUNT_MISMATCH`.
    - Line 369: Rejects refunded payments/orders with `TRANSACTION_REFUNDED`.
    - Line 380: Rejects non-captured/non-confirmed payment states with `INVALID_EXISTING_PAYMENT_STATE`.
    - Line 391: Rejects institute mismatches with `INSTITUTE_MISMATCH`.
    - Lines 401–443: Rejects product and item-type mismatches with `ORDER_ITEM_MISMATCH`.
    - Lines 445–465: Checks existing entitlement row in `course_enrollments` / `student_pyq_purchases`.
    - Lines 467–486 (Case A): If entitlement is active (`is_active = true` AND `revoked_at IS NULL`), returns idempotent success (`outcome: 'already_recorded'`).
    - Lines 488–497 (Case B): If entitlement is inactive/revoked (`is_active = false` OR `revoked_at IS NOT NULL`), rejects with `ENTITLEMENT_REVOKED`.
    - Lines 499–505 (Case C): If entitlement row is completely missing, sets `v_skip_payment_insert := true` and repairs missing row.
12. **Lines 507–584 (Unfulfilled Order Correlation):** Correlates pending orders matching transaction notes.
13. **Lines 586–593 (Role Transition):** Promotes `profiles.role = 'user'` to `'student'`.
14. **Lines 595–626 (Student Provisioning):** Auto-provisions `student_details` via `generate_enrollment_number(institute_id)`.
15. **Lines 639–700 (Order & Line Item Insert):** Inserts confirmed `orders` and polymorphic `order_items`.
16. **Lines 702–750 (Payment Insert):** Inserts captured payment into `public.payments` (`gateway = 'apple'`).
17. **Lines 752–820 (Entitlement Grant & UPSERT):**
    - Course: `INSERT INTO course_enrollments ... ON CONFLICT (course_id, student_id) DO UPDATE ...`
    - PYQ: `INSERT INTO student_pyq_purchases ... ON CONFLICT (package_id, student_id) DO UPDATE ...`
18. **Lines 822–862 (Draft Invoice Snapshot):** Inserts non-fatal draft GST invoice snapshot.
19. **Lines 864–878 (Response Builder):** Returns structured JSON response (`purchase_recorded` or `entitlement_repaired`).

---

## 2. Evaluation of the Nine Entitlement & Transaction Scenarios

| Scenario | Condition Tested | SQL Execution Path | Database Mutations | Safety Result |
| :--- | :--- | :--- | :--- | :--- |
| **Case 1** | Same Tx ID, captured payment, confirmed order, active entitlement. | Enters existing-payment branch (L346), passes all guards, matches Case A (L467). | Zero orders, payments, or enrollments created. Promotes profile role if `'user'`. Returns `already_recorded`. | **SAFE (Pass)** |
| **Case 2** | Same Tx ID, captured payment, confirmed order, missing entitlement row. | Enters existing-payment branch (L346), passes all guards, matches Case C (L499). Sets `v_skip_payment_insert := true`. Reuses existing order/item. | No order created; no payment created. Exactly one missing entitlement row is inserted (L754/L786). Returns `entitlement_repaired`. | **SAFE (Pass)** |
| **Case 3** | Same Tx ID, captured payment, confirmed order, inactive/revoked entitlement. | Enters existing-payment branch (L346), passes guards, matches Case B (L488). | **Zero mutations.** Rejects immediately with code `ENTITLEMENT_REVOKED`. Access is **not** restored. | **SAFE (Pass)** |
| **Case 4** | Same Tx ID, refunded payment (`payments.status = 'refunded'`). | Enters existing-payment branch (L346), detected by refund guard (L369). | **Zero mutations.** Rejects immediately with code `TRANSACTION_REFUNDED`. Replay cannot restore access. | **SAFE (Pass)** |
| **Case 5** | Different Tx ID, same user & product, existing **inactive/revoked entitlement**. | Bypasses existing-payment branch (L346 is NULL). Inserts new order (L641), inserts new payment (L704), then **executes UPSERT at L754/L786**. | **CRITICAL FLAW:** `ON CONFLICT (course_id, student_id) DO UPDATE SET is_active = true, revoked_at = null, revoked_reason = null` **silently reactivates the revoked entitlement and clears admin revocation records.** | <span style="color:red;font-weight:bold;">UNSAFE (FLAW DETECTED)</span> |
| **Case 6** | Different Tx ID, same user & product, no previous entitlement row. | Bypasses existing-payment branch. Normal new purchase path. | Inserts 1 order, 1 order item, 1 payment, 1 active entitlement row. Returns `purchase_recorded`. | **SAFE (Pass)** |
| **Case 7** | Existing Tx ID belonging to another profile. | Enters existing-payment branch (L346), caught by account mismatch check (L360). | **Zero mutations.** Rejects immediately with code `ACCOUNT_MISMATCH`. | **SAFE (Pass)** |
| **Case 8** | Existing Tx ID associated with different product or institute. | Enters existing-payment branch (L346), caught by institute check (L391) or item check (L417/L426/L435). | **Zero mutations.** Rejects immediately with `INSTITUTE_MISMATCH` or `ORDER_ITEM_MISMATCH`. | **SAFE (Pass)** |
| **Case 9** | Concurrent requests for the same transaction. | First request acquires `pg_advisory_xact_lock` (L189). Second request blocks until first commits. Second request unblocks, takes Case 1. | Exactly 1 order, 1 payment, 1 entitlement created. Second request returns `alreadyProcessed: true`. | **SAFE (Pass)** |

---

## 3. Critical Vulnerability: Revocation Reactivation via `ON CONFLICT DO UPDATE` (Case 5)

### 3.1 Can an UPSERT Reactivate a Revoked Entitlement?
**YES.** A critical logic flaw exists on the new-purchase path:

Look at lines 775–781 in Migration 248:
```sql
ON CONFLICT (course_id, student_id)
DO UPDATE SET
  is_active = true,
  enrollment_type = 'purchase',
  order_item_id = COALESCE(excluded.order_item_id, course_enrollments.order_item_id),
  revoked_at = null,
  revoked_reason = null;
```
And lines 811–817 for PYQ packages:
```sql
ON CONFLICT (package_id, student_id)
DO UPDATE SET
  is_active = true,
  revoked_at = null,
  revoked_reason = null,
  updated_at = p_transaction_timestamp;
```

### 3.2 The Failure Scenario
1. A student purchases a course.
2. Later, an administrator explicitly revokes their enrollment for academic misconduct or disciplinary reasons (`is_active = false`, `revoked_reason = 'Disciplinary Ban'`).
3. If the student (or an attacker) initiates a transaction with a **different `transactionId`** (e.g. from another Apple ID, or if a new transaction ID is generated):
   - The RPC searches for payments with the *new* `p_transaction_id`. None are found.
   - The RPC creates a new confirmed order and captures a new payment.
   - The RPC reaches the `course_enrollments` insert. A row already exists for `(course_id, student_id)`, triggering the `ON CONFLICT DO UPDATE` clause.
   - The UPSERT unconditionally overwrites:
     `is_active = true`  
     `revoked_at = null`  
     `revoked_reason = null`  
4. **The administrator's disciplinary revocation is completely destroyed without trace, and access is silently restored.**

### 3.3 Duplicate Paid Order Creation on Active Entitlements
Similarly, if a student already actively owns Course X (e.g., purchased on the website via Razorpay), calling `complete_apple_purchase` with a new Apple transaction ID will create a second paid order and payment, then execute the UPSERT and overwrite `order_item_id`.

---

## 4. Legitimate New Purchases vs. Transaction Replays

- **Old Transaction Replays:** Correctly distinguished and blocked when the transaction ID is identical. Lines 345–505 successfully block refunded transactions and replayed revoked transactions.
- **New Transactions:** **Inadequately isolated from existing account entitlements.** The RPC does not verify whether the student *already* has an active or revoked entitlement record for this course before creating orders and payments.

---

## 5. Product ID and Environment Requirements (Check 2)

### 5.1 Current Signature and Implementation
In Migration 248 lines 38–39:
```sql
p_product_id text DEFAULT null,
p_environment text DEFAULT null,
```

### 5.2 Findings
1. **`p_product_id` is completely unvalidated:**
   - The parameter defaults to `null`.
   - The function body contains **zero checks** verifying that `p_product_id` is non-empty.
   - The function body contains **zero checks** verifying that `p_product_id` matches the product type being purchased.
   - A caller can pass `p_item_type = 'course'`, `p_course_id = '<Course_UUID>'`, and pass an Apple PYQ SKU (`com.makemetopper.pyq.123...`) or `null`. The RPC accepts it and commits.
2. **`p_environment` is completely unvalidated:**
   - The parameter defaults to `null`.
   - Apple StoreKit 2 transactions strictly emit environment as `"Production"`, `"Sandbox"`, or `"Xcode"` (local testing).
   - The RPC accepts `null` or arbitrary strings without restriction.
3. **Database vs. Edge Function Responsibilities:**
   - The cryptographic decoding of the Apple JWS token belongs to the Edge Function.
   - However, the database RPC **must enforce basic structural invariants**:
     - `p_product_id` must be required and non-empty.
     - For `course`, `p_product_id` must start with `com.makemetopper.course.`.
     - For `pyq_package`, `p_product_id` must start with `com.makemetopper.pyq.`.
     - `p_environment` must be one of `'Production'`, `'Sandbox'`, `'Xcode'`.

---

## 6. Runtime SQL Validation Status

- **Status:** **Unavailable in local environment.**
- **Investigation:**
  - `docker ps` failed: Docker Desktop engine is not running on this host (`connection to docker API at npipe:////./pipe/dockerDesktopLinuxEngine failed`).
  - Windows service `postgresql-x64-18` is running, but attempting connection via `psql.exe -U postgres` failed: `fe_sendauth: no password supplied`. No local database password or test database configuration exists in workspace `.env` files.
  - Remote production database was not touched (strictly read-only as required).
- **Execution Note:** As required by the prompt, this report makes no false claim of runtime execution. Findings are derived from complete static trace analysis of every PL/pgSQL AST path and table constraint.

---

## 7. Remaining Blockers & Exact Proposed Minimal Fixes

### Blocker 1: Revocation Bypass & Duplicate Purchase on New Transactions
- **Location:** `248_apple_purchase_fulfillment.sql`, Lines 344 and Lines 775–781 / 811–817.
- **The Issue:**
  1. If student already has an active entitlement, a new purchase creates duplicate financial records.
  2. If student has an inactive/revoked entitlement, the UPSERT wipes out the revocation.
- **Proposed Minimal Correction:**
  Before inserting a new order (around line 344 or 506), query existing entitlement for the student:
  ```sql
  -- Pre-flight check on existing student entitlement
  IF v_student_id IS NOT NULL THEN
    IF p_item_type = 'course' THEN
      SELECT true, ce.is_active, ce.revoked_at
      INTO v_entitlement_found, v_entitlement_is_active, v_entitlement_revoked_at
      FROM public.course_enrollments ce
      WHERE ce.course_id = v_effective_course_id AND ce.student_id = v_student_id;
    ELSIF p_item_type = 'pyq_package' THEN
      SELECT true, sp.is_active, sp.revoked_at
      INTO v_entitlement_found, v_entitlement_is_active, v_entitlement_revoked_at
      FROM public.student_pyq_purchases sp
      WHERE sp.package_id = v_effective_package_id AND sp.student_id = v_student_id;
    END IF;

    -- If student was revoked by admin, reject new purchases unless admin reinstates
    IF v_entitlement_found AND (v_entitlement_is_active = false OR v_entitlement_revoked_at IS NOT NULL) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Account entitlement for this product is revoked. Cannot purchase new enrollment.',
        'code', 'ENTITLEMENT_REVOKED'
      );
    END IF;

    -- If student already has active access, return already_recorded without duplicate orders
    IF v_entitlement_found AND v_entitlement_is_active = true AND v_entitlement_revoked_at IS NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'verified', true,
        'outcome', 'already_recorded',
        'alreadyProcessed', true,
        'message', 'Student already has an active entitlement for this product'
      );
    END IF;
  END IF;
  ```
  And in the `ON CONFLICT DO UPDATE` clause:
  Add `WHERE course_enrollments.revoked_at IS NULL` to prevent updating explicitly revoked rows.

---

### Blocker 2: Missing Validation for `p_product_id` and `p_environment`
- **Location:** `248_apple_purchase_fulfillment.sql`, Lines 25–43 and Lines 135–177.
- **The Issue:** `p_product_id` and `p_environment` are nullable defaults and never checked for validity or prefix consistency.
- **Proposed Minimal Correction:**
  1. Remove `DEFAULT null` from `p_product_id` and `p_environment`.
  2. Add strict validation in section 2:
     ```sql
     IF p_product_id IS NULL OR btrim(p_product_id) = '' THEN
       RETURN jsonb_build_object('success', false, 'error', 'Explicit p_product_id from verified Apple transaction is required.', 'code', 'INVALID_PRODUCT_ID');
     END IF;

     IF p_item_type = 'course' AND NOT p_product_id LIKE 'com.makemetopper.course.%' THEN
       RETURN jsonb_build_object('success', false, 'error', 'p_product_id must start with com.makemetopper.course.', 'code', 'PRODUCT_ID_MISMATCH');
     ELSIF p_item_type = 'pyq_package' AND NOT p_product_id LIKE 'com.makemetopper.pyq.%' THEN
       RETURN jsonb_build_object('success', false, 'error', 'p_product_id must start with com.makemetopper.pyq.', 'code', 'PRODUCT_ID_MISMATCH');
     END IF;

     IF p_environment IS NULL OR p_environment NOT IN ('Production', 'Sandbox', 'Xcode') THEN
       RETURN jsonb_build_object('success', false, 'error', 'Explicit p_environment (Production, Sandbox, or Xcode) is required.', 'code', 'INVALID_ENVIRONMENT');
     END IF;
     ```

---

## 8. Final Safety Gate Recommendation

### **VERDICT: NOT READY**

**Rationale:**
1. **Blocker 1 (Data Integrity & Disciplinary Security):** An administrator's intentional revocation of a student's access can currently be bypassed and wiped out by an incoming purchase containing a new transaction ID (Case 5).
2. **Blocker 2 (Apple Product & Environment Integrity):** `p_product_id` and `p_environment` lack database validation, allowing inconsistent or empty product IDs to be recorded in order audit notes.

The exact minimal fixes have been identified above. Once approved by the user, these two surgical corrections can be applied to Migration 248 in both repositories before final manual migration application.
