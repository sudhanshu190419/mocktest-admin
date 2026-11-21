/**
 * Apple StoreKit 2 Cryptographic Verification & API Integration
 *
 * Implements:
 *  1. RFC 5280 X.509 certificate path validation for Apple StoreKit 2 x5c chains:
 *     - Root CA certificate pinned SHA-256 fingerprint verification (Apple Root CA - G3).
 *     - Intermediate CA signature verification against Apple Root CA - G3 public key.
 *     - Intermediate CA basicConstraints (cA = true) and keyUsage (keyCertSign) enforcement.
 *     - Intermediate CA and Leaf validity window (notBefore / notAfter) enforcement.
 *     - Leaf certificate signature verification against Intermediate CA public key.
 *     - Leaf keyUsage (digitalSignature) and Apple receipt signing OID (1.2.840.113635.100.6.11.1) verification.
 *     - Strict chain linkage (issuer DER matches subject DER).
 *  2. ES256 JWS signature verification using native WebCrypto (P-256).
 *  3. ES256 JWT generation for Apple App Store Server API using native WebCrypto.
 *  4. Server-to-server transaction retrieval from Apple App Store Server API.
 *  5. Secure fail-closed validation of transaction payloads.
 *
 * Zero external native/npm dependencies. Fully compatible with:
 *  - Deno / Supabase Edge Runtime
 *  - Node.js (v18+) and Vitest
 */

export const APPLE_ROOT_CA_G3_SHA256 =
  "63343abb87f93c9d646733b1e847a9ef4e06992984a046f414995f5f4c5477d9";

import {
  DEFAULT_APPLE_BUNDLE_ID,
  AppleNotificationPayload,
  AppleNotificationTransactionPayload,
  validateNotificationEnvelope,
} from "./appleNotificationCore";

/** Options for certificate chain verification, allowing testing overrides. */
export interface AppleChainVerifyOptions {
  trustedRootFingerprint?: string;
  currentTimeMs?: number;
  enableOnlineChecks?: boolean;
  ocspTimeoutMs?: number;
  customOcspFetcher?: (url: string, reqDer: Uint8Array) => Promise<Uint8Array>;
  requireAppleReceiptOid?: boolean;
}

/** Result of an OCSP revocation check on an individual certificate. */
export interface OcspCheckResult {
  valid: boolean;
  status: "good" | "revoked" | "unknown" | "unavailable";
  revocationTime?: Date;
  revocationReason?: number;
  thisUpdate?: Date;
  nextUpdate?: Date;
  responderCert?: ParsedX509Certificate;
  error?: string;
  code?: string;
}

/** Represents a parsed ASN.1 DER TLV element. */
export interface Asn1Element {
  tag: number;
  length: number;
  valueOffset: number;
  totalLength: number;
  value: Uint8Array;
  raw: Uint8Array;
}

/** Represents an inspected X.509 certificate. */
export interface ParsedX509Certificate {
  rawDer: Uint8Array;
  tbsDer: Uint8Array;
  sigAlgOid: string;
  sigAlgHash: "SHA-256" | "SHA-384" | "SHA-512";
  derSig: Uint8Array;
  spkiDer: Uint8Array;
  publicKeyBytes: Uint8Array;
  curveName: "P-256" | "P-384";
  issuerRaw: Uint8Array;
  subjectRaw: Uint8Array;
  serialNumberRaw: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  isCa: boolean;
  keyCertSign: boolean;
  digitalSignature: boolean;
  hasAppleReceiptOid: boolean;
  hasOcspSigningOid: boolean;
  aiaOcspUrl?: string;
}

/** Helper to encode a string or Uint8Array into URL-safe base64 (without padding). */
export function encodeBase64Url(input: string | Uint8Array): string {
  let base64: string;
  if (typeof input === "string") {
    base64 = btoa(input);
  } else {
    let binary = "";
    for (let i = 0; i < input.byteLength; i++) {
      binary += String.fromCharCode(input[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Helper to decode a URL-safe base64 string into a Uint8Array. */
export function decodeBase64UrlToBytes(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Converts ArrayBuffer or Uint8Array to lowercase hex string. */
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

/**
 * Safely extracts a clean ArrayBuffer from a Uint8Array view,
 * respecting byteOffset and byteLength.
 */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** Checks byte-for-byte equality between two Uint8Arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Checks whether a byte sequence contains a specific subsequence. */
function containsSubarray(haystack: Uint8Array, needle: number[]): boolean {
  if (haystack.length < needle.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Reads a single ASN.1 DER TLV element from a Uint8Array at the specified offset.
 */
export function readAsn1(bytes: Uint8Array, offset: number = 0): Asn1Element {
  if (offset >= bytes.length) {
    throw new Error(`Unexpected EOF reading ASN.1 at offset ${offset}.`);
  }

  const start = offset;
  const tag = bytes[offset++];
  let length = 0;
  const firstLen = bytes[offset++];

  if (firstLen < 0x80) {
    length = firstLen;
  } else {
    const numBytes = firstLen & 0x7f;
    if (numBytes === 0 || numBytes > 4) {
      throw new Error(`Invalid ASN.1 length byte: 0x${firstLen.toString(16)}.`);
    }
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | bytes[offset++];
    }
  }

  const valueOffset = offset;
  if (valueOffset + length > bytes.length) {
    throw new Error(`ASN.1 element value exceeds buffer length (${valueOffset + length} > ${bytes.length}).`);
  }

  const totalLength = valueOffset - start + length;
  return {
    tag,
    length,
    valueOffset,
    totalLength,
    value: bytes.subarray(valueOffset, valueOffset + length),
    raw: bytes.subarray(start, start + totalLength),
  };
}

/**
 * Parses all contiguous ASN.1 DER children within a container's value bytes.
 */
export function parseAsn1Children(containerBytes: Uint8Array): Asn1Element[] {
  const children: Asn1Element[] = [];
  let offset = 0;
  while (offset < containerBytes.length) {
    const el = readAsn1(containerBytes, offset);
    children.push(el);
    offset += el.totalLength;
  }
  return children;
}

/**
 * Decodes an ASN.1 DER Object Identifier (OID) byte slice to dot-separated string.
 */
export function parseOid(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const parts: number[] = [];
  const first = bytes[0];
  parts.push(Math.floor(first / 40));
  parts.push(first % 40);

  let val = 0;
  for (let i = 1; i < bytes.length; i++) {
    const b = bytes[i];
    val = (val << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(val);
      val = 0;
    }
  }
  return parts.join(".");
}

/**
 * Parses UTCTime (tag 0x17) or GeneralizedTime (tag 0x18) to Date.
 */
function parseTime(el: Asn1Element): Date {
  const str = new TextDecoder().decode(el.value);
  if (el.tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ
    const yearStr = str.slice(0, 2);
    let year = parseInt(yearStr, 10);
    year += year >= 50 ? 1900 : 2000;
    const month = parseInt(str.slice(2, 4), 10) - 1;
    const day = parseInt(str.slice(4, 6), 10);
    const hour = parseInt(str.slice(6, 8), 10);
    const min = parseInt(str.slice(8, 10), 10);
    const sec = parseInt(str.slice(10, 12), 10);
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  } else if (el.tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMMSSZ
    const year = parseInt(str.slice(0, 4), 10);
    const month = parseInt(str.slice(4, 6), 10) - 1;
    const day = parseInt(str.slice(6, 8), 10);
    const hour = parseInt(str.slice(8, 10), 10);
    const min = parseInt(str.slice(10, 12), 10);
    const sec = parseInt(str.slice(12, 14), 10);
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }
  throw new Error(`Unsupported ASN.1 time tag: 0x${el.tag.toString(16)}.`);
}

/**
 * Converts ASN.1 DER encoded ECDSA signature (SEQUENCE { r INTEGER, s INTEGER })
 * into IEEE P1363 raw signature (r || s), required by WebCrypto crypto.subtle.verify.
 */
export function derSignatureToP1363(derSigBytes: Uint8Array, coordLen: number = 32): Uint8Array {
  const seqEl = readAsn1(derSigBytes, 0);
  if (seqEl.tag !== 0x30) {
    throw new Error("Invalid DER signature: expected SEQUENCE.");
  }

  const rEl = readAsn1(seqEl.value, 0);
  const sEl = readAsn1(seqEl.value, rEl.totalLength);

  let r = rEl.value;
  let s = sEl.value;

  // Trim leading 0x00 byte added for positive signed INTEGER in DER
  if (r.length > coordLen && r[0] === 0x00) {
    r = r.subarray(1);
  }
  if (s.length > coordLen && s[0] === 0x00) {
    s = s.subarray(1);
  }

  const out = new Uint8Array(coordLen * 2);
  out.set(r, coordLen - r.length);
  out.set(s, coordLen * 2 - s.length);
  return out;
}

/**
 * Parses a DER-encoded X.509 certificate according to RFC 5280.
 * Extracts TBSCertificate, signatureAlgorithm, signatureValue, SPKI, validity, and extensions.
 */
export function parseX509Der(derBytes: Uint8Array): ParsedX509Certificate {
  const top = readAsn1(derBytes, 0);
  if (top.tag !== 0x30) {
    throw new Error("Expected SEQUENCE (0x30) at top level of X.509 certificate.");
  }

  const certChildren = parseAsn1Children(top.value);
  if (certChildren.length < 3) {
    throw new Error(`X.509 certificate must contain at least 3 elements, found ${certChildren.length}.`);
  }

  const tbsEl = certChildren[0];
  const sigAlgEl = certChildren[1];
  const sigValEl = certChildren[2];

  // Exact DER bytes that were signed
  const tbsDer = tbsEl.raw;

  // Parse signatureAlgorithm
  const sigAlgChildren = parseAsn1Children(sigAlgEl.value);
  if (sigAlgChildren.length === 0 || sigAlgChildren[0].tag !== 0x06) {
    throw new Error("Missing or invalid algorithm OID in signatureAlgorithm.");
  }
  const sigAlgOid = parseOid(sigAlgChildren[0].value);
  let sigAlgHash: "SHA-256" | "SHA-384" | "SHA-512" = "SHA-256";
  if (sigAlgOid === "1.2.840.10045.4.3.3") {
    sigAlgHash = "SHA-384";
  } else if (sigAlgOid === "1.2.840.10045.4.3.4") {
    sigAlgHash = "SHA-512";
  }

  // Parse signatureValue (BIT STRING)
  if (sigValEl.tag !== 0x03 || sigValEl.value.length < 2) {
    throw new Error("Missing or invalid BIT STRING in signatureValue.");
  }
  // Byte 0 is unused bits; remaining bytes are the DER-encoded ECDSA signature
  const derSig = sigValEl.value.subarray(1);

  // Parse TBSCertificate
  const tbsChildren = parseAsn1Children(tbsEl.value);
  let idx = 0;
  // Optional explicit version [0]
  if (tbsChildren[idx].tag === 0xa0) {
    idx++;
  }

  // serialNumber
  if (idx >= tbsChildren.length) throw new Error("Missing serialNumber in TBSCertificate.");
  const serialNumberRaw = tbsChildren[idx].value;
  idx++;
  // signature algorithm inside TBS
  idx++;

  // issuer Name
  if (idx >= tbsChildren.length) throw new Error("Missing issuer in TBSCertificate.");
  const issuerRaw = tbsChildren[idx].raw;
  idx++;

  // validity
  if (idx >= tbsChildren.length) throw new Error("Missing validity in TBSCertificate.");
  const valChildren = parseAsn1Children(tbsChildren[idx].value);
  if (valChildren.length < 2) throw new Error("Validity SEQUENCE must contain notBefore and notAfter.");
  const notBefore = parseTime(valChildren[0]);
  const notAfter = parseTime(valChildren[1]);
  idx++;

  // subject Name
  if (idx >= tbsChildren.length) throw new Error("Missing subject in TBSCertificate.");
  const subjectRaw = tbsChildren[idx].raw;
  idx++;

  // subjectPublicKeyInfo
  if (idx >= tbsChildren.length) throw new Error("Missing subjectPublicKeyInfo in TBSCertificate.");
  const spkiDer = tbsChildren[idx].raw;
  const spkiChildren = parseAsn1Children(tbsChildren[idx].value);
  let publicKeyBytes = new Uint8Array(0);
  if (spkiChildren.length >= 2 && spkiChildren[1].tag === 0x03 && spkiChildren[1].value.length > 1) {
    publicKeyBytes = new Uint8Array(spkiChildren[1].value.subarray(1));
  }
  idx++;

  // Detect curve: P-384 OID is 1.3.132.0.34 (06 05 2b 81 04 00 22)
  let curveName: "P-256" | "P-384" = "P-256";
  const p384OidBytes = [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22];
  if (containsSubarray(spkiDer, p384OidBytes)) {
    curveName = "P-384";
  }

  // Parse extensions ([3] EXPLICIT Extensions)
  let isCa = false;
  let keyCertSign = false;
  let digitalSignature = false;
  let hasAppleReceiptOid = false;
  let hasOcspSigningOid = false;
  let aiaOcspUrl: string | undefined = undefined;

  for (; idx < tbsChildren.length; idx++) {
    const el = tbsChildren[idx];
    if (el.tag === 0xa3) {
      const extSeq = readAsn1(el.value, 0);
      const extItems = parseAsn1Children(extSeq.value);
      for (const item of extItems) {
        const itemChildren = parseAsn1Children(item.value);
        if (itemChildren.length > 0 && itemChildren[0].tag === 0x06) {
          const oidStr = parseOid(itemChildren[0].value);
          const octet = itemChildren[itemChildren.length - 1];
          if (octet.tag === 0x04) {
            if (oidStr === "2.5.29.19") {
              // BasicConstraints: check if cA is TRUE (0x01, 0x01, 0xff or non-zero)
              const bcBytes = octet.value;
              for (let b = 0; b < bcBytes.length - 2; b++) {
                if (bcBytes[b] === 0x01 && bcBytes[b + 1] === 0x01 && bcBytes[b + 2] !== 0x00) {
                  isCa = true;
                  break;
                }
              }
            } else if (oidStr === "2.5.29.15") {
              // KeyUsage: BIT STRING
              const kuBitStr = readAsn1(octet.value, 0);
              if (kuBitStr.tag === 0x03 && kuBitStr.value.length >= 2) {
                const mask = kuBitStr.value[1];
                if ((mask & 0x80) !== 0) digitalSignature = true;
                if ((mask & 0x04) !== 0) keyCertSign = true;
              }
            } else if (oidStr === "2.5.29.37") {
              // ExtendedKeyUsage: SEQUENCE OF OID
              try {
                const ekuSeq = readAsn1(octet.value, 0);
                const ekuChildren = parseAsn1Children(ekuSeq.value);
                for (const ekuEl of ekuChildren) {
                  if (ekuEl.tag === 0x06 && parseOid(ekuEl.value) === "1.3.6.1.5.5.7.3.9") {
                    hasOcspSigningOid = true;
                  }
                }
              } catch {
                // Ignore malformed EKU
              }
            } else if (oidStr === "1.3.6.1.5.5.7.1.1") {
              // Authority Information Access (AIA)
              try {
                const aiaSeq = readAsn1(octet.value, 0);
                const aiaChildren = parseAsn1Children(aiaSeq.value);
                for (const desc of aiaChildren) {
                  const descChildren = parseAsn1Children(desc.value);
                  if (descChildren.length >= 2 && descChildren[0].tag === 0x06) {
                    const methodOid = parseOid(descChildren[0].value);
                    if (methodOid === "1.3.6.1.5.5.7.48.1" && descChildren[1].tag === 0x86) {
                      aiaOcspUrl = new TextDecoder().decode(descChildren[1].value);
                    }
                  }
                }
              } catch {
                // Ignore malformed AIA
              }
            } else if (oidStr === "1.2.840.113635.100.6.11.1") {
              hasAppleReceiptOid = true;
            }
          }
        }
      }
    }
  }

  return {
    rawDer: derBytes,
    tbsDer,
    sigAlgOid,
    sigAlgHash,
    derSig,
    spkiDer,
    publicKeyBytes,
    curveName,
    issuerRaw,
    subjectRaw,
    serialNumberRaw,
    notBefore,
    notAfter,
    isCa,
    keyCertSign,
    digitalSignature,
    hasAppleReceiptOid,
    hasOcspSigningOid,
    aiaOcspUrl,
  };
}

/**
 * Cryptographically verifies that a child certificate was signed by a parent certificate.
 */
export async function verifyCertificateSignature(
  childCert: ParsedX509Certificate,
  parentCert: ParsedX509Certificate
): Promise<boolean> {
  try {
    const parentKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(parentCert.spkiDer),
      { name: "ECDSA", namedCurve: parentCert.curveName },
      false,
      ["verify"]
    );

    const coordLen = parentCert.curveName === "P-384" ? 48 : 32;
    const p1363Sig = derSignatureToP1363(childCert.derSig, coordLen);

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: { name: childCert.sigAlgHash } },
      parentKey,
      toArrayBuffer(p1363Sig),
      toArrayBuffer(childCert.tbsDer)
    );
  } catch {
    return false;
  }
}

/**
 * Validates the full RFC 5280 X.509 certificate chain from Leaf to Root.
 *
 * Enforces:
 *  1. Root CA certificate pinned SHA-256 fingerprint verification (Apple Root CA - G3).
 *  2. Intermediate CA signature verification against Root CA public key.
 *  3. Intermediate CA basicConstraints (cA = true) and keyUsage (keyCertSign).
 *  4. Intermediate CA validity dates (notBefore / notAfter).
 *  5. Intermediate CA issuer matches Root CA subject.
 *  6. Leaf certificate signature verification against Intermediate CA public key.
 *  7. Leaf certificate keyUsage (digitalSignature) and Apple receipt signing OID.
 *  8. Leaf certificate validity dates (notBefore / notAfter).
 *  9. Leaf certificate issuer matches Intermediate CA subject.
 */
export async function verifyAppleCertificateChain(
  x5c: string[],
  options?: AppleChainVerifyOptions
): Promise<{
  valid: boolean;
  leafCert?: ParsedX509Certificate;
  error?: string;
  code?: string;
}> {
  if (!Array.isArray(x5c) || x5c.length < 3) {
    return {
      valid: false,
      error: `Incomplete x5c certificate chain: expected at least 3 certificates, got ${x5c?.length || 0}.`,
      code: "INCOMPLETE_CERT_CHAIN",
    };
  }

  const nowMs = options?.currentTimeMs ?? Date.now();
  const trustedRootFp = options?.trustedRootFingerprint ?? APPLE_ROOT_CA_G3_SHA256;

  // 1. Root Certificate: x5c[last]
  const rootDer = decodeBase64UrlToBytes(x5c[x5c.length - 1]);
  const rootDigest = await crypto.subtle.digest("SHA-256", toArrayBuffer(rootDer));
  const rootFingerprint = bufferToHex(rootDigest);

  if (rootFingerprint !== trustedRootFp) {
    return {
      valid: false,
      error: `Root certificate digest '${rootFingerprint}' does not match trusted Root CA.`,
      code: "ROOT_CA_MISMATCH",
    };
  }

  let rootCert: ParsedX509Certificate;
  try {
    rootCert = parseX509Der(rootDer);
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to parse Root CA certificate: ${err?.message || err}`,
      code: "MALFORMED_ROOT_CERTIFICATE",
    };
  }

  // 2. Intermediate Certificate: x5c[1]
  const intermediateDer = decodeBase64UrlToBytes(x5c[1]);
  let intermediateCert: ParsedX509Certificate;
  try {
    intermediateCert = parseX509Der(intermediateDer);
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to parse Intermediate CA certificate: ${err?.message || err}`,
      code: "MALFORMED_INTERMEDIATE_CERTIFICATE",
    };
  }

  // Validity period of intermediate
  if (nowMs < intermediateCert.notBefore.getTime() || nowMs > intermediateCert.notAfter.getTime()) {
    return {
      valid: false,
      error: `Intermediate certificate has expired or is not yet valid (notBefore: ${intermediateCert.notBefore.toISOString()}, notAfter: ${intermediateCert.notAfter.toISOString()}).`,
      code: "CERTIFICATE_EXPIRED",
    };
  }

  // Intermediate basicConstraints must have cA = true
  if (!intermediateCert.isCa) {
    return {
      valid: false,
      error: "Intermediate certificate does not possess basicConstraints cA=true.",
      code: "INVALID_CA_CONSTRAINTS",
    };
  }

  // Intermediate keyUsage must have keyCertSign
  if (!intermediateCert.keyCertSign) {
    return {
      valid: false,
      error: "Intermediate certificate is missing keyCertSign key usage constraint.",
      code: "INVALID_KEY_USAGE",
    };
  }

  // Intermediate issuer must match Root subject
  if (!bytesEqual(intermediateCert.issuerRaw, rootCert.subjectRaw)) {
    return {
      valid: false,
      error: "Intermediate certificate issuer does not match Root CA subject.",
      code: "ISSUER_MISMATCH",
    };
  }

  // Cryptographically verify Intermediate signature against Root public key
  const intermediateSigValid = await verifyCertificateSignature(intermediateCert, rootCert);
  if (!intermediateSigValid) {
    return {
      valid: false,
      error: "Intermediate certificate signature verification failed against Root CA.",
      code: "INTERMEDIATE_SIGNATURE_INVALID",
    };
  }

  // 3. Leaf Certificate: x5c[0]
  const leafDer = decodeBase64UrlToBytes(x5c[0]);
  let leafCert: ParsedX509Certificate;
  try {
    leafCert = parseX509Der(leafDer);
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to parse Leaf certificate: ${err?.message || err}`,
      code: "MALFORMED_LEAF_CERTIFICATE",
    };
  }

  // Validity period of leaf
  if (nowMs < leafCert.notBefore.getTime() || nowMs > leafCert.notAfter.getTime()) {
    return {
      valid: false,
      error: `Leaf certificate has expired or is not yet valid (notBefore: ${leafCert.notBefore.toISOString()}, notAfter: ${leafCert.notAfter.toISOString()}).`,
      code: "CERTIFICATE_EXPIRED",
    };
  }

  // Leaf keyUsage must have digitalSignature
  if (!leafCert.digitalSignature) {
    return {
      valid: false,
      error: "Leaf certificate is missing digitalSignature key usage constraint.",
      code: "INVALID_KEY_USAGE",
    };
  }

  // Leaf Apple Receipt Signing OID: 1.2.840.113635.100.6.11.1
  const requireOid = options?.requireAppleReceiptOid ?? true;
  if (requireOid && !leafCert.hasAppleReceiptOid) {
    return {
      valid: false,
      error: "Leaf certificate is missing mandatory Apple receipt signing extension (1.2.840.113635.100.6.11.1).",
      code: "MISSING_APPLE_OID",
    };
  }

  // Leaf issuer must match Intermediate subject
  if (!bytesEqual(leafCert.issuerRaw, intermediateCert.subjectRaw)) {
    return {
      valid: false,
      error: "Leaf certificate issuer does not match Intermediate CA subject.",
      code: "ISSUER_MISMATCH",
    };
  }

  // Cryptographically verify Leaf signature against Intermediate public key
  const leafSigValid = await verifyCertificateSignature(leafCert, intermediateCert);
  if (!leafSigValid) {
    return {
      valid: false,
      error: "Leaf certificate signature verification failed against Intermediate CA.",
      code: "LEAF_SIGNATURE_INVALID",
    };
  }

  // 4. Online OCSP Revocation Checks (when enableOnlineChecks is enabled)
  if (options?.enableOnlineChecks) {
    // 4a. Check Intermediate certificate revocation against Root CA
    const intermediateOcsp = await checkCertificateOcspStatus(intermediateCert, rootCert, options);
    if (!intermediateOcsp.valid) {
      return {
        valid: false,
        error: `Intermediate certificate OCSP check failed: ${intermediateOcsp.error}`,
        code: intermediateOcsp.code || "OCSP_CHECK_FAILED",
      };
    }

    // 4b. Check Leaf certificate revocation against Intermediate CA
    const leafOcsp = await checkCertificateOcspStatus(leafCert, intermediateCert, options);
    if (!leafOcsp.valid) {
      return {
        valid: false,
        error: `Leaf certificate OCSP check failed: ${leafOcsp.error}`,
        code: leafOcsp.code || "OCSP_CHECK_FAILED",
      };
    }
  }

  return {
    valid: true,
    leafCert,
  };
}

/**
 * Encodes an ASN.1 DER length octet sequence.
 */
export function encodeAsn1Length(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

/**
 * Encodes an ASN.1 DER TLV element.
 */
export function encodeAsn1Tlv(tag: number, value: Uint8Array): Uint8Array {
  const lenBytes = encodeAsn1Length(value.length);
  const out = new Uint8Array(1 + lenBytes.length + value.length);
  out[0] = tag;
  out.set(lenBytes, 1);
  out.set(value, 1 + lenBytes.length);
  return out;
}

/**
 * Encodes a list of ASN.1 elements into an ASN.1 DER SEQUENCE (0x30).
 */
export function encodeAsn1Sequence(items: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const item of items) {
    totalLength += item.length;
  }
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const item of items) {
    merged.set(item, offset);
    offset += item.length;
  }
  return encodeAsn1Tlv(0x30, merged);
}

/**
 * Encodes a positive ASN.1 DER INTEGER (0x02), adding a leading 0x00 byte if the high bit is set.
 */
export function encodeAsn1Integer(intBytes: Uint8Array): Uint8Array {
  let b = intBytes;
  if ((b[0] & 0x80) !== 0) {
    const padded = new Uint8Array(b.length + 1);
    padded[0] = 0x00;
    padded.set(b, 1);
    b = padded;
  }
  return encodeAsn1Tlv(0x02, b);
}

/**
 * Normalizes an ASN.1 DER INTEGER byte sequence by removing redundant leading zeroes
 * while preserving a single byte for zero.
 */
export function normalizeDerInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00) {
    start++;
  }
  return bytes.subarray(start);
}

/**
 * Extracts the AIA OCSP responder URL from a DER-encoded X.509 certificate.
 */
export function extractAiaOcspUrl(certDer: Uint8Array): string | null {
  try {
    const cert = parseX509Der(certDer);
    return cert.aiaOcspUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Constructs an RFC 6960 OCSPRequest DER byte payload for a target certificate.
 */
export async function buildOcspRequest(
  targetCert: ParsedX509Certificate,
  issuerCert: ParsedX509Certificate
): Promise<Uint8Array> {
  // 1. issuerNameHash = SHA-1(issuer.subjectRaw)
  const nameHashBuf = await crypto.subtle.digest("SHA-1", toArrayBuffer(issuerCert.subjectRaw));
  const issuerNameHash = new Uint8Array(nameHashBuf);

  // 2. issuerKeyHash = SHA-1(issuer public key bytes without unused bits count byte)
  const keyHashBuf = await crypto.subtle.digest("SHA-1", toArrayBuffer(issuerCert.publicKeyBytes));
  const issuerKeyHash = new Uint8Array(keyHashBuf);

  // 3. CertID: hashAlgorithm SHA-1 (1.3.14.3.2.26)
  const sha1AlgId = new Uint8Array([
    0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00,
  ]);
  const nameHashOctet = encodeAsn1Tlv(0x04, issuerNameHash);
  const keyHashOctet = encodeAsn1Tlv(0x04, issuerKeyHash);
  const serialInt = encodeAsn1Integer(targetCert.serialNumberRaw);

  const certIdSeq = encodeAsn1Sequence([
    sha1AlgId,
    nameHashOctet,
    keyHashOctet,
    serialInt,
  ]);

  // Request ::= SEQUENCE { reqCert CertID }
  const requestSeq = encodeAsn1Sequence([certIdSeq]);

  // requestList ::= SEQUENCE OF Request
  const requestListSeq = encodeAsn1Sequence([requestSeq]);

  // tbsRequest ::= SEQUENCE { requestList }
  const tbsRequestSeq = encodeAsn1Sequence([requestListSeq]);

  // OCSPRequest ::= SEQUENCE { tbsRequest }
  return encodeAsn1Sequence([tbsRequestSeq]);
}

/**
 * Parses and cryptographically verifies an RFC 6960 OCSPResponse.
 */
export async function parseAndVerifyOcspResponse(
  resBytes: Uint8Array,
  targetCert: ParsedX509Certificate,
  issuerCert: ParsedX509Certificate,
  options?: { currentTimeMs?: number }
): Promise<OcspCheckResult> {
  const nowMs = options?.currentTimeMs ?? Date.now();

  try {
    const top = readAsn1(resBytes, 0);
    if (top.tag !== 0x30) {
      return {
        valid: false,
        status: "unavailable",
        error: "Expected top-level SEQUENCE in OCSPResponse.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    const topChildren = parseAsn1Children(top.value);
    if (topChildren.length === 0 || topChildren[0].tag !== 0x0a) {
      return {
        valid: false,
        status: "unavailable",
        error: "Missing or invalid responseStatus in OCSPResponse.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    const responseStatus = topChildren[0].value[0];
    if (responseStatus !== 0) {
      const statusMap: Record<number, string> = {
        1: "malformedRequest",
        2: "internalError",
        3: "tryLater",
        5: "sigRequired",
        6: "unauthorized",
      };
      const statusName = statusMap[responseStatus] || `error_${responseStatus}`;
      return {
        valid: false,
        status: "unavailable",
        error: `OCSP responder returned status: ${statusName} (${responseStatus}).`,
        code: "OCSP_STATUS_ERROR",
      };
    }

    if (topChildren.length < 2 || topChildren[1].tag !== 0xa0) {
      return {
        valid: false,
        status: "unavailable",
        error: "Missing responseBytes in successful OCSPResponse.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    // ResponseBytes ::= SEQUENCE { responseType OBJECT IDENTIFIER, response OCTET STRING }
    const rbSeq = readAsn1(topChildren[1].value, 0);
    const rbChildren = parseAsn1Children(rbSeq.value);
    if (rbChildren.length < 2 || rbChildren[1].tag !== 0x04) {
      return {
        valid: false,
        status: "unavailable",
        error: "Missing response OCTET STRING in ResponseBytes.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    // BasicOCSPResponse ::= SEQUENCE { tbsResponseData, signatureAlgorithm, signature, certs [0] OPTIONAL }
    const basicSeq = readAsn1(rbChildren[1].value, 0);
    const basicChildren = parseAsn1Children(basicSeq.value);
    if (basicChildren.length < 3) {
      return {
        valid: false,
        status: "unavailable",
        error: "BasicOCSPResponse must contain at least 3 elements.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    const tbsResponseData = basicChildren[0];
    const signatureAlgorithm = basicChildren[1];
    const signatureEl = basicChildren[2];

    if (signatureEl.tag !== 0x03 || signatureEl.value.length < 2) {
      return {
        valid: false,
        status: "unavailable",
        error: "Missing or invalid BIT STRING signature in BasicOCSPResponse.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    // Determine signer: delegated responder certificate in certs [0], or issuer CA directly
    let responderCert: ParsedX509Certificate | undefined;
    if (basicChildren.length > 3 && basicChildren[3].tag === 0xa0) {
      const certSeq = readAsn1(basicChildren[3].value, 0);
      const certItems = parseAsn1Children(certSeq.value);
      if (certItems.length > 0) {
        try {
          responderCert = parseX509Der(certItems[0].raw);
        } catch (err: any) {
          return {
            valid: false,
            status: "unavailable",
            error: `Failed to parse OCSP responder certificate: ${err?.message || err}`,
            code: "MALFORMED_OCSP_RESPONSE",
          };
        }

        // Check responder validity window
        if (nowMs < responderCert.notBefore.getTime() || nowMs > responderCert.notAfter.getTime()) {
          return {
            valid: false,
            status: "unavailable",
            error: "OCSP responder certificate has expired or is not yet valid.",
            code: "CERTIFICATE_EXPIRED",
          };
        }

        // Verify responder certificate was issued by the issuer CA
        const isSigned = await verifyCertificateSignature(responderCert, issuerCert);
        if (!isSigned) {
          return {
            valid: false,
            status: "unavailable",
            error: "OCSP responder certificate is not cryptographically signed by issuer CA.",
            code: "OCSP_RESPONDER_NOT_AUTHORIZED",
          };
        }

        // Verify responder certificate possesses id-kp-OCSPSigning (1.3.6.1.5.5.7.3.9)
        if (!responderCert.hasOcspSigningOid) {
          return {
            valid: false,
            status: "unavailable",
            error: "OCSP responder certificate is missing id-kp-OCSPSigning (1.3.6.1.5.5.7.3.9).",
            code: "INVALID_KEY_USAGE",
          };
        }
      }
    }

    const signer = responderCert || issuerCert;

    // Verify cryptographic signature of BasicOCSPResponse
    let signerKey: CryptoKey;
    try {
      signerKey = await crypto.subtle.importKey(
        "spki",
        toArrayBuffer(signer.spkiDer),
        { name: "ECDSA", namedCurve: signer.curveName },
        false,
        ["verify"]
      );
    } catch (err: any) {
      return {
        valid: false,
        status: "unavailable",
        error: `Failed to import OCSP signer key: ${err?.message || err}`,
        code: "KEY_IMPORT_FAILED",
      };
    }

    const coordLen = signer.curveName === "P-384" ? 48 : 32;
    const derSigBytes = signatureEl.value.subarray(1); // skip unused bits byte
    let p1363Sig: Uint8Array;
    try {
      p1363Sig = derSignatureToP1363(derSigBytes, coordLen);
    } catch {
      return {
        valid: false,
        status: "unavailable",
        error: "Malformed ECDSA signature DER in OCSP response.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    // Determine hash algorithm from signatureAlgorithm OID or signer curve
    let hashAlg = "SHA-256";
    const sigAlgChildren = parseAsn1Children(signatureAlgorithm.value);
    if (sigAlgChildren.length > 0 && sigAlgChildren[0].tag === 0x06) {
      const sigAlgOid = parseOid(sigAlgChildren[0].value);
      if (sigAlgOid === "1.2.840.10045.4.3.3") {
        hashAlg = "SHA-384";
      } else if (sigAlgOid === "1.2.840.10045.4.3.4") {
        hashAlg = "SHA-512";
      }
    } else if (signer.curveName === "P-384") {
      hashAlg = "SHA-384";
    }

    const isSigValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: { name: hashAlg } },
      signerKey,
      toArrayBuffer(p1363Sig),
      toArrayBuffer(tbsResponseData.raw)
    );

    if (!isSigValid) {
      return {
        valid: false,
        status: "unavailable",
        error: "OCSP response cryptographic signature verification failed.",
        code: "OCSP_SIGNATURE_INVALID",
      };
    }

    // Parse ResponseData -> responses SEQUENCE OF SingleResponse
    const rdChildren = parseAsn1Children(tbsResponseData.value);
    let responsesSeq: Asn1Element | null = null;
    for (const el of rdChildren) {
      if (el.tag === 0x30) {
        responsesSeq = el;
      }
    }

    if (!responsesSeq) {
      return {
        valid: false,
        status: "unavailable",
        error: "Missing responses SEQUENCE in OCSP ResponseData.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    // Precalculate expected issuerNameHash and issuerKeyHash for SHA-1 and SHA-256 (RFC 6960 Section 4.1.1)
    const [nameHashSha1Buf, keyHashSha1Buf, nameHashSha256Buf, keyHashSha256Buf] = await Promise.all([
      crypto.subtle.digest("SHA-1", toArrayBuffer(issuerCert.subjectRaw)),
      crypto.subtle.digest("SHA-1", toArrayBuffer(issuerCert.publicKeyBytes)),
      crypto.subtle.digest("SHA-256", toArrayBuffer(issuerCert.subjectRaw)),
      crypto.subtle.digest("SHA-256", toArrayBuffer(issuerCert.publicKeyBytes)),
    ]);
    const expectedNameHashSha1 = new Uint8Array(nameHashSha1Buf);
    const expectedKeyHashSha1 = new Uint8Array(keyHashSha1Buf);
    const expectedNameHashSha256 = new Uint8Array(nameHashSha256Buf);
    const expectedKeyHashSha256 = new Uint8Array(keyHashSha256Buf);

    const singleResponses = parseAsn1Children(responsesSeq.value);
    let matchedResponse: Asn1Element[] | null = null;

    for (const sr of singleResponses) {
      if (sr.tag === 0x30) {
        const srChildren = parseAsn1Children(sr.value);
        if (srChildren.length >= 3 && srChildren[0].tag === 0x30) {
          const certIdChildren = parseAsn1Children(srChildren[0].value);
          if (certIdChildren.length >= 4 && certIdChildren[3].tag === 0x02) {
            const respSerial = certIdChildren[3].value;
            // Match normalized certificate serial number
            if (bytesEqual(normalizeDerInteger(respSerial), normalizeDerInteger(targetCert.serialNumberRaw))) {
              // Serial matches. Strictly validate all 4 CertID elements per RFC 6960 Section 4.1.1:
              // 1. hashAlgorithm AlgorithmIdentifier
              const hashAlgEl = certIdChildren[0];
              if (hashAlgEl.tag !== 0x30) {
                return {
                  valid: false,
                  status: "unavailable",
                  error: "Malformed hashAlgorithm SEQUENCE in OCSP CertID.",
                  code: "MALFORMED_OCSP_RESPONSE",
                };
              }
              const hashAlgChildren = parseAsn1Children(hashAlgEl.value);
              if (hashAlgChildren.length === 0 || hashAlgChildren[0].tag !== 0x06) {
                return {
                  valid: false,
                  status: "unavailable",
                  error: "Missing hash algorithm OID in OCSP CertID.",
                  code: "MALFORMED_OCSP_RESPONSE",
                };
              }
              const hashOid = parseOid(hashAlgChildren[0].value);

              // 2. issuerNameHash OCTET STRING
              const nameHashEl = certIdChildren[1];
              if (nameHashEl.tag !== 0x04) {
                return {
                  valid: false,
                  status: "unavailable",
                  error: "Malformed issuerNameHash OCTET STRING in OCSP CertID.",
                  code: "MALFORMED_OCSP_RESPONSE",
                };
              }

              // 3. issuerKeyHash OCTET STRING
              const keyHashEl = certIdChildren[2];
              if (keyHashEl.tag !== 0x04) {
                return {
                  valid: false,
                  status: "unavailable",
                  error: "Malformed issuerKeyHash OCTET STRING in OCSP CertID.",
                  code: "MALFORMED_OCSP_RESPONSE",
                };
              }

              // Verify hash algorithm is supported (SHA-1: 1.3.14.3.2.26, SHA-256: 2.16.840.1.101.3.4.2.1)
              let expectedNameHash: Uint8Array;
              let expectedKeyHash: Uint8Array;
              if (hashOid === "1.3.14.3.2.26") {
                expectedNameHash = expectedNameHashSha1;
                expectedKeyHash = expectedKeyHashSha1;
              } else if (hashOid === "2.16.840.1.101.3.4.2.1") {
                expectedNameHash = expectedNameHashSha256;
                expectedKeyHash = expectedKeyHashSha256;
              } else {
                return {
                  valid: false,
                  status: "unavailable",
                  error: `Unsupported hash algorithm OID '${hashOid}' in OCSP CertID. Only SHA-1 and SHA-256 are supported.`,
                  code: "UNSUPPORTED_HASH_ALGORITHM",
                };
              }

              // Verify issuerNameHash and issuerKeyHash match issuer certificate
              const nameMatches = bytesEqual(nameHashEl.value, expectedNameHash);
              const keyMatches = bytesEqual(keyHashEl.value, expectedKeyHash);
              if (!nameMatches || !keyMatches) {
                return {
                  valid: false,
                  status: "unavailable",
                  error: "OCSP CertID issuerNameHash or issuerKeyHash mismatch against issuer certificate.",
                  code: "OCSP_ISSUER_MISMATCH",
                };
              }

              matchedResponse = srChildren;
              break;
            }
          }
        }
      }
    }

    if (!matchedResponse) {
      return {
        valid: false,
        status: "unavailable",
        error: "No matching SingleResponse found in OCSP response for target certificate serial.",
        code: "OCSP_SERIAL_MISMATCH",
      };
    }

    const statusEl = matchedResponse[1];
    let thisUpdate: Date;
    try {
      thisUpdate = parseTime(matchedResponse[2]);
    } catch {
      return {
        valid: false,
        status: "unavailable",
        error: "Failed to parse thisUpdate timestamp in OCSP response.",
        code: "MALFORMED_OCSP_RESPONSE",
      };
    }

    let nextUpdate: Date | undefined;
    if (matchedResponse.length > 3 && matchedResponse[3].tag === 0xa0) {
      try {
        const nuSeq = readAsn1(matchedResponse[3].value, 0);
        nextUpdate = parseTime(nuSeq);
      } catch {
        // Ignore nextUpdate parse error if optional
      }
    }

    // Freshness check: 5-minute clock skew tolerance
    const SKEW_MS = 5 * 60 * 1000;
    if (nowMs < thisUpdate.getTime() - SKEW_MS) {
      return {
        valid: false,
        status: "unavailable",
        error: `OCSP response thisUpdate is in the future (${thisUpdate.toISOString()}).`,
        code: "OCSP_NOT_YET_VALID",
      };
    }

    if (nextUpdate && nowMs > nextUpdate.getTime() + SKEW_MS) {
      return {
        valid: false,
        status: "unavailable",
        error: `OCSP response expired at ${nextUpdate.toISOString()} (current time: ${new Date(nowMs).toISOString()}).`,
        code: "OCSP_RESPONSE_EXPIRED",
      };
    }

    // Inspect CertStatus tag: 0x80 = good, 0xa1 = revoked, 0x82 = unknown
    if (statusEl.tag === 0x80) {
      return {
        valid: true,
        status: "good",
        thisUpdate,
        nextUpdate,
        responderCert,
      };
    } else if (statusEl.tag === 0xa1) {
      let revocationTime: Date | undefined;
      try {
        const revChildren = parseAsn1Children(statusEl.value);
        if (revChildren.length > 0) {
          const revTimeEl = revChildren[0].tag === 0x30 ? parseAsn1Children(revChildren[0].value)[0] : revChildren[0];
          revocationTime = parseTime(revTimeEl);
        } else {
          revocationTime = parseTime(readAsn1(statusEl.value, 0));
        }
      } catch {
        // Fallback
      }
      return {
        valid: false,
        status: "revoked",
        revocationTime,
        error: `Certificate has been revoked by CA${revocationTime ? ` on ${revocationTime.toISOString()}` : ""}.`,
        code: "CERTIFICATE_REVOKED",
      };
    } else if (statusEl.tag === 0x82) {
      return {
        valid: false,
        status: "unknown",
        error: "Certificate status is unknown to OCSP responder.",
        code: "CERTIFICATE_STATUS_UNKNOWN",
      };
    }

    return {
      valid: false,
      status: "unavailable",
      error: `Unsupported CertStatus tag 0x${statusEl.tag.toString(16)} in OCSP response.`,
      code: "MALFORMED_OCSP_RESPONSE",
    };
  } catch (err: any) {
    return {
      valid: false,
      status: "unavailable",
      error: `Failed to parse OCSP response: ${err?.message || err}`,
      code: "MALFORMED_OCSP_RESPONSE",
    };
  }
}

/**
 * Checks online OCSP revocation status for a target certificate against its issuer CA.
 */
export async function checkCertificateOcspStatus(
  targetCert: ParsedX509Certificate,
  issuerCert: ParsedX509Certificate,
  options?: AppleChainVerifyOptions
): Promise<OcspCheckResult> {
  const aiaUrl = targetCert.aiaOcspUrl;
  if (!aiaUrl) {
    return {
      valid: false,
      status: "unavailable",
      error: "Certificate does not contain an Authority Information Access (AIA) OCSP responder URL.",
      code: "MISSING_AIA_OCSP_URL",
    };
  }

  let reqBytes: Uint8Array;
  try {
    reqBytes = await buildOcspRequest(targetCert, issuerCert);
  } catch (err: any) {
    return {
      valid: false,
      status: "unavailable",
      error: `Failed to construct OCSP request: ${err?.message || err}`,
      code: "OCSP_REQUEST_BUILD_FAILED",
    };
  }

  let resBytes: Uint8Array;
  const timeoutMs = options?.ocspTimeoutMs ?? 5000;

  try {
    if (options?.customOcspFetcher) {
      resBytes = await options.customOcspFetcher(aiaUrl, reqBytes);
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(aiaUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/ocsp-request",
          "Accept": "application/ocsp-response",
        },
        body: toArrayBuffer(reqBytes),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status !== 200) {
        return {
          valid: false,
          status: "unavailable",
          error: `OCSP responder HTTP ${res.status}: ${res.statusText}`,
          code: "OCSP_UNAVAILABLE",
        };
      }

      const resBuf = await res.arrayBuffer();
      resBytes = new Uint8Array(resBuf);
    }
  } catch (err: any) {
    return {
      valid: false,
      status: "unavailable",
      error: `OCSP network request failed or timed out: ${err?.message || err}`,
      code: "OCSP_UNAVAILABLE",
    };
  }

  return await parseAndVerifyOcspResponse(resBytes, targetCert, issuerCert, {
    currentTimeMs: options?.currentTimeMs,
  });
}

/**
 * Extracts the SubjectPublicKeyInfo (SPKI) bytes from a DER-encoded X.509 certificate.
 * Provided for backwards compatibility and standalone SPKI extraction.
 */
export function extractSpkiFromDer(derBytes: Uint8Array): Uint8Array {
  const cert = parseX509Der(derBytes);
  return cert.spkiDer;
}

/**
 * Generates an ES256-signed JWT for Apple App Store Server API authorization.
 * Uses native WebCrypto (crypto.subtle) with zero external runtime dependencies.
 */
export async function generateAppleApiToken(creds: AppleApiCredentials): Promise<string> {
  if (!creds.keyId || !creds.issuerId || !creds.privateKey) {
    throw new Error("Missing Apple API credentials (keyId, issuerId, or privateKey).");
  }

  const bundleId = creds.bundleId || DEFAULT_APPLE_BUNDLE_ID;
  const now = Math.floor(Date.now() / 1000);
  const claims = buildAppleApiJwtClaims(creds.issuerId, bundleId, now);

  const headerObj = {
    alg: "ES256",
    kid: creds.keyId,
    typ: "JWT",
  };

  const headerEncoded = encodeBase64Url(JSON.stringify(headerObj));
  const claimsEncoded = encodeBase64Url(JSON.stringify(claims));
  const unsignedToken = `${headerEncoded}.${claimsEncoded}`;

  // Clean PKCS#8 private key PEM
  const pem = creds.privateKey
    .replace(/-----BEGIN (?:EC )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:EC )?PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryKey = decodeBase64UrlToBytes(pem);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(binaryKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureEncoded = encodeBase64Url(new Uint8Array(signature));
  return `${unsignedToken}.${signatureEncoded}`;
}

/**
 * Queries Apple's App Store Server API for authoritative transaction info.
 * Endpoint: GET /inApps/v1/transactions/{transactionId}
 */
export async function queryAppleTransactionApi(
  transactionId: string,
  apiToken: string,
  environment: "Production" | "Sandbox" = "Production"
): Promise<{
  success: boolean;
  statusCode: number;
  signedTransactionInfo?: string;
  error?: string;
}> {
  const baseUrl =
    environment === "Sandbox"
      ? "https://api.storekit-sandbox.apple.com"
      : "https://api.storekit.apple.com";

  const url = `${baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });

    if (res.status === 200) {
      const data = await res.json();
      if (!data.signedTransactionInfo || typeof data.signedTransactionInfo !== "string") {
        return {
          success: false,
          statusCode: 502,
          error: "Apple API responded with 200 but signedTransactionInfo was missing in payload.",
        };
      }
      return {
        success: true,
        statusCode: 200,
        signedTransactionInfo: data.signedTransactionInfo,
      };
    }

    if (res.status === 404) {
      return {
        success: false,
        statusCode: 404,
        error: `Transaction ${transactionId} not found in Apple ${environment} environment.`,
      };
    }

    const errText = await res.text();
    return {
      success: false,
      statusCode: res.status,
      error: `Apple API query failed with HTTP ${res.status}: ${errText.slice(0, 200)}`,
    };
  } catch (err: any) {
    return {
      success: false,
      statusCode: 503,
      error: `Network error connecting to Apple App Store Server API: ${err?.message || err}`,
    };
  }
}

/**
 * Queries Apple's App Store Server API for authoritative App Transaction info.
 * Endpoint: GET /inApps/v1/transactions/appTransactions/{transactionId}
 */
export async function queryAppleAppTransactionApi(
  transactionId: string,
  apiToken: string,
  environment: "Production" | "Sandbox" = "Production"
): Promise<{
  success: boolean;
  statusCode: number;
  signedAppTransactionInfo?: string;
  error?: string;
}> {
  const baseUrl =
    environment === "Sandbox"
      ? "https://api.storekit-sandbox.apple.com"
      : "https://api.storekit.apple.com";

  const url = `${baseUrl}/inApps/v1/transactions/appTransactions/${encodeURIComponent(transactionId)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });

    if (res.status === 200) {
      const data = await res.json();
      if (!data.signedAppTransactionInfo || typeof data.signedAppTransactionInfo !== "string") {
        return {
          success: false,
          statusCode: 502,
          error: "Apple API responded with 200 but signedAppTransactionInfo was missing in payload.",
        };
      }
      return {
        success: true,
        statusCode: 200,
        signedAppTransactionInfo: data.signedAppTransactionInfo,
      };
    }

    if (res.status === 404) {
      return {
        success: false,
        statusCode: 404,
        error: `App transaction for transaction ${transactionId} not found in Apple ${environment} environment.`,
      };
    }

    const errText = await res.text();
    return {
      success: false,
      statusCode: res.status,
      error: `Apple App Transaction API query failed with HTTP ${res.status}: ${errText.slice(0, 200)}`,
    };
  } catch (err: any) {
    return {
      success: false,
      statusCode: 503,
      error: `Network error connecting to Apple App Store Server API: ${err?.message || err}`,
    };
  }
}

/**
 * Cryptographically verifies an Apple StoreKit 2 transaction JWS.
 *
 * Verification guarantees:
 *  1. Header algorithm is strictly "ES256".
 *  2. Full RFC 5280 certificate chain validation (Root pinning, Intermediate CA signature & constraints,
 *     Leaf signature, digitalSignature usage, and Apple receipt signing OID).
 *  3. Leaf certificate public key is extracted and verified against the JWS ECDSA P-256 signature.
 *  4. Payload is securely parsed and returned only after all cryptographic checks succeed.
 */
export async function verifyAppleStoreKit2Jws(
  jwsString: string,
  options?: AppleChainVerifyOptions
): Promise<{
  valid: boolean;
  payload?: AppleNotificationTransactionPayload;
  error?: string;
  code?: string;
}> {
  if (!jwsString || typeof jwsString !== "string") {
    return { valid: false, error: "Empty or invalid JWS string provided.", code: "INVALID_JWS" };
  }

  const parts = jwsString.trim().split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `Malformed JWS format: expected 3 segments, got ${parts.length}.`,
      code: "MALFORMED_JWS",
    };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode and inspect header
  let header: { alg?: string; x5c?: string[] };
  try {
    const headerBytes = decodeBase64UrlToBytes(headerB64);
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return { valid: false, error: "Failed to parse JWS header JSON.", code: "INVALID_JWS_HEADER" };
  }

  if (header.alg !== "ES256") {
    return {
      valid: false,
      error: `Unsupported JWS algorithm '${header.alg}'. Expected 'ES256'.`,
      code: "UNSUPPORTED_ALGORITHM",
    };
  }

  // 2. Perform full X.509 RFC 5280 certificate path validation
  const chainResult = await verifyAppleCertificateChain(header.x5c || [], {
    ...options,
    requireAppleReceiptOid: options?.requireAppleReceiptOid ?? true,
  });
  if (!chainResult.valid || !chainResult.leafCert) {
    return {
      valid: false,
      error: chainResult.error,
      code: chainResult.code,
    };
  }

  // 3. Import verified leaf public key into WebCrypto
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(chainResult.leafCert.spkiDer),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to import leaf public key into WebCrypto: ${err?.message || err}`,
      code: "KEY_IMPORT_FAILED",
    };
  }

  // 4. Verify JWS ECDSA P-256 signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = decodeBase64UrlToBytes(signatureB64);

  const isValidSignature = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(signingInput)
  );

  if (!isValidSignature) {
    return {
      valid: false,
      error: "Cryptographic signature verification failed: transaction JWS signature is invalid or data was tampered.",
      code: "INVALID_SIGNATURE",
    };
  }

  // 5. Decode verified payload
  try {
    const payloadBytes = decodeBase64UrlToBytes(payloadB64);
    const payload: AppleNotificationTransactionPayload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return {
      valid: true,
      payload,
    };
  } catch {
    return {
      valid: false,
      error: "Failed to parse verified transaction payload JSON.",
      code: "INVALID_PAYLOAD_JSON",
    };
  }
}

/**
 * Cryptographically verifies an Apple App Store Server Notifications V2 outer JWS.
 *
 * Verification guarantees:
 *  1. Header algorithm is strictly "ES256".
 *  2. Full RFC 5280 certificate chain validation (Apple Root CA - G3 pinning, Intermediate CA signature & constraints,
 *     Leaf signature, digitalSignature usage).
 *  3. Leaf certificate public key is extracted and verified against the JWS ECDSA P-256 signature.
 *  4. Payload is securely parsed and returned as AppleNotificationPayload only after all cryptographic checks succeed.
 *  5. Envelope claims (notificationUUID, version, signedDate, bundleId, appAppleId, environment) are validated.
 */
export async function verifyAppleNotificationJws(
  jwsString: string,
  options?: AppleChainVerifyOptions & {
    expectedBundleId?: string;
    expectedAppAppleId?: string;
  }
): Promise<{
  valid: boolean;
  payload?: AppleNotificationPayload;
  error?: string;
  code?: string;
}> {
  if (!jwsString || typeof jwsString !== "string") {
    return { valid: false, error: "Empty or invalid JWS string provided.", code: "INVALID_JWS" };
  }

  const parts = jwsString.trim().split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `Malformed JWS format: expected 3 segments, got ${parts.length}.`,
      code: "MALFORMED_JWS",
    };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode and inspect header
  let header: { alg?: string; x5c?: string[] };
  try {
    const headerBytes = decodeBase64UrlToBytes(headerB64);
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return { valid: false, error: "Failed to parse JWS header JSON.", code: "INVALID_JWS_HEADER" };
  }

  if (header.alg !== "ES256") {
    return {
      valid: false,
      error: `Unsupported JWS algorithm '${header.alg}'. Expected 'ES256'.`,
      code: "UNSUPPORTED_ALGORITHM",
    };
  }

  // 2. Perform full X.509 RFC 5280 certificate path validation
  const chainResult = await verifyAppleCertificateChain(header.x5c || [], {
    ...options,
    requireAppleReceiptOid: options?.requireAppleReceiptOid ?? false,
  });
  if (!chainResult.valid || !chainResult.leafCert) {
    return {
      valid: false,
      error: chainResult.error,
      code: chainResult.code,
    };
  }

  // 3. Import verified leaf public key into WebCrypto
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(chainResult.leafCert.spkiDer),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to import leaf public key into WebCrypto: ${err?.message || err}`,
      code: "KEY_IMPORT_FAILED",
    };
  }

  // 4. Verify JWS ECDSA P-256 signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = decodeBase64UrlToBytes(signatureB64);

  const isValidSignature = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(signingInput)
  );

  if (!isValidSignature) {
    return {
      valid: false,
      error: "Cryptographic signature verification failed: notification JWS signature is invalid or data was tampered.",
      code: "INVALID_SIGNATURE",
    };
  }

  // 5. Decode verified payload
  let payload: AppleNotificationPayload;
  try {
    const payloadBytes = decodeBase64UrlToBytes(payloadB64);
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return {
      valid: false,
      error: "Failed to parse verified notification payload JSON.",
      code: "INVALID_PAYLOAD_JSON",
    };
  }

  // 6. Validate envelope claims
  const claimsResult = validateNotificationEnvelope(payload, options);
  if (!claimsResult.valid) {
    return {
      valid: false,
      error: claimsResult.error,
      code: claimsResult.code,
    };
  }

  return {
    valid: true,
    payload,
  };
}

/**
 * Cryptographically verifies an Apple StoreKit 2 App Transaction JWS (signedAppTransactionInfo).
 *
 * Verification guarantees:
 *  1. Header algorithm is strictly "ES256".
 *  2. Full RFC 5280 certificate chain validation (Apple Root CA - G3 pinning, Intermediate CA signature & constraints,
 *     Leaf signature, digitalSignature usage, and Apple receipt signing OID).
 *  3. Leaf certificate public key is extracted and verified against the JWS ECDSA P-256 signature.
 *  4. Payload is securely parsed and returned as AppleAppTransactionPayload only after all cryptographic checks succeed.
 */
export async function verifyAppleAppTransactionJws(
  jwsString: string,
  options?: AppleChainVerifyOptions
): Promise<{
  valid: boolean;
  payload?: AppleAppTransactionPayload;
  error?: string;
  code?: string;
}> {
  if (!jwsString || typeof jwsString !== "string") {
    return { valid: false, error: "Empty or invalid JWS string provided.", code: "INVALID_JWS" };
  }

  const parts = jwsString.trim().split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `Malformed JWS format: expected 3 segments, got ${parts.length}.`,
      code: "MALFORMED_JWS",
    };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode and inspect header
  let header: { alg?: string; x5c?: string[] };
  try {
    const headerBytes = decodeBase64UrlToBytes(headerB64);
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return { valid: false, error: "Failed to parse JWS header JSON.", code: "INVALID_JWS_HEADER" };
  }

  if (header.alg !== "ES256") {
    return {
      valid: false,
      error: `Unsupported JWS algorithm '${header.alg}'. Expected 'ES256'.`,
      code: "UNSUPPORTED_ALGORITHM",
    };
  }

  // 2. Perform full X.509 RFC 5280 certificate path validation
  const chainResult = await verifyAppleCertificateChain(header.x5c || [], options);
  if (!chainResult.valid || !chainResult.leafCert) {
    return {
      valid: false,
      error: chainResult.error,
      code: chainResult.code,
    };
  }

  // 3. Import verified leaf public key into WebCrypto
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(chainResult.leafCert.spkiDer),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to import leaf public key into WebCrypto: ${err?.message || err}`,
      code: "KEY_IMPORT_FAILED",
    };
  }

  // 4. Verify JWS ECDSA P-256 signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = decodeBase64UrlToBytes(signatureB64);

  const isValidSignature = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(signingInput)
  );

  if (!isValidSignature) {
    return {
      valid: false,
      error: "Cryptographic signature verification failed: app transaction JWS signature is invalid or data was tampered.",
      code: "INVALID_SIGNATURE",
    };
  }

  // 5. Decode verified payload
  try {
    const payloadBytes = decodeBase64UrlToBytes(payloadB64);
    const payload: AppleAppTransactionPayload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return {
      valid: true,
      payload,
    };
  } catch {
    return {
      valid: false,
      error: "Failed to parse verified app transaction payload JSON.",
      code: "INVALID_PAYLOAD_JSON",
    };
  }
}
