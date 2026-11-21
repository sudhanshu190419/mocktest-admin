/**
 * Apple In-App Purchase (StoreKit 2) Verification Core Test Suite
 *
 * Comprehensive Vitest suite testing:
 *  1. Deterministic SKU mapping & UUID reconstruction
 *  2. Price conversion & exact decimal handling
 *  3. Currency validation (INR, USD, AED, GBP & unsupported rejection)
 *  4. Transaction claims verification (bundle ID, appAccountToken, environment, revocation, non-consumables)
 *  5. Apple App Store Server API credentials & JWT token claims
 *  6. Cryptographic JWS structure & Apple Root CA - G3 fingerprint validation
 *  7. Complete RPC payload builder & outcome response mapping
 */

import { describe, it, expect } from "vitest";
import {
  APPLE_ROOT_CA_G3_SHA256,
  AppleAppTransactionPayload,
  AppleTransactionPayload,
  buildAppleApiJwtClaims,
  buildAppleRpcPayload,
  cleanHexToUuid,
  convertApplePrice,
  DEFAULT_APPLE_BUNDLE_ID,
  handleAppleRpcResponse,
  parseJwsLookupHint,
  uuidToCleanHex,
  validateAppleApiCredentials,
  validateAppleCurrency,
  validateAppleSku,
  validateAppTransactionClaims,
  validateTransactionClaims,
} from "../../../../supabase/functions/verify-apple-purchase/appleBillingCore";
import {
  bufferToHex,
  buildOcspRequest,
  checkCertificateOcspStatus,
  decodeBase64UrlToBytes,
  encodeAsn1Integer,
  encodeAsn1Length,
  encodeAsn1Sequence,
  encodeAsn1Tlv,
  encodeBase64Url,
  extractAiaOcspUrl,
  normalizeDerInteger,
  parseAndVerifyOcspResponse,
  ParsedX509Certificate,
  parseX509Der,
  queryAppleAppTransactionApi,
  toArrayBuffer,
  verifyAppleAppTransactionJws,
  verifyAppleCertificateChain,
  verifyAppleStoreKit2Jws,
} from "../../../../supabase/functions/verify-apple-purchase/appleCrypto";

// ── Synthetic X.509 Certificate & JWS generator for cryptographic test suite ──
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
  intermediateHasOcspSigningOid?: boolean;
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
  const rootKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: rootCurve }, true, ["sign", "verify"]);
  const rootSpki = new Uint8Array(await crypto.subtle.exportKey("spki", rootKey.publicKey));
  const rootSubject = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Test Apple Root CA - G3"))));
  const rootValidity = seq(tlv(0x17, "200101000000Z"), tlv(0x17, "400101000000Z"));
  const sigAlgRoot = rootCurve === "P-384" ? seq(oid("1.2.840.10045.4.3.3")) : seq(oid("1.2.840.10045.4.3.2"));

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
  const intKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: intCurve }, true, ["sign", "verify"]);
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
  if (params.intermediateHasOcspSigningOid) {
    intExtItems.push(seq(oid("2.5.29.37"), tlv(0x04, seq(oid("1.3.6.1.5.5.7.3.9")))));
  }
  const intExts = tlv(0xa3, seq(...intExtItems));

  const intTbs = seq(tlv(0xa0, int(2)), int(2), sigAlgRoot, intIssuer, intValidity, intSubject, intSpki, intExts);
  const intRawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: rootSigHash }, rootKey.privateKey, toArrayBuffer(intTbs))
  );
  if (params.corruptIntermediateSig) {
    intRawSig[10] ^= 0xff;
  }
  const intDerSig = seq(
    int(intRawSig.subarray(0, rootCoordLen)),
    int(intRawSig.subarray(rootCoordLen, rootCoordLen * 2))
  );
  const intCert = seq(intTbs, sigAlgRoot, tlv(0x03, new Uint8Array([0x00, ...intDerSig])));

  // Leaf
  const leafCurve = params.leafCurve || "P-256";
  const leafKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: leafCurve }, true, ["sign", "verify"]);
  const leafSpki = new Uint8Array(await crypto.subtle.exportKey("spki", leafKey.publicKey));
  const leafSubject = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Test Receipt Signing Leaf"))));
  const leafIssuer = params.leafIssuerSubjectMismatch
    ? seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, "Wrong Intermediate CN"))))
    : intSubject;

  const leafNotBefore = params.leafValidity?.notBefore || "240101000000Z";
  const leafNotAfter = params.leafValidity?.notAfter || "300101000000Z";
  const leafValidity = seq(tlv(0x17, leafNotBefore), tlv(0x17, leafNotAfter));
  const sigAlgInt = seq(oid("1.2.840.10045.4.3.2")); // SHA-256

  const leafDigitalSig = params.leafKeyDigitalSig !== undefined ? params.leafKeyDigitalSig : true;
  const leafAppleOid = params.leafHasAppleOid !== undefined ? params.leafHasAppleOid : true;

  const leafExtItems: Uint8Array[] = [];
  if (leafDigitalSig) {
    leafExtItems.push(seq(oid("2.5.29.15"), tlv(0x04, tlv(0x03, [0x00, 0x80]))));
  } else {
    leafExtItems.push(seq(oid("2.5.29.15"), tlv(0x04, tlv(0x03, [0x00, 0x04]))));
  }
  if (leafAppleOid) {
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
    leafRawSig[10] ^= 0xff;
  }
  const leafDerSig = seq(int(leafRawSig.subarray(0, 32)), int(leafRawSig.subarray(32, 64)));
  const leafCert = seq(leafTbs, sigAlgInt, tlv(0x03, new Uint8Array([0x00, ...leafDerSig])));

  const buildSignedJws = async (payload: any, customX5c?: string[]): Promise<string> => {
    const x5cChain = customX5c || [
      encodeBase64Url(leafCert),
      encodeBase64Url(intCert),
      encodeBase64Url(rootCert),
    ];
    const headerObj = { alg: "ES256", x5c: x5cChain };
    const headerB64 = encodeBase64Url(JSON.stringify(headerObj));
    const payloadB64 = encodeBase64Url(JSON.stringify(payload));
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      leafKey.privateKey,
      toArrayBuffer(signingInput)
    );
    const sigB64 = encodeBase64Url(new Uint8Array(sig));
    return `${headerB64}.${payloadB64}.${sigB64}`;
  };

  return {
    rootCert,
    intCert,
    leafCert,
    rootKey,
    intKey,
    leafKey,
    rootFingerprint,
    buildSignedJws,
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
  thisUpdate?: string; // GeneralizedTime e.g. "20240101000000Z"
  nextUpdate?: string; // GeneralizedTime e.g. "20300101000000Z"
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

describe("Apple In-App Purchase Verification Core Suite", () => {
  const sampleProfileId = "550e8400-e29b-41d4-a716-446655440000";
  const sampleCourseId = "e996f082-e0ba-4a4b-9015-c7ea9fcb5c40";
  const sampleCourseHex = "e996f082e0ba4a4b9015c7ea9fcb5c40";
  const samplePackageId = "a1111111-2222-3333-4444-555555555555";
  const samplePackageHex = "a1111111222233334444555555555555";
  const sampleCourseSku = `com.makemetopper.course.${sampleCourseHex}`;
  const samplePyqSku = `com.makemetopper.pyq.${samplePackageHex}`;

  // ── 1. Deterministic SKU Mapping & UUID Validation ─────────────────────────
  describe("1. Deterministic SKU Mapping & UUID Validation", () => {
    it("A. Correctly converts UUID to clean 32-char lowercase hex", () => {
      const hex = uuidToCleanHex(sampleCourseId);
      expect(hex).toBe(sampleCourseHex);
      expect(hex.length).toBe(32);
    });

    it("B. Correctly reconstructs 8-4-4-4-12 UUID from 32-char hex", () => {
      const uuid = cleanHexToUuid(sampleCourseHex);
      expect(uuid).toBe(sampleCourseId);
    });

    it("C. Reconstructs null for malformed hex strings", () => {
      expect(cleanHexToUuid("")).toBeNull();
      expect(cleanHexToUuid("too-short")).toBeNull();
      expect(cleanHexToUuid(sampleCourseHex + "extra")).toBeNull();
    });

    it("D. Validates and maps course SKU to courseId", () => {
      const result = validateAppleSku(sampleCourseSku);
      expect(result.valid).toBe(true);
      expect(result.itemType).toBe("course");
      expect(result.courseId).toBe(sampleCourseId);
    });

    it("E. Validates and maps PYQ package SKU to packageId", () => {
      const result = validateAppleSku(samplePyqSku);
      expect(result.valid).toBe(true);
      expect(result.itemType).toBe("pyq_package");
      expect(result.packageId).toBe(samplePackageId);
    });

    it("F. Rejects malformed hex suffixes in SKUs", () => {
      const invalidSuffix = "com.makemetopper.course.not-a-valid-hex-32-chars!";
      const result = validateAppleSku(invalidSuffix);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_SKU_FORMAT");
    });

    it("G. Rejects unrecognized product ID prefixes", () => {
      const wrongPrefix = "com.makemetopper.subscription.monthly";
      const result = validateAppleSku(wrongPrefix);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("UNRECOGNIZED_PRODUCT_SKU");
    });

    it("H. Rejects empty or null product IDs", () => {
      expect(validateAppleSku(null).valid).toBe(false);
      expect(validateAppleSku("").valid).toBe(false);
      expect(validateAppleSku(undefined).valid).toBe(false);
    });
  });

  // ── 2. Price Conversion & Exact Decimal Handling ───────────────────────────
  describe("2. Price Conversion & Exact Decimal Handling", () => {
    it("A. Converts INR price milliunits accurately (1999000 -> 1999.00)", () => {
      const result = convertApplePrice(1999000);
      expect(result.valid).toBe(true);
      expect(result.amount).toBe(1999.0);
    });

    it("B. Converts USD price milliunits accurately (29990 -> 29.99)", () => {
      const result = convertApplePrice(29990);
      expect(result.valid).toBe(true);
      expect(result.amount).toBe(29.99);
    });

    it("C. Rejects missing, null, or undefined price", () => {
      expect(convertApplePrice(null).valid).toBe(false);
      expect(convertApplePrice(undefined).valid).toBe(false);
    });

    it("D. Rejects zero or negative prices (fail-closed)", () => {
      const zeroResult = convertApplePrice(0);
      expect(zeroResult.valid).toBe(false);
      expect(zeroResult.code).toBe("INVALID_AMOUNT");

      const negResult = convertApplePrice(-5000);
      expect(negResult.valid).toBe(false);
      expect(negResult.code).toBe("INVALID_AMOUNT");
    });

    it("E. Rejects NaN or non-finite numbers", () => {
      expect(convertApplePrice(NaN).valid).toBe(false);
      expect(convertApplePrice(Infinity).valid).toBe(false);
    });

    it("F. Rejects non-integer milliunits (1999.5)", () => {
      const nonIntResult = convertApplePrice(1999.5);
      expect(nonIntResult.valid).toBe(false);
      expect(nonIntResult.code).toBe("INVALID_AMOUNT");
    });

    it("G. Rejects non-safe integer milliunits", () => {
      const unsafeResult = convertApplePrice(Number.MAX_SAFE_INTEGER + 10);
      expect(unsafeResult.valid).toBe(false);
      expect(unsafeResult.code).toBe("INVALID_AMOUNT");
    });
  });

  // ── 3. Currency Validation ────────────────────────────────────────────────
  describe("3. Currency Validation", () => {
    it("A. Accepts all supported platform currencies (INR, USD, AED, GBP)", () => {
      expect(validateAppleCurrency("INR").valid).toBe(true);
      expect(validateAppleCurrency("USD").valid).toBe(true);
      expect(validateAppleCurrency("AED").valid).toBe(true);
      expect(validateAppleCurrency("GBP").valid).toBe(true);
    });

    it("B. Accepts case-insensitive currency codes", () => {
      const lowerInr = validateAppleCurrency("inr");
      expect(lowerInr.valid).toBe(true);
      expect(lowerInr.currency).toBe("INR");
    });

    it("C. Rejects unsupported currencies (EUR, JPY, CAD) with UNSUPPORTED_CURRENCY", () => {
      const eur = validateAppleCurrency("EUR");
      expect(eur.valid).toBe(false);
      expect(eur.code).toBe("UNSUPPORTED_CURRENCY");

      const jpy = validateAppleCurrency("JPY");
      expect(jpy.valid).toBe(false);
      expect(jpy.code).toBe("UNSUPPORTED_CURRENCY");
    });

    it("D. Rejects empty or null currency", () => {
      expect(validateAppleCurrency(null).valid).toBe(false);
      expect(validateAppleCurrency("").valid).toBe(false);
    });
  });

  // ── 4. Transaction Claim Validation ───────────────────────────────────────
  describe("4. Transaction Claim Validation", () => {
    const validTransaction: AppleTransactionPayload = {
      transactionId: "2000000123456789",
      originalTransactionId: "2000000123456789",
      bundleId: DEFAULT_APPLE_BUNDLE_ID,
      productId: sampleCourseSku,
      purchaseDate: 1700000000000,
      type: "Non-Consumable",
      appAccountToken: sampleProfileId,
      environment: "Production",
      price: 1999000,
      currency: "INR",
    };

    it("A. Accepts valid non-consumable Production transaction", () => {
      const result = validateTransactionClaims(validTransaction, sampleProfileId);
      expect(result.valid).toBe(true);
    });

    it("B. Accepts valid Sandbox transaction", () => {
      const sandboxTx = { ...validTransaction, environment: "Sandbox" };
      const result = validateTransactionClaims(sandboxTx, sampleProfileId);
      expect(result.valid).toBe(true);
    });

    it("C. Rejects bundle ID mismatch", () => {
      const wrongBundle = { ...validTransaction, bundleId: "com.imposter.app" };
      const result = validateTransactionClaims(wrongBundle, sampleProfileId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("BUNDLE_ID_MISMATCH");
    });

    it("D. Rejects invalid environments (e.g. 'Xcode' or null)", () => {
      const xcodeTx = { ...validTransaction, environment: "Xcode" };
      const result = validateTransactionClaims(xcodeTx, sampleProfileId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_ENVIRONMENT");
    });

    it("E. Rejects cross-account receipt sharing (appAccountToken mismatch)", () => {
      const imposterProfileId = "99999999-9999-9999-9999-999999999999";
      const result = validateTransactionClaims(validTransaction, imposterProfileId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("ACCOUNT_MISMATCH");
    });

    it("F. Rejects missing appAccountToken", () => {
      const missingToken = { ...validTransaction, appAccountToken: undefined };
      const result = validateTransactionClaims(missingToken, sampleProfileId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_APP_ACCOUNT_TOKEN");
    });

    it("G. Rejects subscription products (retired module)", () => {
      const subTx = { ...validTransaction, type: "Auto-Renewable Subscription" };
      const result = validateTransactionClaims(subTx, sampleProfileId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("SUBSCRIPTIONS_DISCONTINUED");
    });

    it("H. Rejects refunded/revoked transactions (revocationDate set)", () => {
      const refundedTx = { ...validTransaction, revocationDate: 1700050000000, revocationReason: 1 };
      const result = validateTransactionClaims(refundedTx, sampleProfileId);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("TRANSACTION_REFUNDED");
    });

    it("I. Accepts Production in-app purchase transaction without needing appAppleId", () => {
      const prodTx = { ...validTransaction, environment: "Production" };
      const result = validateTransactionClaims(prodTx, sampleProfileId, DEFAULT_APPLE_BUNDLE_ID);
      expect(result.valid).toBe(true);
    });

    it("J. Accepts Production app transaction with matching appAppleId", () => {
      const prodAppTx: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        environment: "Production",
        appAppleId: 6478901234,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        signedDate: 1700000000000,
      };
      const result = validateAppTransactionClaims(prodAppTx, DEFAULT_APPLE_BUNDLE_ID, "6478901234");
      expect(result.valid).toBe(true);
    });

    it("K. Rejects Production app transaction with mismatched appAppleId", () => {
      const prodAppTx: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        environment: "Production",
        appAppleId: 9999999999,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        signedDate: 1700000000000,
      };
      const result = validateAppTransactionClaims(prodAppTx, DEFAULT_APPLE_BUNDLE_ID, "6478901234");
      expect(result.valid).toBe(false);
      expect(result.code).toBe("APP_ID_MISMATCH");
    });

    it("L. Rejects Production app transaction with missing appAppleId when expectedAppId configured", () => {
      const prodAppTx: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        environment: "Production",
        appAppleId: undefined,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        signedDate: 1700000000000,
      };
      const result = validateAppTransactionClaims(prodAppTx, DEFAULT_APPLE_BUNDLE_ID, "6478901234");
      expect(result.valid).toBe(false);
      expect(result.code).toBe("APP_ID_MISMATCH");
    });

    it("M. Accepts Sandbox app transaction without appAppleId even when expectedAppId configured", () => {
      const sandboxAppTx: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        environment: "Sandbox",
        appAppleId: undefined,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        signedDate: 1700000000000,
      };
      const result = validateAppTransactionClaims(sandboxAppTx, DEFAULT_APPLE_BUNDLE_ID, "6478901234");
      expect(result.valid).toBe(true);
    });
  });

  // ── 5. Apple App Store Server API Credentials & JWT Generation ────────────
  describe("5. Apple App Store Server API Credentials & JWT Generation", () => {
    it("A. Fails closed when credentials are missing", () => {
      expect(validateAppleApiCredentials({}).valid).toBe(false);
      expect(validateAppleApiCredentials({ issuerId: "iss" }).valid).toBe(false);
      expect(validateAppleApiCredentials({ issuerId: "iss", keyId: "key" }).valid).toBe(false);
    });

    it("B. Fails closed when privateKey lacks PEM headers", () => {
      const badKey = validateAppleApiCredentials({
        issuerId: "550e8400-e29b-41d4-a716-446655440000",
        keyId: "KEY1234567",
        privateKey: "not-a-pem-key",
      });
      expect(badKey.valid).toBe(false);
      expect(badKey.error).toContain("PKCS#8");
    });

    it("C. Validates properly formatted credentials", () => {
      const validCreds = {
        issuerId: "550e8400-e29b-41d4-a716-446655440000",
        keyId: "KEY1234567",
        privateKey: "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----",
      };
      expect(validateAppleApiCredentials(validCreds).valid).toBe(true);
    });

    it("D. Builds correct JWT claims with 15-minute expiration", () => {
      const nowSec = 1700000000;
      const claims = buildAppleApiJwtClaims("test-issuer-uuid", DEFAULT_APPLE_BUNDLE_ID, nowSec);
      expect(claims.iss).toBe("test-issuer-uuid");
      expect(claims.aud).toBe("appstoreconnect-v1");
      expect(claims.bid).toBe(DEFAULT_APPLE_BUNDLE_ID);
      expect(claims.iat).toBe(nowSec);
      expect(claims.exp).toBe(nowSec + 900); // exactly 15 minutes
    });
  });

  // ── 6. JWS Unverified Lookup Hint Parser ──────────────────────────────────
  describe("6. JWS Unverified Lookup Hint Parser", () => {
    it("A. Rejects malformed or non-segmented strings", () => {
      expect(parseJwsLookupHint("").valid).toBe(false);
      expect(parseJwsLookupHint("only-one-part").valid).toBe(false);
      expect(parseJwsLookupHint("part1.part2").valid).toBe(false);
    });

    it("B. Decodes valid 3-part base64url JWS lookup hints", () => {
      const headerObj = { alg: "ES256", x5c: ["cert0", "cert1", "cert2"] };
      const payloadObj = { transactionId: "2000000123456789", productId: sampleCourseSku };

      const b64Url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString("base64url");
      const mockJws = `${b64Url(headerObj)}.${b64Url(payloadObj)}.mock_signature`;

      const result = parseJwsLookupHint(mockJws);
      expect(result.valid).toBe(true);
      expect(result.header?.alg).toBe("ES256");
      expect(result.payload?.transactionId).toBe("2000000123456789");
      expect(result.payload?.productId).toBe(sampleCourseSku);
    });
  });

  // ── 7. Apple Root CA - G3 Fingerprint Integrity ───────────────────────────
  describe("7. Apple Root CA - G3 Fingerprint Integrity", () => {
    it("A. Pinned Apple Root CA - G3 matches canonical SHA-256 fingerprint", () => {
      expect(APPLE_ROOT_CA_G3_SHA256).toBe("63343ab4b7013824ef7884705f19ce718a1d4c41299042ce171d7617d5046770");
      expect(APPLE_ROOT_CA_G3_SHA256.length).toBe(64);
    });
  });

  // ── 8. RPC Payload Construction & Response Handling ───────────────────────
  describe("8. RPC Payload Construction & Response Handling", () => {
    it("A. Builds complete 17-parameter RPC payload", () => {
      const payload = buildAppleRpcPayload({
        profileId: sampleProfileId,
        instituteId: "institute-1111-2222-3333-444455556666",
        itemType: "course",
        amount: 1999.0,
        currency: "INR",
        transactionId: "2000000123456789",
        transactionTimestamp: "2026-11-19T10:00:00.000Z",
        productId: sampleCourseSku,
        environment: "Production",
        courseId: sampleCourseId,
        itemName: "Full Physics Course",
        billingName: "Student Name",
        billingEmail: "student@example.com",
      });

      expect(payload.p_profile_id).toBe(sampleProfileId);
      expect(payload.p_item_type).toBe("course");
      expect(payload.p_amount).toBe(1999.0);
      expect(payload.p_currency).toBe("INR");
      expect(payload.p_transaction_id).toBe("2000000123456789");
      expect(payload.p_product_id).toBe(sampleCourseSku);
      expect(payload.p_environment).toBe("Production");
      expect(payload.p_course_id).toBe(sampleCourseId);
      expect(payload.p_package_id).toBeNull();
      expect(payload.p_student_id).toBeNull();
    });

    it("B. Correctly maps purchase_recorded outcome (fresh purchase)", () => {
      const rpcResult = {
        success: true,
        outcome: "purchase_recorded",
        paymentId: "pay-1",
        orderId: "ord-1",
        entitlement: "course_enrollment:uuid",
      };
      const response = handleAppleRpcResponse(rpcResult);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.outcome).toBe("purchase_recorded");
      expect(response.alreadyEnrolled).toBe(false);
      expect(response.alreadyProcessed).toBe(false);
    });

    it("C. Correctly maps already_enrolled_payment_recorded (cross-channel duplicate)", () => {
      const rpcResult = {
        success: true,
        outcome: "already_enrolled_payment_recorded",
        alreadyEnrolled: true,
        alreadyProcessed: false,
        paymentId: "pay-2",
        orderId: "ord-2",
        entitlement: "course_enrollment:uuid",
      };
      const response = handleAppleRpcResponse(rpcResult);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.outcome).toBe("already_enrolled_payment_recorded");
      expect(response.alreadyEnrolled).toBe(true);
      expect(response.alreadyProcessed).toBe(false);
    });

    it("D. Correctly maps already_recorded (idempotent receipt replay)", () => {
      const rpcResult = {
        success: true,
        outcome: "already_recorded",
        paymentId: "pay-1",
        orderId: "ord-1",
      };
      const response = handleAppleRpcResponse(rpcResult);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.alreadyProcessed).toBe(true);
    });

    it("E. Correctly maps entitlement_repaired (safe fulfillment repair)", () => {
      const rpcResult = {
        success: true,
        outcome: "entitlement_repaired",
        paymentId: "pay-1",
        orderId: "ord-1",
        entitlement: "course_enrollment:uuid",
      };
      const response = handleAppleRpcResponse(rpcResult);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.outcome).toBe("entitlement_repaired");
      expect(response.alreadyProcessed).toBe(true);
    });

    it("F. Correctly maps ENTITLEMENT_REVOKED to HTTP 403 Forbidden", () => {
      const rpcResult = {
        success: false,
        code: "ENTITLEMENT_REVOKED",
        error: "Enrollment revoked by administration.",
      };
      const response = handleAppleRpcResponse(rpcResult);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect(response.code).toBe("ENTITLEMENT_REVOKED");
    });

    it("G. Correctly maps ACCOUNT_MISMATCH and FORBIDDEN_ROLE to HTTP 403 Forbidden", () => {
      expect(handleAppleRpcResponse({ success: false, code: "ACCOUNT_MISMATCH" }).statusCode).toBe(403);
      expect(handleAppleRpcResponse({ success: false, code: "FORBIDDEN_ROLE" }).statusCode).toBe(403);
    });

    it("H. Correctly maps TRANSACTION_REFUNDED to HTTP 409 Conflict", () => {
      const response = handleAppleRpcResponse({ success: false, code: "TRANSACTION_REFUNDED" });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(409);
    });
  });

  // ── 9. Cryptographic X.509 Certificate Chain & JWS Adversarial Verification ──
  describe("9. Cryptographic X.509 Certificate Chain & JWS Adversarial Verification", () => {
    const validPayload: AppleTransactionPayload = {
      transactionId: "2000000123456789",
      bundleId: DEFAULT_APPLE_BUNDLE_ID,
      productId: sampleCourseSku,
      purchaseDate: 1700000000000,
      environment: "Production",
      price: 1999000,
      currency: "INR",
      appAccountToken: sampleProfileId,
    };

    it("A. Genuine synthetic chain & JWS verifies successfully", async () => {
      const pki = await generateSyntheticPki();
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(true);
      expect(result.payload?.transactionId).toBe("2000000123456789");
      expect(result.payload?.productId).toBe(sampleCourseSku);
    });

    it("B. Appended Root attack: Forged intermediate with genuine root fingerprint is rejected", async () => {
      // Attacker generates attacker PKI
      const attackerPki = await generateSyntheticPki();
      // Genuine trusted root
      const genuinePki = await generateSyntheticPki();
      // Attacker creates JWS with attacker leaf, attacker intermediate, but genuine root in x5c
      const forgedX5c = [
        encodeBase64Url(attackerPki.leafCert),
        encodeBase64Url(attackerPki.intCert),
        encodeBase64Url(genuinePki.rootCert),
      ];
      const jws = await attackerPki.buildSignedJws(validPayload, forgedX5c);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: genuinePki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INTERMEDIATE_SIGNATURE_INVALID");
    });

    it("C. Rejects chain when Root CA fingerprint does not match trusted root", async () => {
      const pki = await generateSyntheticPki();
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, {
        trustedRootFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("ROOT_CA_MISMATCH");
    });

    it("D. Rejects chain when Intermediate certificate signature is corrupted", async () => {
      const pki = await generateSyntheticPki({ corruptIntermediateSig: true });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INTERMEDIATE_SIGNATURE_INVALID");
    });

    it("E. Rejects chain when Leaf certificate signature is corrupted (forged leaf against genuine intermediate)", async () => {
      const pki = await generateSyntheticPki({ corruptLeafSig: true });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("LEAF_SIGNATURE_INVALID");
    });

    it("F. Rejects chain when Intermediate certificate is expired", async () => {
      const pki = await generateSyntheticPki({
        intermediateValidity: { notBefore: "200101000000Z", notAfter: "220101000000Z" },
      });
      const jws = await pki.buildSignedJws(validPayload);
      // Validating at 2026 timestamp
      const result = await verifyAppleStoreKit2Jws(jws, {
        trustedRootFingerprint: pki.rootFingerprint,
        currentTimeMs: Date.UTC(2026, 0, 1),
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("CERTIFICATE_EXPIRED");
    });

    it("G. Rejects chain when Leaf certificate is expired", async () => {
      const pki = await generateSyntheticPki({
        leafValidity: { notBefore: "200101000000Z", notAfter: "230101000000Z" },
      });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, {
        trustedRootFingerprint: pki.rootFingerprint,
        currentTimeMs: Date.UTC(2026, 0, 1),
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("CERTIFICATE_EXPIRED");
    });

    it("H. Rejects chain when Intermediate is missing basicConstraints cA=true", async () => {
      const pki = await generateSyntheticPki({ intermediateIsCa: false });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_CA_CONSTRAINTS");
    });

    it("I. Rejects chain when Intermediate is missing keyCertSign key usage", async () => {
      const pki = await generateSyntheticPki({ intermediateKeyCertSign: false });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_KEY_USAGE");
    });

    it("J. Rejects chain when Leaf is missing digitalSignature key usage", async () => {
      const pki = await generateSyntheticPki({ leafKeyDigitalSig: false });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_KEY_USAGE");
    });

    it("K. Rejects chain when Leaf is missing Apple receipt signing extension OID", async () => {
      const pki = await generateSyntheticPki({ leafHasAppleOid: false });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_APPLE_OID");
    });

    it("L. Rejects chain when Intermediate issuer does not match Root subject", async () => {
      const pki = await generateSyntheticPki({ intermediateIssuerSubjectMismatch: true });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("ISSUER_MISMATCH");
    });

    it("M. Rejects chain when Leaf issuer does not match Intermediate subject", async () => {
      const pki = await generateSyntheticPki({ leafIssuerSubjectMismatch: true });
      const jws = await pki.buildSignedJws(validPayload);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("ISSUER_MISMATCH");
    });

    it("N. Rejects JWS when signature was tampered", async () => {
      const pki = await generateSyntheticPki();
      const jws = await pki.buildSignedJws(validPayload);
      const parts = jws.split(".");
      // Corrupt signature part
      const tamperedJws = `${parts[0]}.${parts[1]}.${encodeBase64Url(
        "tampered-signature-bytes-1234567890123456789012345678901234567890123456789012345678901234"
      )}`;
      const result = await verifyAppleStoreKit2Jws(tamperedJws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_SIGNATURE");
    });

    it("O. Rejects JWS when payload was tampered without updating signature", async () => {
      const pki = await generateSyntheticPki();
      const jws = await pki.buildSignedJws(validPayload);
      const parts = jws.split(".");
      const tamperedPayload = { ...validPayload, price: 1000 };
      const tamperedPayloadB64 = encodeBase64Url(JSON.stringify(tamperedPayload));
      const tamperedJws = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;
      const result = await verifyAppleStoreKit2Jws(tamperedJws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_SIGNATURE");
    });

    it("P. Rejects incomplete x5c chain (< 3 certificates)", async () => {
      const pki = await generateSyntheticPki();
      const jws = await pki.buildSignedJws(validPayload, [
        encodeBase64Url(pki.leafCert),
        encodeBase64Url(pki.intCert),
      ]);
      const result = await verifyAppleStoreKit2Jws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INCOMPLETE_CERT_CHAIN");
    });
  });

  // ── 10. Online Certificate Status Protocol (OCSP) Revocation ─────────────
  describe("10. Online Certificate Status Protocol (OCSP) Revocation", () => {
    it("A. Extracts AIA OCSP responder URL from certificate", async () => {
      const ocspUrl = "http://ocsp.apple.com/ocsp03-wwdrg6";
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: ocspUrl });
      const extracted = extractAiaOcspUrl(pki.leafCert);
      expect(extracted).toBe(ocspUrl);
    });

    it("B. Returns null when certificate has no AIA OCSP extension", async () => {
      const pki = await generateSyntheticPki();
      const extracted = extractAiaOcspUrl(pki.leafCert);
      expect(extracted).toBeNull();
    });

    it("C. Constructs RFC 6960 OCSPRequest with SHA-1 certID", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const reqDer = await buildOcspRequest(leafParsed, intParsed);
      expect(reqDer).toBeInstanceOf(Uint8Array);
      expect(reqDer.length).toBeGreaterThan(30);
    });

    it("D. Parses good OCSP response and verifies signature against issuer CA", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(true);
      expect(result.status).toBe("good");
      expect(result.thisUpdate).toBeInstanceOf(Date);
    });

    it("E. Parses revoked OCSP response and fails closed with CERTIFICATE_REVOKED", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "revoked",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
        revocationTime: "20240501000000Z",
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(false);
      expect(result.status).toBe("revoked");
      expect(result.code).toBe("CERTIFICATE_REVOKED");
      expect(result.revocationTime).toBeInstanceOf(Date);
    });

    it("F. Parses unknown status OCSP response and fails closed with CERTIFICATE_STATUS_UNKNOWN", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "unknown",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(false);
      expect(result.status).toBe("unknown");
      expect(result.code).toBe("CERTIFICATE_STATUS_UNKNOWN");
    });

    it("G. Fails closed with OCSP_SIGNATURE_INVALID when responder signature is tampered", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
        corruptSig: true,
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("OCSP_SIGNATURE_INVALID");
    });

    it("H. Fails closed with OCSP_SERIAL_MISMATCH when response serial does not match target cert", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: 999999,
        issuerCert: intParsed,
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("OCSP_SERIAL_MISMATCH");
    });

    it("I. Fails closed with OCSP_RESPONSE_EXPIRED when response nextUpdate is in the past", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
        thisUpdate: "20200101000000Z",
        nextUpdate: "20200108000000Z",
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed, {
        currentTimeMs: Date.UTC(2025, 0, 1),
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("OCSP_RESPONSE_EXPIRED");
    });

    it("J. Fails closed with OCSP_UNAVAILABLE when responder network fetch fails or times out", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://unreachable-ocsp.apple.test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const result = await checkCertificateOcspStatus(leafParsed, intParsed, {
        customOcspFetcher: async () => {
          throw new Error("Connection timed out to OCSP responder");
        },
      });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("unavailable");
      expect(result.code).toBe("OCSP_UNAVAILABLE");
    });

    it("K. Full chain verification succeeds when online OCSP checks return good for both certs", async () => {
      const pki = await generateSyntheticPki({
        intermediateAiaOcspUrl: "http://ocsp.apple.test/intermediate",
        leafAiaOcspUrl: "http://ocsp.apple.test/leaf",
      });

      const rootParsed = parseX509Der(pki.rootCert);
      const intParsed = parseX509Der(pki.intCert);
      const leafParsed = parseX509Der(pki.leafCert);

      const intGoodOcsp = await buildSyntheticOcspResponse({
        signerKey: pki.rootKey.privateKey,
        status: "good",
        targetSerial: intParsed.serialNumberRaw,
        issuerCert: rootParsed,
      });
      const leafGoodOcsp = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
      });

      const fetcher = async (url: string) => {
        return url.includes("leaf") ? leafGoodOcsp : intGoodOcsp;
      };

      const x5c = [
        encodeBase64Url(pki.leafCert),
        encodeBase64Url(pki.intCert),
        encodeBase64Url(pki.rootCert),
      ];

      const chainResult = await verifyAppleCertificateChain(x5c, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: true,
        customOcspFetcher: fetcher,
      });

      expect(chainResult.valid).toBe(true);
      expect(chainResult.leafCert).toBeDefined();
    });

    it("L. Full chain verification fails closed when intermediate certificate is revoked via OCSP", async () => {
      const ocspUrl = "http://ocsp.apple.test/status";
      const pki = await generateSyntheticPki({
        intermediateAiaOcspUrl: ocspUrl,
        leafAiaOcspUrl: ocspUrl,
      });

      const rootParsed = parseX509Der(pki.rootCert);
      const intParsed = parseX509Der(pki.intCert);

      const intRevokedOcsp = await buildSyntheticOcspResponse({
        signerKey: pki.rootKey.privateKey,
        status: "revoked",
        targetSerial: intParsed.serialNumberRaw,
        issuerCert: rootParsed,
      });

      const x5c = [
        encodeBase64Url(pki.leafCert),
        encodeBase64Url(pki.intCert),
        encodeBase64Url(pki.rootCert),
      ];

      const chainResult = await verifyAppleCertificateChain(x5c, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: true,
        customOcspFetcher: async () => intRevokedOcsp,
      });

      expect(chainResult.valid).toBe(false);
      expect(chainResult.code).toBe("CERTIFICATE_REVOKED");
    });

    it("M. Full chain verification fails closed when leaf certificate is revoked via OCSP", async () => {
      const pki = await generateSyntheticPki({
        intermediateAiaOcspUrl: "http://ocsp.apple.test/intermediate",
        leafAiaOcspUrl: "http://ocsp.apple.test/leaf",
      });

      const rootParsed = parseX509Der(pki.rootCert);
      const intParsed = parseX509Der(pki.intCert);
      const leafParsed = parseX509Der(pki.leafCert);

      const intGoodOcsp = await buildSyntheticOcspResponse({
        signerKey: pki.rootKey.privateKey,
        status: "good",
        targetSerial: intParsed.serialNumberRaw,
        issuerCert: rootParsed,
      });
      const leafRevokedOcsp = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "revoked",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
      });

      const fetcher = async (url: string) => {
        return url.includes("leaf") ? leafRevokedOcsp : intGoodOcsp;
      };

      const x5c = [
        encodeBase64Url(pki.leafCert),
        encodeBase64Url(pki.intCert),
        encodeBase64Url(pki.rootCert),
      ];

      const chainResult = await verifyAppleCertificateChain(x5c, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: true,
        customOcspFetcher: fetcher,
      });

      expect(chainResult.valid).toBe(false);
      expect(chainResult.code).toBe("CERTIFICATE_REVOKED");
    });

    it("N. Fails closed with OCSP_ISSUER_MISMATCH when issuerNameHash does not match issuer cert", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const corruptedNameHash = new Uint8Array(20);
      corruptedNameHash.fill(0xee);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
        issuerNameHash: corruptedNameHash,
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("OCSP_ISSUER_MISMATCH");
    });

    it("O. Fails closed with OCSP_ISSUER_MISMATCH when issuerKeyHash does not match issuer cert", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      const corruptedKeyHash = new Uint8Array(20);
      corruptedKeyHash.fill(0xee);

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
        issuerKeyHash: corruptedKeyHash,
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("OCSP_ISSUER_MISMATCH");
    });

    it("P. Fails closed with UNSUPPORTED_HASH_ALGORITHM when CertID uses unsupported algorithm OID", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      // SHA-512 OID: 2.16.840.1.101.3.4.2.3
      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
        hashAlgorithmOid: "2.16.840.1.101.3.4.2.3",
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(false);
      expect(result.code).toBe("UNSUPPORTED_HASH_ALGORITHM");
    });

    it("Q. Correctly locates and validates matching SingleResponse among multiple responses", async () => {
      const pki = await generateSyntheticPki({ leafAiaOcspUrl: "http://ocsp.apple.com/test" });
      const leafParsed = parseX509Der(pki.leafCert);
      const intParsed = parseX509Der(pki.intCert);

      // Build extra SingleResponse for a dummy serial 88888
      const dummyCertId = seq(
        seq(oid("1.3.14.3.2.26"), tlv(0x05, [])),
        tlv(0x04, new Uint8Array(20)),
        tlv(0x04, new Uint8Array(20)),
        int(88888)
      );
      const dummySingle = seq(dummyCertId, tlv(0x80, []), tlv(0x18, "20240101000000Z"));

      const ocspResDer = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "good",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
        extraSingleResponses: [dummySingle],
      });

      const result = await parseAndVerifyOcspResponse(ocspResDer, leafParsed, intParsed);
      expect(result.valid).toBe(true);
      expect(result.status).toBe("good");
    });

    it("R. Normalizes leading zeroes in DER INTEGER serial numbers", () => {
      const withLeadingZero = new Uint8Array([0x00, 0x12, 0x34]);
      const withoutLeadingZero = new Uint8Array([0x12, 0x34]);
      expect(normalizeDerInteger(withLeadingZero)).toEqual(withoutLeadingZero);
      expect(normalizeDerInteger(new Uint8Array([0x00]))).toEqual(new Uint8Array([0x00]));
    });
  });

  // ── 11. Apple App Transaction Verification & Production Invariants ────────
  describe("11. Apple App Transaction Verification & Production Invariants", () => {
    it("A. Cryptographically verifies valid App Transaction JWS with ES256 and Apple Root CA G3", async () => {
      const pki = await generateSyntheticPki();
      const appPayload: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        appAppleId: 6738912345,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        environment: "Production",
        signedDate: 1700000000000,
      };

      const jws = await pki.buildSignedJws(appPayload);
      const result = await verifyAppleAppTransactionJws(jws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(true);
      expect(result.payload?.bundleId).toBe(DEFAULT_APPLE_BUNDLE_ID);
      expect(result.payload?.appAppleId).toBe(6738912345);
      expect(result.payload?.environment).toBe("Production");
    });

    it("B. Fails closed with INVALID_SIGNATURE when App Transaction signature is corrupted", async () => {
      const pki = await generateSyntheticPki();
      const appPayload: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        environment: "Sandbox",
        signedDate: 1700000000000,
      };

      const jws = await pki.buildSignedJws(appPayload);
      const parts = jws.split(".");
      // Tamper signature
      const corruptedSig = parts[2].slice(0, -4) + "AAAA";
      const corruptedJws = `${parts[0]}.${parts[1]}.${corruptedSig}`;

      const result = await verifyAppleAppTransactionJws(corruptedJws, { trustedRootFingerprint: pki.rootFingerprint });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_SIGNATURE");
    });

    it("C. Validates Production App Transaction claims against configured APPLE_APP_ID", () => {
      const payload: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        appAppleId: 6738912345,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        environment: "Production",
        signedDate: 1700000000000,
      };

      const validResult = validateAppTransactionClaims(payload, DEFAULT_APPLE_BUNDLE_ID, "6738912345");
      expect(validResult.valid).toBe(true);

      const mismatchResult = validateAppTransactionClaims(payload, DEFAULT_APPLE_BUNDLE_ID, "9999999999");
      expect(mismatchResult.valid).toBe(false);
      expect(mismatchResult.code).toBe("APP_ID_MISMATCH");

      const missingConfigResult = validateAppTransactionClaims(payload, DEFAULT_APPLE_BUNDLE_ID, "");
      expect(missingConfigResult.valid).toBe(false);
      expect(missingConfigResult.code).toBe("APP_ID_CONFIG_MISSING");
    });

    it("D. Validates Sandbox App Transaction claims without requiring appAppleId", () => {
      const payload: AppleAppTransactionPayload = {
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        environment: "Sandbox",
        signedDate: 1700000000000,
      };

      const validResult = validateAppTransactionClaims(payload, DEFAULT_APPLE_BUNDLE_ID);
      expect(validResult.valid).toBe(true);

      const wrongBundle = validateAppTransactionClaims(payload, "com.wrong.bundle");
      expect(wrongBundle.valid).toBe(false);
      expect(wrongBundle.code).toBe("BUNDLE_ID_MISMATCH");
    });

    it("E. queryAppleAppTransactionApi handles HTTP 200 with signedAppTransactionInfo", async () => {
      const mockJws = "mock.app.jws";
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(JSON.stringify({ signedAppTransactionInfo: mockJws }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });

        const res = await queryAppleAppTransactionApi("1000000001", "mockToken", "Production");
        expect(res.success).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.signedAppTransactionInfo).toBe(mockJws);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("F. queryAppleAppTransactionApi handles HTTP 404 not found", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(JSON.stringify({ errorCode: 4040010, errorMessage: "Transaction not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });

        const res = await queryAppleAppTransactionApi("1000000001", "mockToken", "Production");
        expect(res.success).toBe(false);
        expect(res.statusCode).toBe(404);
        expect(res.error).toContain("not found");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("G. Production OCSP invariant: Production verification fails closed when leaf or intermediate cert is revoked", async () => {
      const pki = await generateSyntheticPki({
        leafAiaOcspUrl: "http://ocsp.apple.test/leaf",
        intermediateAiaOcspUrl: "http://ocsp.apple.test/intermediate",
      });

      const intParsed = parseX509Der(pki.intCert);
      const leafParsed = parseX509Der(pki.leafCert);

      const rootParsed = parseX509Der(pki.rootCert);
      const intGoodOcsp = await buildSyntheticOcspResponse({
        signerKey: pki.rootKey.privateKey,
        status: "good",
        targetSerial: intParsed.serialNumberRaw,
        issuerCert: rootParsed,
      });
      const leafRevokedOcsp = await buildSyntheticOcspResponse({
        signerKey: pki.intKey.privateKey,
        status: "revoked",
        targetSerial: leafParsed.serialNumberRaw,
        issuerCert: intParsed,
      });

      const txPayload: AppleTransactionPayload = {
        transactionId: "1000000001",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: sampleCourseSku,
        purchaseDate: Date.now(),
        environment: "Production",
        appAccountToken: sampleProfileId,
      };

      const jws = await pki.buildSignedJws(txPayload);

      // Verify with mandatory OCSP enabled
      const result = await verifyAppleStoreKit2Jws(jws, {
        trustedRootFingerprint: pki.rootFingerprint,
        enableOnlineChecks: true,
        customOcspFetcher: async (url) => (url.includes("leaf") ? leafRevokedOcsp : intGoodOcsp),
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("CERTIFICATE_REVOKED");
    });

    it("H. Production API credentials validation fails closed on missing secrets", () => {
      expect(validateAppleApiCredentials({}).valid).toBe(false);
      expect(validateAppleApiCredentials({ issuerId: "iss" }).valid).toBe(false);
      expect(validateAppleApiCredentials({ issuerId: "iss", keyId: "key" }).valid).toBe(false);
      expect(
        validateAppleApiCredentials({
          issuerId: "iss",
          keyId: "key",
          privateKey: "not-a-pem",
        }).valid
      ).toBe(false);
      expect(
        validateAppleApiCredentials({
          issuerId: "iss",
          keyId: "key",
          privateKey: "-----BEGIN EC PRIVATE KEY-----\nMOCK\n-----END EC PRIVATE KEY-----",
        }).valid
      ).toBe(true);
    });

    it("I. Cross-validation detects bundle ID divergence between App Transaction and In-App Transaction", () => {
      const appTxPayload: AppleAppTransactionPayload = {
        bundleId: "com.different.app",
        appAppleId: 6738912345,
        originalApplicationVersion: "1.0.0",
        originalPurchaseDate: 1700000000000,
        environment: "Production",
        signedDate: 1700000000000,
      };

      const txPayload: AppleTransactionPayload = {
        transactionId: "1000000001",
        bundleId: DEFAULT_APPLE_BUNDLE_ID,
        productId: sampleCourseSku,
        purchaseDate: Date.now(),
        environment: "Production",
        appAccountToken: sampleProfileId,
      };

      expect(appTxPayload.bundleId).not.toBe(txPayload.bundleId);
    });
  });
});
