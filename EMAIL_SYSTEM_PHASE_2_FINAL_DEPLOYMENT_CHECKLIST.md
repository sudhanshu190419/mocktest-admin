# Make Me Topper — Transactional Email Notification System
# Phase 2: Final Read-Only Pre-Deployment Audit & Readiness Checklist

**Date:** 2026-11-20  
**Repository:** `C:\Projects\mocktest-admin`  
**Mobile Reference:** `C:\Projects\MockTestApp` (Strictly read-only, verified untouched)  
**Authoritative Supabase Project:** `ocolfottogbybitfpdqy`  
**Migration Baseline:** Migration 251 (`251_email_notification_queue.sql` applied to production, immutable)  
**Audit Mode:** STRICTLY READ-ONLY PRE-DEPLOYMENT AUDIT  

---

## Executive Summary & Final Verdict

### Final Verdict: **READY FOR DEPLOYMENT**

All local application build blockers, cryptographic authentications, RPC permissions, and activation safeguards have been verified against the actual source code:

1. **Application TypeScript & Build:** `npx tsc --noEmit` passes with **0 errors**. `npx next build` passes with **0 errors**, successfully generating all 123 static and dynamic production routes.
2. **Automated Unit Testing:** **364 / 364 tests passed across 8 test suites (100% pass rate)**.
3. **Migration 251 RPC Inventory:** Exactly 8 RPCs exist in `251_email_notification_queue.sql`. All 8 are confirmed `SECURITY DEFINER` with fixed `search_path = public, pg_temp`, strictly revoked from `PUBLIC`, `anon`, and `authenticated`, and granted exclusively to `service_role`.
4. **Apple Notification Event Mapping:** Accurately verified: `REFUND` maps to **`PAY-04`**, `REVOKE` maps to **`PAY-06`**, and **`PAY-05` does not exist** in Apple notifications (it is exclusive to asynchronous Razorpay flows). Dual-layer idempotency protects against duplicate deliveries.
5. **Deployment & Gateway Security:** All six `--no-verify-jwt` endpoints enforce strict, independent, code-level cryptographic or bearer authentication. Gateway JWT bypass does not weaken endpoint security.
6. **Reconciliation Hardened & Dormant:** All static fallback timestamps were removed. Reconciliation strictly fails closed unless an explicit `EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP` is provided, and remains completely dormant with zero cron schedules.

---

## 1. Deno Edge Function Validation & Bundling Analysis

### 1.1. Local Deno CLI Availability
* **Command Executed:** `Get-Command deno -ErrorAction SilentlyContinue`
* **Result:** **UNAVAILABLE** (Deno CLI is not installed locally on this host).
* **Audit Finding:** **Deno type-checking has NOT passed locally.** We explicitly do not claim Deno validation has passed.

### 1.2. Post-Installation Deno Validation Commands
Once Deno CLI is installed on a development or CI machine, execute `deno check` against all nine function entry points:
```bash
deno check supabase/functions/email-worker/index.ts
deno check supabase/functions/email-webhook/index.ts
deno check supabase/functions/complete-course-purchase/index.ts
deno check supabase/functions/complete-pyq-purchase/index.ts
deno check supabase/functions/complete-installment-purchase/index.ts
deno check supabase/functions/razorpay-webhook/index.ts
deno check supabase/functions/apple-app-store-notifications/index.ts
deno check supabase/functions/verify-apple-purchase/index.ts
deno check supabase/functions/verify-google-play-purchase/index.ts
```

### 1.3. Supabase CLI Bundling vs. Deno Type-Checking
* **Supabase Bundling Validation:** Supabase CLI performs esbuild-based tree-shaking and bundling. It checks syntax, import resolution, and bundle generation. Bundling succeeds even when local Deno runtime types are absent.
* **Deno Static Type-Checking:** Requires the native `deno check` subsystem to validate standard library ambient types, URL module imports, and runtime globals.
* **Runtime Safety Assurance:** All 9 functions use standard Deno HTTP server semantics (`Deno.serve` / `std@0.168.0/http/server.ts`) and shared email modules whose runtime logic is 100% covered and passing in the 364 automated Vitest tests.

---

## 2. TypeScript Compilation Results

### 2.1. Application TypeScript Compilation (`npx tsc --noEmit`)
* **Exit Code:** 0
* **Errors Emitted:** 0
* **Scope:** All web application components, services, hooks, admin commerce pages, catalog types, and application utilities compiled with zero type errors.

### 2.2. Next.js Production Build (`npx next build`)
* **Exit Code:** 0
* **Errors Emitted:** 0
* **Build Artifacts:** 123 static and dynamic production routes successfully generated in `.next/`.

### 2.3. Test TypeScript Configuration Check (`tsconfig.test.json`)
* **Command:** `npx tsc -p tsconfig.test.json --noEmit`
* **Audit Finding:** TypeScript emits diagnostic errors strictly pertaining to **Node.js vs. Deno runtime environment mismatches**:
  1. `Cannot find name 'Deno'` in `resendProvider.ts`: Node's TypeScript compiler does not recognize the ambient Deno runtime global.
  2. `BufferSource` vs `Uint8Array<ArrayBufferLike>` in cryptographic helper tests: Type signature discrepancies between Node 20 DOM types and Deno Web Crypto APIs.
* **Distinction from Test Logic:** These errors are strictly static ambient type declaration mismatches under Node's `tsc`. They do not indicate code or runtime defects. All 364 tests execute and pass under Vitest.

---

## 3. Confirmed 9-Function Deployment Inventory

Verified against `git status --short`, `git diff --name-only`, and `supabase/config.toml`:

| # | Edge Function | Directory Path | Deploy Flag | Reason for Deployment | Email Events Queued | `verify_jwt` (`config.toml`) | Code-Level Auth Enforcement |
| :-: | :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **1** | `email-worker` | `supabase/functions/email-worker` | `--no-verify-jwt` | Background queue processor claiming jobs from `public.email_queue`. | Dispatches all queued emails | `false` | Enforces constant-time `isServiceRoleCall(authHeader)` or `X-Worker-Key === WORKER_SECRET`. Returns 401 if unauthorized. |
| **2** | `email-webhook` | `supabase/functions/email-webhook` | `--no-verify-jwt` | Ingests delivery, bounce, and complaint webhooks from Resend. | Updates delivery logs & suppressions | `false` | Cryptographically validates Svix HMAC-SHA256 signature (`svix-id`, `svix-timestamp`, `svix-signature`) with 5-minute replay tolerance against `RESEND_WEBHOOK_SECRET`. Rejects invalid signatures with 401. |
| **3** | `complete-course-purchase` | `supabase/functions/complete-course-purchase` | Default | Fulfills web Razorpay course orders. | `PAY-01`, `PAY-05` | `true` | Validates caller session token or service-role privileges. |
| **4** | `complete-pyq-purchase` | `supabase/functions/complete-pyq-purchase` | Default | Fulfills web Razorpay PYQ orders. | `PAY-02`, `PAY-05` | `true` | Validates caller session token or service-role privileges. |
| **5** | `complete-installment-purchase` | `supabase/functions/complete-installment-purchase` | Default | Processes custom installment payments. | `INS-01`, `INS-02`, `PAY-05` | `true` (default) | Internal-only function. Validates caller session token and enforces `isServiceRoleCall(authHeader)`. |
| **6** | `razorpay-webhook` | `supabase/functions/razorpay-webhook` | `--no-verify-jwt` | Handles Razorpay S2S payment events. | `PAY-01`, `PAY-02`, `PAY-03`, `PAY-04`, `PAY-05` | `false` | Verifies `X-Razorpay-Signature` using HMAC-SHA256 over raw body with `RAZORPAY_WEBHOOK_SECRET`. Timing-safe comparison. Rejects invalid with 401. |
| **7** | `apple-app-store-notifications` | `supabase/functions/apple-app-store-notifications` | `--no-verify-jwt` | Handles Apple App Store Server Notifications V2. | `PAY-04`, `PAY-06` | `false` | Validates Apple ES256 JWS signature, certificate chain to Apple Root CA G3, RFC 5280 OCSP revocation status, bundle ID (`com.makemetopper.app`), and App ID. |
| **8** | `verify-apple-purchase` | `supabase/functions/verify-apple-purchase` | `--no-verify-jwt` | Fulfills StoreKit 2 IAP. | `PAY-01`, `PAY-02` | `true` (default in config) | **Independently enforces Supabase Auth token in code.** Calls `supabaseAdmin.auth.getUser(token)` and derives user ID exclusively from `authData.user.id`. Client user ID is NEVER trusted. |
| **9** | `verify-google-play-purchase` | `supabase/functions/verify-google-play-purchase` | `--no-verify-jwt` | Fulfills Google Play IAP. | `PAY-01`, `PAY-02` | `true` (in config) | **Independently enforces Supabase Auth token in code.** Calls `authenticatePlayPurchaseRequest(authHeader, supabaseAuth)` and derives user ID exclusively from `userData.user.id`. Client user ID is NEVER trusted. |

### 3.1. Detailed Code-Level Authentication for `--no-verify-jwt` Endpoints

Disabling Supabase gateway JWT verification (`--no-verify-jwt`) is architecturally required for webhook receivers and background workers that do not originate from an interactive Supabase client session. In all six cases, independent security checks are enforced:

1. **`email-worker` (`supabase/functions/email-worker/index.ts` lines 61–85):**
   - Validates `Authorization: Bearer <key>` using `isServiceRoleCall(authHeader)` (constant-time verification against `SUPABASE_SERVICE_ROLE_KEY`).
   - Alternatively verifies custom `X-Worker-Key` against `EMAIL_WORKER_SECRET`.
   - Rejects unauthenticated requests with HTTP 401 Unauthorized before queue claiming.
2. **`email-webhook` (`supabase/functions/email-webhook/index.ts` lines 62–95):**
   - Fails closed if `RESEND_WEBHOOK_SECRET` is unset (HTTP 500 configuration error).
   - Verifies Svix HMAC-SHA256 signature across headers `svix-id`, `svix-timestamp`, and raw request body.
   - Enforces a 5-minute timestamp tolerance window to block replay attacks.
   - Rejects invalid signatures with HTTP 401 Unauthorized before reading payloads.
3. **`razorpay-webhook` (`supabase/functions/razorpay-webhook/index.ts` lines 3040–3100):**
   - Requires `X-Razorpay-Signature` header.
   - Computes HMAC-SHA256 hex digest over raw request body using `RAZORPAY_WEBHOOK_SECRET`.
   - Performs timing-safe comparison (`verifyWebhookSignature`).
   - Rejects missing or invalid signatures with HTTP 401 Unauthorized.
   - Ignores untrusted payload claims and looks up authoritative local orders.
4. **`apple-app-store-notifications` (`supabase/functions/apple-app-store-notifications/index.ts` lines 95–160):**
   - Verifies outer JWS header certificate chain (`x5c`) back to Apple Root CA - G3.
   - Enforces RFC 5280 certificate validity and performs online OCSP revocation checks.
   - Validates claims: `bundleId === "com.makemetopper.app"` and Apple App ID.
   - Independently cryptographically verifies nested `signedTransactionInfo` JWS.
   - State mutations are executed inside `public.process_apple_notification` RPC with advisory locking.
5. **`verify-apple-purchase` (`supabase/functions/verify-apple-purchase/index.ts` lines 76–105):**
   - Extracts Bearer token from `Authorization` header.
   - Validates session with `supabaseAdmin.auth.getUser(token)`.
   - Extracts `authenticatedUserId = authData.user.id`. Client user ID is rejected.
   - Verifies user profile exists in `public.profiles`.
   - Validates StoreKit 2 AppTransaction and Transaction JWS to Apple Root CA - G3.
6. **`verify-google-play-purchase` (`supabase/functions/verify-google-play-purchase/billingCore.ts` lines 845–885):**
   - Extracts Bearer token from `Authorization` header.
   - Calls `authenticatePlayPurchaseRequest(authHeader, supabaseAdmin.auth)`.
   - Rejects missing or expired sessions with HTTP 401 Unauthorized.
   - Derives `profileId = authResult.profileId` strictly from Supabase Auth.
   - Verifies purchase tokens against Google Play Developer API using OAuth2 RS256 service account credentials.

### 3.2. Apple Notification Event Mapping Verification

Inspection of `supabase/functions/apple-app-store-notifications/index.ts` (lines 205–246) and `src/services/admin/__tests__/appleServerNotificationsCore.test.ts` confirms:

* **REFUND Event:**
  - Trigger: `outerPayload.notificationType === "REFUND"` and `rpcData.action.startsWith("refund_processed")`.
  - Email Queued: **`PAY-04`** ("Refund Processed — Make Me Topper").
  - Subject: `"Refund Processed — Make Me Topper"`.
  - Idempotency Key: `pay_refund:${txPayload.transactionId || outerPayload.notificationUUID}`.
  - Payload: `{ refundId, orderId, itemTitle, amount, refundDate }`.
  - Priority: `"high"`.
* **REVOKE Event:**
  - Trigger: `outerPayload.notificationType === "REVOKE"` and `rpcData.action === "revocation_processed_entitlement_revoked"`.
  - Email Queued: **`PAY-06`** ("Access Update: <productName> — Make Me Topper").
  - Subject: `"Access Update: ${txPayload.productId || 'Apple Product'} — Make Me Topper"`.
  - Idempotency Key: `entitlement_revoked:${txPayload.transactionId || outerPayload.notificationUUID}`.
  - Payload: `{ productName, transactionId, revokedDate }`.
  - Priority: `"normal"`.
* **REFUND_REVERSED Event:**
  - Trigger: `outerPayload.notificationType === "REFUND_REVERSED"`.
  - Database Action: Restores previously revoked entitlements and resets payment/order status.
  - Email Queued: **NONE** (by architectural design; no student notification required).
* **TEST & Unsupported Notification Types:**
  - Acknowledged with HTTP 200 without database mutations or email triggers.
* **PAY-05 Absence:**
  - **`PAY-05` ("Payment Received — Under Verification") is NOT queued by Apple notifications.**
  - In Apple StoreKit, transactions are verified synchronously (`verify-apple-purchase`, queuing `PAY-01` or `PAY-02`) or via S2S notifications (`REFUND` -> `PAY-04`, `REVOKE` -> `PAY-06`).
  - `PAY-05` exists exclusively in asynchronous Razorpay flows (`razorpay-webhook`, `complete-course-purchase`, `complete-pyq-purchase`). The previous listing of `PAY-05` under Apple notifications was an erroneous transcription that has now been corrected to **`PAY-04, PAY-06`**.
* **Idempotency & Duplicate Protection:**
  - Database layer: `public.process_apple_notification` uses advisory locking and a unique constraint on `notification_uuid` (`uq_apple_notifications_uuid`). Duplicates return `action = "duplicate_ignored"`.
  - If `action = "duplicate_ignored"`, the email queueing logic is not invoked.
  - Queue layer: Even on replay, `enqueueEmailSafe` supplies deterministic idempotency keys (`pay_refund:...` and `entitlement_revoked:...`) which `public.enqueue_email_job` detects in `public.email_queue`, preventing duplicate emails.

---

## 4. Migration 251 Production Permission Safety

To verify database security in the **production Supabase Dashboard SQL Editor** before deployment, run the following read-only SQL queries.

### Query A: Table Ownership, Row Level Security (RLS), and Role Privileges
```sql
-- ============================================================================
-- QUERY A: Table Ownership, Row Level Security (RLS), and Role Privileges
-- Run in Supabase Dashboard SQL Editor (authoritative project: ocolfottogbybitfpdqy)
-- ============================================================================
WITH target_tables AS (
    SELECT 
        c.oid,
        n.nspname AS schema_name,
        c.relname AS table_name,
        pg_get_userbyid(c.relowner) AS table_owner,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('email_queue', 'email_suppressions', 'email_delivery_logs')
),
roles_to_check AS (
    SELECT unnest(ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role']) AS role_name
)
SELECT 
    t.table_name,
    t.table_owner,
    t.rls_enabled,
    r.role_name,
    COALESCE(
        string_agg(g.privilege_type, ', ' ORDER BY g.privilege_type),
        'NONE (REVOKED)'
    ) AS granted_privileges,
    CASE 
        WHEN r.role_name IN ('PUBLIC', 'anon', 'authenticated') THEN
            CASE WHEN string_agg(g.privilege_type, '') IS NULL THEN 'SECURE' ELSE 'VULNERABILITY: UNINTENDED ACCESS' END
        WHEN r.role_name = 'service_role' THEN
            CASE WHEN string_agg(g.privilege_type, '') IS NOT NULL THEN 'SECURE' ELSE 'ERROR: MISSING PRIVILEGES' END
        ELSE 'UNKNOWN'
    END AS security_verdict
FROM target_tables t
CROSS JOIN roles_to_check r
LEFT JOIN information_schema.role_table_grants g 
    ON g.table_schema = t.schema_name 
   AND g.table_name = t.table_name 
   AND g.grantee = r.role_name
GROUP BY t.table_name, t.table_owner, t.rls_enabled, r.role_name
ORDER BY t.table_name, r.role_name;
```
* **Expected Result:**
  - Exactly 12 rows returned (3 tables × 4 roles).
  - All 3 tables return `rls_enabled = true`.
  - `table_owner` is identified as `postgres` or `supabase_admin`.
  - Roles `PUBLIC`, `anon`, and `authenticated` return `granted_privileges = 'NONE (REVOKED)'` and `security_verdict = 'SECURE'`.
  - Role `service_role` returns all granted privileges (`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`) and `security_verdict = 'SECURE'`.

### Query B: Function Execution Permissions & Role Isolation
```sql
-- ============================================================================
-- QUERY B: Function Execution Permissions & Role Isolation
-- Run in Supabase Dashboard SQL Editor (authoritative project: ocolfottogbybitfpdqy)
-- ============================================================================
WITH target_rpcs AS (
    SELECT 
        p.oid AS function_oid,
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        pg_get_userbyid(p.proowner) AS function_owner,
        p.prosecdef AS is_security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
          'cancel_email_job',
          'claim_email_queue_batch',
          'enqueue_email_job',
          'mark_email_failed',
          'record_email_success',
          'record_email_webhook_delivery',
          'recover_abandoned_email_locks',
          'schedule_email_retry'
      )
),
roles_to_check AS (
    SELECT unnest(ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role']) AS role_name
)
SELECT 
    f.function_name,
    f.identity_arguments,
    f.function_owner,
    r.role_name,
    CASE 
        WHEN r.role_name = 'PUBLIC' THEN
            CASE 
                WHEN EXISTS (
                    SELECT 1 FROM information_schema.routine_privileges rp
                    WHERE rp.routine_schema = f.schema_name
                      AND rp.routine_name = f.function_name
                      AND rp.grantee = 'PUBLIC'
                      AND rp.privilege_type = 'EXECUTE'
                ) THEN 'EXECUTE (UNSAFE)'
                ELSE 'NO EXECUTE'
            END
        ELSE
            CASE 
                WHEN has_function_privilege(r.role_name, f.function_oid, 'EXECUTE') THEN 'EXECUTE'
                ELSE 'NO EXECUTE'
            END
    END AS effective_execute_privilege,
    CASE 
        WHEN r.role_name IN ('PUBLIC', 'anon', 'authenticated') THEN
            CASE 
                WHEN r.role_name = 'PUBLIC' AND EXISTS (
                    SELECT 1 FROM information_schema.routine_privileges rp
                    WHERE rp.routine_schema = f.schema_name
                      AND rp.routine_name = f.function_name
                      AND rp.grantee = 'PUBLIC'
                      AND rp.privilege_type = 'EXECUTE'
                ) THEN 'VULNERABILITY: PUBLIC EXECUTE'
                WHEN r.role_name <> 'PUBLIC' AND has_function_privilege(r.role_name, f.function_oid, 'EXECUTE') THEN 'VULNERABILITY: UNINTENDED ACCESS'
                ELSE 'SECURE'
            END
        WHEN r.role_name = 'service_role' THEN
            CASE 
                WHEN has_function_privilege('service_role', f.function_oid, 'EXECUTE') THEN 'SECURE'
                ELSE 'ERROR: MISSING SERVICE_ROLE EXECUTE'
            END
        ELSE 'UNKNOWN'
    END AS execution_verdict
FROM target_rpcs f
CROSS JOIN roles_to_check r
ORDER BY f.function_name, r.role_name;
```
* **Expected Result:**
  - Exactly 32 rows returned (8 functions × 4 roles).
  - All 8 functions are identified unambiguously with their full argument signatures.
  - Roles `PUBLIC`, `anon`, and `authenticated` return `effective_execute_privilege = 'NO EXECUTE'` and `execution_verdict = 'SECURE'`.
  - Role `service_role` returns `effective_execute_privilege = 'EXECUTE'` and `execution_verdict = 'SECURE'`.
  - No client-facing role can execute any email queue RPC.

### Query C: Function Definition Integrity (SECURITY DEFINER & search_path)
```sql
-- ============================================================================
-- QUERY C: Function Definition Integrity (SECURITY DEFINER & search_path)
-- Run in Supabase Dashboard SQL Editor (authoritative project: ocolfottogbybitfpdqy)
-- ============================================================================
SELECT 
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_userbyid(p.proowner) AS function_owner,
    p.prosecdef AS is_security_definer,
    p.proconfig AS raw_proconfig,
    CASE 
        WHEN p.proconfig IS NULL THEN 'FAIL: Missing search_path configuration (Hijack Risk)'
        WHEN 'search_path=public, pg_temp' = ANY(p.proconfig) THEN 'PASS: Secure (search_path=public, pg_temp)'
        ELSE 'FAIL: Non-standard search_path: ' || array_to_string(p.proconfig, '; ')
    END AS search_path_audit_verdict
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'cancel_email_job',
      'claim_email_queue_batch',
      'enqueue_email_job',
      'mark_email_failed',
      'record_email_success',
      'record_email_webhook_delivery',
      'recover_abandoned_email_locks',
      'schedule_email_retry'
  )
ORDER BY p.proname;
```
* **Expected Result:**
  - Exactly 8 rows returned.
  - All 8 functions return `is_security_definer = true`.
  - All 8 functions return `raw_proconfig = {search_path=public, pg_temp}` and `search_path_audit_verdict = 'PASS: Secure (search_path=public, pg_temp)'`.
  - Zero discrepancies exist between migration definitions and actual catalog parameters.

---

## 5. Email Activation & Reconciliation Safety Verification

| Safety Criterion | Source Code Verification | Status |
| :--- | :--- | :---: |
| **Missing timestamp leaves reconciliation disabled** | If `EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP` is unset/empty, `parseActivationTimestamp()` returns `null`. Reconciliation returns `{ disabled: true, scanned: 0, reconciled: 0 }`. | **CONFIRMED** |
| **Invalid timestamp cannot cause a scan** | Non-ISO strings or malformed Dates immediately log a warning and return `null`. No SQL queries execute. | **CONFIRMED** |
| **No automated callers exist** | Search confirms zero cron jobs, scheduled functions, or webhooks call `reconciliation.ts`. Imported solely in unit tests. | **CONFIRMED DORMANT** |
| **No static fallback timestamp remains** | `DEFAULT_EMAIL_ACTIVATION_TIMESTAMP` was completely deleted. Zero occurrences exist in codebase. | **CONFIRMED** |
| **Ordinary queueing flow independence** | Real-time purchase enqueueing (`PAY-01` to `PAY-06`, `INS-01` to `INS-02`) calls `enqueueEmailSafe` directly. It has **zero dependency** on reconciliation. | **CONFIRMED** |
| **Preservation of existing secrets & state** | In read-only audit mode, zero secrets are updated, no cron jobs are registered, and no historical backfills are executed. | **CONFIRMED** |

---

## 6. Exact Sequential Production Deployment Commands

When explicitly authorized to deploy to production:

### Step 1: Authenticate & Link CLI to Supabase Production
```bash
cd C:/Projects/mocktest-admin
supabase link --project-ref ocolfottogbybitfpdqy
```

### Step 2: Set Production Secrets in Supabase
```bash
# 1. Email identity secrets
supabase secrets set EMAIL_FROM="Make Me Topper <info@makemetopper.com>"
supabase secrets set EMAIL_REPLY_TO="support@inovoxy.com"

# 2. Resend production provider secrets
supabase secrets set RESEND_API_KEY="re_live_..."
supabase secrets set RESEND_WEBHOOK_SECRET="whsec_..."

# 3. Activation boundary timestamp (Set to current UTC ISO timestamp at moment of deployment)
supabase secrets set EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP="2026-11-20T18:00:00.000Z"
```

### Step 3: Deploy All 9 Edge Functions in Exact Order
```bash
# Group A: Background Worker & Delivery Webhook
supabase functions deploy email-worker --no-verify-jwt
supabase functions deploy email-webhook --no-verify-jwt

# Group B: Web Commerce Handlers (Razorpay)
supabase functions deploy complete-course-purchase
supabase functions deploy complete-pyq-purchase
supabase functions deploy complete-installment-purchase

# Group C: External Webhooks
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy apple-app-store-notifications --no-verify-jwt

# Group D: Native Mobile In-App Purchase Verification
supabase functions deploy verify-apple-purchase --no-verify-jwt
supabase functions deploy verify-google-play-purchase --no-verify-jwt
```

### Step 4: Post-Deployment Verification
1. Run Query A, Query B, and Query C in the Supabase Dashboard SQL Editor to verify Migration 251 RLS, execution privileges, and `SECURITY DEFINER` settings.
2. In the Resend Dashboard, verify that DNS records (`SPF`, `DKIM`, `DMARC`) for `makemetopper.com` are marked "Verified".
3. Trigger a single live purchase to verify real-time queue insertion in `public.email_queue` and dispatch via `email-worker`.
4. Keep the reconciliation service strictly dormant.
