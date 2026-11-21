# Apple IAP Phase 3 — Final OCSP and Runtime Security Gate Report

**Date:** November 19, 2026  
**Repositories:**
- Backend: `C:\Projects\mocktest-admin`
- Mobile Reference: `C:\Projects\MockTestApp`  
**Evaluation Type:** Read-Only Runtime & Cryptographic Security Gate  
**Final Verdict:** **NOT READY — SECURITY BLOCKER REMAINS**

---

## 1. Executive Summary & Verdict

Phase 3 developed the cryptographic verification pipeline and transaction claim validation for Apple StoreKit 2 transactions within `supabase/functions/verify-apple-purchase/`. While the native WebCrypto certificate chain verification and RFC 6960 OCSP ASN.1 engine are structurally functional (with 76 targeted unit tests passing in Node/Vitest), a rigorous end-to-end execution path audit reveals **three confirmed security blockers** that prevent safe deployment to Apple Sandbox:

1. **Production OCSP Revocation Bypass via Configuration:**  
   In `index.ts`, `APPLE_ENABLE_ONLINE_CHECKS` defaults to `false` when unset, missing, or empty. Because environment is evaluated only *after* cryptographic verification, Production transactions bypass online OCSP revocation checks by default. Missing configuration fails open, not closed.
2. **Apple App Transaction & `appAppleId` Verification is Dead Code:**  
   `validateAppTransactionClaims(...)` is never imported, invoked, or reachable in `index.ts`. The App Store Server API endpoint `GET /inApps/v1/transactions/appTransactions/{transactionId}` is never queried. `APPLE_APP_ID` is read into a constant on line 48 of `index.ts` and never referenced anywhere else in the request lifecycle.
3. **Incomplete RFC 6960 CertID Validation:**  
   In `appleCrypto.ts` (`parseAndVerifyOcspResponse`), matching of the target certificate against the OCSP response evaluates **only the serial number**. It omits validation of `issuerNameHash`, `issuerKeyHash`, and `hashAlgorithm`, violating RFC 6960 Section 4.2.1.

**Verdict:** **NOT READY — SECURITY BLOCKER REMAINS**

---

## 2. Production OCSP Enforcement Findings

### 2.1 Configuration Evaluation (`APPLE_ENABLE_ONLINE_CHECKS`)
In `supabase/functions/verify-apple-purchase/index.ts` (line 49):
```typescript
const APPLE_ENABLE_ONLINE_CHECKS = Deno.env.get("APPLE_ENABLE_ONLINE_CHECKS") === "true";
```

Behavior across all input states:
- `"true"`: `APPLE_ENABLE_ONLINE_CHECKS` evaluates to `true`.
- `"false"`: `APPLE_ENABLE_ONLINE_CHECKS` evaluates to `false`.
- Missing (unset): `Deno.env.get(...)` returns `undefined` $\rightarrow$ evaluates to `false`.
- Empty (`""`): evaluates to `false`.
- Invalid (e.g., `"1"`, `"yes"`, `"TRUE"`): evaluates to `false`.

### 2.2 Trace from HTTP Request to Database RPC Invocation
Tracing the incoming request in `index.ts`:
1. **Line 172:** The Edge Function executes:
   ```typescript
   const clientJwsVerification = await verifyAppleStoreKit2Jws(clientJws, {
     enableOnlineChecks: APPLE_ENABLE_ONLINE_CHECKS,
   });
   ```
2. **`appleCrypto.ts` Line 690:**
   ```typescript
   if (options?.enableOnlineChecks) {
     const intermediateOcsp = await checkCertificateOcspStatus(intermediateCert, rootCert, options);
     ...
     const leafOcsp = await checkCertificateOcspStatus(leafCert, intermediateCert, options);
     ...
   }
   return { valid: true, leafCert };
   ```
   When `APPLE_ENABLE_ONLINE_CHECKS` is `false` (the default!), lines 690–710 are **entirely skipped**.
3. **`index.ts` Lines 200–240:** If Apple Server API credentials are not configured, server API querying is skipped.
4. **`index.ts` Line 244:** `validateTransactionClaims(verifiedTransaction, profile.profile_id, APPLE_BUNDLE_ID)` is executed. It validates `bundleId`, `appAccountToken`, and non-consumable product type.
5. **`index.ts` Lines 384–397:** Database fulfillment RPC is invoked:
   ```typescript
   const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("complete_apple_purchase", rpcPayload);
   ```

### 2.3 Security Assessment
- **Fails Open on Missing Configuration:** If an administrator provisions the function without explicitly setting `APPLE_ENABLE_ONLINE_CHECKS="true"`, Production transactions succeed without checking whether the leaf or intermediate certificates have been revoked.
- **Production Cannot Bypass OCSP (Invariant Violated):** Production transactions can currently bypass OCSP checks whenever `APPLE_ENABLE_ONLINE_CHECKS` is unset or `false`.
- **Sandbox Inheritance:** If `APPLE_ENABLE_ONLINE_CHECKS` is toggled off for local/sandbox testing, Production transactions running on the same function instance also bypass OCSP.
- **Client Influence:** The client sends `{ transactionJws: string }`. The client cannot directly set environment variables, but the server's default configuration fails open.

---

## 3. Complete OCSP CertID & Response Validation Results

### 3.1 CertID Validation Analysis
In `supabase/functions/verify-apple-purchase/appleCrypto.ts` (lines 1060–1087):
```typescript
for (const sr of singleResponses) {
  if (sr.tag === 0x30) {
    const srChildren = parseAsn1Children(sr.value);
    if (srChildren.length >= 3 && srChildren[0].tag === 0x30) {
      const certIdChildren = parseAsn1Children(srChildren[0].value);
      if (certIdChildren.length >= 4 && certIdChildren[3].tag === 0x02) {
        const respSerial = certIdChildren[3].value;
        if (bytesEqual(respSerial, targetCert.serialNumberRaw)) {
          matchedResponse = srChildren;
          break;
        }
      }
    }
  }
}
```

RFC 6960 Section 4.1.1 defines `CertID` as:
```asn1
CertID ::= SEQUENCE {
    hashAlgorithm       AlgorithmIdentifier,
    issuerNameHash      OCTET STRING,
    issuerKeyHash       OCTET STRING,
    serialNumber        CertificateSerialNumber
}
```

**Finding:** The implementation extracts `certIdChildren[3]` (the serial number) and checks only `bytesEqual(respSerial, targetCert.serialNumberRaw)`.  
- `hashAlgorithm` is NOT checked.
- `issuerNameHash` is NOT matched against `SHA-1(issuer.subjectRaw)`.
- `issuerKeyHash` is NOT matched against `SHA-1(issuer.publicKeyBytes)`.

If an OCSP response contained multiple single responses or a collision from another CA with the same serial number, matching on serial alone would accept it.

### 3.2 Response Field Verification Status
- **Response Status Successful:** Verified. Lines 864–880 strictly enforce `responseStatus === 0`. Non-zero statuses return `OCSP_STATUS_ERROR`.
- **Response Type Supported:** Partial. The parser confirms `rbChildren[1].tag === 0x04` (OCTET STRING), but does not assert that `rbChildren[0]` OID matches `1.3.6.1.5.5.7.48.1.1` (`id-pkix-ocsp-basic`).
- **ResponderID Matching:** Omitted. The responder ID (by Name `[1]` or KeyHash `[2]`) is parsed as ASN.1, but not compared against the signing certificate's subject Name or public key hash.
- **Signature Algorithm:** Verified. Supports ECDSA with SHA-256 (`1.2.840.10045.4.3.2`), SHA-384 (`1.2.840.10045.4.3.3`), and SHA-512 (`1.2.840.10045.4.3.4`).
- **ProducedAt Timestamp:** Extracted but not freshness-validated against maximum age.
- **ThisUpdate Freshness:** Verified. Checked with 5-minute clock skew tolerance (`nowMs >= thisUpdate.getTime() - SKEW_MS`).
- **NextUpdate Freshness:** Verified. Checked with 5-minute clock skew tolerance (`nowMs <= nextUpdate.getTime() + SKEW_MS`). Stale responses return `OCSP_RESPONSE_EXPIRED`.
- **Fail-Closed on Non-Good Status:** Verified. Revoked status (`0xa1`) returns `CERTIFICATE_REVOKED`; unknown status (`0x82`) returns `CERTIFICATE_STATUS_UNKNOWN`.

### 3.3 Delegated Responder Authorization
In `appleCrypto.ts` lines 930–975:
- **Distinguishes Signer:** If `certs [0]` is present in `BasicOCSPResponse`, responder certificate is parsed; otherwise defaults to `issuerCert`.
- **Issuer Relationship & Signature:** Cryptographically verified via `verifyCertificateSignature(responderCert, issuerCert)`.
- **Validity Period:** Checked (`nowMs >= responderCert.notBefore` and `nowMs <= responderCert.notAfter`).
- **OCSP Signing EKU:** Checked (`responderCert.hasOcspSigningOid` for `1.3.6.1.5.5.7.3.9`).

---

## 4. Apple App Transaction API Usage & `appAppleId` Execution Path

### 4.1 Dead Code Identification
In `supabase/functions/verify-apple-purchase/appleBillingCore.ts`:
- `AppleAppTransactionPayload` interface exists (lines 56–67).
- `validateAppTransactionClaims(...)` function exists (lines 390–445) and checks `bundleId`, `environment`, and in Production enforces `payload.appAppleId === expectedAppId`.
- This function is tested in `applePurchaseVerificationCore.test.ts` (Section 4, tests J–M).

### 4.2 Production Execution Path in `index.ts`
1. `validateAppTransactionClaims` is **NOT imported** in `index.ts`.
2. `validateAppTransactionClaims` is **NEVER called** in `index.ts`.
3. In `index.ts`, line 48:
   ```typescript
   const APPLE_APP_ID = Deno.env.get("APPLE_APP_ID") || "";
   ```
   **This is the sole reference to `APPLE_APP_ID` in `index.ts`.** It is never passed to any function, never checked against any payload, and never enforced.
4. **Endpoint Mismatch:**
   Apple's App Store Server API specification defines:
   - In-App Purchase Transaction Info: `GET /inApps/v1/transactions/{transactionId}`
   - App Transaction Info: `GET /inApps/v1/transactions/appTransactions/{transactionId}`
   In `appleCrypto.ts` (line 1290), `queryAppleTransactionApi` calls:
   ```typescript
   const url = `${baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;
   ```
   It queries the transaction endpoint, which returns in-app transaction JWS (`signedTransactionInfo`). It **never queries the App Transaction endpoint** (`/inApps/v1/transactions/appTransactions/{transactionId}`).

**Conclusion:** `validateAppTransactionClaims(...)` is dead code in the runtime. The production request flow never retrieves or validates the App Transaction receipt or `APPLE_APP_ID`.

---

## 5. Actual Apple OCSP Verification Evidence

### 5.1 Real Apple OCSP Infrastructure Probe (Session Step 1066–1071)
An active verification probe was executed using Node.js against live Apple infrastructure:
- **Certificates Downloaded:**
  - `AppleRootCA-G3.cer` fetched from `https://www.apple.com/certificateauthority/AppleRootCA-G3.cer`.
  - `AppleWWDRCAG6.cer` fetched from `https://www.apple.com/certificateauthority/AppleWWDRCAG6.cer`.
- **AIA Extraction:** Extracted `http://ocsp.apple.com/ocsp03-applerootcag3` directly from WWDR G6 AIA extension.
- **Live HTTP Query:** Dispatched DER `OCSPRequest` to `http://ocsp.apple.com/ocsp03-applerootcag3`.
- **Live Server Response:**
  - Status: HTTP 200, Content-Type: `application/ocsp-response`, 906 bytes.
  - Responder: `CN=Apple Root - G3 OCSP Responder MG1`, issued by `CN=Apple Root CA - G3`.
  - Responder Signature: ECDSA P-256 over `tbsResponseData`, cryptographically verified with WebCrypto `crypto.subtle.verify` $\rightarrow$ `true`.
  - CertStatus: `0x80 (GOOD)`.
  - Timestamps: `thisUpdate: 20261119163729Z`, `nextUpdate: 20261120043728Z`.

### 5.2 Synthetic Fixtures in Vitest Suite
In `src/services/admin/__tests__/applePurchaseVerificationCore.test.ts`:
- The 13 OCSP unit tests (Section 10, tests A–M) utilize locally generated synthetic ECDSA certificates and synthetic DER OCSP responses (`buildSyntheticOcspResponse`).
- Synthetic tests ensure deterministic, sub-millisecond execution of error branches (`revoked`, `unknown`, `expired`, `malformed`, `sig-corrupted`, `serial-mismatch`) without dependency on Apple's live network availability.
- **Distinction:** Live Apple responder probing confirmed DER ASN.1 wire format interoperability; synthetic unit tests validated adversarial fail-closed paths.

---

## 6. Test Results and Historical Command Reconciliation

### 6.1 Test Execution Reconciliation
During this phase, test commands executed as follows:

| Test Command | Scope | Result | Explanation |
| :--- | :--- | :--- | :--- |
| `npx vitest run src/services/admin/__tests__/applePurchaseVerificationCore.test.ts` | Apple IAP Verification Suite | **76 / 76 Passed** | All Apple SKU, decimal precision, claim, crypto chain, and OCSP tests pass. |
| `npx vitest run src/services/admin/__tests__/googlePlayVerificationCore.test.ts ...PaymentRecording.test.ts` | Google Play Regression | **146 / 146 Passed** | Zero regressions in Google Play commerce architecture. |
| `npx tsc ... --noEmit` | TypeScript Strict Check | **Exit 0 (Clean)** | Zero type errors in Apple crypto and verification modules. |
| `npx vitest run src/services/admin/__tests__/` | Full Admin Services Suite | **484 Passed, 1 Failed** | Exited with code 1 due to `retireTeacherSelfSignup.test.ts`. |

### 6.2 Analysis of the Code 1 Failure
The full admin suite failure occurred in:
`FAIL src/services/admin/__tests__/retireTeacherSelfSignup.test.ts > LoginView.tsx does not contain teacher registration UI`
```
AssertionError: expected content to contain 'signIn(phoneNumber.trim(), password)'
```
- **Root Cause:** A pre-existing expectation in `retireTeacherSelfSignup.test.ts` regarding specific string formatting in `LoginView.tsx` (the web admin Next.js frontend).
- **Commerce Relevance:** Zero connection to Apple IAP, Google Play, payment gateways, Edge Functions, or database RPCs.
- **Conclusion:** The failure is isolated and does not represent an Apple IAP regression. The targeted 76-test Apple suite and 146-test Google Play suites supersede it for billing verification.

---

## 7. Supabase Edge Runtime and Docker Environment Limitations

1. **Docker Daemon Status:**
   - Docker Desktop is not running on this host (`failed to connect to docker API`).
   - Per explicit instructions, Docker was not launched.
   - Consequently, local `supabase functions serve verify-apple-purchase` could not be executed inside the local Supabase Edge Runtime container.
2. **Environment Execution Breakdown:**
   - **Node.js 22.18.0 / Vitest:** Verified pure TypeScript logic, WebCrypto compatibility, ASN.1 parsing, and RFC 6960 serialization.
   - **Deno / Supabase Edge Runtime:** The code in `index.ts` uses WebCrypto (`crypto.subtle`), `TextEncoder`, `TextDecoder`, `fetch`, and `@supabase/supabase-js`, which are standard Web standard APIs supported by Deno. However, live execution within Supabase Edge Runtime has **not yet occurred**.
   - **Genuine Apple Sandbox:** Has **not yet occurred**. The mobile checkout flow has not yet been connected to the Edge Function, and live Apple transactions have not been processed.

---

## 8. Detailed Inventory of Remaining Blockers

Before Apple Sandbox deployment, the following 3 surgical corrections are required:

### Blocker 1: Production OCSP Enforcement & Fail-Closed Logic
- **Issue:** `APPLE_ENABLE_ONLINE_CHECKS` defaults to `false` and is evaluated before environment is known.
- **Remediation:**
  1. If `verifiedTransaction.environment === "Production"`, enforce OCSP unconditionally.
  2. If an OCSP check cannot be performed (responder down, timeout, missing AIA), fail closed with HTTP 400/503.
  3. Allow OCSP bypass ONLY when `environment === "Sandbox"` AND an explicit `APPLE_ALLOW_SANDBOX_OFFLINE="true"` flag is configured.

### Blocker 2: Complete RFC 6960 CertID Matching
- **Issue:** `parseAndVerifyOcspResponse` matches `SingleResponse` solely on certificate serial number.
- **Remediation:**
  Update matching logic in `appleCrypto.ts` to compute:
  - `expectedIssuerNameHash = SHA-1(issuerCert.subjectRaw)`
  - `expectedIssuerKeyHash = SHA-1(issuerCert.publicKeyBytes)`
  And verify that `certID.issuerNameHash === expectedIssuerNameHash` and `certID.issuerKeyHash === expectedIssuerKeyHash` in addition to `serialNumber`.

### Blocker 3: Wiring App Transaction Retrieval and `APPLE_APP_ID` Enforcement
- **Issue:** `validateAppTransactionClaims(...)` and `APPLE_APP_ID` are dead code; the app transaction API is never queried.
- **Remediation:**
  1. In `appleCrypto.ts`, add `queryAppleAppTransactionApi(transactionId, apiToken, environment)` calling `GET /inApps/v1/transactions/appTransactions/{transactionId}`.
  2. In `index.ts`, when `verifiedTransaction.environment === "Production"` and `APPLE_APP_ID` is set:
     - Query `queryAppleAppTransactionApi`.
     - Verify returned `signedAppTransactionInfo` JWS.
     - Call `validateAppTransactionClaims(verifiedAppTx, APPLE_BUNDLE_ID, APPLE_APP_ID)`.
     - Reject if `appAppleId` does not match `APPLE_APP_ID`.

---

## 9. Final Verdict

**NOT READY — SECURITY BLOCKER REMAINS**

Deployment to genuine Apple Sandbox must be held until the three blockers above (Production OCSP fail-closed enforcement, complete CertID validation, and live App Transaction `appAppleId` verification) are implemented and verified.

