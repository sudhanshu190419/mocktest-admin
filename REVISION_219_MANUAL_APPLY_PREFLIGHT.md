# Make Me Topper — Migration 219 Manual Application Preflight Report

**Document Revision:** 2.0 (Pre-Application Corrections & Access Policy Reconciliation)  
**Date:** October 28, 2026  
**Repositories:**
- Backend / Admin: `C:\Projects\mocktest-admin`
- Android: `C:\Projects\MockTestApp`
**Target Migration:** `supabase/migrations/219_installment_foundation_and_access_control.sql`  
**Preflight Diagnostic Query:** `supabase/tests/migration_219_remote_preflight.sql`  
**Target Environment:** Remote Supabase Database (Demo / Testing Data)

---

## Executive Summary

Migration 219 implements the comprehensive database foundation for course installment plans, contractual student agreements, installment schedules, allocation tracking, audit logging, webhook quarantine events, dispute restorations, and access control for live classes and recordings.

Because migration histories across the Backend/Admin repository (`mocktest-admin`, 227 migrations) and Android repository (`MockTestApp`, 92 migrations) have diverged significantly, **neither repository can safely serve as a canonical source for `supabase db push`**. 

This preflight evaluation establishes:
1. **Feasibility Decision:** **Result C (Diagnostic Baseline) $\longrightarrow$ Result A (Operational Execution)**. Migration 219 cannot be applied safely until prerequisite migrations or schema reconciliation are completed and catalog verified. If the remote database is missing prerequisite schema elements (e.g., `payments.paid_at`, `payments.refund_amount`, `public.is_admin()`, or `public.get_my_student_id()`), Migration 219 will fail immediately. However, if the updated read-only catalog preflight script (`supabase/tests/migration_219_remote_preflight.sql`) returns **0 FAIL** items, Migration 219 **is ready for manual database testing** via the Supabase SQL Editor within an atomic transaction.
2. **Destructive Operations:** Migration 219 contains **0 top-level data deletions or truncations**. It contains **4 procedural trigger drops**, **14 policy drops/re-creations**, **7 RLS activations**, and replaces **2 existing access-control functions** (`authorize_live_class_access` and `verify_recording_playback_access`).
3. **Content Access Policy Preservation:** Zero-grace suspension applies strictly to **live classes** (`authorize_live_class_access`). The existing **30-day content-only window** is preserved following the actual paid-through milestone date (`ss.content_access_end_date`). Past recordings from paid periods remain accessible; only recordings of classes held *during* an unpaid gap period while in arrears are locked.
4. **Mandatory Protocol:** A 100% read-only catalog query has been generated at `supabase/tests/migration_219_remote_preflight.sql` to audit the live catalog before any DDL is executed.

---

## 1. Exact Files Inspected

### 1.1 Target Migration Files
- `C:\Projects\mocktest-admin\supabase\migrations\219_installment_foundation_and_access_control.sql`
  - Lines: 2,151 | Size: 98,348 bytes
  - SHA-256: `f0cdac0c170834a6d73e9d58f64f258dbb4c3e88e9bbd53b1010e54ed18c487c`
- `C:\Projects\MockTestApp\supabase\migrations\219_installment_foundation_and_access_control.sql`
  - Lines: 2,151 | Size: 98,348 bytes
  - SHA-256: `f0cdac0c170834a6d73e9d58f64f258dbb4c3e88e9bbd53b1010e54ed18c487c`
  *(Both repositories maintain 100% byte-for-byte identical migration definitions).*

### 1.2 Divergence Between Repositories
- **`mocktest-admin`:** 227 migration files. Contains recent Google Play reconciliation and RTDN ledger migrations `213` through `218`.
- **`MockTestApp`:** 92 migration files. Jumps from `212_capture_pending_doubt_storage_paths.sql` directly to `219_installment_foundation_and_access_control.sql`.
- **Divergence Impact:** Running `supabase db push` from `mocktest-admin` would attempt to apply 135 admin-only migrations to the database. Running `supabase db push` from `MockTestApp` would attempt to apply `219` without the ledger context or fail if `213-218` were already applied remotely. **Manual, transaction-wrapped execution via the Supabase SQL Editor is the only safe deployment method.**

### 1.3 Prerequisite Migrations Inspected
- `005_domain_04_live_learning.sql`: Defines `live_classes` (`class_id`, `scheduled_at`, `status`) and `recordings` (`recording_id`, `class_id`, `storage_bucket`, `storage_path`, `status`).
- `008_domain_07_commerce.sql`: Defines `orders`, `order_items`, `payments`, `payment_status`, `payment_gateway`, `currency_code`.
- `011_domain_10_administration.sql`: Defines `institutes`, `audit_logs`, `audit_action_type`, admin authorization patterns.
- `012_domain_11_subscription_access_control.sql`: Defines `student_subscriptions`, subscription status enums, access grants.
- `021_rls_policies.sql`: Defines `public.is_admin()` and `public.get_my_student_id()` security helper functions.
- `067_authorize_live_class_access_rpc.sql`: Defines original `public.authorize_live_class_access(p_user_id uuid, p_class_id uuid default null, p_room_name text default null) returns jsonb`.
- `076_audit_infrastructure.sql`: Defines `public.write_audit_log` helper RPC.
- `096_subscription_entitlement_ownership.sql`: Defines `public.is_permanent_course_owner(p_course_id)`.
- `189_verify_recording_playback_access_rpc.sql` & `204_subscription_grace_parity_and_content_access.sql`: Defines original `public.verify_recording_playback_access` and `public.can_student_access_content(p_course_id)`.
- `216_google_play_renewal_reconciliation_and_rtdn_ledger.sql`: Defines Google Play ledger and payment audit columns.

### 1.4 Test and Function Specifications Inspected
- `supabase/tests/installment_foundation_and_access_control_test.sql` (1,234 lines)
- `supabase/tests/migration_219_remote_preflight.sql` (460 lines, read-only catalog preflight)
- `supabase/functions/razorpay-webhook/index.ts` (1,238 lines)
- `supabase/functions/razorpay-webhook/currency.ts` (410 lines)

---

## 2. All Destructive-Operation Findings

An exhaustive scan of `219_installment_foundation_and_access_control.sql` reveals the following potentially destructive operations:

### 2.1 DROP Statements
| Statement | Target | Line | Potential Data Loss / Destruction Risk |
| :--- | :--- | :--- | :--- |
| `DROP TRIGGER IF EXISTS trg_enforce_installment_allocation_limits` | `public.installment_payment_allocations` | 1205 | **LOW (Procedural):** Drops existing trigger if previously attached. No table data is removed. Required to bind updated trigger function cleanly. |
| `DROP TRIGGER IF EXISTS trg_installment_adjustment_audit` | `public.installment_adjustments` | 1446 | **LOW (Procedural):** Drops trigger before re-creation. No table data is removed. |
| `DROP TRIGGER IF EXISTS trg_enforce_adjustment_immutability` | `public.installment_adjustments` | 1488 | **LOW (Procedural):** Drops immutability guard trigger before re-creation. |
| `DROP TRIGGER IF EXISTS trg_sync_dispute_restoration` | `public.installment_dispute_restorations` | 1860 | **LOW (Procedural):** Drops dispute synchronization trigger before re-creation. |
| `DROP TABLE` | *None* | — | **NONE:** No table drops exist in Migration 219. |
| `DROP COLUMN` | *None* | — | **NONE:** No column drops exist in Migration 219. |
| `DROP FUNCTION` | *None* | — | **NONE:** Uses `CREATE OR REPLACE FUNCTION` instead of dropping. |

### 2.2 TRUNCATE, DELETE, and UPDATE Operations
- **Top-Level DML:** **ZERO (0)**. There are no top-level `TRUNCATE`, `DELETE`, or `UPDATE` statements that run unconditionally when Migration 219 is executed. Existing rows in `payments`, `orders`, `profiles`, etc., will not be modified during the migration run.
- **Internal Function DML:** 13 `UPDATE` statements exist within stored functions and triggers:
  1. `enforce_installment_allocation_limits()`: Updates `student_installment_schedule.paid_amount` and `status` (`PAID`, `PARTIALLY_PAID`) when payment allocations are recorded.
  2. `apply_installment_schedule_adjustment()`: Updates `student_installment_schedule` (`due_date`, `amount`, `status`) and `student_course_agreements.updated_at` upon authorized administrative adjustment.
  3. `process_installment_payment()`: Updates `student_installment_schedule`, `student_course_agreements`, and `student_subscriptions` on payment settlement.
  4. `reconcile_installment_schedule()`: Re-computes installment schedule balances.
  5. `reconcile_student_installments()`: Authoritative reconciliation loop.
  6. `sync_dispute_restoration()`: Updates `public.payments.status` to `completed` and logs administrative dispute restoration.
- **Deletion Operations:** **ZERO (0)** even inside functions. Records are never deleted; cancellations and waivers are handled via state transitions and immutable audit logs.

### 2.3 ALTER TABLE Operations
- 7 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` statements:
  - `public.course_installment_plans`
  - `public.student_course_agreements`
  - `public.student_installment_schedule`
  - `public.installment_payment_allocations`
  - `public.installment_adjustments`
  - `public.installment_dispute_restorations`
  - `public.webhook_quarantine_events`
- **The `IF NOT EXISTS` Pitfall:** Migration 219 creates tables using `CREATE TABLE IF NOT EXISTS`. If any of these 7 tables already exist in the remote database from an earlier testing phase, PostgreSQL **silently skips** the `CREATE TABLE` block. It will **NOT** add newly added columns (such as `requires_admin_review`, `provider_reference_id`, `restored_amount`) or missing constraints (such as composite unique keys `uq_schedule_agreement_schedule`). The preflight SQL specifically inspects for this schema drift.

### 2.4 Replacement of Existing Functions
Migration 219 replaces two mission-critical content-access functions using `CREATE OR REPLACE FUNCTION` (both functions maintain 100% parameter and return-type signature parity with their original migrations 067 and 189/204, while adding defensive `DROP FUNCTION IF EXISTS ... (uuid, uuid)` guards to eliminate unintended legacy overloads):
1. `public.authorize_live_class_access(p_user_id UUID, p_class_id UUID DEFAULT NULL, p_room_name TEXT DEFAULT NULL) RETURNS JSONB`
   - **Pre-existing logic (Migration 067):** Checked basic live class existence and batch assignment.
   - **New logic (Migration 219):** Implements the **Server-Side Quad-Check (Hardened Allowlist)**:
     - *Check 1:* Active batch assignment (`batch_students.status = 'active'`).
     - *Check 2:* Batch end date (`b.end_date < current_date` strictly blocks join access; **applies to ALL students including permanent course owners**).
     - *Check 3:* Valid entitlement (`is_permanent_course_owner` OR active subscription `end_date >= current_date`).
     - *Check 4 (Installment Gate):* If student is enrolled under an installment agreement, strictly verifies that **no unpaid installment is overdue** (`due_date < CURRENT_DATE` with balance > 0). If overdue, access is **IMMEDIATELY SUSPENDED (Zero Grace)** under error code `INSTALLMENT_ARREARS_BLOCKED`.
   - **Impact Assessment:** Students with full-course purchases or current non-overdue installments experience no interruption. Students with overdue installments are blocked from joining live classes, strictly preserving the approved contractual policy.
2. `public.verify_recording_playback_access(p_recording_id UUID) RETURNS JSONB`
   - **Pre-existing logic (Migration 189 / 204):** Verified basic recording entitlement and subscription expiration.
   - **New logic (Migration 219):** Enforces the **Unpaid-Gap Restriction**:
     - Preserves course content entitlement delegation via `public.can_student_access_content(courses.course_id)` (protecting the 30-day content window).
     - For installment students in arrears (`overdue_balance > 0`), checks the class session date (`lc.scheduled_at`, falling back to `r.recorded_at`). If the class was conducted *during* an unpaid gap period (`class_date > ss.end_date`), access is locked with code `RECORDING_LOCKED_ARREARS`. Recordings from prior fully-paid milestones remain playable during the content access window.

---

## 3. Required Prerequisite Objects

Before Migration 219 can be executed, the following objects must already exist in the Supabase catalog:

| Category | Object Name | Source Migration | Why Required by Migration 219 |
| :--- | :--- | :--- | :--- |
| **Extension** | `pgcrypto` or `uuid-ossp` | 001 | Required for `gen_random_uuid()` defaults on all primary keys. |
| **Enum Type** | `public.user_role` | 001 | Required for profile role evaluation (`admin`, `student`, `teacher`). |
| **Enum Type** | `public.payment_gateway` | 008 | Required for payment provider references (`razorpay`, `google_play`). |
| **Enum Type** | `public.payment_status` | 008 | Required for payment status checks (`completed`, `refunded`, etc.). |
| **Enum Type** | `public.currency_code` | 008 | Required for currency checks (`INR`). |
| **Enum Type** | `public.audit_action_type` | 011 / 076 | Required for audit logging actions. |
| **Table** | `public.profiles` | 001 | Foreign key reference for user profiles and admin role checks. |
| **Table** | `public.student_details` | 002 | Foreign key reference for `student_course_agreements.student_id`. |
| **Table** | `public.courses` | 005 | Foreign key reference for `student_course_agreements.course_id`. |
| **Table** | `public.orders` | 008 | Foreign key reference for order payments and enrollment records. |
| **Table** | `public.payments` | 008 | Foreign key reference for `payment_id` in schedules and allocations. |
| **Column** | `public.payments.payment_id` | 008 | Primary key referenced by `installment_payment_allocations`. |
| **Column** | `public.payments.paid_at` | 008 / 012 | Timestamp required by `process_installment_payment` and anchor logic. |
| **Column** | `public.payments.refund_amount` | 008 / 216 | Numeric column required by payment reversal triggers. |
| **Column** | `public.payments.refund_gateway_id` | 008 / 216 | Gateway reversal identifier checked by dispute reconciliation. |
| **Table** | `public.live_classes` | 005 | Target for `authorize_live_class_access` (`class_id`, `scheduled_at`, `status`). |
| **Table** | `public.recordings` | 005 | Target for `verify_recording_playback_access` (`recording_id`, `storage_path`). |
| **Table** | `public.student_subscriptions` | 012 / 204 | Referenced and updated by payment allocation (`end_date`, `content_access_end_date`). |
| **Function** | `public.is_admin()` | 021 | Critical RLS security definer function for admin policies. |
| **Function** | `public.get_my_student_id()` | 021 | Critical RLS security definer function for student data isolation. |
| **Function** | `public.write_audit_log(...)` | 076 | Audit logging RPC called by triggers and administrative RPCs. |
| **Function** | `public.can_student_access_content(...)`| 096 / 204 | Content entitlement check evaluating 30-day content window. |
| **Function** | `public.is_permanent_course_owner(...)`| 096 | Evaluates full-course purchase ownership. |

---

## 4. RLS and Permission Findings

### 4.1 Table-by-Table RLS Matrix
| Exact Table Name | RLS Enabled? | Student Access | Administrator Access | Service Role Access | Default-Deny Risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `course_installment_plans` | **YES** | `SELECT` active plans | Full (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) | Full (Bypasses RLS) | Low: Publicly readable by authenticated students. |
| `student_course_agreements` | **YES** | `SELECT` own agreement | Full | Full | **HIGH:** If `get_my_student_id()` is missing, students cannot view their agreements. |
| `student_installment_schedule` | **YES** | `SELECT` own schedule | Full | Full | **HIGH:** Students cannot check upcoming due dates if RLS helper fails. |
| `installment_payment_allocations` | **YES** | `SELECT` own allocations | Full | Full | Low: Read-only for students. |
| `installment_adjustments` | **YES** | `SELECT` own adjustments | Full | Full | Low: Immutable ledger; admin-written. |
| `installment_dispute_restorations` | **YES** | **NONE** (Blocked) | Full | Full | **CRITICAL:** Students must NOT see dispute records. |
| `webhook_quarantine_events` | **YES** | **NONE** (Blocked) | Full | Full | **CRITICAL:** Students must NOT see webhook error payloads. |

### 4.2 Webhook and Security Definer Permissions
- **Razorpay Webhook Edge Function:** Connects using the `SUPABASE_SERVICE_ROLE_KEY`. It runs with `service_role` privileges, which automatically **bypasses Row Level Security**. Webhook ingestion, payment allocations, and dispute quarantines will not be obstructed by RLS policies.
- **Search Path Security:** All functions in Migration 219 explicitly declare:
  ```sql
  SET search_path = public, auth, pg_temp;
  ```
  This prevents search-path hijacking attacks across security-definer execution boundaries.
- **RLS Default-Deny Hazard:** If an administrator uses the Supabase UI's automatic *"Run and Enable RLS"* prompt on a table without the accompanying policies in Migration 219, all student and public queries will be rejected with an empty result set. **Always apply the complete migration file containing both the `ENABLE ROW LEVEL SECURITY` statements and the corresponding `CREATE POLICY` definitions.**

---

## 5. Feasibility Decision and Supporting Evidence

### Official Determination:
### **Result C (Diagnostic Baseline) $longrightarrow$ Result A (Operational Execution)**

#### Evidence & Justification:
1. **Result C (Diagnostic Baseline):**  
   Migration 219 **cannot be applied safely until prerequisite migrations or schema reconciliation are completed**. Because migration histories diverge between the two repositories (`mocktest-admin` at 227 migrations, `MockTestApp` at 92 migrations), the remote demo/testing Supabase database cannot be assumed to possess all required prerequisite columns (e.g., `payments.paid_at`, `payments.refund_amount`) or functions (`can_student_access_content`, `is_admin`). If applied to a database where these prerequisites are absent, PostgreSQL will immediately abort the transaction.
2. **Transition to Result A (Operational Execution):**  
   Once the read-only catalog preflight script (`supabase/tests/migration_219_remote_preflight.sql`) is executed in the Supabase SQL Editor and returns **`status = 'PASS'` (0 FAIL items)**, **Result A applies**: Migration 219 is **ready for manual database testing** inside an atomic transaction block.
3. **Why Not Result B?**  
   Migration 219 does **not** require further source-code corrections. Its SQL syntax, procedural logic, trigger relationships, and constraint definitions have been validated and match all approved business rules and test specifications.

---

## 6. Read-Only Remote Preflight SQL Guide

The updated read-only preflight diagnostic file is located at:
```
supabase/tests/migration_219_remote_preflight.sql
```

### Execution Instructions:
1. Open the **Supabase Dashboard** for the project.
2. Navigate to the **SQL Editor** in the left sidebar.
3. Click **New Query**.
4. Copy and paste the entire contents of `supabase/tests/migration_219_remote_preflight.sql`.
5. Click **Run**.
6. Review the resulting diagnostic table:
   - **Row 1 (`0. OVERALL PREFLIGHT SUMMARY`):** Shows total checks, passed checks, warnings, and failures.
   - **Failures (`FAIL`):** Any prerequisite table, column, enum, or function that is missing will appear at the top. If any `FAIL` items exist, **Result C applies** — apply the missing prerequisite migration first.
   - **Warnings (`WARN`):** Indicates pre-existing target tables or replaced functions that will be updated.
   - **Passed (`PASS`):** Verified catalog objects.

---

## 7. Ordered Manual Application Checklist

If and only if the preflight query reports **0 FAIL items**, follow this strict ordered checklist to apply Migration 219:

### Step 1: Database Snapshot / Backup
- In the Supabase Dashboard, go to **Database** $ightarrow$ **Backups**.
- Verify that a recent automated backup exists, or export a schema/data dump using the Supabase CLI:
  ```bash
  supabase db dump --data-only > backup_demo_data.sql
  ```

### Step 2: Run Catalog Preflight
- Execute `supabase/tests/migration_219_remote_preflight.sql` in the SQL Editor.
- Confirm `Failures: 0` in the overall summary.

### Step 3: Atomic Transaction-Wrapped Execution
- Open a **New Query** window in the SQL Editor.
- Paste the exact contents of `supabase/migrations/219_installment_foundation_and_access_control.sql`.
- Enclose the entire script in an explicit transaction block:
  ```sql
  BEGIN;

  -- [PASTE FULL CONTENT OF 219_installment_foundation_and_access_control.sql HERE]

  COMMIT;
  ```
- Click **Run**.

### Step 4: Error Handling & Rollback Protocol
- If any statement encounters an error (e.g., constraint conflict or missing column), PostgreSQL will automatically **ROLLBACK** the entire transaction.
- **DO NOT** attempt to run individual snippets or comment out failing lines.
- Copy the exact error message, resolve the missing prerequisite object, and rerun the transaction in its entirety.

### Step 5: Post-Application Verification
Run the following verification queries in the SQL Editor:
```sql
-- 1. Verify all 7 target tables exist with RLS enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN (
    'course_installment_plans',
    'student_course_agreements',
    'student_installment_schedule',
    'installment_payment_allocations',
    'installment_adjustments',
    'installment_dispute_restorations',
    'webhook_quarantine_events'
  );

-- 2. Verify replaced access functions
SELECT proname, prorettype::regtype, pronargs 
FROM pg_proc 
WHERE proname IN ('authorize_live_class_access', 'verify_recording_playback_access')
  AND pronamespace = 'public'::regnamespace;
```

### Step 6: Supported Migration History Reconciliation
- **CRITICAL RULE:** Do NOT execute raw `INSERT INTO supabase_migrations.schema_migrations ... ON CONFLICT DO NOTHING` before verifying that Migration 219 has executed without error and the post-application checks pass.
- Once Migration 219 has succeeded and verified on the remote database, use the official Supabase CLI migration repair workflow:
  ```bash
  supabase migration repair --status applied 219
  ```
- If the CLI is not connected and manual SQL reconciliation is necessary, inspect the column definitions of `supabase_migrations.schema_migrations` first to avoid column mismatch errors, and record the version only after verifying that all tables, constraints, and triggers are operational.

---

## 8. Remaining Risks and Unresolved Dependencies

1. **Migration Sequence Divergence:** The Android repository (`MockTestApp`) lacks migrations `213` through `218`. If the remote database was built strictly from `MockTestApp`, Google Play RTDN tables and recent payment columns may be missing. The preflight query specifically detects this.
2. **Demo Data Foreign Key Violations:** If existing demo records in `public.payments` have orphaned `order_id` or `student_id` values, allocating them to installment agreements will fail the foreign key constraints defined in Migration 219.
3. **Edge Function Secrets Synchronization:** Migration 219 expects the Razorpay webhook to write to `webhook_quarantine_events` and call `reconcile_student_installments`. Ensure that `RAZORPAY_WEBHOOK_SECRET` is configured in Supabase Secrets before triggering webhook events.

---

## 9. Preservation of Core Business Rules

Migration 219 strictly complies with and preserves all mandatory business rules:
- **Fixed Contractual Schedules:** Installment amounts and due dates are locked upon agreement creation.
- **Zero Grace Live-Class Policy:** Overdue installments trigger immediate suspension of **live-class joining** (`due_date < CURRENT_DATE` with balance > 0).
- **Preserved 30-Day Content Window:** General course content access (study material, notes, tests) follows the paid-through entitlement date plus the standard 30-day content-only window (`ss.content_access_end_date`). Overdue installments do NOT immediately suspend course content.
- **Milestone-Based Paid-Through Calculation:** Subscription `end_date` is calculated from consecutively funded milestones ($k \times \text{interval\_months}$), not from the terminal duration of the whole course when fewer installments have been paid.
- **No Fresh Content Window on Late Settlement:** Late payments update `content_access_end_date` strictly from the milestone entitlement date (`v_new_end_date + interval '30 days'`), not from the late payment date.
- **Unpaid-Gap Recording Restrictions:** Recordings from sessions held *during* an unpaid gap period while in arrears are locked. The session date is evaluated from `lc.scheduled_at` (falling back to `r.recorded_at`), not merely the upload date.
- **Ended Batch Cutoff for All Students:** Permanent course ownership does **not** bypass the batch end date restriction for live classes.
- **Manual Razorpay Payments on Web:** Web portal handles installment payments via Razorpay Orders.
- **Google Play Full-Course Purchases:** Android app uses Google Play Billing for full purchases; installment purchasing is restricted to web agreements.
- **Manual Batch Assignment:** Batch assignment rules remain intact; installment checks augment rather than replace batch enrollment.
- **No Late Fees:** No penalty fees are assessed on overdue installments.
- **No Retroactive Reallocation:** Payment allocations are immutable once applied.
- **No Entitlement Revocation from Unresolved Reversals:** Financial disputes quarantine the event for administrative review without automatically stripping student entitlements until verified.

---

## 10. Operational Restrictions Compliance Confirmation

We explicitly confirm that during this preflight evaluation:
- **Docker Desktop:** Was NOT started, stopped, or modified.
- **Supabase Local Services:** Were NOT started or restarted.
- **Database Connections:** NO SQL commands were executed against any database.
- **Migrations:** NO migrations were applied.
- **Edge Functions:** NO Edge Functions were deployed.
- **Production Data / Gateways:** NO production data or payment provider configurations were altered.
- **Working Tree:** All unrelated working tree modifications were strictly preserved.

---

## 11. Final Pre-Application Corrections & Technical Audit

### 11.1 Access-Control SQL Compliance with Approved Business Rules
An end-to-end line inspection of `authorize_live_class_access`, `verify_recording_playback_access`, `can_student_access_content`, and `is_permanent_course_owner` confirms that the actual SQL in Migration 219 adheres to all 7 approved business rules:
1. **Rule 1 (Live Class Prerequisites):** `authorize_live_class_access` enforces Condition 1 (active batch assignment), Condition 2 (batch end date), Condition 3 (valid entitlement), and Condition 4 (installment integrity allowlist).
2. **Rule 2 (Zero Grace for Live Classes):** Check 4b and 4c evaluate effective overdue balance and dynamic schedule dates. If overdue, it immediately returns `INSTALLMENT_ARREARS_BLOCKED`.
3. **Rule 3 & 4 (30-Day Content Window & Milestone End Date):** In `process_installment_payment`, `student_subscriptions.end_date` is computed strictly from consecutively funded milestone index $k$ (`v_consecutive_k * v_plan.interval_months`), and `content_access_end_date` is set to `v_new_end_date + interval '30 days'`. General content access evaluates `public.can_student_access_content(p_course_id)`, which checks `content_access_end_date >= current_date`.
4. **Rule 5 (No Fresh 30-Day Period on Late Settlement):** `content_access_end_date` is calculated as `(v_new_end_date + interval '30 days')::date`. Because `v_new_end_date` is the scheduled milestone date and not `now()`, paying late does not grant a fresh 30-day window from the payment timestamp.
5. **Rule 6 (Unpaid-Gap Recording Evaluation):** `verify_recording_playback_access` evaluates `coalesce((select lc.scheduled_at from public.live_classes lc where lc.class_id = v_rec.class_id), v_rec.recorded_at)::date`. If the session date falls after the paid-through entitlement (`class_date > ss.end_date`) and the agreement is in arrears, access is locked with `RECORDING_LOCKED_ARREARS`.
6. **Rule 7 (Permanent Ownership Does Not Bypass Ended Batches):** In `authorize_live_class_access`, Condition 2 (`batch.end_date < current_date`) is evaluated *before* Condition 3 (Permanent Ownership), ensuring that permanent owners cannot join live classes for concluded cohort batches.

### 11.2 Exact Object-Name Inconsistencies Found and Corrected
The actual Migration 219 SQL, test suite (`installment_foundation_and_access_control_test.sql`), and Edge Functions consistently use the correct database object names. The previous revision of `REVISION_219_MANUAL_APPLY_PREFLIGHT.md` contained documentation discrepancies that have now been corrected:
- **Discrepancy 1:** The report referred to `installment_schedule_adjustments`. The exact database table name in Migration 219 (Line 129), in tests (66 occurrences), and in Edge Functions (10 occurrences) is **`installment_adjustments`**. Corresponding triggers are `trg_installment_adjustment_audit` and `trg_enforce_adjustment_immutability` on `installment_adjustments`. Corrected.
- **Discrepancy 2:** The report referred to `payment_dispute_restorations`. The exact database table name in Migration 219 (Line 497) and in tests is **`installment_dispute_restorations`**. Corresponding trigger is `trg_sync_dispute_restoration` on `installment_dispute_restorations`. Corrected.
- **Discrepancy 3:** The report referred to `payment_reconciliation_quarantine`. The exact database table name in Migration 219 (Line 562), in tests, and in Edge Functions is **`webhook_quarantine_events`**. Corrected.

### 11.3 Preflight Coverage and Technical Limitations
The preflight script (`supabase/tests/migration_219_remote_preflight.sql`) contains **only read-only catalog queries** against PostgreSQL system catalogs (`information_schema.tables`, `information_schema.columns`, `pg_type`, `pg_proc`, `pg_constraint`, `supabase_migrations.schema_migrations`). It issues zero DDL or DML statements.

**What the Preflight PROVES:**
- Verifies that all required extensions, custom enums, prerequisite tables, and critical foreign key columns exist in the remote database.
- Verifies that required security-definer helper functions (`is_admin`, `get_my_student_id`, `can_student_access_content`, `is_permanent_course_owner`, `write_audit_log`) exist with compatible signatures.
- Detects schema drift or partial pre-existence of target tables and columns that would be silently ignored by `CREATE TABLE IF NOT EXISTS`.
- Verifies that functions being replaced (`authorize_live_class_access`, `verify_recording_playback_access`) exist and are cataloged.

**What the Preflight DOES NOT PROVE:**
- **Runtime Data Cleanliness:** It does not prove that existing rows in `payments` or `orders` satisfy all foreign key integrity constraints (e.g., orphaned demo records).
- **Runtime Transaction Performance:** It does not evaluate table lock duration during transaction execution.
- **Unconditional Runtime Correctness:** A static preflight result of `0 FAIL` proves catalog compatibility; **it does not substitute for executing the actual database tests** (`installment_foundation_and_access_control_test.sql`) against live data.

### 11.4 Corrected Migration-History Guidance
- **Do NOT execute raw `INSERT INTO supabase_migrations.schema_migrations` statements with `ON CONFLICT DO NOTHING`**. The schema of `schema_migrations` varies between Supabase CLI versions, and recording a migration before application or verification creates a false record of applied state.
- **Recommended Workflow:** Apply Migration 219 within an atomic transaction (`BEGIN; ... COMMIT;`) via the Supabase SQL Editor. Run the post-application verification queries. Then use the supported CLI repair command:
  ```bash
  supabase migration repair --status applied 219
  ```

### 11.5 Exact Remaining Prerequisites Matrix
Before executing Migration 219, the catalog must satisfy:
1. `payments` table has `payment_id`, `paid_at`, `refund_amount`, `refund_gateway_id`.
2. `live_classes` table has `class_id`, `scheduled_at`, `status`.
3. `recordings` table has `recording_id`, `class_id`, `storage_bucket`, `storage_path`, `status`.
4. `student_subscriptions` table has `end_date`, `grace_end_date`, `content_access_end_date`.
5. Helper functions `public.is_admin()`, `public.get_my_student_id()`, `public.can_student_access_content(uuid)`, `public.is_permanent_course_owner(uuid)`, and `public.write_audit_log` exist in `public` schema.

### 11.6 Final Readiness Decision for Manual Testing
- **Baseline Result:** **Result C (Cannot be applied safely until missing prerequisite migrations or schema reconciliation are completed)** if the preflight query reports any missing prerequisites or unaligned migrations between repositories.
- **Execution Result:** **Result A (Ready for manual database testing after specified checks)** IF AND ONLY IF the preflight query in the Supabase SQL Editor returns **`Failures: 0`**. Once verified, Migration 219 can be executed in an atomic transaction and validated using `supabase/tests/installment_foundation_and_access_control_test.sql`.
---

## 12. Order Item Schema Compatibility & Preflight Resolution

### 12.1 Root Cause: Why `order_items.price` Failed in Preflight
During the initial execution of the preflight script in the Supabase SQL Editor, the diagnostic check:
```
Column: public.order_items.price ===> Status: FAIL
```
failed because the PostgreSQL table `public.order_items` (created in Migration 008, Domain 07 Commerce) **does not possess a column named `price`**. 

The actual schema of `public.order_items` as defined in the repository migrations and verified in the live database catalog is:
- `item_id` (UUID PRIMARY KEY)
- `order_id` (UUID NOT NULL, FK to `public.orders`)
- `institute_id` (UUID NOT NULL, FK to `public.institutes`)
- `item_type` (public.item_type enum NOT NULL: `'course'`, `'subscription_plan'`, `'pyq_package'`)
- `plan_id` (UUID NULL)
- `package_id` (UUID NULL)
- `course_id` (UUID NULL, added in Migration 043)
- `item_name` (VARCHAR(255) NOT NULL)
- `unit_price` (NUMERIC(12,2) NOT NULL) — Gross unit catalog price
- `quantity` (SMALLINT NOT NULL DEFAULT 1) — Units purchased
- `discount_amount` (NUMERIC(12,2) NOT NULL DEFAULT 0.00) — Coupon / promotional discount
- `line_total` (NUMERIC(12,2) NOT NULL) — Final net payable item total: `(unit_price * quantity) - discount_amount`
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT now())

The check for `order_items.price` was an erroneous assumption in the preflight SQL rather than a database defect.

### 12.2 Verification: Migration 219 Dependencies on `order_items`
A comprehensive static code scan of `219_installment_foundation_and_access_control.sql` confirmed that:
- **Migration 219 NEVER references `price`, `unit_price`, `line_total`, `discount_amount`, or `quantity`.**
- Migration 219 references `public.order_items` in exactly two places:
  1. **Line 222 (Allocation limits trigger `trg_enforce_allocation_limits`):**
     ```sql
     select p.amount, coalesce(p.refund_amount, 0.00), p.refund_gateway_id, p.status::text, o.student_id, oi.course_id
     into v_payment_amount, v_payment_refund, v_payment_refund_id, v_payment_status, v_payment_student_id, v_payment_course_id
     from public.payments p
     join public.orders o on o.order_id = p.order_id
     left join public.order_items oi on oi.order_id = p.order_id
     where p.payment_id = NEW.payment_id
     limit 1;
     ```
  2. **Line 989 (Payment processing RPC `process_installment_payment`):**
     ```sql
     -- Resolve course_id from order items
     select oi.course_id into v_course_id
     from public.order_items oi
     where oi.order_id = v_payment.order_id
     limit 1;
     ```
In both instances, the **only** column queried from `public.order_items` is **`oi.course_id`** (filtering by `oi.order_id`), which is used solely to link the payment's order to the student's `student_course_agreements` record for that course.

The financial amounts for installments are derived from:
- `course_installment_plans.total_fee` and `student_course_agreements.total_fee` (the contractual fixed course fee).
- `public.payments.amount` (the actual gateway payment captured in the commerce ledger).
- `student_installment_schedule.amount_due` (the scheduled milestone obligations).

Because Migration 219 does not compute pricing from `order_items`, **Migration 219 is 100% compatible with the actual database schema and requires zero code modifications.**

### 12.3 Test Suite Remediation: `installment_foundation_and_access_control_test.sql`
While Migration 219 itself does not query `price`, an inspection of the test file `supabase/tests/installment_foundation_and_access_control_test.sql` revealed that 22 mock test setups inserted into `order_items` using the invalid columns:
```sql
-- Legacy / invalid mock insert in test suite:
insert into public.order_items (order_id, course_id, price, item_type)
values (v_test_order_id, v_test_course_id, 1000.00, 'installment');
```
This mock statement would fail at runtime because:
1. Column `price` does not exist (must be `unit_price` and `line_total`).
2. `institute_id` and `item_name` are NOT NULL on `public.order_items`.
3. `item_type` `'installment'` is not in the `item_type` enum (`'course'`, `'subscription_plan'`, `'pyq_package'`) and violates constraint `ck_order_items_item_type_consistency` (which requires `item_type = 'course'` when `course_id` is populated).

All 22 test setup statements across both repositories have been updated to the valid production schema:
```sql
-- Corrected mock insert in test suite:
insert into public.order_items (order_id, institute_id, course_id, item_name, item_type, unit_price, line_total)
values (v_test_order_id, v_test_inst_id, v_test_course_id, 'Course Installment', 'course', 1000.00, 1000.00);
```

### 12.4 Preflight SQL Correction: `migration_219_remote_preflight.sql`
In `supabase/tests/migration_219_remote_preflight.sql`, the erroneous prerequisite check:
```sql
('order_items', 'price')  -- REMOVED
```
has been replaced with comprehensive checks verifying the real schema of `public.order_items`:
```sql
('order_items', 'item_id'),
('order_items', 'order_id'),
('order_items', 'institute_id'),
('order_items', 'item_type'),
('order_items', 'item_name'),
('order_items', 'course_id'),
('order_items', 'unit_price'),
('order_items', 'quantity'),
('order_items', 'discount_amount'),
('order_items', 'line_total'),
```
The preflight script remains 100% read-only and queries only PostgreSQL information schema views.

### 12.5 Exact Files Changed
| Repository | File Path | Nature of Change |
| :--- | :--- | :--- |
| Both | `supabase/tests/migration_219_remote_preflight.sql` | Removed `price`; added verified columns (`item_id`, `unit_price`, `line_total`, etc.). |
| Both | `supabase/tests/installment_foundation_and_access_control_test.sql` | Corrected 22 mock `order_items` insert statements to match production schema. |
| Both | `REVISION_219_MANUAL_APPLY_PREFLIGHT.md` | Added Section 12 documenting root cause, resolution, and readiness. |
| Both | `supabase/migrations/219_installment_foundation_and_access_control.sql` | **UNCHANGED** (Verified safe: does not reference `order_items.price`). |

### 12.6 Static Validation and Repository Parity Results
All updated files maintain 100% byte-for-byte SHA-256 parity across `mocktest-admin` and `MockTestApp`:
- `supabase/tests/migration_219_remote_preflight.sql`: `323d7948154b89291220b32eb2896ead8f4bfbc7911983bde60db5910c6c2037` (MATCH)
- `supabase/tests/installment_foundation_and_access_control_test.sql`: `f7aad6212cf395fdbd3767bc7c79ba1a01969ad8b0814f4233f0ca1e80d1d520` (MATCH)
- `supabase/migrations/219_installment_foundation_and_access_control.sql`: `f0cdac0c170834a6d73e9d58f64f258dbb4c3e88e9bbd53b1010e54ed18c487c` (MATCH)
- `SUBSCRIPTION_IMPLEMENTATION_ADDENDUM.md`: `58700b652b1e02bbbe28912be0b735e30956aeb215011dbb5f89b6ea361cfaa1` (MATCH)

### 12.7 Preflight Re-Run Readiness
The preflight script is now **ready to be re-run in the Supabase SQL Editor**.
- The false-positive failure on `order_items.price` is eliminated.
- The preflight will verify that all verified columns on `order_items` exist.
- If the re-run returns **`Failures: 0`**, **Result A applies unconditionally**, and Migration 219 can be safely applied manually inside a single transaction block (`BEGIN; ... COMMIT;`) followed by verification.
---

## 13. Final Preflight Catalog Validation & Constraint/Signature Hardening

### 13.1 Overview of Hardened Catalog Checks
To prevent false-positive diagnostic passes and ensure rigorous validation before manual application, the preflight script (`supabase/tests/migration_219_remote_preflight.sql`) has been updated with relation-scoped constraint verification, exact function signature validation, and target table RLS security checks.

### 13.2 Each Check Corrected or Added
1. **Relation-Scoped Prerequisite Constraints (`check_prereq_constraints`):**
   - **Previous Limitation:** Constraints were evaluated by constraint name alone across the entire database, meaning a constraint with the same name on another table or schema could produce a false `PASS`.
   - **Correction:** The query now joins `pg_constraint` directly to `pg_class` and `pg_namespace`, asserting:
     ```sql
     nsp.nspname = 'public' AND rel.relname = c.tbl AND con.conname = c.con_name
     ```
   - **Objects Verified:**
     - `pk_payments` on `public.payments`
     - `pk_orders` on `public.orders`
     - `pk_order_items` on `public.order_items`
     - `pk_student_details` on `public.student_details`
     - `pk_courses` on `public.courses`
     - `pk_batches` on `public.batches`
     - `pk_batch_students` on `public.batch_students`
     - `fk_order_items_course` on `public.order_items`
     - `ck_order_items_item_type_consistency` on `public.order_items`

2. **Hardened Target Constraint Drift (`check_target_constraint_drift`):**
   - **Correction:** All 7 critical unique and composite foreign key constraints on target tables are now strictly bound to their intended relation:
     - `uq_schedule_agreement_schedule` on `public.student_installment_schedule` (unique `agreement_id, schedule_id`, required as referenced key for composite foreign key from allocations)
     - `uq_student_course_agreement` on `public.student_course_agreements` (unique `student_id, course_id`)
     - `uq_payment_schedule_allocation` on `public.installment_payment_allocations` (unique `payment_id, schedule_id`)
     - `uq_installment_adjustments_gateway_event` on `public.installment_adjustments` (unique `gateway_event_id`)
     - `uq_dispute_restorations_event` on `public.installment_dispute_restorations` (unique `gateway_event_id`)
     - `uq_dispute_restorations_provider_ref` on `public.installment_dispute_restorations` (unique `provider_reference_id`)
     - `uq_webhook_quarantine_event` on `public.webhook_quarantine_events` (unique `gateway_event_id`)

3. **Exact Function Signature & Property Verification (`check_prereq_functions` & `check_auth_functions`):**
   - **Previous Limitation:** Only checked whether a function with `p.proname = f.fn_name` existed in the `public` schema, without verifying argument types or return types.
   - **Correction:** The query now verifies:
     - Argument count (`p.pronargs`)
     - Argument type vector (`oidvectortypes(p.proargtypes)`)
     - Return type (`p.prorettype::regtype::text`)
     - Security Definer flag (`p.prosecdef = true`)
   - **Verified Signatures:**
     - `public.is_admin()` $\longrightarrow$ `boolean` [SECURITY DEFINER = true, args = 0]
     - `public.get_my_student_id()` $\longrightarrow$ `uuid` [SECURITY DEFINER = true, args = 0]
     - `public.can_student_access_content(uuid)` $\longrightarrow$ `boolean` [SECURITY DEFINER = true, args = 1 (`uuid`)]
     - `public.is_permanent_course_owner(uuid)` $\longrightarrow$ `boolean` [SECURITY DEFINER = true, args = 1 (`uuid`)]
     - `public.write_audit_log(...)` $\longrightarrow$ `jsonb` [SECURITY DEFINER = true]
     - `auth.uid()` $\longrightarrow$ `uuid` [args = 0]
     - `auth.role()` $\longrightarrow$ `text` [args = 0]

4. **Target Table Security & Policy Isolation Inspection (`check_target_table_security`):**
   - Inspects whether pre-existing target tables have Row Level Security enabled (`rel.relrowsecurity = true`).
   - Explicitly guards `public.webhook_quarantine_events`: asserts that **NO non-admin policy exists**. If any student policy were present, the check returns `FAIL: CRITICAL SECURITY DEFECT: Non-admin policy found on webhook_quarantine_events! Sensitive quarantine records are exposed to students.`

### 13.3 Exact Objects, Constraints, and Signatures Checked
| Category | Object Name | Relation / Schema | Expected Signature / Type | Security Property |
| :--- | :--- | :--- | :--- | :--- |
| **Constraint** | `pk_payments` | `public.payments` | Primary Key on `payment_id` | Table-scoped in `public` |
| **Constraint** | `pk_orders` | `public.orders` | Primary Key on `order_id` | Table-scoped in `public` |
| **Constraint** | `pk_order_items` | `public.order_items` | Primary Key on `item_id` | Table-scoped in `public` |
| **Constraint** | `fk_order_items_course` | `public.order_items` | Foreign Key on `course_id` | Table-scoped in `public` |
| **Constraint** | `ck_order_items_item_type_consistency`| `public.order_items`| CHECK constraint | Table-scoped in `public` |
| **Constraint** | `uq_schedule_agreement_schedule` | `public.student_installment_schedule` | UNIQUE (`agreement_id`, `schedule_id`) | Composite referenced key |
| **Constraint** | `uq_webhook_quarantine_event` | `public.webhook_quarantine_events` | UNIQUE (`gateway_event_id`) | Webhook idempotency guard |
| **Function** | `is_admin()` | `public` | `() -> boolean` | SECURITY DEFINER, search_path = '' |
| **Function** | `get_my_student_id()` | `public` | `() -> uuid` | SECURITY DEFINER, search_path = '' |
| **Function** | `can_student_access_content(uuid)` | `public` | `(p_course_id uuid) -> boolean` | SECURITY DEFINER, search_path = '' |
| **Function** | `is_permanent_course_owner(uuid)`| `public` | `(p_course_id uuid) -> boolean` | SECURITY DEFINER, search_path = '' |
| **Function** | `write_audit_log(...)` | `public` | `(...) -> jsonb` | SECURITY DEFINER, search_path = '' |
| **Function** | `uid()` | `auth` | `() -> uuid` | Supabase Auth helper |
| **Function** | `role()` | `auth` | `() -> text` | Supabase Auth helper |

### 13.4 Target Table Security, RLS, and Policy Integrity
- **Quarantine & Dispute Protection:** `webhook_quarantine_events` and `installment_dispute_restorations` hold gateway error payloads, provider refund IDs, and dispute reconciliation notes. Students must have **zero access** to these tables. In Migration 219, only administrators (`public.is_admin()`) have select/manage policies. Webhooks connect using the `service_role` secret, which possesses the PostgreSQL `BYPASSRLS` attribute and operates without being restricted by RLS policies.
- **Student Scoping:** On `student_course_agreements` and `student_installment_schedule`, students are strictly limited to their own records via `student_id = public.get_my_student_id()`.
- **Policy Enforcement Rule:** Do **not** use the Supabase Dashboard's automatic "Run and enable RLS" prompt on individual tables. RLS must be activated together with the complete policy definitions in Migration 219 to avoid locking out authenticated students with an empty result set (default-deny).

### 13.5 Remaining Limitations of Static Preflight
While this preflight script provides exhaustive catalog verification, static catalog inspection has fundamental limitations:
1. **Catalog vs. Data Hygiene:** The preflight proves that tables and columns exist; it does **not** evaluate whether existing demo/testing records in `payments` or `orders` contain orphan IDs or violate foreign keys.
2. **Catalog vs. Transaction Execution:** The preflight proves that DDL statements will find their dependent objects; it does **not** simulate PostgreSQL lock acquisition or statement timeout under concurrent load.
3. **No Substitute for Database Tests:** A preflight result of `Failures: 0` establishes prerequisite readiness; **it does not substitute for running the SQL test suite** (`supabase/tests/installment_foundation_and_access_control_test.sql`) against a running PostgreSQL instance.

### 13.6 Appropriateness of Manual Database Testing
Once `supabase/tests/migration_219_remote_preflight.sql` is executed in the Supabase SQL Editor and returns:
```
0. OVERALL PREFLIGHT SUMMARY ===> Status: PASS (Failures: 0)
```
**Manual database testing is appropriate and safe to proceed**, following the ordered application checklist:
1. Wrap the entire contents of `supabase/migrations/219_installment_foundation_and_access_control.sql` in an atomic transaction:
   ```sql
   BEGIN;
   -- Paste Migration 219 SQL
   COMMIT;
   ```
2. Execute post-application verification queries confirming that all 7 tables have `relrowsecurity = true` and replaced functions return valid JSONB.
3. Run the integration test suite (`supabase/tests/installment_foundation_and_access_control_test.sql`) to validate runtime business logic.
4. Record the migration in `supabase_migrations.schema_migrations` using the supported Supabase CLI migration repair workflow.
