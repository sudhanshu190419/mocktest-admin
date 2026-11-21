/**
 * Apple In-App Purchase Billing Core Helpers
 *
 * Pure, runtime-agnostic business logic, SKU mapping, currency & price validation,
 * StoreKit 2 transaction claim verification, and RPC payload builders.
 *
 * Designed to execute identically in:
 *  - Deno / Supabase Edge Runtime (`supabase/functions/verify-apple-purchase/index.ts`)
 *  - Vitest / Node.js test environment (`src/services/admin/__tests__/applePurchaseVerificationCore.test.ts`)
 */

// Pinned Apple Root CA - G3 SHA-256 Fingerprint (DER certificate digest)
export const APPLE_ROOT_CA_G3_SHA256 = "63343ab4b7013824ef7884705f19ce718a1d4c41299042ce171d7617d5046770";

export const DEFAULT_APPLE_BUNDLE_ID = "com.makemetopper.app";

export const SUPPORTED_CURRENCIES = ["INR", "USD", "AED", "GBP"] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

export interface AppleApiCredentials {
  issuerId?: string;
  keyId?: string;
  privateKey?: string;
  bundleId?: string;
  appId?: string;
}

/**
 * Decoded payload for in-app purchase transactions (JWSTransactionDecodedPayload).
 * Represents StoreKit 2 in-app purchases.
 * Note: Under Apple's schema, in-app purchase transactions contain bundleId, but NOT appAppleId.
 */
export interface AppleTransactionPayload {
  transactionId: string;
  originalTransactionId?: string;
  bundleId: string;
  productId: string;
  purchaseDate: number; // milliseconds since epoch
  originalPurchaseDate?: number;
  type?: string; // 'Non-Consumable' | 'Auto-Renewable Subscription' | etc.
  appAccountToken?: string; // RFC 4122 UUID matching profiles.profile_id
  inAppOwnershipType?: string; // 'PURCHASED' | 'FAMILY_SHARED'
  signedDate?: number;
  environment: "Production" | "Sandbox" | string;
  price?: number; // integer milliunits, e.g. 1999000 for 1999.00
  currency?: string; // ISO 4217, e.g. 'INR'
  revocationDate?: number;
  revocationReason?: number;
}

/**
 * Decoded payload for App Transactions (JWSAppTransactionDecodedPayload).
 * Represents the signed app download receipt from the App Store.
 * In this payload, appAppleId is present in Production.
 */
export interface AppleAppTransactionPayload {
  bundleId: string;
  appAppleId?: number; // Numeric App Store Apple ID (Production only)
  originalApplicationVersion: string;
  originalPurchaseDate: number;
  deviceVerification?: string;
  deviceVerificationNonce?: string;
  environment: "Production" | "Sandbox" | string;
  signedDate: number;
  appTransactionId?: string;
  receiptType?: string;
}

export interface ProductMappingResult {
  valid: boolean;
  itemType?: "course" | "pyq_package";
  courseId?: string;
  packageId?: string;
  error?: string;
  code?: string;
}

export interface PriceValidationResult {
  valid: boolean;
  amount?: number;
  error?: string;
  code?: string;
}

export interface CurrencyValidationResult {
  valid: boolean;
  currency?: SupportedCurrency;
  error?: string;
  code?: string;
}

export interface TransactionClaimValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
}

export interface AppleRpcPayload {
  p_profile_id: string;
  p_institute_id: string;
  p_item_type: "course" | "pyq_package";
  p_amount: number;
  p_currency: string;
  p_transaction_id: string;
  p_transaction_timestamp: string;
  p_product_id: string;
  p_environment: string;
  p_student_id: string | null;
  p_course_id: string | null;
  p_package_id: string | null;
  p_item_name: string | null;
  p_original_transaction_id: string | null;
  p_gateway_response: Record<string, unknown>;
  p_billing_name: string | null;
  p_billing_email: string | null;
}

export interface AppleRpcOutcome {
  success: boolean;
  statusCode: number;
  outcome?: string;
  alreadyEnrolled?: boolean;
  alreadyProcessed?: boolean;
  paymentId?: string;
  orderId?: string;
  entitlement?: string;
  message?: string;
  error?: string;
  code?: string;
}

/** Converts standard 8-4-4-4-12 UUID string to clean 32-char lowercase hex. */
export function uuidToCleanHex(uuid: string): string {
  return uuid.replace(/[^a-f0-9]/gi, "").toLowerCase();
}

/** Reconstructs standard 8-4-4-4-12 UUID from 32-char hex string. */
export function cleanHexToUuid(hex: string): string | null {
  if (!hex || hex.length !== 32) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Validates deterministic Apple StoreKit 2 SKU and maps to internal product UUID.
 *
 * Expected formats (matching src/utils/appleSkuHelper.ts):
 *   Course:      com.makemetopper.course.<32-hex-course-uuid>
 *   PYQ Package: com.makemetopper.pyq.<32-hex-package-uuid>
 */
export function validateAppleSku(productId: string | null | undefined): ProductMappingResult {
  if (!productId || typeof productId !== "string" || productId.trim() === "") {
    return {
      valid: false,
      error: "Product ID (StoreKit SKU) is required.",
      code: "MISSING_PRODUCT_ID",
    };
  }

  const trimmed = productId.trim();

  // Course prefix check
  const coursePrefix = "com.makemetopper.course.";
  if (trimmed.startsWith(coursePrefix)) {
    const hex = trimmed.slice(coursePrefix.length);
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
      return {
        valid: false,
        error: `Invalid course SKU format. Expected 32-hex UUID suffix, got: ${hex}`,
        code: "INVALID_SKU_FORMAT",
      };
    }
    const courseId = cleanHexToUuid(hex);
    if (!courseId) {
      return {
        valid: false,
        error: "Failed to construct valid UUID from course SKU.",
        code: "INVALID_SKU_UUID",
      };
    }
    return {
      valid: true,
      itemType: "course",
      courseId,
    };
  }

  // PYQ Package prefix check
  const pyqPrefix = "com.makemetopper.pyq.";
  if (trimmed.startsWith(pyqPrefix)) {
    const hex = trimmed.slice(pyqPrefix.length);
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
      return {
        valid: false,
        error: `Invalid PYQ SKU format. Expected 32-hex UUID suffix, got: ${hex}`,
        code: "INVALID_SKU_FORMAT",
      };
    }
    const packageId = cleanHexToUuid(hex);
    if (!packageId) {
      return {
        valid: false,
        error: "Failed to construct valid UUID from PYQ SKU.",
        code: "INVALID_SKU_UUID",
      };
    }
    return {
      valid: true,
      itemType: "pyq_package",
      packageId,
    };
  }

  return {
    valid: false,
    error: `Unrecognized Apple product ID format: ${productId}. Expected prefix 'com.makemetopper.course.' or 'com.makemetopper.pyq.'`,
    code: "UNRECOGNIZED_PRODUCT_SKU",
  };
}

/**
 * Converts Apple StoreKit 2 transaction price in milliunits to decimal currency units.
 * Apple representation: amount = price / 1000 (e.g. 1999000 -> 1999.00).
 *
 * Strict validation: Must be a positive finite number > 0.
 */
export function convertApplePrice(priceMilliunits: number | null | undefined): PriceValidationResult {
  if (priceMilliunits === null || priceMilliunits === undefined) {
    return {
      valid: false,
      error: "Missing transaction price from Apple transaction payload.",
      code: "MISSING_PRICE",
    };
  }

  if (typeof priceMilliunits !== "number" || !Number.isFinite(priceMilliunits)) {
    return {
      valid: false,
      error: `Invalid price data type: expected finite number, got ${typeof priceMilliunits}.`,
      code: "INVALID_PRICE_TYPE",
    };
  }

  if (!Number.isSafeInteger(priceMilliunits) || priceMilliunits <= 0) {
    return {
      valid: false,
      error: `Non-positive or non-integer price (${priceMilliunits} milliunits) cannot be fulfilled.`,
      code: "INVALID_AMOUNT",
    };
  }

  // Integer-based exact 2-decimal rounded amount
  const cents = Math.round(priceMilliunits / 10);
  const roundedAmount = cents / 100;

  return {
    valid: true,
    amount: roundedAmount,
  };
}

/**
 * Validates transaction currency against the database's currency_code enum ('INR', 'USD', 'AED', 'GBP').
 */
export function validateAppleCurrency(currencyCode: string | null | undefined): CurrencyValidationResult {
  if (!currencyCode || typeof currencyCode !== "string" || currencyCode.trim() === "") {
    return {
      valid: false,
      error: "Missing transaction currency from Apple transaction payload.",
      code: "MISSING_CURRENCY",
    };
  }

  const upper = currencyCode.trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(upper as SupportedCurrency)) {
    return {
      valid: false,
      error: `Unsupported transaction currency: '${currencyCode}'. Accepted currencies: ${SUPPORTED_CURRENCIES.join(", ")}.`,
      code: "UNSUPPORTED_CURRENCY",
    };
  }

  return {
    valid: true,
    currency: upper as SupportedCurrency,
  };
}

/**
 * Validates verified Apple StoreKit 2 transaction claims against identity and policy.
 * Corresponds to Apple's JWSTransactionDecodedPayload verification.
 */
export function validateTransactionClaims(
  payload: AppleTransactionPayload,
  authenticatedProfileId: string,
  expectedBundleId: string = DEFAULT_APPLE_BUNDLE_ID
): TransactionClaimValidationResult {
  // 1. Bundle ID validation
  if (!payload.bundleId || payload.bundleId.trim() !== expectedBundleId) {
    return {
      valid: false,
      error: `Bundle ID mismatch: transaction bundleId '${payload.bundleId}' does not match expected '${expectedBundleId}'.`,
      code: "BUNDLE_ID_MISMATCH",
    };
  }

  // 2. Environment validation (strictly Production or Sandbox)
  if (!payload.environment || !["Production", "Sandbox"].includes(payload.environment)) {
    return {
      valid: false,
      error: `Invalid Apple environment: '${payload.environment}'. Only Production and Sandbox are accepted.`,
      code: "INVALID_ENVIRONMENT",
    };
  }

  // 3. App Account Token validation (RFC 4122 UUID matching profiles.profile_id)
  if (!payload.appAccountToken || typeof payload.appAccountToken !== "string" || payload.appAccountToken.trim() === "") {
    return {
      valid: false,
      error: "Missing appAccountToken in verified transaction. Transaction cannot be bound to user identity.",
      code: "MISSING_APP_ACCOUNT_TOKEN",
    };
  }

  const normalizedPayloadToken = payload.appAccountToken.trim().toLowerCase();
  const normalizedProfileId = authenticatedProfileId.trim().toLowerCase();

  if (normalizedPayloadToken !== normalizedProfileId) {
    return {
      valid: false,
      error: `Account token mismatch: transaction appAccountToken '${payload.appAccountToken}' does not match authenticated user '${authenticatedProfileId}'.`,
      code: "ACCOUNT_MISMATCH",
    };
  }

  // 4. Transaction ID presence
  if (!payload.transactionId || typeof payload.transactionId !== "string" || payload.transactionId.trim() === "") {
    return {
      valid: false,
      error: "Missing transactionId in Apple transaction payload.",
      code: "MISSING_TRANSACTION_ID",
    };
  }

  // 5. Product ID presence
  if (!payload.productId || typeof payload.productId !== "string" || payload.productId.trim() === "") {
    return {
      valid: false,
      error: "Missing productId in Apple transaction payload.",
      code: "MISSING_PRODUCT_ID",
    };
  }

  // 6. Purchase Date validation
  if (!payload.purchaseDate || typeof payload.purchaseDate !== "number" || payload.purchaseDate <= 0) {
    return {
      valid: false,
      error: "Missing or invalid purchaseDate in Apple transaction payload.",
      code: "INVALID_PURCHASE_DATE",
    };
  }

  // 7. Product type validation (discontinued subscription rejection)
  if (payload.type && (payload.type.includes("Subscription") || payload.type === "Auto-Renewable Subscription")) {
    return {
      valid: false,
      error: "Subscription purchases are retired. Only individual course and PYQ package purchases are supported.",
      code: "SUBSCRIPTIONS_DISCONTINUED",
    };
  }

  // 8. Revocation validation (reject refunded / revoked transactions)
  if (payload.revocationDate !== undefined && payload.revocationDate !== null) {
    return {
      valid: false,
      error: "Transaction was revoked or refunded by Apple. Fulfillment is blocked.",
      code: "TRANSACTION_REFUNDED",
    };
  }

  return { valid: true };
}

/**
 * Validates verified Apple StoreKit 2 AppTransaction claims against application identity.
 * Corresponds to Apple's JWSAppTransactionDecodedPayload verification in SignedDataVerifier.
 * In Production, appAppleId is mandatory and verified against expectedAppId.
 * In Sandbox, appAppleId is optional/omitted.
 */
export function validateAppTransactionClaims(
  payload: AppleAppTransactionPayload,
  expectedBundleId: string = DEFAULT_APPLE_BUNDLE_ID,
  expectedAppId?: string
): TransactionClaimValidationResult {
  // 1. Bundle ID validation
  if (!payload.bundleId || payload.bundleId.trim() !== expectedBundleId) {
    return {
      valid: false,
      error: `Bundle ID mismatch: appTransaction bundleId '${payload.bundleId}' does not match expected '${expectedBundleId}'.`,
      code: "BUNDLE_ID_MISMATCH",
    };
  }

  // 2. Environment validation (strictly Production or Sandbox)
  if (!payload.environment || !["Production", "Sandbox"].includes(payload.environment)) {
    return {
      valid: false,
      error: `Invalid Apple environment: '${payload.environment}'. Only Production and Sandbox are accepted.`,
      code: "INVALID_ENVIRONMENT",
    };
  }

  // 3. App Apple ID validation (enforced in Production when expectedAppId is configured)
  if (payload.environment === "Production") {
    if (!expectedAppId || expectedAppId.trim() === "") {
      return {
        valid: false,
        error: "Missing expected APPLE_APP_ID configuration for Production app transaction verification.",
        code: "APP_ID_CONFIG_MISSING",
      };
    }
    if (!payload.appAppleId || String(payload.appAppleId).trim() !== expectedAppId.trim()) {
      return {
        valid: false,
        error: `App ID mismatch: appTransaction appAppleId '${payload.appAppleId}' does not match expected '${expectedAppId}'.`,
        code: "APP_ID_MISMATCH",
      };
    }
  }

  return { valid: true };
}

/**
 * Validates Apple App Store Server API credentials configuration.
 * Fails closed without leaking private key contents.
 */
export function validateAppleApiCredentials(creds: AppleApiCredentials): { valid: boolean; error?: string } {
  if (!creds.issuerId || creds.issuerId.trim() === "") {
    return { valid: false, error: "Missing APPLE_IAP_ISSUER_ID secret." };
  }
  if (!creds.keyId || creds.keyId.trim() === "") {
    return { valid: false, error: "Missing APPLE_IAP_KEY_ID secret." };
  }
  if (!creds.privateKey || creds.privateKey.trim() === "") {
    return { valid: false, error: "Missing APPLE_IAP_PRIVATE_KEY secret." };
  }

  const pk = creds.privateKey.trim();
  if (!pk.includes("PRIVATE KEY")) {
    return { valid: false, error: "Malformed APPLE_IAP_PRIVATE_KEY: Expected PEM PKCS#8 format." };
  }

  return { valid: true };
}

/**
 * Builds standard ES256 JWT claims for Apple App Store Server API authorization.
 * Expiration is set to now + 900 seconds (15 minutes; Apple allows max 1 hour).
 */
export function buildAppleApiJwtClaims(
  issuerId: string,
  bundleId: string = DEFAULT_APPLE_BUNDLE_ID,
  nowSec: number = Math.floor(Date.now() / 1000)
): { iss: string; iat: number; exp: number; aud: string; bid: string } {
  return {
    iss: issuerId,
    iat: nowSec,
    exp: nowSec + 900,
    aud: "appstoreconnect-v1",
    bid: bundleId,
  };
}

/**
 * Builds the exact named parameters payload for `public.complete_apple_purchase(...)` RPC.
 */
export function buildAppleRpcPayload(params: {
  profileId: string;
  instituteId: string;
  itemType: "course" | "pyq_package";
  amount: number;
  currency: string;
  transactionId: string;
  transactionTimestamp: string;
  productId: string;
  environment: string;
  studentId?: string | null;
  courseId?: string | null;
  packageId?: string | null;
  itemName?: string | null;
  originalTransactionId?: string | null;
  gatewayResponse?: Record<string, unknown>;
  billingName?: string | null;
  billingEmail?: string | null;
}): AppleRpcPayload {
  return {
    p_profile_id: params.profileId,
    p_institute_id: params.instituteId,
    p_item_type: params.itemType,
    p_amount: params.amount,
    p_currency: params.currency,
    p_transaction_id: params.transactionId,
    p_transaction_timestamp: params.transactionTimestamp,
    p_product_id: params.productId,
    p_environment: params.environment,
    p_student_id: params.studentId || null,
    p_course_id: params.courseId || null,
    p_package_id: params.packageId || null,
    p_item_name: params.itemName || null,
    p_original_transaction_id: params.originalTransactionId || params.transactionId,
    p_gateway_response: params.gatewayResponse || {},
    p_billing_name: params.billingName || null,
    p_billing_email: params.billingEmail || null,
  };
}

/**
 * Parses and maps the database response from `public.complete_apple_purchase(...)`.
 * Strictly distinguishes between new fulfillment, existing entitlement preservation, and errors.
 */
export function handleAppleRpcResponse(rpcResult: any): AppleRpcOutcome {
  if (!rpcResult || typeof rpcResult !== "object") {
    return {
      success: false,
      statusCode: 500,
      error: "Invalid or empty response received from database fulfillment RPC.",
      code: "EMPTY_RPC_RESPONSE",
    };
  }

  // Handle explicit success response
  if (rpcResult.success === true) {
    const outcome = rpcResult.outcome || "purchase_recorded";

    if (outcome === "already_enrolled_payment_recorded") {
      return {
        success: true,
        statusCode: 200,
        outcome: "already_enrolled_payment_recorded",
        alreadyEnrolled: true,
        alreadyProcessed: false,
        paymentId: rpcResult.paymentId,
        orderId: rpcResult.orderId,
        entitlement: rpcResult.entitlement,
        message: rpcResult.message || "Payment recorded; existing active access preserved without modification.",
      };
    }

    if (outcome === "already_recorded") {
      return {
        success: true,
        statusCode: 200,
        outcome: "already_recorded",
        alreadyProcessed: true,
        alreadyEnrolled: true,
        paymentId: rpcResult.paymentId,
        orderId: rpcResult.orderId,
        message: rpcResult.message || "Transaction already fulfilled and access active.",
      };
    }

    if (outcome === "entitlement_repaired") {
      return {
        success: true,
        statusCode: 200,
        outcome: "entitlement_repaired",
        alreadyProcessed: true,
        alreadyEnrolled: false,
        paymentId: rpcResult.paymentId,
        orderId: rpcResult.orderId,
        entitlement: rpcResult.entitlement,
        message: rpcResult.message || "Missing entitlement safely repaired for existing captured Apple payment.",
      };
    }

    return {
      success: true,
      statusCode: 200,
      outcome: "purchase_recorded",
      alreadyProcessed: false,
      alreadyEnrolled: false,
      paymentId: rpcResult.paymentId,
      orderId: rpcResult.orderId,
      entitlement: rpcResult.entitlement,
      message: rpcResult.message || "Apple In-App Purchase processed atomically.",
    };
  }

  // Handle explicit error response from RPC
  const code = rpcResult.code || "FULFILLMENT_FAILED";
  const errorMsg = rpcResult.error || "Fulfillment failed in database.";

  let statusCode = 400;
  if (code === "ENTITLEMENT_REVOKED" || code === "FORBIDDEN_ROLE" || code === "ACCOUNT_MISMATCH") {
    statusCode = 403;
  } else if (code === "PROFILE_NOT_FOUND" || code === "COURSE_NOT_FOUND" || code === "PACKAGE_NOT_FOUND") {
    statusCode = 404;
  } else if (code === "UNAUTHORIZED_CALLER") {
    statusCode = 401;
  } else if (code === "TRANSACTION_REFUNDED") {
    statusCode = 409;
  }

  return {
    success: false,
    statusCode,
    error: errorMsg,
    code,
  };
}

/**
 * Decodes a base64url-encoded string safely into a UTF-8 string.
 */
export function decodeBase64Url(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return atob(base64);
}

/**
 * Extracts unverified header and payload claims from a StoreKit 2 JWS.
 * Intended ONLY for candidate lookup hints before cryptographic verification.
 */
export function parseJwsLookupHint(jwsString: string): {
  valid: boolean;
  header?: { alg?: string; x5c?: string[] };
  payload?: Partial<AppleTransactionPayload>;
  error?: string;
} {
  if (!jwsString || typeof jwsString !== "string") {
    return { valid: false, error: "Invalid JWS string: empty input." };
  }

  const parts = jwsString.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, error: `Invalid JWS format: expected 3 dot-separated segments, got ${parts.length}.` };
  }

  try {
    const headerJson = decodeBase64Url(parts[0]);
    const payloadJson = decodeBase64Url(parts[1]);

    const header = JSON.parse(headerJson);
    const payload = JSON.parse(payloadJson);

    return {
      valid: true,
      header,
      payload,
    };
  } catch (err: any) {
    return {
      valid: false,
      error: `Failed to decode JWS lookup hint: ${err?.message || err}`,
    };
  }
}

