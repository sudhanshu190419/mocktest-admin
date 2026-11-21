/**
 * apple-app-store-notifications
 *
 * Supabase Edge Function to securely receive, verify, and process Apple's
 * App Store Server Notifications V2.
 *
 * Handled Notification Types:
 *  - REFUND: Updates payment to refunded/partially_refunded; revokes Apple-owned entitlements.
 *  - REVOKE: Revokes Apple-owned entitlements (e.g. Family Sharing revoked); leaves payments intact.
 *  - REFUND_REVERSED: Restores payments/orders and previously refunded Apple-owned entitlements.
 *  - TEST: Verifies outer JWS and application identity; acknowledges without modifying database.
 *  - Unsupported types: Verified and recorded as 'ignored_unsupported' without side-effects.
 *
 * Security & Reliability Guarantees:
 *  1. verify_jwt = false at runtime level; endpoint authentication is enforced authoritatively
 *     via Apple ES256 JWS signature verification and certificate path validation to Apple Root CA - G3.
 *  2. Full RFC 5280 certificate chain validation with OCSP revocation checking.
 *  3. Application identity verification: bundleId (com.makemetopper.app) and appAppleId.
 *  4. Independent JWS cryptographic verification for nested signedTransactionInfo.
 *  5. Critical cross-platform entitlement protection: only revokes entitlements granted by the exact
 *     matching Apple order item, preserving independent Razorpay, Google Play, and admin grants.
 *  6. Atomicity & Idempotency: All state mutations executed in SECURITY DEFINER RPC
 *     public.process_apple_notification with advisory locking and unique notification UUID constraints.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueEmailSafe } from "../_shared/email/enqueue.ts";

import {
  AppleNotificationPayload,
  AppleNotificationTransactionPayload,
  buildProcessNotificationRpcPayload,
  DEFAULT_APPLE_BUNDLE_ID,
  validateNestedTransactionClaims,
} from "./appleNotificationCore.ts";

import {
  bufferToHex,
  toArrayBuffer,
  verifyAppleNotificationJws,
  verifyAppleStoreKit2Jws,
} from "./appleCrypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") || DEFAULT_APPLE_BUNDLE_ID;
const APPLE_APP_ID = Deno.env.get("APPLE_APP_ID") || "";

// Online OCSP revocation checking is strictly mandatory by default.
// In non-production testing, offline bypass is permitted ONLY when APPLE_ALLOW_SANDBOX_OFFLINE === "true"
// AND the verified environment is confirmed to be "Sandbox".
const APPLE_ALLOW_SANDBOX_OFFLINE = Deno.env.get("APPLE_ALLOW_SANDBOX_OFFLINE") === "true";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Computes SHA-256 hex hash of a string for safe audit referencing.
 */
async function computeSha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(enc));
  return bufferToHex(digest);
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only POST requests are permitted for Apple webhooks
  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: `Method ${req.method} not allowed. Apple Server Notifications require POST.` },
      405
    );
  }

  // Request size limit: reject payloads > 1MB
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1024 * 1024) {
    return jsonResponse({ success: false, error: "Payload exceeds 1MB limit." }, 413);
  }

  try {
    let body: { signedPayload?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Malformed JSON request body." }, 400);
    }

    if (!body || typeof body.signedPayload !== "string" || body.signedPayload.trim() === "") {
      return jsonResponse(
        { success: false, error: "Missing required signedPayload string in request body." },
        400
      );
    }

    const signedPayload = body.signedPayload.trim();
    const payloadHash = await computeSha256Hex(signedPayload);

    // 1. Initial outer notification JWS verification (without online checks for environment discovery)
    const initialVerify = await verifyAppleNotificationJws(signedPayload, {
      expectedBundleId: APPLE_BUNDLE_ID,
      expectedAppAppleId: APPLE_APP_ID,
      enableOnlineChecks: false,
    });

    if (!initialVerify.valid || !initialVerify.payload) {
      console.error(
        "[APPLE_NOTIFICATIONS] Outer JWS cryptographic verification failed:",
        initialVerify.error,
        initialVerify.code
      );
      return jsonResponse(
        { success: false, error: initialVerify.error, code: initialVerify.code },
        400
      );
    }

    const outerPayload: AppleNotificationPayload = initialVerify.payload;
    const isSandbox = outerPayload.data?.environment === "Sandbox";

    // 2. Determine OCSP enforcement:
    // Production notifications NEVER bypass OCSP.
    // Sandbox notifications may bypass OCSP ONLY if APPLE_ALLOW_SANDBOX_OFFLINE === "true".
    const enableOnlineChecks = !(APPLE_ALLOW_SANDBOX_OFFLINE && isSandbox);

    if (enableOnlineChecks) {
      const ocspVerify = await verifyAppleNotificationJws(signedPayload, {
        expectedBundleId: APPLE_BUNDLE_ID,
        expectedAppAppleId: APPLE_APP_ID,
        enableOnlineChecks: true,
      });

      if (!ocspVerify.valid) {
        console.error(
          "[APPLE_NOTIFICATIONS] Outer JWS certificate OCSP revocation check failed:",
          ocspVerify.error,
          ocspVerify.code
        );
        return jsonResponse(
          { success: false, error: ocspVerify.error, code: ocspVerify.code },
          400
        );
      }
    }

    console.log(
      `[APPLE_NOTIFICATIONS] Verified outer notification: type=${outerPayload.notificationType}, ` +
      `subtype=${outerPayload.subtype || "none"}, uuid=${outerPayload.notificationUUID}, env=${outerPayload.data?.environment}`
    );

    // 3. For notifications containing signedTransactionInfo: independently verify nested JWS
    let txPayload: AppleNotificationTransactionPayload | null = null;
    const signedTxInfo = outerPayload.data?.signedTransactionInfo;

    if (signedTxInfo && typeof signedTxInfo === "string") {
      const txVerify = await verifyAppleStoreKit2Jws(signedTxInfo, {
        enableOnlineChecks,
      });

      if (!txVerify.valid || !txVerify.payload) {
        console.error(
          "[APPLE_NOTIFICATIONS] Nested signedTransactionInfo JWS verification failed:",
          txVerify.error,
          txVerify.code
        );
        return jsonResponse(
          {
            success: false,
            error: `Nested transaction JWS verification failed: ${txVerify.error}`,
            code: txVerify.code,
          },
          400
        );
      }

      txPayload = txVerify.payload;

      // Cross-check nested transaction claims against outer notification
      const crossCheck = validateNestedTransactionClaims(outerPayload, txPayload, {
        expectedBundleId: APPLE_BUNDLE_ID,
      });

      if (!crossCheck.valid) {
        console.error("[APPLE_NOTIFICATIONS] Nested transaction cross-check failed:", crossCheck.error);
        return jsonResponse(
          { success: false, error: crossCheck.error, code: crossCheck.code },
          400
        );
      }

      console.log(
        `[APPLE_NOTIFICATIONS] Verified nested transaction: txId=${txPayload.transactionId}, ` +
        `sku=${txPayload.productId}, revocationDate=${txPayload.revocationDate || "none"}`
      );
    } else {
      // If notificationType is REFUND, REVOKE, or REFUND_REVERSED, signedTransactionInfo is mandatory
      if (
        outerPayload.notificationType === "REFUND" ||
        outerPayload.notificationType === "REVOKE" ||
        outerPayload.notificationType === "REFUND_REVERSED"
      ) {
        console.error(
          `[APPLE_NOTIFICATIONS] Missing signedTransactionInfo for notification type ${outerPayload.notificationType}`
        );
        return jsonResponse(
          {
            success: false,
            error: `Missing signedTransactionInfo in data object for notification type '${outerPayload.notificationType}'.`,
            code: "MISSING_TRANSACTION_INFO",
          },
          400
        );
      }
    }

    // 4. Check Supabase service-role client configuration
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[APPLE_NOTIFICATIONS] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
      return jsonResponse(
        { success: false, error: "Server configuration error: missing Supabase credentials." },
        500
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 5. Build atomic RPC parameters
    const rpcPayload = buildProcessNotificationRpcPayload(
      outerPayload,
      txPayload,
      payloadHash,
      outerPayload as unknown as Record<string, unknown>
    );

    // 6. Execute public.process_apple_notification RPC
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "process_apple_notification",
      rpcPayload
    );

    if (rpcError) {
      console.error("[APPLE_NOTIFICATIONS] Database RPC execution error:", rpcError);
      // Return 500 so Apple retries the delivery on transient database failures
      return jsonResponse(
        {
          success: false,
          error: `Database processing error: ${rpcError.message}`,
          code: rpcError.code,
        },
        500
      );
    }

    if (!rpcData?.success) {
      console.error("[APPLE_NOTIFICATIONS] Database RPC returned failure:", rpcData);
      const isTransient = rpcData?.code === "INTERNAL_ERROR" || rpcData?.code === "DB_ERROR";
      return jsonResponse(
        {
          success: false,
          error: rpcData?.error || "Notification processing failed.",
          code: rpcData?.code,
        },
        isTransient ? 500 : 400
      );
    }

    console.log(
      `[APPLE_NOTIFICATIONS] Successfully processed notification ${outerPayload.notificationUUID}: ` +
      `action=${rpcData.action}`
    );

    // 7. Enqueue Transactional Emails (PAY-04 for REFUND, PAY-06 for REVOKE)
    // Non-blocking: caught internally; failures never fail Apple's webhook response
    try {
      if (rpcData.orderId) {
        const { data: oRow } = await supabaseAdmin
          .from("orders")
          .select("profile_id, student_id")
          .eq("order_id", rpcData.orderId)
          .maybeSingle();

        const profileId = oRow?.profile_id;
        const studentId = oRow?.student_id;

        if (outerPayload.notificationType === "REFUND" && String(rpcData.action).startsWith("refund_processed")) {
          const refundAmount = txPayload.price ? (Number(txPayload.price) / 1000) : "Apple App Store";
          await enqueueEmailSafe(supabaseAdmin, {
            recipientProfileId: profileId,
            studentId,
            eventType: "PAY-04",
            subject: "Refund Processed — Make Me Topper",
            templateId: "PAY-04",
            payload: {
              refundId: txPayload.transactionId || outerPayload.notificationUUID,
              orderId: rpcData.orderId,
              itemTitle: txPayload.productId || "Apple IAP Product",
              amount: refundAmount,
              refundDate: new Date().toLocaleDateString("en-IN", { dateStyle: "medium" }),
            },
            priority: "high",
            idempotencyKey: `pay_refund:${txPayload.transactionId || outerPayload.notificationUUID}`,
          });
        } else if (outerPayload.notificationType === "REVOKE" && rpcData.action === "revocation_processed_entitlement_revoked") {
          await enqueueEmailSafe(supabaseAdmin, {
            recipientProfileId: profileId,
            studentId,
            eventType: "PAY-06",
            subject: `Access Update: ${txPayload.productId || "Apple Product"} — Make Me Topper`,
            templateId: "PAY-06",
            payload: {
              productName: txPayload.productId || "Apple IAP Product",
              transactionId: txPayload.transactionId || outerPayload.notificationUUID,
              revokedDate: new Date().toLocaleDateString("en-IN", { dateStyle: "medium" }),
            },
            priority: "normal",
            idempotencyKey: `entitlement_revoked:${txPayload.transactionId || outerPayload.notificationUUID}`,
          });
        }
      }
    } catch (emailErr) {
      console.warn(
        `[APPLE_NOTIFICATIONS] Email notification non-blocking exception:`,
        emailErr instanceof Error ? emailErr.message : String(emailErr)
      );
    }

    // Return HTTP 200 OK to Apple acknowledging successful processing
    return jsonResponse({
      success: true,
      action: rpcData.action,
      notificationUUID: outerPayload.notificationUUID,
      message: "Notification received and processed successfully.",
    });
  } catch (err: any) {
    console.error("[APPLE_NOTIFICATIONS] Unhandled exception processing notification:", err);
    return jsonResponse(
      {
        success: false,
        error: `Unexpected server error: ${err?.message || err}`,
        code: "UNHANDLED_EXCEPTION",
      },
      500
    );
  }
});

