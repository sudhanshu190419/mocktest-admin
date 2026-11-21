/**
 * Apple App Store Server Notifications V2 Core Types & Business Logic
 *
 * Implements:
 *  1. TypeScript interfaces for Apple App Store Server Notifications V2 payloads:
 *     - Outer ResponseBodyV2DecodedPayload
 *     - Nested JWSTransactionDecodedPayload
 *  2. Application identity & envelope claims validation
 *  3. Cross-check validation between outer notification and nested transaction
 *  4. RPC payload builder for public.process_apple_notification
 *  5. Error classification and normalized outcome responses
 */

export const DEFAULT_APPLE_BUNDLE_ID = "com.makemetopper.app";

/** Outer App Store Server Notifications V2 Decoded Payload */
export interface AppleNotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  version: string;
  signedDate: number;
  data?: {
    appAppleId?: number | string;
    bundleId?: string;
    bundleVersion?: string;
    environment?: "Production" | "Sandbox";
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    status?: number;
  };
  summary?: Record<string, unknown>;
  externalPurchaseToken?: Record<string, unknown>;
}

/** Nested StoreKit 2 Transaction Decoded Payload */
export interface AppleNotificationTransactionPayload {
  transactionId: string;
  originalTransactionId: string;
  webOrderLineItemId?: string;
  bundleId: string;
  productId: string;
  subscriptionGroupIdentifier?: string;
  purchaseDate: number;
  originalPurchaseDate: number;
  expiresDate?: number;
  quantity: number;
  type: string;
  appAccountToken?: string;
  inAppOwnershipType?: string; // "PURCHASED" | "FAMILY_SHARED"
  signedDate: number;
  environment: "Production" | "Sandbox";
  transactionReason?: string;
  storefront?: string;
  storefrontId?: string;
  price?: number;
  currency?: string;
  revocationDate?: number;
  revocationReason?: number;
  revocationPercentage?: number; // integer 0..100000
  revocationType?: number | string;
}

/** RPC Payload structure passed to public.process_apple_notification */
export interface ProcessAppleNotificationRpcPayload {
  p_notification_uuid: string;
  p_notification_type: string;
  p_subtype: string | null;
  p_environment: string;
  p_bundle_id: string;
  p_app_apple_id: number | null;
  p_signed_date: string;
  p_payload_hash: string;
  p_raw_payload: Record<string, unknown> | null;
  p_transaction_id: string | null;
  p_original_transaction_id: string | null;
  p_product_id: string | null;
  p_app_account_token: string | null;
  p_revocation_date: string | null;
  p_revocation_reason: number | null;
  p_revocation_percentage: number | null;
  p_revocation_type: string | null;
  p_in_app_ownership_type: string | null;
}

/** Validation Options for Apple Notifications */
export interface ValidateNotificationOptions {
  expectedBundleId?: string;
  expectedAppAppleId?: string;
  currentTimeMs?: number;
}

/**
 * Validates outer notification envelope claims.
 */
export function validateNotificationEnvelope(
  payload: AppleNotificationPayload,
  options?: ValidateNotificationOptions
): { valid: boolean; error?: string; code?: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Empty or invalid notification payload object.", code: "INVALID_PAYLOAD" };
  }

  // 1. notificationType
  if (!payload.notificationType || typeof payload.notificationType !== "string") {
    return { valid: false, error: "Missing or invalid notificationType in notification payload.", code: "MISSING_NOTIFICATION_TYPE" };
  }

  // 2. notificationUUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!payload.notificationUUID || !uuidRegex.test(payload.notificationUUID)) {
    return {
      valid: false,
      error: `Invalid notificationUUID format: '${payload.notificationUUID}'. Must be a valid UUID.`,
      code: "INVALID_NOTIFICATION_UUID",
    };
  }

  // 3. version
  if (!payload.version || typeof payload.version !== "string") {
    return { valid: false, error: "Missing version string in notification payload.", code: "MISSING_VERSION" };
  }
  if (!payload.version.startsWith("2")) {
    return {
      valid: false,
      error: `Unsupported notification version '${payload.version}'. Expected V2 ('2.x').`,
      code: "UNSUPPORTED_VERSION",
    };
  }

  // 4. signedDate
  const nowMs = options?.currentTimeMs ?? Date.now();
  if (typeof payload.signedDate !== "number" || isNaN(payload.signedDate)) {
    return { valid: false, error: "Missing or non-numeric signedDate in notification payload.", code: "INVALID_SIGNED_DATE" };
  }
  // Reject timestamps prior to 2020 or more than 10 minutes in the future (clock skew guard)
  if (payload.signedDate < 1577836800000 || payload.signedDate > nowMs + 10 * 60 * 1000) {
    return {
      valid: false,
      error: `signedDate ${payload.signedDate} is out of acceptable time bounds.`,
      code: "SIGNED_DATE_OUT_OF_BOUNDS",
    };
  }

  // 5. data claims (when data object is present)
  if (payload.data) {
    const expectedBundleId = options?.expectedBundleId || DEFAULT_APPLE_BUNDLE_ID;
    if (payload.data.bundleId && payload.data.bundleId !== expectedBundleId) {
      return {
        valid: false,
        error: `Notification bundleId '${payload.data.bundleId}' does not match expected '${expectedBundleId}'.`,
        code: "BUNDLE_ID_MISMATCH",
      };
    }

    if (payload.data.environment && payload.data.environment !== "Production" && payload.data.environment !== "Sandbox") {
      return {
        valid: false,
        error: `Invalid environment '${payload.data.environment}'. Expected 'Production' or 'Sandbox'.`,
        code: "INVALID_ENVIRONMENT",
      };
    }

    // In Production, validate appAppleId when configured
    if (
      payload.data.environment === "Production" &&
      options?.expectedAppAppleId &&
      payload.data.appAppleId != null
    ) {
      const incomingAppIdStr = String(payload.data.appAppleId);
      if (incomingAppIdStr !== options.expectedAppAppleId) {
        return {
          valid: false,
          error: `appAppleId '${incomingAppIdStr}' does not match expected production App ID '${options.expectedAppAppleId}'.`,
          code: "APP_ID_MISMATCH",
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Cross-checks verified nested transaction data against the outer notification.
 */
export function validateNestedTransactionClaims(
  outer: AppleNotificationPayload,
  tx: AppleNotificationTransactionPayload,
  options?: ValidateNotificationOptions
): { valid: boolean; error?: string; code?: string } {
  if (!tx || typeof tx !== "object") {
    return { valid: false, error: "Missing nested transaction payload.", code: "MISSING_TRANSACTION_PAYLOAD" };
  }

  // 1. Transaction IDs
  if (!tx.transactionId || typeof tx.transactionId !== "string" || tx.transactionId.trim() === "") {
    return { valid: false, error: "Missing or empty transactionId in nested transaction.", code: "INVALID_TRANSACTION_ID" };
  }

  // 2. Bundle ID matching
  const expectedBundleId = options?.expectedBundleId || DEFAULT_APPLE_BUNDLE_ID;
  if (tx.bundleId !== expectedBundleId) {
    return {
      valid: false,
      error: `Transaction bundleId '${tx.bundleId}' does not match expected '${expectedBundleId}'.`,
      code: "BUNDLE_ID_MISMATCH",
    };
  }

  if (outer.data?.bundleId && tx.bundleId !== outer.data.bundleId) {
    return {
      valid: false,
      error: `Transaction bundleId '${tx.bundleId}' does not match outer notification bundleId '${outer.data.bundleId}'.`,
      code: "BUNDLE_ID_MISMATCH",
    };
  }

  // 3. Environment matching
  if (tx.environment !== "Production" && tx.environment !== "Sandbox") {
    return {
      valid: false,
      error: `Invalid transaction environment '${tx.environment}'. Expected 'Production' or 'Sandbox'.`,
      code: "INVALID_ENVIRONMENT",
    };
  }

  if (outer.data?.environment && tx.environment !== outer.data.environment) {
    return {
      valid: false,
      error: `Transaction environment '${tx.environment}' does not match outer notification environment '${outer.data.environment}'.`,
      code: "ENVIRONMENT_MISMATCH",
    };
  }

  // 4. Product ID
  if (!tx.productId || typeof tx.productId !== "string" || tx.productId.trim() === "") {
    return { valid: false, error: "Missing productId in transaction payload.", code: "MISSING_PRODUCT_ID" };
  }

  return { valid: true };
}

/**
 * Builds the complete parameters object for the public.process_apple_notification RPC.
 */
export function buildProcessNotificationRpcPayload(
  outer: AppleNotificationPayload,
  txPayload: AppleNotificationTransactionPayload | null,
  payloadHash: string,
  rawPayload: Record<string, unknown> | null
): ProcessAppleNotificationRpcPayload {
  const env = outer.data?.environment || txPayload?.environment || "Production";
  const bundleId = outer.data?.bundleId || txPayload?.bundleId || DEFAULT_APPLE_BUNDLE_ID;
  const appAppleId =
    outer.data?.appAppleId != null ? parseInt(String(outer.data.appAppleId), 10) || null : null;

  let revocationDateIso: string | null = null;
  if (txPayload?.revocationDate) {
    revocationDateIso = new Date(txPayload.revocationDate).toISOString();
  }

  let appAccountToken: string | null = null;
  if (txPayload?.appAccountToken) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(txPayload.appAccountToken)) {
      appAccountToken = txPayload.appAccountToken;
    }
  }

  return {
    p_notification_uuid: outer.notificationUUID,
    p_notification_type: outer.notificationType,
    p_subtype: outer.subtype || null,
    p_environment: env,
    p_bundle_id: bundleId,
    p_app_apple_id: appAppleId,
    p_signed_date: new Date(outer.signedDate).toISOString(),
    p_payload_hash: payloadHash,
    p_raw_payload: rawPayload,
    p_transaction_id: txPayload?.transactionId || null,
    p_original_transaction_id: txPayload?.originalTransactionId || txPayload?.transactionId || null,
    p_product_id: txPayload?.productId || null,
    p_app_account_token: appAccountToken,
    p_revocation_date: revocationDateIso,
    p_revocation_reason: txPayload?.revocationReason != null ? txPayload.revocationReason : null,
    p_revocation_percentage: txPayload?.revocationPercentage != null ? txPayload.revocationPercentage : null,
    p_revocation_type: txPayload?.revocationType != null ? String(txPayload.revocationType) : null,
    p_in_app_ownership_type: txPayload?.inAppOwnershipType || null,
  };
}
