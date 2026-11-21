# Apple In-App Purchase (StoreKit 2) Phase 2 — SQL Security Corrections Report

**Date:** 2026-11-19  
**Platform:** Make Me Topper (iOS / Supabase Backend)  
**Primary Repositories:**
- Backend: `C:\Projects\mocktest-admin`
- Mobile: `C:\Projects\MockTestApp`
**Files Modified & Synchronized:**
- `supabase/migrations/248_apple_purchase_fulfillment.sql`
- Checksum (SHA-256): `725DA0E12FCF35E6B03C5C2514DE87D3ACE759705EE8DD2885B3ED069D287A18`

---

## 1. Executive Summary

Following the comprehensive audit in `APPLE_IAP_PHASE_2_FINAL_SAFETY_GATE.md`, two critical security and consistency vulnerabilities were identified in the preliminary draft of `supabase/migrations/248_apple_purchase_fulfillment.sql`:
1. **Revocation Bypass and Entitlement Overwriting:** An unconditional `ON CONFLICT (...) DO UPDATE` clause in the fulfillment RPC was resetting `is_active = true, revoked_at = null, revoked_reason = null` whenever a student purchased or presented a new transaction ID, erasing administrator disciplinary revocations. Furthermore, when an active entitlement already existed, unnecessary conflict updates were occurring.
2. **Missing Product ID & Environment Validation:** Parameters `p_product_id` and `p_environment` were defined with `DEFAULT null` and had zero validation, allowing malformed SKUs, arbitrary product-UUID pairings, and untrusted environments (such as `Xcode` or null) to bypass database integrity checks.

This document details the surgical SQL corrections applied to `supabase/migrations/248_apple_purchase_fulfillment.sql` to resolve both blockers completely, without destabilizing existing commerce tables, Razorpay, or Google Play fulfillment workflows.

---

## 2. Exact SQL Locations Corrected

All edits were confined to `supabase/migrations/248_apple_purchase_fulfillment.sql`. The specific changes and line ranges are:

### A. Function Parameter Signature (Lines 31–49)
- **Change:** Elevated `p_product_id text` and `p_environment text` from optional parameters with `DEFAULT null` to **mandatory parameters without defaults**, placed at positions 8 and 9 (immediately following `p_transaction_timestamp` and preceding `p_student_id`).
- **PostgreSQL Compliance:** In PostgreSQL PL/pgSQL, parameters without defaults cannot follow parameters with default values. The signature now has 9 required parameters followed by 8 optional parameters with `DEFAULT null`.

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

### B. Parameter Presence & Environment Validation (Lines 135–182 in Step 2)
- **Change:** Added strict rejection if `p_product_id` or `p_environment` is null or empty.
- **Environment Whitelist:** Restricted `p_environment` strictly to `('Production', 'Sandbox')`. Any other value (e.g., `'Xcode'`, `'LocalTesting'`, or unexpected inputs) is rejected immediately with error code `INVALID_ENVIRONMENT`.

```sql
IF p_product_id IS NULL OR btrim(p_product_id) = '' THEN
  RAISE EXCEPTION 'Product ID (StoreKit SKU) is required for Apple purchases'
    USING ERRCODE = 'P0002', DETAIL = 'MISSING_PRODUCT_ID';
END IF;

IF p_environment IS NULL OR btrim(p_environment) = '' THEN
  RAISE EXCEPTION 'Environment is required for Apple purchases'
    USING ERRCODE = 'P0002', DETAIL = 'MISSING_ENVIRONMENT';
END IF;

IF btrim(p_environment) NOT IN ('Production', 'Sandbox') THEN
  RAISE EXCEPTION 'Invalid Apple environment: %. Must be Production or Sandbox', p_environment
    USING ERRCODE = 'P0002', DETAIL = 'INVALID_ENVIRONMENT';
END IF;
```

### C. Deterministic SKU Format & UUID Validation (Lines 365–424 in Step 8)
- **Change:** Enforced exact deterministic mapping between StoreKit 2 SKU and database UUIDs:
  - **Course:** Must equal `'com.makemetopper.course.' || lower(replace(v_effective_course_id::text, '-', ''))`
  - **PYQ Package:** Must equal `'com.makemetopper.pyq.' || lower(replace(v_effective_package_id::text, '-', ''))`
- **Error Code:** Mismatches raise an exception with DETAIL `'PRODUCT_ID_MISMATCH'`.

### D. Existing Entitlement Pre-Flight Check (Lines 496–562 in Step 10B)
- **Change:** Before creating any new order or payment record for a new transaction ID, the RPC queries `course_enrollments` or `student_pyq_purchases` for the student:
  - **If Deactivated/Revoked (`is_active = false OR revoked_at IS NOT NULL`):** Immediately raises exception with DETAIL `'ENTITLEMENT_REVOKED'`. No order or payment is inserted.
  - **If Already Active (`is_active = true AND revoked_at IS NULL`):** Sets flag `v_entitlement_already_active := true`.

### E. Entitlement Insertion Conflict Policy (Lines 864–909 in Step 17)
- **Change:** Replaced dangerous `ON CONFLICT (...) DO UPDATE` with `ON CONFLICT (...) DO NOTHING`.
- **Conditional Skip:** If `v_entitlement_already_active` is true, entitlement insertion is bypassed entirely to avoid redundant lock contention and prevent any mutation of the existing active record.

```sql
-- Course Entitlement:
INSERT INTO public.course_enrollments (
  course_id, student_id, institute_id, enrollment_no,
  status, is_active, enrolled_at, created_at, updated_at
) VALUES (
  v_effective_course_id, v_student_id, v_resolved_institute_id, v_enrollment_no,
  'enrolled', true, p_transaction_timestamp, p_transaction_timestamp, p_transaction_timestamp
)
ON CONFLICT (course_id, student_id) DO NOTHING;
```

### F. Return Payload for Pre-Enrolled Purchases (Lines 954–968 in Step 19)
- **Change:** When `v_entitlement_already_active` is true, records the captured payment and confirmed order for accounting and audit reconciliation, while returning:
  - `outcome: 'already_enrolled_payment_recorded'`
  - `alreadyEnrolled: true`
  - `alreadyProcessed: false`
  - `message: 'Payment recorded for financial reconciliation; existing active entitlement preserved without modification'`

### G. Security Definer Grants & Revocations (Lines 992–998)
- **Change:** Updated function signatures in `REVOKE ALL` and `GRANT EXECUTE` to precisely match the new 17-parameter signature, ensuring execution is strictly granted to `service_role` and blocked for `anon`, `authenticated`, and `public`.

---

## 3. Before-and-After Entitlement Conflict Behavior

| Scenario | Previous Behavior (Vulnerable) | Corrected Behavior (Secure) | Rationale |
| :--- | :--- | :--- | :--- |
| **New purchase, no existing entitlement** | Created order, payment, and inserted active entitlement. | Creates order, payment, and inserts active entitlement. | Unchanged standard purchase path. |
| **Receipt replay (Same tx ID, payment captured, order confirmed, entitlement missing)** | Fulfill repair: inserted or updated entitlement row. | Fulfill repair: inserts entitlement (`outcome: 'entitlement_repaired'`). | Safe idempotency repair if a transient network crash interrupted prior step. |
| **Receipt replay (Same tx ID, payment refunded)** | Rejected with `TRANSACTION_REFUNDED`. | Rejected with `TRANSACTION_REFUNDED`. | Preserved financial invariant. |
| **Student has admin-revoked entitlement, buys again with new tx ID** | **VULNERABLE:** `ON CONFLICT DO UPDATE` set `is_active = true, revoked_at = null, revoked_reason = null`. Disciplinary action bypassed. | **BLOCKED:** Step 10B preflight detects `is_active = false OR revoked_at IS NOT NULL` and aborts with `ENTITLEMENT_REVOKED`. | Disciplinary bans and fraud suspensions cannot be bypassed by client repurchase. |
| **Student has active entitlement (e.g. web/Razorpay), buys on iOS with new tx ID** | Overwrote enrollment record timestamp with `DO UPDATE`. Created potential duplicate orders. | Records payment and order for accounting; skips entitlement update via `ON CONFLICT DO NOTHING`; returns `already_enrolled_payment_recorded`. | Maintains financial ledger parity without corrupting existing enrollment timestamps or status. |

---

## 4. Protection of Administrator Disciplinary Revocations

When an administrator revokes a student's access in Make Me Topper:
- `course_enrollments`: `status := 'cancelled'`, `is_active := false`, `revoked_at := now()`, `revoked_reason := 'Administrative revocation'`.
- `student_pyq_purchases`: `is_active := false`, `revoked_at := now()`, `revoked_reason := 'Administrative revocation'`.

In the corrected implementation:
```sql
IF p_item_type = 'course' THEN
  SELECT ce.is_active, ce.revoked_at
  INTO v_existing_entitlement_active, v_existing_entitlement_revoked_at
  FROM public.course_enrollments ce
  WHERE ce.course_id = v_effective_course_id AND ce.student_id = v_student_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_entitlement_active = false OR v_existing_entitlement_revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Student enrollment for this course has been deactivated or revoked by administration'
        USING ERRCODE = 'P0003', DETAIL = 'ENTITLEMENT_REVOKED';
    ELSE
      v_entitlement_already_active := true;
    END IF;
  END IF;
```
Because this check runs in Step 10B **before** order creation or payment creation, no row is inserted into `payments` or `orders`, and the transaction rolls back cleanly.

---

## 5. SKU Mapping and UUID Validation

StoreKit 2 products are created in App Store Connect with deterministic identifiers created by `appleSkuHelper.ts`:
- Course: `com.makemetopper.course.<uuid_without_hyphens>`
- PYQ Package: `com.makemetopper.pyq.<uuid_without_hyphens>`

Step 8 in Migration 248 enforces this contract bidirectionally:
```sql
IF p_item_type = 'course' THEN
  v_expected_sku := 'com.makemetopper.course.' || lower(replace(v_effective_course_id::text, '-', ''));
  IF lower(btrim(p_product_id)) <> v_expected_sku THEN
    RAISE EXCEPTION 'Product ID % does not match expected course SKU %', p_product_id, v_expected_sku
      USING ERRCODE = 'P0002', DETAIL = 'PRODUCT_ID_MISMATCH';
  END IF;
ELSIF p_item_type = 'pyq_package' THEN
  v_expected_sku := 'com.makemetopper.pyq.' || lower(replace(v_effective_package_id::text, '-', ''));
  IF lower(btrim(p_product_id)) <> v_expected_sku THEN
    RAISE EXCEPTION 'Product ID % does not match expected PYQ SKU %', p_product_id, v_expected_sku
      USING ERRCODE = 'P0002', DETAIL = 'PRODUCT_ID_MISMATCH';
  END IF;
END IF;
```
This guarantees:
1. An attacker cannot submit a cheap PYQ SKU while requesting access to a premium Course UUID.
2. An attacker cannot supply an invalid UUID that does not match the product being fulfilled.
3. Complete parity with mobile `src/utils/appleSkuHelper.ts`.

---

## 6. Environment Strict Whitelisting

StoreKit 2 JWS transactions include an `environment` claim. In migration 248:
- Allowed values: `'Production'` and `'Sandbox'`.
- All other values (including `'Xcode'`, `'LocalTesting'`, or null) are strictly rejected with `INVALID_ENVIRONMENT`.
- This ensures test certificates or local StoreKit configuration files generated in Xcode cannot fulfill live production access on the backend.

---

## 7. Concurrency, Atomicity, and Row Locking

The RPC enforces a deterministic lock acquisition hierarchy across all transactions:
1. **Existing Payment Lock:** `SELECT ... FROM public.payments WHERE gateway_payment_id = p_transaction_id FOR UPDATE`
2. **Existing Order Lock:** `SELECT ... FROM public.orders WHERE id = v_existing_payment.order_id FOR UPDATE`
3. **Student Identity Resolution:** Queries `profiles` and `student_details` with fallback to `profiles.id`.
4. **Preflight Entitlement Check:** Reads student enrollment state before mutating state.
5. **Atomic Insertion Order:** `orders` $\rightarrow$ `order_items` $\rightarrow$ `payments` $\rightarrow$ `entitlements` $\rightarrow$ `invoices`.

If any step fails, the entire transaction is rolled back by PostgreSQL. Race conditions between concurrent webhooks or duplicate app retries are serialized on the `gateway_payment_id` payment row lock.

---

## 8. Checksum and Synchronization Verification

Both repository copies of Migration 248 were verified for exact byte-for-byte equality:

| File Path | SHA-256 Hash |
| :--- | :--- |
| `C:\Projects\mocktest-admin\supabase\migrations\248_apple_purchase_fulfillment.sql` | `725DA0E12FCF35E6B03C5C2514DE87D3ACE759705EE8DD2885B3ED069D287A18` |
| `C:\Projects\MockTestApp\supabase\migrations\248_apple_purchase_fulfillment.sql` | `725DA0E12FCF35E6B03C5C2514DE87D3ACE759705EE8DD2885B3ED069D287A18` |

Migration 247 was also verified:

| File Path | SHA-256 Hash |
| :--- | :--- |
| `C:\Projects\mocktest-admin\supabase\migrations\247_add_apple_payment_gateway_enum.sql` | `A4CDB7563DCF95BBB2833258F731809B962DF8C2643D11B2B1C3503B82A02139` |
| `C:\Projects\MockTestApp\supabase\migrations\247_add_apple_payment_gateway_enum.sql` | `A4CDB7563DCF95BBB2833258F731809B962DF8C2643D11B2B1C3503B82A02139` |

---

## 9. Remaining Limitations and Unresolved Business Decisions

1. **Client Refund / Chargeback Revocation (Phase 3+):**
   - In-app purchases may be refunded directly through Apple Support.
   - Handling automatic access revocation on refund requires implementing Apple Server Notifications V2 (`CONSUMPTION_REQUEST`, `REFUND`, `REVOKE` notifications).
   - Migration 248 correctly prevents re-fulfillment of already-refunded transactions (`TRANSACTION_REFUNDED`), but an external trigger or webhook is needed to flip `is_active = false` when Apple issues a refund.
2. **In-App Restore Purchases UX Flow:**
   - Apple App Store Guideline 3.1.1 requires a visible "Restore Purchases" button.
   - When a user taps "Restore Purchases", `getAvailablePurchases()` retrieves unfinished or non-consumable transactions. If the backend returns `already_enrolled_payment_recorded` or `purchase_recorded`, the mobile app must display a user-friendly confirmation ("Your purchases are restored and active").
3. **Multi-Tenant Institute Isolation:**
   - The RPC resolves the institute from the course/package first, then student profile, falling back to a global default. All orders and enrollments remain strictly scoped to the resolved institute ID.

---

## 10. Conclusion

Phase 2 database migrations are now complete, hardened, and synchronized across both repositories. The RPC guarantees that:
- Admin disciplinary revocations cannot be circumvented.
- SKU identifiers and environments are strictly verified.
- Replays, idempotency repairs, and cross-channel enrollments are handled cleanly and without data loss.

The backend database layer is fully ready for Phase 3 (Supabase Edge Function: `verify-apple-purchase`).
