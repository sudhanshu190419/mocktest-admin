# Apple IAP Phase 3 — Critical Cryptographic Verification Remediation Report

## 1. Executive Summary

This report documents the security remediation of the Apple StoreKit 2 transaction verification subsystem implemented in `supabase/functions/verify-apple-purchase/`.

The previous Phase 3 implementation verified only that the root certificate fingerprint in the JWS `x5c` header matched the pinned Apple Root CA G3 digest, and then verified the JWS signature against the public key extracted from the leaf certificate. It did not cryptographically verify certificate path linkage between the root, intermediate, and leaf certificates according to RFC 5280. This created a critical vulnerability to an **"appended-root" forgery attack**, where an adversary could generate an arbitrary self-signed leaf and intermediate certificate, append the genuine Apple Root CA G3 certificate to the `x5c` header, sign a fraudulent JWS payload with their own private key, and achieve unauthorized purchase fulfillment.

This remediation replaces the preliminary verification mechanism with a zero-dependency, native WebCrypto (`crypto.subtle`) RFC 5280 X.509 certificate path validator, hardens financial precision using integer arithmetic, validates production App Store application identity (`APPLE_APP_ID` / `appAppleId`), and adds an adversarial test suite in Vitest covering forged chains, tampered signatures, expired certificates, and missing extensions.

All 62 tests in `src/services/admin/__tests__/applePurchaseVerificationCore.test.ts` pass cleanly (164 ms). Zero regressions were introduced to existing commerce or Google Play test suites.

---

## 2. Security Vulnerability Analysis

### The Flaw: Root Pinning Without Path Validation
In JSON Web Signatures (JWS) containing an `x5c` certificate chain, RFC 7515 specifies that certificates are ordered starting with the leaf certificate (`x5c[0]`) and ending with a root or intermediate certificate (`x5c[n-1]`).

The initial verification logic performed the following steps:
1. Checked that `header.alg === "ES256"`.
2. Verified that `header.x5c.length >= 3`.
3. Computed the SHA-256 digest of `x5c[x5c.length - 1]` and verified it matched Apple Root CA G3 (`63343ab4b7013824ef7884705f19ce718a1d4c41299042ce171d7617d5046770`).
4. Extracted the public key from `x5c[0]`.
5. Verified the JWS signature against the public key from `x5c[0]`.

### The "Appended-Root" Attack Vector
Because the chain linkage was never checked:
1. An attacker generates an EC private/public key pair ($K_{attacker}$).
2. The attacker creates a self-signed leaf certificate ($C_{leaf}$) and intermediate certificate ($C_{int}$).
3. The attacker obtains the public DER bytes of Apple Root CA G3 ($C_{apple\_root}$).
4. The attacker constructs an `x5c` header: `[base64(C_{leaf}), base64(C_{int}), base64(C_{apple\_root})]`.
5. The attacker constructs a fraudulent StoreKit 2 payload awarding an expensive course for free, signs the JWS with $K_{attacker}$, and submits it to `/verify-apple-purchase`.
6. Under the preliminary implementation:
   - Root digest check: $C_{apple\_root}$ matches the pinned Apple fingerprint $\rightarrow$ **PASS**.
   - JWS signature check: Verified against $C_{leaf}$ using $K_{attacker}$ $\rightarrow$ **PASS**.
   - Result: Transaction fulfills without reaching Apple servers or validating genuine App Store issuance.

---

## 3. Cryptographic Verification Architecture

To permanently eliminate this vulnerability, `supabase/functions/verify-apple-purchase/appleCrypto.ts` has been refactored to implement full RFC 5280 X.509 path validation natively via WebCrypto:

```
[Apple Root CA - G3] (Pinned SHA-256 Digest: 63343ab4b7...)
        │
        ▼ (Cryptographic ECDSA SHA-384 Verification against Root Public Key)
[Apple WWDR Intermediate CA] (basicConstraints: cA=true, keyUsage: keyCertSign)
        │
        ▼ (Cryptographic ECDSA SHA-256 Verification against Intermediate Public Key)
[StoreKit Receipt Signing Leaf] (keyUsage: digitalSignature, OID: 1.2.840.113635.100.6.11.1)
        │
        ▼ (Cryptographic ECDSA P-256 JWS Signature Verification against Leaf Public Key)
[StoreKit 2 Transaction Payload]
```

Every link in the chain is cryptographically verified before any payload claims are inspected or processed.

---

## 4. Runtime Compatibility & Dependency Strategy

### The Runtime Conflict
Official Apple libraries (such as `@apple/app-store-server-library`) depend on Node.js native crypto methods, specifically `node:crypto.X509Certificate.prototype.verify`. In Supabase Edge Runtime (Deno-based), calling `X509Certificate.prototype.verify` throws `ERR_NOT_IMPLEMENTED` (see Supabase Edge Runtime Issue #761). Furthermore, heavy JavaScript X.509 libraries (`@peculiar/x509`, `pkijs`) fail in Edge Runtime due to `reflect-metadata` and global scope assumptions, while `node-forge` does not support standard ECDSA P-256/P-384.

### The Solution: Native WebCrypto ASN.1 Implementation
WebCrypto (`crypto.subtle`) is a standardized W3C API fully supported across:
- Supabase Edge Runtime (Deno)
- Node.js 18+ (Vitest runner)
- Modern browser runtimes

By implementing a lightweight, standard-compliant ASN.1 DER parser and ECDSA signature converter in pure TypeScript:
1. **Zero external dependencies**: No npm packages, native bindings, or binary shims.
2. **Deterministic cross-runtime execution**: Executes identically in local Node.js unit tests and deployed Supabase Edge Functions.
3. **ArrayBuffer slice safety**: Uses `toArrayBuffer` to avoid the classic JavaScript `TypedArray.prototype.buffer` offset gotcha where `subarray()` shares the parent `ArrayBuffer`.

---

## 5. ASN.1 DER Parser Implementation Details

The pure TypeScript ASN.1 DER engine in `supabase/functions/verify-apple-purchase/appleCrypto.ts` implements:

1. **TLV Reader (`readAsn1`)**:
   - Parses ASN.1 Tag-Length-Value tuples.
   - Enforces DER definite-length encoding; rejects indefinite length (BER).
   - Bounds-checks values against buffer boundaries.

2. **Sequence Child Parser (`parseAsn1Children`)**:
   - Iterates contiguous TLV structures inside `SEQUENCE` containers.

3. **OID Decoder (`parseOid`)**:
   - Decodes 7-bit variable-length ASN.1 Object Identifiers into canonical dotted notation (e.g., `1.2.840.113635.100.6.11.1`, `2.5.29.19`, `2.5.29.15`).

4. **X.509 Date Parser (`parseTime`)**:
   - Parses both UTCTime (tag `0x17`, `YYMMDDHHMMSSZ`) and GeneralizedTime (tag `0x18`, `YYYYMMDDHHMMSSZ`) to UTC `Date` objects with proper century handling.

5. **Signature Conversion (`derSignatureToP1363`)**:
   - X.509 DER signatures encode ECDSA values as `SEQUENCE { r INTEGER, s INTEGER }`.
   - WebCrypto `crypto.subtle.verify` requires IEEE P1363 format ($r \parallel s$, fixed coordinate length: 32 bytes for P-256, 48 bytes for P-384).
   - The parser strips DER positive-integer padding (`0x00`) or adds leading zeroes to guarantee exact fixed-width coordinate packing.

---

## 6. Certificate Validation Criteria & Checks

The function `verifyAppleCertificateChain(x5c: string[], options?: AppleChainVerifyOptions)` executes the following checks in strict order:

| Link / Step | Check | RFC 5280 / Apple Rule | Error Code on Failure |
|---|---|---|---|
| **Chain Length** | `x5c.length >= 3` | Must contain Leaf, Intermediate, and Root | `INCOMPLETE_CERT_CHAIN` |
| **Root Pinning** | SHA-256 digest of `x5c[last]` | Matches pinned Apple Root CA G3 fingerprint | `ROOT_CA_MISMATCH` |
| **Intermediate Expiry** | `notBefore <= now <= notAfter` | Intermediate within active validity window | `CERTIFICATE_EXPIRED` |
| **Intermediate CA** | `basicConstraints.cA === true` | Certificate is authorized as a CA | `INVALID_CA_CONSTRAINTS` |
| **Intermediate KeyUsage** | `keyUsage & 0x04` | Certificate is authorized for `keyCertSign` | `INVALID_KEY_USAGE` |
| **Intermediate Linkage** | `intermediate.issuer === root.subject` | Issuer DN bytes equal Root subject DN bytes | `ISSUER_MISMATCH` |
| **Intermediate Signature** | `crypto.subtle.verify(rootKey, sig, tbs)` | Cryptographically signed by Apple Root CA G3 | `INTERMEDIATE_SIGNATURE_INVALID` |
| **Leaf Expiry** | `notBefore <= now <= notAfter` | Leaf within active validity window | `CERTIFICATE_EXPIRED` |
| **Leaf KeyUsage** | `keyUsage & 0x80` | Certificate authorized for `digitalSignature` | `INVALID_KEY_USAGE` |
| **Leaf Apple OID** | `1.2.840.113635.100.6.11.1` | Must contain Apple App Store receipt signing OID | `MISSING_APPLE_OID` |
| **Leaf Linkage** | `leaf.issuer === intermediate.subject` | Issuer DN bytes equal Intermediate subject DN bytes | `ISSUER_MISMATCH` |
| **Leaf Signature** | `crypto.subtle.verify(intKey, sig, tbs)` | Cryptographically signed by Intermediate CA | `LEAF_SIGNATURE_INVALID` |
| **JWS Signature** | `crypto.subtle.verify(leafKey, sig, data)` | ES256 signature signed by Leaf public key | `INVALID_SIGNATURE` |

---

## 7. Financial Precision & Integer Arithmetic

In `supabase/functions/verify-apple-purchase/appleBillingCore.ts`:
- Apple StoreKit 2 transmits transaction amounts as integer milliunits (e.g., `1999000` milliunits for ₹1,999.00).
- Previous implementation used floating-point division `priceMilliunits / 1000` combined with `Math.round(raw * 100) / 100`.
- Remediation enforces strict safe-integer boundaries and cents-based integer division:
  ```ts
  if (!Number.isSafeInteger(priceMilliunits) || priceMilliunits <= 0) {
    return { valid: false, error: "Non-positive or non-integer price cannot be fulfilled.", code: "INVALID_AMOUNT" };
  }
  const cents = Math.round(priceMilliunits / 10);
  const roundedAmount = cents / 100;
  ```
- Non-integer milliunits (such as `1999.5`) and non-safe integers ($> 2^{53} - 1$) are rejected fail-closed.

---

## 8. App Identity & Environment Hardening

1. **`APPLE_APP_ID` Configuration**:
   - `supabase/functions/verify-apple-purchase/index.ts` reads `APPLE_APP_ID = Deno.env.get("APPLE_APP_ID") || ""`.
2. **`appAppleId` Claim Verification**:
   - In StoreKit 2, Apple transmits `appAppleId` (the numerical App Store ID) exclusively in the Production environment.
   - `validateTransactionClaims` enforces that when `environment === "Production"` and `APPLE_APP_ID` is configured, `String(payload.appAppleId) === String(expectedAppId)`. If mismatched or missing, verification fails with `APP_ID_MISMATCH`.
   - Sandbox transactions do not include `appAppleId` and are permitted without it.

---

## 9. Adversarial Testing Suite & Verification Matrix

The test suite in `src/services/admin/__tests__/applePurchaseVerificationCore.test.ts` was expanded from 40 to 62 tests.

Section 9 implements synthetic PKI generation with WebCrypto and asserts fail-closed rejections for every adversarial condition:

| Test ID | Test Case | Adversarial Vector Tested | Expected Result | Status |
|---|---|---|---|---|
| **9.A** | Genuine synthetic chain | Valid Root $\rightarrow$ Intermediate $\rightarrow$ Leaf $\rightarrow$ JWS | `valid: true`, parsed payload | **PASS** |
| **9.B** | Appended-root attack | Forged leaf & intermediate + genuine root in `x5c` | `INTERMEDIATE_SIGNATURE_INVALID` | **PASS** |
| **9.C** | Untrusted root fingerprint | Synthetic chain with wrong root fingerprint override | `ROOT_CA_MISMATCH` | **PASS** |
| **9.D** | Corrupted intermediate signature | Bit-flipped intermediate ECDSA signature | `INTERMEDIATE_SIGNATURE_INVALID` | **PASS** |
| **9.E** | Corrupted leaf signature | Bit-flipped leaf ECDSA signature (forged leaf) | `LEAF_SIGNATURE_INVALID` | **PASS** |
| **9.F** | Expired intermediate cert | Intermediate validity window in the past | `CERTIFICATE_EXPIRED` | **PASS** |
| **9.G** | Expired leaf cert | Leaf validity window in the past | `CERTIFICATE_EXPIRED` | **PASS** |
| **9.H** | Missing CA basic constraint | Intermediate cert with `isCA = false` | `INVALID_CA_CONSTRAINTS` | **PASS** |
| **9.I** | Missing keyCertSign usage | Intermediate cert lacking `keyCertSign` flag | `INVALID_KEY_USAGE` | **PASS** |
| **9.J** | Missing digitalSignature usage | Leaf cert lacking `digitalSignature` flag | `INVALID_KEY_USAGE` | **PASS** |
| **9.K** | Missing Apple Receipt OID | Leaf cert lacking OID `1.2.840.113635.100.6.11.1` | `MISSING_APPLE_OID` | **PASS** |
| **9.L** | Intermediate issuer mismatch | Intermediate issuer DN $\neq$ Root subject DN | `ISSUER_MISMATCH` | **PASS** |
| **9.M** | Leaf issuer mismatch | Leaf issuer DN $\neq$ Intermediate subject DN | `ISSUER_MISMATCH` | **PASS** |
| **9.N** | Tampered JWS signature | JWS signature bytes altered | `INVALID_SIGNATURE` | **PASS** |
| **9.O** | Tampered JWS payload | Payload modified without resigning | `INVALID_SIGNATURE` | **PASS** |
| **9.P** | Incomplete cert chain | `x5c` containing $< 3$ certificates | `INCOMPLETE_CERT_CHAIN` | **PASS** |
| **2.F** | Non-integer milliunits | Price milliunits with floating point fractional part | `INVALID_AMOUNT` | **PASS** |
| **2.G** | Unsafe integer milliunits | Price milliunits $> \text{MAX\_SAFE\_INTEGER}$ | `INVALID_AMOUNT` | **PASS** |
| **4.I** | Production matching appAppleId | Valid Production transaction with matching App ID | `valid: true` | **PASS** |
| **4.J** | Production mismatched appAppleId | Production transaction with different App ID | `APP_ID_MISMATCH` | **PASS** |
| **4.K** | Production missing appAppleId | Production transaction with missing App ID | `APP_ID_MISMATCH` | **PASS** |
| **4.L** | Sandbox without appAppleId | Sandbox transaction missing App ID | `valid: true` | **PASS** |

---

## 10. Test Execution Results & Proof of Security

### Vitest Test Execution Output
```
 RUN  v3.2.7 C:/Projects/mocktest-admin

 ✓ src/services/admin/__tests__/applePurchaseVerificationCore.test.ts (62 tests) 164ms

 Test Files  1 passed (1)
      Tests  62 passed (62)
   Start at  23:07:09
   Duration  1.09s (transform 124ms, setup 0ms, collect 211ms, tests 164ms, environment 0ms, prepare 152ms)
```

### TypeScript Compilation Check
```
cd C:\Projects\mocktest-admin
npx tsc src/services/admin/__tests__/applePurchaseVerificationCore.test.ts --noEmit --skipLibCheck --target ES2022 --moduleResolution node
(exited with code 0, 0 errors)
```

### Regression Verification (Google Play Commerce Tests)
```
 ✓ src/services/admin/__tests__/googlePlayVerificationCore.test.ts (20 tests) 18ms
 ✓ src/services/admin/__tests__/googlePlayPaymentRecording.test.ts (126 tests) 72ms

 Test Files  2 passed (2)
      Tests  146 passed (146)
   Duration  968ms
```

---

## 11. Security Audit Findings & Defenses Summary

| Vulnerability Vector | Severity | Defending Subsystem | Verification Proof |
|---|---|---|---|
| **Appended Root Forgery** | **Critical** | `verifyAppleCertificateChain` verifies intermediate signature against Root CA | Test 9.B |
| **Rogue Leaf Forgery** | **Critical** | `verifyAppleCertificateChain` verifies leaf signature against Intermediate CA | Test 9.E |
| **Expired Certificate Use** | **Medium** | Validity period checks on Intermediate and Leaf | Tests 9.F, 9.G |
| **Non-CA Intermediate Substitution** | **High** | `basicConstraints` cA requirement | Test 9.H |
| **Key Usage Privilege Escalation** | **High** | `keyCertSign` and `digitalSignature` enforcement | Tests 9.I, 9.J |
| **Non-StoreKit Leaf Substitution** | **High** | Mandatory Apple receipt signing OID `1.2.840.113635.100.6.11.1` | Test 9.K |
| **Cross-App Receipt Sharing** | **Medium** | Bundle ID and `APPLE_APP_ID` matching | Tests 4.C, 4.I, 4.J |
| **Cross-User Account Hijacking** | **Critical** | `appAccountToken` bound to authenticated `auth.uid()` | Test 4.E |
| **Financial Milliunit Precision Drift** | **Low** | Integer-based cents rounding and safe-integer check | Tests 2.F, 2.G |

---

## 12. Synchronized Deliverables & File Checksums

The modified implementation files and their SHA-256 checksums:

| File Path | SHA-256 Checksum |
|---|---|
| `supabase/functions/verify-apple-purchase/appleCrypto.ts` | `f812bcec89dff202a54bf550603e273062ba0df63fae4eb033dea1d607976258` |
| `supabase/functions/verify-apple-purchase/appleBillingCore.ts` | `6f373cd9cf25e39183bdef5bac401abf7fb0c671e76cddb289fa69c5e7aa5904` |
| `supabase/functions/verify-apple-purchase/index.ts` | `931b218bf90332f2baa91e19c18420a4be3490111fdb4828262805103d60cb58` |
| `supabase/functions/verify-apple-purchase/deno.json` | `62bf9ee34f5e1a2ad251d3304d6f844ab8126b0a9656b0c99e9d1912b3c8397f` |
| `src/services/admin/__tests__/applePurchaseVerificationCore.test.ts` | `60d27dc4d5194f5445aad6e332836c610405a8cf9d97003c75ef2af616621e96` |

Both repositories contain synchronized copies of this report:
- `C:\Projects\mocktest-admin\APPLE_IAP_PHASE_3_CRYPTOGRAPHIC_REMEDIATION_REPORT.md`
- `C:\Projects\MockTestApp\APPLE_IAP_PHASE_3_CRYPTOGRAPHIC_REMEDIATION_REPORT.md`

---

## 13. Ponytail Preflight Sign-Off

### What Was Skipped
1. **Third-Party X.509 Libraries**: Did not add `@apple/app-store-server-library`, `node-forge`, or `@peculiar/x509` (avoided broken native bindings in Deno Edge Runtime).
2. **Edge Function Deployment**: Did not deploy the function to live Supabase infrastructure; changes remain local and test-verified.
3. **Database Changes**: Zero migrations or SQL edits were executed (Migrations 247 and 248 remain applied and intact).
4. **Mobile UI Wiring**: Mobile client purchase screens and store UI were not touched.

### Remaining Risks & Operational Notes
1. **App Store Connect Secret Setup**: When deploying the Edge Function to production, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, and `APPLE_APP_ID` environment variables must be populated in Supabase secrets.
2. **Clock Drift**: Certificate validity checks use server system time. Ensure the hosting environment maintains NTP synchronization.

