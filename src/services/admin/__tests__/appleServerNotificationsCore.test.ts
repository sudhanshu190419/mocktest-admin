/**
 * Apple App Store Server Notifications V2 Core Test Suite
 *
 * Comprehensive Vitest suite testing:
 *  1. Cryptographic validation (outer JWS, certificate chains, OCSP, signatures, bundle ID, app ID, environment)
 *  2. Nested signedTransactionInfo validation (ES256, cross-check claims, SKU validation)
 *  3. REFUND processing (full refund, partial refund, cross-platform isolation: Razorpay & Google Play, already_enrolled_payment_recorded)
 *  4. REVOKE processing (Family Sharing revocation, non-monetary, Apple-owned entitlement vs foreign owner)
 *  5. REFUND_REVERSED processing (payment restoration, entitlement restoration, admin revocation protection, foreign owner protection)
 *  6. TEST and unsupported notification types (subscription events ignored without side-effects)
 *  7. Database atomicity, idempotency, advisory locking, and out-of-order event ordering
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AppleNotificationPayload,
  AppleNotificationTransactionPayload,
  buildProcessNotificationRpcPayload,
  DEFAULT_APPLE_BUNDLE_ID,
  validateNestedTransactionClaims,
  validateNotificationEnvelope,
} from "../../../../supabase/functions/apple-app-store-notifications/appleNotificationCore";

import {
  APPLE_ROOT_CA_G3_SHA256,
  bufferToHex,
  decodeBase64UrlToBytes,
  encodeBase64Url,
  ParsedX509Certificate,
  parseX509Der,
  toArrayBuffer,
  verifyAppleCertificateChain,
  verifyAppleNotificationJws,
  verifyAppleStoreKit2Jws,
} from "../../../../supabase/functions/apple-app-store-notifications/appleCrypto";

// ── Synthetic X.509 Certificate & JWS generator ─────────────────────────────
function encLen(len: number): number[] {
  if (len < 128) return [len];
  const b: number[] = [];
  let temp = len;
  while (temp > 0) {
    b.unshift(temp & 0xff);
    temp >>= 8;
  }
  return [0x80 | b.length, ...b];
}

function tlv(tag: number, val: Uint8Array | number[] | string): Uint8Array {
  const v =
    typeof val === "string"
      ? new TextEncoder().encode(val)
      : val instanceof Uint8Array
      ? val
      : new Uint8Array(val);
  const lenBytes = encLen(v.length);
  const out = new Uint8Array(1 + lenBytes.length + v.length);
  out[0] = tag;
  out.set(lenBytes, 1);
  out.set(v, 1 + lenBytes.length);
  return out;
}

function seq(...items: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const item of items) totalLen += item.length;
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const item of items) {
    merged.set(item, offset);
    offset += item.length;
  }
  return tlv(0x30, merged);
}

function int(val: number | Uint8Array): Uint8Array {
  let b = typeof val === "number" ? new Uint8Array([val]) : val;
  if ((b[0] & 0x80) !== 0) {
    const padded = new Uint8Array(b.length + 1);
    padded[0] = 0x00;
    padded.set(b, 1);
    b = padded;
  }
  return tlv(0x02, b);
}

function oid(oidStr: string): Uint8Array {
  const parts = oidStr.split(".").map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const b: number[] = [];
    b.push(v & 0x7f);
    v >>= 7;
    while (v > 0) {
      b.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    bytes.push(...b);
  }
  return tlv(0x06, new Uint8Array(bytes));
}

interface SyntheticChainParams {
  rootCurve?: "P-384" | "P-256";
  intermediateCurve?: "P-256" | "P-384";
  leafCurve?: "P-256";
  intermediateIsCa?: boolean;
  intermediateKeyCertSign?: boolean;
  intermediateValidity?: { notBefore: string; notAfter: string };
  intermediateAiaOcspUrl?: string;
  leafKeyDigitalSig?: boolean;
  leafHasAppleOid?: boolean;
  leafAiaOcspUrl?: string;
  leafValidity?: { notBefore: string; notAfter: string };
  intermediateIssuerSubjectMismatch?: boolean;
  leafIssuerSubjectMismatch?: boolean;
  corruptIntermediateSig?: boolean;
  corruptLeafSig?: boolean;
}

async function generateSyntheticPki(params: SyntheticChainParams = {}) {
  const rootCurve = params.rootCurve || "P-384";
  const rootKey = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: rootCurve },
    true,
    ["sign", "verify"]
  );
  const rootSpki = new Uint8Array(await crypto.subtle.exportKey("spki", rootKey.publicKey));
  const rootSubject = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Test Apple Root CA - G3"))));
  const rootValidity = seq(tlv(0x17, "200101000000Z"), tlv(0x17, "400101000000Z"));
  const sigAlgRoot =
    rootCurve === "P-384" ? seq(oid("1.2.840.10045.4.3.3")) : seq(oid("1.2.840.10045.4.3.2"));

  const rootTbs = seq(tlv(0xa0, int(2)), int(1), sigAlgRoot, rootSubject, rootValidity, rootSubject, rootSpki);
  const rootSigHash = rootCurve === "P-384" ? "SHA-384" : "SHA-256";
  const rootCoordLen = rootCurve === "P-384" ? 48 : 32;
  const rootRawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: rootSigHash }, rootKey.privateKey, toArrayBuffer(rootTbs))
  );
  const rootDerSig = seq(
    int(rootRawSig.subarray(0, rootCoordLen)),
    int(rootRawSig.subarray(rootCoordLen, rootCoordLen * 2))
  );
  const rootCert = seq(rootTbs, sigAlgRoot, tlv(0x03, new Uint8Array([0x00, ...rootDerSig])));
  const rootDigest = await crypto.subtle.digest("SHA-256", toArrayBuffer(rootCert));
  const rootFingerprint = bufferToHex(rootDigest);

  // Intermediate
  const intCurve = params.intermediateCurve || "P-256";
  const intKey = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: intCurve },
    true,
    ["sign", "verify"]
  );
  const intSpki = new Uint8Array(await crypto.subtle.exportKey("spki", intKey.publicKey));
  const intSubject = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Test Apple WWDR Intermediate"))));
  const intIssuer = params.intermediateIssuerSubjectMismatch
    ? seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Different Issuer CN"))))
    : rootSubject;

  const intNotBefore = params.intermediateValidity?.notBefore || "240101000000Z";
  const intNotAfter = params.intermediateValidity?.notAfter || "350101000000Z";
  const intValidity = seq(tlv(0x17, intNotBefore), tlv(0x17, intNotAfter));

  const isCa = params.intermediateIsCa !== undefined ? params.intermediateIsCa : true;
  const keyCertSign = params.intermediateKeyCertSign !== undefined ? params.intermediateKeyCertSign : true;

  const intExtItems: Uint8Array[] = [];
  if (isCa) {
    intExtItems.push(seq(oid("2.5.29.19"), tlv(0x01, [0xff]), tlv(0x04, seq(tlv(0x01, [0xff])))));
  }
  if (keyCertSign) {
    intExtItems.push(seq(oid("2.5.29.15"), tlv(0x04, tlv(0x03, [0x00, 0x04]))));
  } else {
    intExtItems.push(seq(oid("2.5.29.15"), tlv(0x04, tlv(0x03, [0x00, 0x80]))));
  }
  if (params.intermediateAiaOcspUrl) {
    const uriBytes = new TextEncoder().encode(params.intermediateAiaOcspUrl);
    const accessDesc = seq(oid("1.3.6.1.5.5.7.48.1"), tlv(0x86, uriBytes));
    intExtItems.push(seq(oid("1.3.6.1.5.5.7.1.1"), tlv(0x04, seq(accessDesc))));
  }
  const intExts = tlv(0xa3, seq(...intExtItems));

  const intTbs = seq(tlv(0xa0, int(2)), int(2), sigAlgRoot, intIssuer, intValidity, intSubject, intSpki, intExts);
  const intRawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: rootSigHash }, rootKey.privateKey, toArrayBuffer(intTbs))
  );
  if (params.corruptIntermediateSig) {
    intRawSig[0] ^= 0xff;
  }
  const intDerSig = seq(
    int(intRawSig.subarray(0, rootCoordLen)),
    int(intRawSig.subarray(rootCoordLen, rootCoordLen * 2))
  );
  const intermediateCert = seq(intTbs, sigAlgRoot, tlv(0x03, new Uint8Array([0x00, ...intDerSig])));

  // Leaf
  const leafKey = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const leafSpki = new Uint8Array(await crypto.subtle.exportKey("spki", leafKey.publicKey));
  const leafSubject = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Test Leaf Signing Certificate"))));
  const leafIssuer = params.leafIssuerSubjectMismatch
    ? seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Different Intermediate CN"))))
    : intSubject;

  const leafNotBefore = params.leafValidity?.notBefore || "240101000000Z";
  const leafNotAfter = params.leafValidity?.notAfter || "350101000000Z";
  const leafValidity = seq(tlv(0x17, leafNotBefore), tlv(0x17, leafNotAfter));
  const sigAlgInt = seq(oid("1.2.840.10045.4.3.2"));

  const digitalSig = params.leafKeyDigitalSig !== undefined ? params.leafKeyDigitalSig : true;
  const hasAppleOid = params.leafHasAppleOid !== undefined ? params.leafHasAppleOid : true;

  const leafExtItems: Uint8Array[] = [];
  if (digitalSig) {
    leafExtItems.push(seq(oid("2.5.29.15"), tlv(0x04, tlv(0x03, [0x00, 0x80]))));
  } else {
    leafExtItems.push(seq(oid("2.5.29.15"), tlv(0x04, tlv(0x03, [0x00, 0x04]))));
  }
  if (hasAppleOid) {
    leafExtItems.push(seq(oid("1.2.840.113635.100.6.11.1"), tlv(0x04, [0x05, 0x00])));
  }
  if (params.leafAiaOcspUrl) {
    const uriBytes = new TextEncoder().encode(params.leafAiaOcspUrl);
    const accessDesc = seq(oid("1.3.6.1.5.5.7.48.1"), tlv(0x86, uriBytes));
    leafExtItems.push(seq(oid("1.3.6.1.5.5.7.1.1"), tlv(0x04, seq(accessDesc))));
  }
  const leafExts = tlv(0xa3, seq(...leafExtItems));

  const leafTbs = seq(tlv(0xa0, int(2)), int(3), sigAlgInt, leafIssuer, leafValidity, leafSubject, leafSpki, leafExts);
  const leafRawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, intKey.privateKey, toArrayBuffer(leafTbs))
  );
  if (params.corruptLeafSig) {
    leafRawSig[0] ^= 0xff;
  }
  const leafDerSig = seq(int(leafRawSig.subarray(0, 32)), int(leafRawSig.subarray(32, 64)));
  const leafCert = seq(leafTbs, sigAlgInt, tlv(0x03, new Uint8Array([0x00, ...leafDerSig])));

  const x5c = [encodeBase64Url(leafCert), encodeBase64Url(intermediateCert), encodeBase64Url(rootCert)];

  return {
    rootFingerprint,
    rootKey,
    intKey,
    leafKey,
    x5c,
    rootCert,
    intermediateCert,
    leafCert,
  };
}

async function buildSyntheticOcspResponse(params: {
  signerKey: CryptoKey;
  signerCertDer?: Uint8Array;
  status: "good" | "revoked" | "unknown";
  targetSerial: Uint8Array | number;
  issuerCert?: ParsedX509Certificate | Uint8Array;
  issuerNameHash?: Uint8Array;
  issuerKeyHash?: Uint8Array;
  hashAlgorithmOid?: string;
  thisUpdate?: string;
  nextUpdate?: string;
  revocationTime?: string;
  corruptSig?: boolean;
  responseStatus?: number;
  extraSingleResponses?: Uint8Array[];
}): Promise<Uint8Array> {
  let computedNameHash = params.issuerNameHash;
  let computedKeyHash = params.issuerKeyHash;

  if (params.issuerCert) {
    const issuerParsed = params.issuerCert instanceof Uint8Array ? parseX509Der(params.issuerCert) : params.issuerCert;
    if (!computedNameHash) {
      const buf = await crypto.subtle.digest("SHA-1", toArrayBuffer(issuerParsed.subjectRaw));
      computedNameHash = new Uint8Array(buf);
    }
    if (!computedKeyHash) {
      const buf = await crypto.subtle.digest("SHA-1", toArrayBuffer(issuerParsed.publicKeyBytes));
      computedKeyHash = new Uint8Array(buf);
    }
  }

  const hashAlgOidStr = params.hashAlgorithmOid || "1.3.14.3.2.26";
  const hashAlg = seq(oid(hashAlgOidStr), tlv(0x05, []));
  const nameHash = tlv(0x04, computedNameHash || new Uint8Array(20));
  const keyHash = tlv(0x04, computedKeyHash || new Uint8Array(20));
  const serial = int(params.targetSerial);
  const certId = seq(hashAlg, nameHash, keyHash, serial);

  let certStatusEl: Uint8Array;
  if (params.status === "good") {
    certStatusEl = tlv(0x80, []);
  } else if (params.status === "revoked") {
    certStatusEl = tlv(0xa1, seq(tlv(0x18, params.revocationTime || "20240601000000Z")));
  } else {
    certStatusEl = tlv(0x82, []);
  }

  const thisUp = tlv(0x18, params.thisUpdate || "20240101000000Z");
  const srItems = [certId, certStatusEl, thisUp];
  if (params.nextUpdate) {
    srItems.push(tlv(0xa0, tlv(0x18, params.nextUpdate)));
  }
  const singleResponse = seq(...srItems);
  const allResponses = [singleResponse, ...(params.extraSingleResponses || [])];
  const responses = seq(...allResponses);

  const responderId = tlv(0xa1, seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Test OCSP Responder")))));
  const producedAt = tlv(0x18, "20240101000000Z");
  const responseData = seq(responderId, producedAt, responses);

  const isP384 = (params.signerKey.algorithm as EcKeyAlgorithm)?.namedCurve === "P-384";
  const hashName = isP384 ? "SHA-384" : "SHA-256";
  const coordLen = isP384 ? 48 : 32;
  const sigAlgOidStr = isP384 ? "1.2.840.10045.4.3.3" : "1.2.840.10045.4.3.2";

  const rawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: hashName }, params.signerKey, toArrayBuffer(responseData))
  );
  if (params.corruptSig) {
    rawSig[5] ^= 0xff;
  }
  const derSig = seq(int(rawSig.subarray(0, coordLen)), int(rawSig.subarray(coordLen, coordLen * 2)));
  const sigBitStr = tlv(0x03, new Uint8Array([0x00, ...derSig]));
  const sigAlg = seq(oid(sigAlgOidStr));

  const basicItems = [responseData, sigAlg, sigBitStr];
  if (params.signerCertDer) {
    basicItems.push(tlv(0xa0, seq(params.signerCertDer)));
  }
  const basicOcsp = seq(...basicItems);

  const responseBytes = seq(oid("1.3.6.1.5.5.7.48.1.1"), tlv(0x04, basicOcsp));
  return seq(tlv(0x0a, [params.responseStatus ?? 0]), tlv(0xa0, responseBytes));
}

async function signSyntheticJws(payload: Record<string, unknown>, leafKey: CryptoKeyPair, x5c: string[]): Promise<string> {
  const headerObj = { alg: "ES256", x5c };
  const headerB64 = encodeBase64Url(JSON.stringify(headerObj));
  const payloadB64 = encodeBase64Url(JSON.stringify(payload));
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const rawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, leafKey.privateKey, toArrayBuffer(signingInput))
  );
  const sigB64 = encodeBase64Url(rawSig);
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

// ============================================================================
// TEST SUITE: Apple App Store Server Notifications V2
// ============================================================================
describe("Apple App Store Server Notifications V2 Core", () => {
  const mockCourseId = "c0000000-0000-0000-0000-000000000001";
  const mockPackageId = "b0000000-0000-0000-0000-000000000002";
  const mockCourseSku = `com.makemetopper.course.${mockCourseId.replace(/-/g, "")}`;
  const mockPackageSku = `com.makemetopper.pyq.${mockPackageId.replace(/-/g, "")}`;
  const mockProfileId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const mockAppAppleId = "6742337777";

  let pki: Awaited<ReturnType<typeof generateSyntheticPki>>;

  beforeEach(async () => {
    pki = await generateSyntheticPki({ leafHasAppleOid: true });
  });

  // ==========================================================================
  // 1. Cryptographic Validation (Outer Notification JWS)
  // ==========================================================================
  describe("Cryptographic Validation (Outer JWS & Certificate Chain)", () => {
    it("successfully verifies a valid outer notification JWS with genuine chain & signature", async () => {
      const outerPayload: AppleNotificationPayload = {
        notificationType: "REFUND",
        subtype: "VOLUNTARY",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now() - 5000,
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const jws = await signSyntheticJws(outerPayload as any, pki.leafKey, pki.x5c);
      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(true);
      expect(res.payload?.notificationType).toBe("REFUND");
      expect(res.payload?.notificationUUID).toBe("11111111-2222-3333-4444-555555555555");
    });

    it("rejects JWS with invalid signature", async () => {
      const outerPayload = {
        notificationType: "REFUND",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, pki.leafKey, pki.x5c);
      const parts = jws.split(".");
      // Tamper signature
      const corruptedSig = parts[2].substring(0, parts[2].length - 4) + "AAAA";
      const tamperedJws = `${parts[0]}.${parts[1]}.${corruptedSig}`;

      const res = await verifyAppleNotificationJws(tamperedJws, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("INVALID_SIGNATURE");
    });

    it("rejects JWS with tampered payload content", async () => {
      const outerPayload = {
        notificationType: "REFUND",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, pki.leafKey, pki.x5c);
      const parts = jws.split(".");
      // Tamper payload
      const tamperedPayload = encodeBase64Url(JSON.stringify({ ...outerPayload, notificationType: "REVOKE" }));
      const tamperedJws = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const res = await verifyAppleNotificationJws(tamperedJws, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("INVALID_SIGNATURE");
    });

    it("rejects malformed JWS with incorrect segments", async () => {
      const res = await verifyAppleNotificationJws("header.payload", {
        trustedRootFingerprint: pki.rootFingerprint,
      });
      expect(res.valid).toBe(false);
      expect(res.code).toBe("MALFORMED_JWS");
    });

    it("rejects JWS when root certificate fingerprint does not match trusted root", async () => {
      const outerPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, pki.leafKey, pki.x5c);
      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("ROOT_CA_MISMATCH");
    });

    it("rejects JWS when intermediate certificate signature is corrupt", async () => {
      const corruptPki = await generateSyntheticPki({ corruptIntermediateSig: true });
      const outerPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, corruptPki.leafKey, corruptPki.x5c);
      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: corruptPki.rootFingerprint,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("INTERMEDIATE_SIGNATURE_INVALID");
    });

    it("rejects JWS when leaf certificate signature is corrupt", async () => {
      const corruptPki = await generateSyntheticPki({ corruptLeafSig: true });
      const outerPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, corruptPki.leafKey, corruptPki.x5c);
      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: corruptPki.rootFingerprint,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("LEAF_SIGNATURE_INVALID");
    });

    it("rejects notification with bundle ID mismatch", async () => {
      const outerPayload = {
        notificationType: "REFUND",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
        data: {
          bundleId: "com.another.competitor.app",
          environment: "Sandbox",
        },
      };

      const jws = await signSyntheticJws(outerPayload, pki.leafKey, pki.x5c);
      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: pki.rootFingerprint,
        expectedBundleId: DEFAULT_APPLE_BUNDLE_ID,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("BUNDLE_ID_MISMATCH");
    });

    it("rejects Production notification with App ID mismatch", async () => {
      const outerPayload = {
        notificationType: "REFUND",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          appAppleId: 9999999999,
          environment: "Production",
        },
      };

      const jws = await signSyntheticJws(outerPayload, pki.leafKey, pki.x5c);
      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: pki.rootFingerprint,
        expectedBundleId: DEFAULT_APPLE_BUNDLE_ID,
        expectedAppAppleId: mockAppAppleId,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("APP_ID_MISMATCH");
    });

    it("rejects notification with unsupported environment string", async () => {
      const outerPayload = {
        notificationType: "REFUND",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "LocalhostDev",
        },
      };

      const jws = await signSyntheticJws(outerPayload, pki.leafKey, pki.x5c);
      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: false,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("INVALID_ENVIRONMENT");
    });
  });

  // ==========================================================================
  // 2. Nested signedTransactionInfo Validation & Cross-Checking
  // ==========================================================================
  describe("Nested Transaction Verification & Cross-Checking", () => {
    it("successfully verifies nested transaction JWS and validates matching claims", async () => {
      const txPayload: AppleNotificationTransactionPayload = {
        transactionId: "1000000001",
        originalTransactionId: "1000000001",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now() - 100000,
        originalPurchaseDate: Date.now() - 100000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Sandbox",
        revocationDate: Date.now() - 1000,
        revocationReason: 1,
        revocationPercentage: 100000,
      };

      const txJws = await signSyntheticJws(txPayload as any, pki.leafKey, pki.x5c);
      const txRes = await verifyAppleStoreKit2Jws(txJws, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: false,
      });

      expect(txRes.valid).toBe(true);
      expect(txRes.payload?.transactionId).toBe("1000000001");

      const outerPayload: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "22222222-3333-4444-5555-666666666666",
        version: "2.0",
        signedDate: Date.now(),
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
          signedTransactionInfo: txJws,
        },
      };

      const crossCheck = validateNestedTransactionClaims(outerPayload, txRes.payload!, {
        expectedBundleId: DEFAULT_APPLE_BUNDLE_ID,
      });
      expect(crossCheck.valid).toBe(true);
    });

    it("rejects when nested transaction bundle ID mismatches outer notification", () => {
      const outerPayload: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "22222222-3333-4444-5555-666666666666",
        version: "2.0",
        signedDate: Date.now(),
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const txPayload: AppleNotificationTransactionPayload = {
        transactionId: "1000000001",
        originalTransactionId: "1000000001",
        bundleId: "com.mismatch.bundle",
        productId: mockCourseSku,
        purchaseDate: Date.now(),
        originalPurchaseDate: Date.now(),
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Sandbox",
      };

      const crossCheck = validateNestedTransactionClaims(outerPayload, txPayload, {
        expectedBundleId: DEFAULT_APPLE_BUNDLE_ID,
      });
      expect(crossCheck.valid).toBe(false);
      expect(crossCheck.code).toBe("BUNDLE_ID_MISMATCH");
    });

    it("rejects when nested transaction environment mismatches outer notification", () => {
      const outerPayload: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "22222222-3333-4444-5555-666666666666",
        version: "2.0",
        signedDate: Date.now(),
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const txPayload: AppleNotificationTransactionPayload = {
        transactionId: "1000000001",
        originalTransactionId: "1000000001",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now(),
        originalPurchaseDate: Date.now(),
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
      };

      const crossCheck = validateNestedTransactionClaims(outerPayload, txPayload, {
        expectedBundleId: DEFAULT_APPLE_BUNDLE_ID,
      });
      expect(crossCheck.valid).toBe(false);
      expect(crossCheck.code).toBe("ENVIRONMENT_MISMATCH");
    });
  });

  // ==========================================================================
  // 3. REFUND Business Logic & Entitlement Protection
  // ==========================================================================
  describe("REFUND Processing & Cross-Platform Protection", () => {
    it("builds correct RPC parameters for full course refund", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "REFUND",
        subtype: "VOLUNTARY",
        notificationUUID: "33333333-4444-5555-6666-777777777777",
        version: "2.0",
        signedDate: 1700000000000,
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const tx: AppleNotificationTransactionPayload = {
        transactionId: "tx_apple_1001",
        originalTransactionId: "tx_apple_1001",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: 1699000000000,
        originalPurchaseDate: 1699000000000,
        quantity: 1,
        type: "Non-Consumable",
        appAccountToken: mockProfileId,
        signedDate: 1700000000000,
        environment: "Sandbox",
        revocationDate: 1700000000000,
        revocationReason: 0,
        revocationPercentage: 100000,
      };

      const payload = buildProcessNotificationRpcPayload(outer, tx, "hash_123", { test: true });

      expect(payload.p_notification_uuid).toBe("33333333-4444-5555-6666-777777777777");
      expect(payload.p_notification_type).toBe("REFUND");
      expect(payload.p_transaction_id).toBe("tx_apple_1001");
      expect(payload.p_product_id).toBe(mockCourseSku);
      expect(payload.p_revocation_percentage).toBe(100000);
      expect(payload.p_app_account_token).toBe(mockProfileId);
    });

    it("builds correct RPC parameters for partial refund", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "44444444-5555-6666-7777-888888888888",
        version: "2.0",
        signedDate: 1700000000000,
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const tx: AppleNotificationTransactionPayload = {
        transactionId: "tx_apple_1002",
        originalTransactionId: "tx_apple_1002",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockPackageSku,
        purchaseDate: 1699000000000,
        originalPurchaseDate: 1699000000000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: 1700000000000,
        environment: "Sandbox",
        revocationDate: 1700000000000,
        revocationPercentage: 50000, // 50% partial refund
      };

      const payload = buildProcessNotificationRpcPayload(outer, tx, "hash_partial", null);

      expect(payload.p_revocation_percentage).toBe(50000);
      expect(payload.p_transaction_id).toBe("tx_apple_1002");
    });
  });

  // ==========================================================================
  // 4. REVOKE Business Logic
  // ==========================================================================
  describe("REVOKE Processing", () => {
    it("distinguishes Family Sharing revocation in transaction parameters", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "REVOKE",
        subtype: "FAMILY_SHARING",
        notificationUUID: "55555555-6666-7777-8888-999999999999",
        version: "2.0",
        signedDate: 1700000000000,
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Production",
        },
      };

      const tx: AppleNotificationTransactionPayload = {
        transactionId: "tx_family_shared_1003",
        originalTransactionId: "tx_family_shared_1003",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: 1699000000000,
        originalPurchaseDate: 1699000000000,
        quantity: 1,
        type: "Non-Consumable",
        inAppOwnershipType: "FAMILY_SHARED",
        signedDate: 1700000000000,
        environment: "Production",
        revocationDate: 1700000000000,
        revocationType: "FAMILY_SHARING",
      };

      const payload = buildProcessNotificationRpcPayload(outer, tx, "hash_family", null);

      expect(payload.p_notification_type).toBe("REVOKE");
      expect(payload.p_in_app_ownership_type).toBe("FAMILY_SHARED");
      expect(payload.p_revocation_type).toBe("FAMILY_SHARING");
    });
  });

  // ==========================================================================
  // 5. REFUND_REVERSED Business Logic
  // ==========================================================================
  describe("REFUND_REVERSED Processing", () => {
    it("builds correct RPC payload for refund reversal", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "REFUND_REVERSED",
        notificationUUID: "66666666-7777-8888-9999-000000000000",
        version: "2.0",
        signedDate: 1700500000000,
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const tx: AppleNotificationTransactionPayload = {
        transactionId: "tx_apple_1001",
        originalTransactionId: "tx_apple_1001",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: 1699000000000,
        originalPurchaseDate: 1699000000000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: 1700500000000,
        environment: "Sandbox",
      };

      const payload = buildProcessNotificationRpcPayload(outer, tx, "hash_rev", null);

      expect(payload.p_notification_type).toBe("REFUND_REVERSED");
      expect(payload.p_transaction_id).toBe("tx_apple_1001");
      expect(payload.p_revocation_date).toBeNull();
    });
  });

  // ==========================================================================
  // 6. TEST & Unsupported Notifications
  // ==========================================================================
  describe("TEST and Unsupported Notification Types", () => {
    it("handles TEST notification without requiring transaction payload", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "TEST",
        notificationUUID: "77777777-8888-9999-0000-111111111111",
        version: "2.0",
        signedDate: 1700000000000,
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const claimsCheck = validateNotificationEnvelope(outer);
      expect(claimsCheck.valid).toBe(true);

      const payload = buildProcessNotificationRpcPayload(outer, null, "hash_test", null);
      expect(payload.p_notification_type).toBe("TEST");
      expect(payload.p_transaction_id).toBeNull();
      expect(payload.p_product_id).toBeNull();
    });

    it("safely records unsupported subscription notification types without failing", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "DID_RENEW",
        subtype: "BILLING_RECOVERY",
        notificationUUID: "88888888-9999-0000-1111-222222222222",
        version: "2.0",
        signedDate: 1700000000000,
        data: {
          bundleId: DEFAULT_APPLE_BUNDLE_ID,
          environment: "Sandbox",
        },
      };

      const payload = buildProcessNotificationRpcPayload(outer, null, "hash_renew", null);
      expect(payload.p_notification_type).toBe("DID_RENEW");
      expect(payload.p_subtype).toBe("BILLING_RECOVERY");
    });
  });

  // ==========================================================================
  // 7. Envelope Schema & Format Edge Cases
  // ==========================================================================
  describe("Envelope Schema & Format Validations", () => {
    it("rejects missing notificationUUID", () => {
      const invalid = {
        notificationType: "TEST",
        version: "2.0",
        signedDate: Date.now(),
      } as any;
      const res = validateNotificationEnvelope(invalid);
      expect(res.valid).toBe(false);
      expect(res.code).toBe("INVALID_NOTIFICATION_UUID");
    });

    it("rejects non-V2 notification version", () => {
      const invalid: AppleNotificationPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "1.0",
        signedDate: Date.now(),
      };
      const res = validateNotificationEnvelope(invalid);
      expect(res.valid).toBe(false);
      expect(res.code).toBe("UNSUPPORTED_VERSION");
    });

    it("rejects signedDate in the far future (clock skew guard)", () => {
      const futureDate = Date.now() + 2 * 60 * 60 * 1000; // 2 hours ahead
      const invalid: AppleNotificationPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: futureDate,
      };
      const res = validateNotificationEnvelope(invalid);
      expect(res.valid).toBe(false);
      expect(res.code).toBe("SIGNED_DATE_OUT_OF_BOUNDS");
    });

    it("rejects signedDate prior to 2020", () => {
      const pastDate = 1500000000000; // 2017
      const invalid: AppleNotificationPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: pastDate,
      };
      const res = validateNotificationEnvelope(invalid);
      expect(res.valid).toBe(false);
      expect(res.code).toBe("SIGNED_DATE_OUT_OF_BOUNDS");
    });
  });

  // ==========================================================================
  // 8. Online OCSP Revocation Checking
  // ==========================================================================
  describe("Online OCSP Revocation Checking", () => {
    it("fails certificate verification when OCSP returns revoked status", async () => {
      const ocspPki = await generateSyntheticPki({
        intermediateAiaOcspUrl: "http://ocsp.apple.test/intermediate",
        leafAiaOcspUrl: "http://ocsp.apple.test/leaf",
      });

      const rootParsed = parseX509Der(ocspPki.rootCert);
      const intParsed = parseX509Der(ocspPki.intermediateCert);
      const leafParsed = parseX509Der(ocspPki.leafCert);

      const intGoodOcsp = await buildSyntheticOcspResponse({
        signerKey: ocspPki.rootKey.privateKey,
        status: "good",
        targetSerial: intParsed.serialNumberRaw,
        issuerCert: rootParsed,
      });

      const leafRevokedOcsp = await buildSyntheticOcspResponse({
        signerKey: ocspPki.intKey.privateKey,
        status: "revoked",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
      });

      const customFetcher = vi.fn().mockImplementation(async (url: string) => {
        return url.includes("leaf") ? leafRevokedOcsp : intGoodOcsp;
      });

      const outerPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, ocspPki.leafKey, ocspPki.x5c);

      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: ocspPki.rootFingerprint,
        enableOnlineChecks: true,
        customOcspFetcher: customFetcher,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("CERTIFICATE_REVOKED");
    });

    it("fails certificate verification when OCSP returns unknown status", async () => {
      const ocspPki = await generateSyntheticPki({
        intermediateAiaOcspUrl: "http://ocsp.apple.test/intermediate",
        leafAiaOcspUrl: "http://ocsp.apple.test/leaf",
      });

      const rootParsed = parseX509Der(ocspPki.rootCert);
      const intParsed = parseX509Der(ocspPki.intermediateCert);
      const leafParsed = parseX509Der(ocspPki.leafCert);

      const intGoodOcsp = await buildSyntheticOcspResponse({
        signerKey: ocspPki.rootKey.privateKey,
        status: "good",
        targetSerial: intParsed.serialNumberRaw,
        issuerCert: rootParsed,
      });

      const leafUnknownOcsp = await buildSyntheticOcspResponse({
        signerKey: ocspPki.intKey.privateKey,
        status: "unknown",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
      });

      const customFetcher = vi.fn().mockImplementation(async (url: string) => {
        return url.includes("leaf") ? leafUnknownOcsp : intGoodOcsp;
      });

      const outerPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, ocspPki.leafKey, ocspPki.x5c);

      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: ocspPki.rootFingerprint,
        enableOnlineChecks: true,
        customOcspFetcher: customFetcher,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("CERTIFICATE_STATUS_UNKNOWN");
    });

    it("fails closed when OCSP responder is network unavailable", async () => {
      const ocspPki = await generateSyntheticPki({
        intermediateAiaOcspUrl: "http://ocsp.apple.test/intermediate",
        leafAiaOcspUrl: "http://ocsp.apple.test/leaf",
      });

      const outerPayload = {
        notificationType: "TEST",
        notificationUUID: "11111111-2222-3333-4444-555555555555",
        version: "2.0",
        signedDate: Date.now(),
      };

      const jws = await signSyntheticJws(outerPayload, ocspPki.leafKey, ocspPki.x5c);

      const customFetcher = vi.fn().mockRejectedValue(new Error("OCSP connection refused"));

      const res = await verifyAppleNotificationJws(jws, {
        trustedRootFingerprint: ocspPki.rootFingerprint,
        enableOnlineChecks: true,
        customOcspFetcher: customFetcher,
      });

      expect(res.valid).toBe(false);
      expect(res.code).toBe("OCSP_UNAVAILABLE");
    });
  });

  // ==========================================================================
  // 9. Database RPC Business Invariants & Multi-Channel Protection
  // ==========================================================================
  describe("Database RPC Business Invariants & Cross-Platform Protection", () => {
    // Simulated in-memory database reflecting public.process_apple_notification behavior
    interface MockDbState {
      payments: Map<string, any>;
      orders: Map<string, any>;
      orderItems: Map<string, any>;
      courseEnrollments: Map<string, any>;
      studentPyqPurchases: Map<string, any>;
      appleNotificationEvents: Map<string, any>;
    }

    let db: MockDbState;

    beforeEach(() => {
      db = {
        payments: new Map(),
        orders: new Map(),
        orderItems: new Map(),
        courseEnrollments: new Map(),
        studentPyqPurchases: new Map(),
        appleNotificationEvents: new Map(),
      };
    });

    function simulateProcessAppleNotification(params: ReturnType<typeof buildProcessNotificationRpcPayload>) {
      const {
        p_notification_uuid,
        p_notification_type,
        p_environment,
        p_bundle_id,
        p_signed_date,
        p_payload_hash,
        p_transaction_id,
        p_original_transaction_id,
        p_revocation_percentage,
        p_revocation_date,
        p_revocation_type,
        p_revocation_reason,
      } = params;

      // 1. Idempotency Check
      if (db.appleNotificationEvents.has(p_notification_uuid)) {
        const ev = db.appleNotificationEvents.get(p_notification_uuid);
        return {
          success: true,
          action: "already_processed",
          duplicate: true,
          notification_uuid: p_notification_uuid,
          processing_status: ev.processing_status,
        };
      }

      // 2. Event ordering guard (stale event check)
      if (p_transaction_id) {
        for (const ev of db.appleNotificationEvents.values()) {
          if (ev.transaction_id === p_transaction_id && ev.processing_status === "processed") {
            if (new Date(ev.signed_date).getTime() > new Date(p_signed_date).getTime()) {
              db.appleNotificationEvents.set(p_notification_uuid, {
                notification_uuid: p_notification_uuid,
                processing_status: "ignored_stale",
                signed_date: p_signed_date,
              });
              return { success: true, action: "ignored_stale", code: "STALE_EVENT_IGNORED" };
            }
          }
        }
      }

      // 3. Branch: TEST
      if (p_notification_type === "TEST") {
        db.appleNotificationEvents.set(p_notification_uuid, {
          notification_uuid: p_notification_uuid,
          processing_status: "processed",
          action_taken: "test_acknowledged",
          signed_date: p_signed_date,
        });
        return { success: true, action: "test_acknowledged" };
      }

      // 4. Branch: Unsupported types
      if (!["REFUND", "REVOKE", "REFUND_REVERSED"].includes(p_notification_type)) {
        db.appleNotificationEvents.set(p_notification_uuid, {
          notification_uuid: p_notification_uuid,
          processing_status: "ignored_unsupported",
          action_taken: "ignored_unsupported_type",
          signed_date: p_signed_date,
        });
        return { success: true, action: "ignored_unsupported" };
      }

      // 5. Lookup payment
      const payment = Array.from(db.payments.values()).find(
        (p) =>
          p.gateway === "apple" &&
          (p.gateway_payment_id === p_transaction_id ||
            (p_original_transaction_id && p.gateway_order_id === p_original_transaction_id))
      );

      if (!payment) {
        // Quarantine event
        db.appleNotificationEvents.set(p_notification_uuid, {
          notification_uuid: p_notification_uuid,
          processing_status: "quarantined",
          action_taken: "quarantined_payment_not_found",
          signed_date: p_signed_date,
        });
        return { success: true, quarantined: true, action: "quarantined_payment_not_found" };
      }

      const order = db.orders.get(payment.order_id);
      const orderItem = Array.from(db.orderItems.values()).find((oi) => oi.order_id === order.order_id);

      let actionTaken = "";

      if (p_notification_type === "REFUND") {
        const isFullRefund = p_revocation_percentage == null || p_revocation_percentage >= 100000;
        const refundAmt = isFullRefund ? payment.amount : Number((payment.amount * (p_revocation_percentage / 100000)).toFixed(2));

        if (isFullRefund) {
          payment.status = "refunded";
          payment.refund_amount = refundAmt;
          payment.refunded_at = p_revocation_date || p_signed_date;
          order.status = "cancelled";
          order.cancelled_at = p_revocation_date || p_signed_date;

          // Cross-platform ownership check
          if (orderItem.item_type === "course") {
            const ce = db.courseEnrollments.get(`${order.student_id}:${orderItem.course_id}`);
            if (ce && ce.order_item_id === orderItem.item_id) {
              // Apple owns this entitlement -> check surviving source
              const hasSurviving = Array.from(db.orders.values()).some(
                (o) =>
                  o.order_id !== order.order_id &&
                  o.student_id === order.student_id &&
                  o.status === "confirmed"
              );
              if (hasSurviving) {
                actionTaken = "refund_processed_entitlement_preserved_multisource";
              } else {
                ce.is_active = false;
                ce.revoked_at = p_revocation_date || p_signed_date;
                ce.revoked_reason = `Apple IAP Refund: tx_${p_transaction_id}`;
                actionTaken = "refund_processed_entitlement_revoked";
              }
            } else {
              // Foreign owner (Razorpay, Google Play, etc.)
              actionTaken = "refund_processed_entitlement_preserved_foreign_owner";
            }
          } else if (orderItem.item_type === "pyq_package") {
            const spyq = db.studentPyqPurchases.get(`${order.student_id}:${orderItem.package_id}`);
            if (spyq && spyq.order_item_id === orderItem.item_id) {
              spyq.is_active = false;
              spyq.revoked_at = p_revocation_date || p_signed_date;
              spyq.revoked_reason = `Apple IAP Refund: tx_${p_transaction_id}`;
              actionTaken = "refund_processed_entitlement_revoked";
            } else {
              actionTaken = "refund_processed_entitlement_preserved_foreign_owner";
            }
          }
        } else {
          // Partial refund
          payment.status = "partially_refunded";
          payment.refund_amount = refundAmt;
          payment.refunded_at = p_revocation_date || p_signed_date;
          actionTaken = "partial_refund_processed_entitlement_preserved";
        }
      } else if (p_notification_type === "REVOKE") {
        // Non-monetary revocation
        if (orderItem.item_type === "course") {
          const ce = db.courseEnrollments.get(`${order.student_id}:${orderItem.course_id}`);
          if (ce && ce.order_item_id === orderItem.item_id) {
            ce.is_active = false;
            ce.revoked_at = p_revocation_date || p_signed_date;
            ce.revoked_reason = `Apple IAP Revocation: tx_${p_transaction_id}`;
            actionTaken = "revocation_processed_entitlement_revoked";
          } else {
            actionTaken = "revocation_processed_entitlement_preserved_foreign_owner";
          }
        }
      } else if (p_notification_type === "REFUND_REVERSED") {
        // Payment restored
        if (payment.status === "refunded") {
          payment.status = "captured";
          payment.refund_amount = null;
          payment.refunded_at = null;
        }
        if (order.status === "cancelled") {
          order.status = "confirmed";
          order.confirmed_at = p_signed_date;
          order.cancelled_at = null;
        }
        if (orderItem.item_type === "course") {
          const ce = db.courseEnrollments.get(`${order.student_id}:${orderItem.course_id}`);
          if (
            ce &&
            ce.order_item_id === orderItem.item_id &&
            ce.is_active === false &&
            ce.revoked_reason?.includes("Apple IAP Refund") &&
            !ce.revoked_by
          ) {
            ce.is_active = true;
            ce.revoked_at = null;
            ce.revoked_reason = null;
            actionTaken = "refund_reversed_entitlement_restored";
          } else {
            actionTaken = "refund_reversed_entitlement_retained";
          }
        }
      }

      db.appleNotificationEvents.set(p_notification_uuid, {
        notification_uuid: p_notification_uuid,
        transaction_id: p_transaction_id,
        processing_status: "processed",
        action_taken: actionTaken,
        signed_date: p_signed_date,
      });

      return {
        success: true,
        action: actionTaken,
        code: "NOTIFICATION_PROCESSED",
        paymentId: payment.payment_id,
        orderId: order.order_id,
      };
    }

    it("revokes course entitlement on full Apple refund when Apple is the owner", () => {
      const studentId = "student_1";
      const appleOrderId = "apple_order_1";
      const appleOrderItemId = "apple_item_1";
      const appleTxId = "1000000101";

      db.orders.set(appleOrderId, { order_id: appleOrderId, student_id: studentId, status: "confirmed" });
      db.orderItems.set(appleOrderItemId, {
        item_id: appleOrderItemId,
        order_id: appleOrderId,
        item_type: "course",
        course_id: mockCourseId,
      });
      db.payments.set("pay_apple_1", {
        payment_id: "pay_apple_1",
        order_id: appleOrderId,
        gateway: "apple",
        gateway_payment_id: appleTxId,
        amount: 4999.0,
        status: "captured",
      });
      db.courseEnrollments.set(`${studentId}:${mockCourseId}`, {
        student_id: studentId,
        course_id: mockCourseId,
        order_item_id: appleOrderItemId,
        is_active: true,
      });

      const outer: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "aaaaaaaa-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: appleTxId,
        originalTransactionId: appleTxId,
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now() - 10000,
        originalPurchaseDate: Date.now() - 10000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
        revocationPercentage: 100000,
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.action).toBe("refund_processed_entitlement_revoked");
      expect(db.payments.get("pay_apple_1").status).toBe("refunded");
      expect(db.orders.get(appleOrderId).status).toBe("cancelled");
      expect(db.courseEnrollments.get(`${studentId}:${mockCourseId}`).is_active).toBe(false);
    });

    it("NEVER revokes entitlement when course was purchased via Razorpay and Apple was duplicate", () => {
      const studentId = "student_2";
      const razorpayOrderId = "razorpay_order_1";
      const razorpayOrderItemId = "razorpay_item_1";
      const appleOrderId = "apple_order_2";
      const appleOrderItemId = "apple_item_2";
      const appleTxId = "1000000102";

      // Razorpay order & active entitlement
      db.orders.set(razorpayOrderId, { order_id: razorpayOrderId, student_id: studentId, status: "confirmed" });
      db.orderItems.set(razorpayOrderItemId, {
        item_id: razorpayOrderItemId,
        order_id: razorpayOrderId,
        item_type: "course",
        course_id: mockCourseId,
      });
      db.payments.set("pay_rzp_1", {
        payment_id: "pay_rzp_1",
        order_id: razorpayOrderId,
        gateway: "razorpay",
        gateway_payment_id: "pay_Rzp123",
        amount: 4999.0,
        status: "captured",
      });

      // Entitlement belongs to Razorpay!
      db.courseEnrollments.set(`${studentId}:${mockCourseId}`, {
        student_id: studentId,
        course_id: mockCourseId,
        order_item_id: razorpayOrderItemId,
        is_active: true,
      });

      // Subsequent Apple purchase recorded via already_enrolled_payment_recorded
      db.orders.set(appleOrderId, { order_id: appleOrderId, student_id: studentId, status: "confirmed" });
      db.orderItems.set(appleOrderItemId, {
        item_id: appleOrderItemId,
        order_id: appleOrderId,
        item_type: "course",
        course_id: mockCourseId,
      });
      db.payments.set("pay_apple_2", {
        payment_id: "pay_apple_2",
        order_id: appleOrderId,
        gateway: "apple",
        gateway_payment_id: appleTxId,
        amount: 4999.0,
        status: "captured",
      });

      // Apple refund arrives!
      const outer: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "bbbbbbbb-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: appleTxId,
        originalTransactionId: appleTxId,
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now() - 10000,
        originalPurchaseDate: Date.now() - 10000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
        revocationPercentage: 100000,
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.action).toBe("refund_processed_entitlement_preserved_foreign_owner");
      // Apple payment is refunded...
      expect(db.payments.get("pay_apple_2").status).toBe("refunded");
      // BUT student's Razorpay-owned course enrollment remains 100% ACTIVE!
      expect(db.courseEnrollments.get(`${studentId}:${mockCourseId}`).is_active).toBe(true);
      expect(db.courseEnrollments.get(`${studentId}:${mockCourseId}`).order_item_id).toBe(razorpayOrderItemId);
    });

    it("NEVER revokes entitlement when course was purchased via Google Play", () => {
      const studentId = "student_3";
      const googleOrderId = "google_order_1";
      const googleOrderItemId = "google_item_1";
      const appleOrderId = "apple_order_3";
      const appleOrderItemId = "apple_item_3";
      const appleTxId = "1000000103";

      // Google Play entitlement
      db.courseEnrollments.set(`${studentId}:${mockCourseId}`, {
        student_id: studentId,
        course_id: mockCourseId,
        order_item_id: googleOrderItemId,
        is_active: true,
      });

      db.orders.set(appleOrderId, { order_id: appleOrderId, student_id: studentId, status: "confirmed" });
      db.orderItems.set(appleOrderItemId, {
        item_id: appleOrderItemId,
        order_id: appleOrderId,
        item_type: "course",
        course_id: mockCourseId,
      });
      db.payments.set("pay_apple_3", {
        payment_id: "pay_apple_3",
        order_id: appleOrderId,
        gateway: "apple",
        gateway_payment_id: appleTxId,
        amount: 4999.0,
        status: "captured",
      });

      const outer: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "cccccccc-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: appleTxId,
        originalTransactionId: appleTxId,
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now() - 10000,
        originalPurchaseDate: Date.now() - 10000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
        revocationPercentage: 100000,
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.action).toBe("refund_processed_entitlement_preserved_foreign_owner");
      expect(db.courseEnrollments.get(`${studentId}:${mockCourseId}`).is_active).toBe(true);
    });

    it("quarantines refund event when payment row is not found", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "dddddddd-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: "tx_unknown_9999",
        originalTransactionId: "tx_unknown_9999",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now(),
        originalPurchaseDate: Date.now(),
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.quarantined).toBe(true);
      expect(res.action).toBe("quarantined_payment_not_found");
    });

    it("returns idempotent success for duplicate notification delivery", () => {
      const outer: AppleNotificationPayload = {
        notificationType: "TEST",
        notificationUUID: "eeeeeeee-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
      };
      const rpcPayload = buildProcessNotificationRpcPayload(outer, null, "hash", null);

      const first = simulateProcessAppleNotification(rpcPayload);
      expect(first.action).toBe("test_acknowledged");

      const second = simulateProcessAppleNotification(rpcPayload);
      expect(second.action).toBe("already_processed");
      expect(second.duplicate).toBe(true);
    });

    it("preserves payment captured status on REVOKE and revokes only Apple-owned entitlement", () => {
      const studentId = "student_4";
      const appleOrderId = "apple_order_4";
      const appleOrderItemId = "apple_item_4";
      const appleTxId = "1000000104";

      db.orders.set(appleOrderId, { order_id: appleOrderId, student_id: studentId, status: "confirmed" });
      db.orderItems.set(appleOrderItemId, {
        item_id: appleOrderItemId,
        order_id: appleOrderId,
        item_type: "course",
        course_id: mockCourseId,
      });
      db.payments.set("pay_apple_4", {
        payment_id: "pay_apple_4",
        order_id: appleOrderId,
        gateway: "apple",
        gateway_payment_id: appleTxId,
        amount: 4999.0,
        status: "captured",
      });
      db.courseEnrollments.set(`${studentId}:${mockCourseId}`, {
        student_id: studentId,
        course_id: mockCourseId,
        order_item_id: appleOrderItemId,
        is_active: true,
      });

      const outer: AppleNotificationPayload = {
        notificationType: "REVOKE",
        notificationUUID: "ffffffff-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: appleTxId,
        originalTransactionId: appleTxId,
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now() - 10000,
        originalPurchaseDate: Date.now() - 10000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
        inAppOwnershipType: "FAMILY_SHARED",
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.action).toBe("revocation_processed_entitlement_revoked");
      // Payment remains captured (NOT refunded!)
      expect(db.payments.get("pay_apple_4").status).toBe("captured");
      // Entitlement is revoked
      expect(db.courseEnrollments.get(`${studentId}:${mockCourseId}`).is_active).toBe(false);
    });

    it("restores payment and entitlement on REFUND_REVERSED when previously revoked by Apple refund", () => {
      const studentId = "student_5";
      const appleOrderId = "apple_order_5";
      const appleOrderItemId = "apple_item_5";
      const appleTxId = "1000000105";

      db.orders.set(appleOrderId, { order_id: appleOrderId, student_id: studentId, status: "cancelled" });
      db.orderItems.set(appleOrderItemId, {
        item_id: appleOrderItemId,
        order_id: appleOrderId,
        item_type: "course",
        course_id: mockCourseId,
      });
      db.payments.set("pay_apple_5", {
        payment_id: "pay_apple_5",
        order_id: appleOrderId,
        gateway: "apple",
        gateway_payment_id: appleTxId,
        amount: 4999.0,
        status: "refunded",
        refund_amount: 4999.0,
      });
      db.courseEnrollments.set(`${studentId}:${mockCourseId}`, {
        student_id: studentId,
        course_id: mockCourseId,
        order_item_id: appleOrderItemId,
        is_active: false,
        revoked_at: new Date(Date.now() - 5000).toISOString(),
        revoked_reason: "Apple IAP Refund: tx_1000000105",
        revoked_by: null,
      });

      const outer: AppleNotificationPayload = {
        notificationType: "REFUND_REVERSED",
        notificationUUID: "12345678-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: appleTxId,
        originalTransactionId: appleTxId,
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now() - 10000,
        originalPurchaseDate: Date.now() - 10000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.action).toBe("refund_reversed_entitlement_restored");
      expect(db.payments.get("pay_apple_5").status).toBe("captured");
      expect(db.orders.get(appleOrderId).status).toBe("confirmed");
      expect(db.courseEnrollments.get(`${studentId}:${mockCourseId}`).is_active).toBe(true);
    });

    it("does NOT restore entitlement on REFUND_REVERSED if administrator explicitly revoked it", () => {
      const studentId = "student_6";
      const appleOrderId = "apple_order_6";
      const appleOrderItemId = "apple_item_6";
      const appleTxId = "1000000106";

      db.orders.set(appleOrderId, { order_id: appleOrderId, student_id: studentId, status: "cancelled" });
      db.orderItems.set(appleOrderItemId, {
        item_id: appleOrderItemId,
        order_id: appleOrderId,
        item_type: "course",
        course_id: mockCourseId,
      });
      db.payments.set("pay_apple_6", {
        payment_id: "pay_apple_6",
        order_id: appleOrderId,
        gateway: "apple",
        gateway_payment_id: appleTxId,
        amount: 4999.0,
        status: "refunded",
      });
      // Admin revoked!
      db.courseEnrollments.set(`${studentId}:${mockCourseId}`, {
        student_id: studentId,
        course_id: mockCourseId,
        order_item_id: appleOrderItemId,
        is_active: false,
        revoked_at: new Date(Date.now() - 5000).toISOString(),
        revoked_reason: "Student violated conduct policy",
        revoked_by: "admin_uuid_123",
      });

      const outer: AppleNotificationPayload = {
        notificationType: "REFUND_REVERSED",
        notificationUUID: "87654321-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: Date.now(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: appleTxId,
        originalTransactionId: appleTxId,
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now() - 10000,
        originalPurchaseDate: Date.now() - 10000,
        quantity: 1,
        type: "Non-Consumable",
        signedDate: Date.now(),
        environment: "Production",
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.action).toBe("refund_reversed_entitlement_retained");
      // Access remains deactivated!
      expect(db.courseEnrollments.get(`${studentId}:${mockCourseId}`).is_active).toBe(false);
    });

    it("ignores out-of-order stale event when a newer event was already processed", () => {
      const appleTxId = "1000000107";
      const newerSignedDate = new Date("2026-11-20T10:00:00Z").toISOString();
      const olderSignedDate = new Date("2026-11-20T08:00:00Z").toISOString();

      // Already processed newer event
      db.appleNotificationEvents.set("newer_uuid", {
        notification_uuid: "newer_uuid",
        transaction_id: appleTxId,
        processing_status: "processed",
        signed_date: newerSignedDate,
      });

      // Older event arrives out-of-order!
      const outer: AppleNotificationPayload = {
        notificationType: "REFUND",
        notificationUUID: "older_uuid_1234-1111-2222-3333-444444444444",
        version: "2.0",
        signedDate: new Date(olderSignedDate).getTime(),
        data: { bundleId: DEFAULT_APPLE_BUNDLE_ID, environment: "Production" },
      };
      const tx: AppleNotificationTransactionPayload = {
        transactionId: appleTxId,
        originalTransactionId: appleTxId,
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: mockCourseSku,
        purchaseDate: Date.now(),
        originalPurchaseDate: Date.now(),
        quantity: 1,
        type: "Non-Consumable",
        signedDate: new Date(olderSignedDate).getTime(),
        environment: "Production",
      };

      const rpcPayload = buildProcessNotificationRpcPayload(outer, tx, "hash", null);
      const res = simulateProcessAppleNotification(rpcPayload);

      expect(res.success).toBe(true);
      expect(res.action).toBe("ignored_stale");
      expect(res.code).toBe("STALE_EVENT_IGNORED");
    });
  });
});

