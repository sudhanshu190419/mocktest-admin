/**
 * verify-apple-purchase
 *
 * Supabase Edge Function to securely verify Apple StoreKit 2 In-App Purchases,
 * validate cryptographic integrity against Apple Root CA - G3, query Apple App Store Server API,
 * and atomically fulfill purchase entitlements via public.complete_apple_purchase RPC.
 *
 * Security Principles:
 *  1. User identity derived EXCLUSIVELY from verified Supabase Auth JWT (auth.uid() = profiles.profile_id).
 *  2. Client-provided fields are treated as UNTRUSTED; all financial, product, and timestamp
 *     parameters are extracted exclusively from cryptographically verified Apple transactions.
 *  3. Cryptographic signature and Apple Root CA - G3 certificate pinning enforced.
 *  4. Strict deterministic SKU mapping to database course and PYQ package UUIDs.
 *  5. Replays, revocations, and cross-account claims rejected fail-closed.
 *  6. Database fulfillment delegated atomically to SECURITY DEFINER public.complete_apple_purchase.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueEmailSafe } from "../_shared/email/enqueue.ts";

import {
  AppleAppTransactionPayload,
  AppleRpcPayload,
  AppleTransactionPayload,
  buildAppleRpcPayload,
  convertApplePrice,
  DEFAULT_APPLE_BUNDLE_ID,
  handleAppleRpcResponse,
  parseJwsLookupHint,
  validateAppleApiCredentials,
  validateAppleCurrency,
  validateAppleSku,
  validateAppTransactionClaims,
  validateTransactionClaims,
} from "./appleBillingCore.ts";

import {
  generateAppleApiToken,
  queryAppleAppTransactionApi,
  queryAppleTransactionApi,
  verifyAppleAppTransactionJws,
  verifyAppleStoreKit2Jws,
} from "./appleCrypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const APPLE_IAP_ISSUER_ID = Deno.env.get("APPLE_IAP_ISSUER_ID") || "";
const APPLE_IAP_KEY_ID = Deno.env.get("APPLE_IAP_KEY_ID") || "";
const APPLE_IAP_PRIVATE_KEY = Deno.env.get("APPLE_IAP_PRIVATE_KEY") || "";
const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") || DEFAULT_APPLE_BUNDLE_ID;
const APPLE_APP_ID = Deno.env.get("APPLE_APP_ID") || "";

// Online OCSP revocation checking is strictly mandatory by default.
// In non-production testing, offline bypass is permitted ONLY when APPLE_ALLOW_SANDBOX_OFFLINE === "true"
// AND the verified transaction environment is confirmed to be "Sandbox".
// Production transactions NEVER bypass OCSP under any circumstances.
const APPLE_ALLOW_SANDBOX_OFFLINE = Deno.env.get("APPLE_ALLOW_SANDBOX_OFFLINE") === "true";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyAppleRequest {
  transactionJws: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Authenticate Request via Supabase Auth ───────────────────────────
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or malformed Authorization header.", code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Empty Bearer token provided.", code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      console.warn(`[VERIFY_APPLE_AUTH] Authentication check failed: ${authError?.message || "Invalid session"}`);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired session.", code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authenticatedUserId = authData.user.id;

    // ── 2. Authoritative Profile & Role Verification ────────────────────────
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("profile_id, role, institute_id, name, email")
      .eq("profile_id", authenticatedUserId)
      .single();

    if (profileError || !profile) {
      console.warn(`[VERIFY_APPLE_AUTH] Profile not found for user: ${authenticatedUserId}`);
      return new Response(
        JSON.stringify({ success: false, error: "User profile not found.", code: "PROFILE_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Role eligibility check: Staff accounts cannot purchase student products
    if (!["user", "student"].includes(profile.role)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Profile role '${profile.role}' is not eligible for student checkout.`,
          code: "FORBIDDEN_ROLE",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Confirm user is not an approved admin or teacher
    const [adminCheck, teacherCheck] = await Promise.all([
      supabaseAdmin
        .from("admin_roles")
        .select("role_id")
        .eq("profile_id", authenticatedUserId)
        .eq("access_status", "approved")
        .limit(1),
      supabaseAdmin
        .from("teacher_details")
        .select("teacher_id")
        .eq("profile_id", authenticatedUserId)
        .limit(1),
    ]);

    if ((adminCheck.data && adminCheck.data.length > 0) || (teacherCheck.data && teacherCheck.data.length > 0)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Staff accounts cannot be converted to students or perform in-app purchases.",
          code: "FORBIDDEN_ROLE",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Validate Request Body ────────────────────────────────────────────
    let body: VerifyAppleRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Malformed JSON request body.", code: "INVALID_JSON_BODY" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body?.transactionJws || typeof body.transactionJws !== "string" || body.transactionJws.trim() === "") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required parameter: transactionJws.", code: "MISSING_TRANSACTION_JWS" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientJws = body.transactionJws.trim();

    // ── 4. Cryptographic Verification of Client StoreKit 2 JWS ───────────────
    // Enforces full RFC 5280 certificate chain validation against pinned Apple Root CA - G3,
    // verifies ES256 ECDSA P-256 signature, and enforces online OCSP revocation checks.
    // In Production, online OCSP checks are strictly mandatory and fail-closed.
    let clientJwsVerification = await verifyAppleStoreKit2Jws(clientJws, {
      enableOnlineChecks: !APPLE_ALLOW_SANDBOX_OFFLINE,
    });
    if (!clientJwsVerification.valid || !clientJwsVerification.payload) {
      console.warn(`[VERIFY_APPLE_SECURITY] Client JWS verification failed: ${clientJwsVerification.error}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: clientJwsVerification.error || "Cryptographic verification of transaction JWS failed.",
          code: clientJwsVerification.code || "JWS_VERIFICATION_FAILED",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let verifiedTransaction: AppleTransactionPayload = clientJwsVerification.payload;

    // Strict Production OCSP Invariant: If verified environment is Production, OCSP checks MUST
    // have executed. If APPLE_ALLOW_SANDBOX_OFFLINE bypassed OCSP initially, re-verify with mandatory OCSP.
    if (verifiedTransaction.environment === "Production" && APPLE_ALLOW_SANDBOX_OFFLINE) {
      const prodOcspVerification = await verifyAppleStoreKit2Jws(clientJws, {
        enableOnlineChecks: true,
      });
      if (!prodOcspVerification.valid || !prodOcspVerification.payload) {
        console.warn(`[VERIFY_APPLE_SECURITY] Production transaction failed mandatory OCSP check: ${prodOcspVerification.error}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: prodOcspVerification.error || "Production transaction failed mandatory OCSP revocation check.",
            code: prodOcspVerification.code || "OCSP_CHECK_FAILED",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      verifiedTransaction = prodOcspVerification.payload;
    }

    // ── 5. Server-to-Server App Store Server API & App Transaction Checks ────
    const apiCreds = {
      issuerId: APPLE_IAP_ISSUER_ID,
      keyId: APPLE_IAP_KEY_ID,
      privateKey: APPLE_IAP_PRIVATE_KEY,
      bundleId: APPLE_BUNDLE_ID,
    };
    const credValidation = validateAppleApiCredentials(apiCreds);

    // In Production, Apple API credentials and APPLE_APP_ID are strictly mandatory (fail closed)
    if (verifiedTransaction.environment === "Production") {
      if (!credValidation.valid) {
        console.error(`[VERIFY_APPLE_API] Production Apple API credentials missing or invalid: ${credValidation.error}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Apple App Store Server API credentials are required for Production purchase verification.",
            code: "APPLE_API_CREDENTIALS_MISSING",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!APPLE_APP_ID || APPLE_APP_ID.trim() === "") {
        console.error("[VERIFY_APPLE_CONFIG] APPLE_APP_ID is not configured for Production.");
        return new Response(
          JSON.stringify({
            success: false,
            error: "APPLE_APP_ID configuration is required for Production purchase verification.",
            code: "APP_ID_CONFIG_MISSING",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (credValidation.valid) {
      try {
        const apiToken = await generateAppleApiToken(apiCreds);
        const targetEnv = verifiedTransaction.environment === "Sandbox" ? "Sandbox" : "Production";

        // 5a. Query In-App Purchase Transaction Info
        let apiResult = await queryAppleTransactionApi(verifiedTransaction.transactionId, apiToken, targetEnv);

        // Fallback cross-check if transaction environment differs
        if (!apiResult.success && apiResult.statusCode === 404 && targetEnv === "Production") {
          apiResult = await queryAppleTransactionApi(verifiedTransaction.transactionId, apiToken, "Sandbox");
        }

        if (apiResult.success && apiResult.signedTransactionInfo) {
          const serverJwsVerification = await verifyAppleStoreKit2Jws(apiResult.signedTransactionInfo, {
            enableOnlineChecks: verifiedTransaction.environment === "Production" || !APPLE_ALLOW_SANDBOX_OFFLINE,
          });
          if (serverJwsVerification.valid && serverJwsVerification.payload) {
            // Confirm server transaction matches client transaction
            if (serverJwsVerification.payload.transactionId !== verifiedTransaction.transactionId) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error: "Authoritative Apple transaction ID does not match client transaction ID.",
                  code: "TRANSACTION_ID_MISMATCH",
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
            // Use authoritative server-retrieved transaction payload
            verifiedTransaction = serverJwsVerification.payload;
          } else {
            return new Response(
              JSON.stringify({
                success: false,
                error: `Authoritative server transaction JWS verification failed: ${serverJwsVerification.error}`,
                code: serverJwsVerification.code || "SERVER_JWS_VERIFICATION_FAILED",
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else if (!apiResult.success && apiResult.statusCode === 404) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Transaction ${verifiedTransaction.transactionId} was not found on Apple servers.`,
              code: "TRANSACTION_NOT_FOUND_ON_APPLE",
            }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // 5b. Query & Validate App Transaction Info (Apple StoreKit 2 App Transaction)
        let appTxResult = await queryAppleAppTransactionApi(verifiedTransaction.transactionId, apiToken, targetEnv);

        // Fallback cross-check if transaction environment differs
        if (!appTxResult.success && appTxResult.statusCode === 404 && targetEnv === "Production") {
          appTxResult = await queryAppleAppTransactionApi(verifiedTransaction.transactionId, apiToken, "Sandbox");
        }

        if (appTxResult.success && appTxResult.signedAppTransactionInfo) {
          const verifiedAppTxResult = await verifyAppleAppTransactionJws(appTxResult.signedAppTransactionInfo, {
            enableOnlineChecks: verifiedTransaction.environment === "Production" || !APPLE_ALLOW_SANDBOX_OFFLINE,
          });

          if (!verifiedAppTxResult.valid || !verifiedAppTxResult.payload) {
            console.warn(`[VERIFY_APPLE_SECURITY] App transaction JWS verification failed: ${verifiedAppTxResult.error}`);
            return new Response(
              JSON.stringify({
                success: false,
                error: verifiedAppTxResult.error || "Cryptographic verification of App Transaction failed.",
                code: verifiedAppTxResult.code || "APP_TRANSACTION_VERIFICATION_FAILED",
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const verifiedAppTx = verifiedAppTxResult.payload;

          // Validate App Transaction claims (bundleId, environment, and in Production appAppleId === APPLE_APP_ID)
          const appClaimValidation = validateAppTransactionClaims(
            verifiedAppTx,
            APPLE_BUNDLE_ID,
            APPLE_APP_ID
          );

          if (!appClaimValidation.valid) {
            console.warn(`[VERIFY_APPLE_SECURITY] App transaction claim validation failed: ${appClaimValidation.error}`);
            return new Response(
              JSON.stringify({
                success: false,
                error: appClaimValidation.error,
                code: appClaimValidation.code || "INVALID_APP_TRANSACTION_CLAIMS",
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Cross-validate that the App Transaction bundleId matches the transaction payload bundleId
          if (verifiedAppTx.bundleId !== verifiedTransaction.bundleId) {
            return new Response(
              JSON.stringify({
                success: false,
                error: `App transaction bundle ID '${verifiedAppTx.bundleId}' does not match transaction bundle ID '${verifiedTransaction.bundleId}'.`,
                code: "BUNDLE_ID_MISMATCH",
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else if (verifiedTransaction.environment === "Production") {
          // In Production, App Transaction retrieval and validation is mandatory
          return new Response(
            JSON.stringify({
              success: false,
              error: `Failed to retrieve authoritative App Transaction from Apple: ${appTxResult.error || "Not found"}`,
              code: "APP_TRANSACTION_RETRIEVAL_FAILED",
            }),
            { status: appTxResult.statusCode || 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (err: any) {
        console.error(`[VERIFY_APPLE_API] Error querying App Store Server API: ${err?.message || err}`);
        if (verifiedTransaction.environment === "Production") {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Apple API query failed in Production: ${err?.message || err}`,
              code: "APPLE_API_ERROR",
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // In Sandbox only: continues with cryptographically verified JWS if API is temporarily unavailable
      }
    }

    // ── 6. Mandatory Verified Transaction Claim Checks ──────────────────────
    const claimValidation = validateTransactionClaims(
      verifiedTransaction,
      profile.profile_id,
      APPLE_BUNDLE_ID
    );
    if (!claimValidation.valid) {
      console.warn(`[VERIFY_APPLE_SECURITY] Transaction claim validation failed: ${claimValidation.error}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: claimValidation.error,
          code: claimValidation.code || "INVALID_TRANSACTION_CLAIMS",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 7. Deterministic SKU Mapping & Catalog Verification ─────────────────
    const skuMapping = validateAppleSku(verifiedTransaction.productId);
    if (!skuMapping.valid || !skuMapping.itemType) {
      return new Response(
        JSON.stringify({
          success: false,
          error: skuMapping.error || "Invalid Apple product SKU format.",
          code: skuMapping.code || "INVALID_SKU",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let resolvedInstituteId = profile.institute_id;
    let resolvedItemName: string | null = null;

    if (skuMapping.itemType === "course") {
      const { data: course, error: courseErr } = await supabaseAdmin
        .from("courses")
        .select("course_id, institute_id, title, is_published")
        .eq("course_id", skuMapping.courseId!)
        .single();

      if (courseErr || !course) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Course ${skuMapping.courseId} referenced by Apple SKU was not found in catalog.`,
            code: "COURSE_NOT_FOUND",
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      resolvedInstituteId = course.institute_id || resolvedInstituteId;
      resolvedItemName = course.title || "Course Enrollment";

    } else if (skuMapping.itemType === "pyq_package") {
      const { data: pkg, error: pkgErr } = await supabaseAdmin
        .from("pyq_packages")
        .select("package_id, institute_id, name, is_active")
        .eq("package_id", skuMapping.packageId!)
        .single();

      if (pkgErr || !pkg) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `PYQ package ${skuMapping.packageId} referenced by Apple SKU was not found in catalog.`,
            code: "PACKAGE_NOT_FOUND",
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      resolvedInstituteId = pkg.institute_id || resolvedInstituteId;
      resolvedItemName = pkg.name || "PYQ Package Access";
    }

    if (!resolvedInstituteId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to resolve institute context for purchase fulfillment.",
          code: "INSTITUTE_RESOLUTION_FAILED",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 8. Authoritative Price, Currency & Timestamp Extraction ─────────────
    const priceValidation = convertApplePrice(verifiedTransaction.price);
    if (!priceValidation.valid || priceValidation.amount === undefined) {
      return new Response(
        JSON.stringify({
          success: false,
          error: priceValidation.error || "Invalid price in verified Apple transaction.",
          code: priceValidation.code || "INVALID_PRICE",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currencyValidation = validateAppleCurrency(verifiedTransaction.currency);
    if (!currencyValidation.valid || !currencyValidation.currency) {
      return new Response(
        JSON.stringify({
          success: false,
          error: currencyValidation.error || "Unsupported transaction currency.",
          code: currencyValidation.code || "UNSUPPORTED_CURRENCY",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transactionTimestamp = new Date(verifiedTransaction.purchaseDate).toISOString();

    // ── 9. Atomic Database Fulfillment via RPC ──────────────────────────────
    const rpcPayload: AppleRpcPayload = buildAppleRpcPayload({
      profileId: profile.profile_id,
      instituteId: resolvedInstituteId,
      itemType: skuMapping.itemType,
      amount: priceValidation.amount,
      currency: currencyValidation.currency,
      transactionId: verifiedTransaction.transactionId,
      transactionTimestamp,
      productId: verifiedTransaction.productId,
      environment: verifiedTransaction.environment,
      studentId: null, // Resolved automatically by RPC if null
      courseId: skuMapping.courseId || null,
      packageId: skuMapping.packageId || null,
      itemName: resolvedItemName,
      originalTransactionId: verifiedTransaction.originalTransactionId || verifiedTransaction.transactionId,
      gatewayResponse: {
        bundleId: verifiedTransaction.bundleId,
        inAppOwnershipType: verifiedTransaction.inAppOwnershipType,
        signedDate: verifiedTransaction.signedDate,
        verifiedAt: new Date().toISOString(),
      },
      billingName: profile.name || null,
      billingEmail: profile.email || null,
    });

    console.log(`[VERIFY_APPLE_RPC] Invoking complete_apple_purchase for txId: ${verifiedTransaction.transactionId}`);
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("complete_apple_purchase", rpcPayload);

    if (rpcError) {
      console.error(`[VERIFY_APPLE_RPC_ERROR] complete_apple_purchase failed:`, rpcError);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Database fulfillment error: ${rpcError.message || rpcError}`,
          code: rpcError.code || "RPC_EXECUTION_ERROR",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 10. Handle and Format RPC Result ────────────────────────────────────
    const handledOutcome = handleAppleRpcResponse(rpcResult);

    // ── 11. Asynchronous Transactional Email Enqueue (PAY-01 / PAY-02) ────────
    // Non-blocking: Email enqueue failures must NEVER fail or rollback purchase verification.
    if (handledOutcome.success) {
      try {
        let studentId: string | null = null;

        if (handledOutcome.orderId) {
          const { data: oRow } = await supabaseAdmin
            .from("orders")
            .select("student_id")
            .eq("order_id", handledOutcome.orderId)
            .maybeSingle();
          studentId = oRow?.student_id || null;
        }
        if (!studentId) {
          const { data: sRow } = await supabaseAdmin
            .from("student_details")
            .select("student_id")
            .eq("profile_id", profile.profile_id)
            .maybeSingle();
          studentId = sRow?.student_id || null;
        }

        if (skuMapping.itemType === "course" && skuMapping.courseId && studentId) {
          const { data: enrData } = await supabaseAdmin
            .from("course_enrollments")
            .select("enrollment_id")
            .eq("course_id", skuMapping.courseId)
            .eq("student_id", studentId)
            .maybeSingle();

          const enrollmentId = enrData?.enrollment_id || null;
          const idempotencyKey = enrollmentId
            ? `course_enrolled:${enrollmentId}`
            : `course_enrolled:apple:${verifiedTransaction.transactionId}`;

          await enqueueEmailSafe(supabaseAdmin, {
            recipientProfileId: profile.profile_id,
            studentId,
            eventType: "PAY-01",
            subject: `Order Confirmed: ${resolvedItemName} — Make Me Topper`,
            templateId: "PAY-01",
            payload: {
              courseName: resolvedItemName,
              enrollmentNumber: "Active",
              orderId: handledOutcome.orderId || "N/A",
              amount: priceValidation.amount,
              purchaseDate: new Date().toLocaleDateString("en-IN", { dateStyle: "medium" }),
            },
            priority: "high",
            idempotencyKey,
          });
        } else if (skuMapping.itemType === "pyq_package" && skuMapping.packageId && studentId) {
          const { data: pyqData } = await supabaseAdmin
            .from("student_pyq_purchases")
            .select("purchase_id")
            .eq("package_id", skuMapping.packageId)
            .eq("student_id", studentId)
            .maybeSingle();

          const purchaseId = pyqData?.purchase_id || null;
          const idempotencyKey = purchaseId
            ? `pyq_purchase:${purchaseId}`
            : `pyq_purchase:apple:${verifiedTransaction.transactionId}`;

          await enqueueEmailSafe(supabaseAdmin, {
            recipientProfileId: profile.profile_id,
            studentId,
            eventType: "PAY-02",
            subject: `Access Granted: ${resolvedItemName} — Make Me Topper`,
            templateId: "PAY-02",
            payload: {
              packageName: resolvedItemName,
              purchaseId: purchaseId || verifiedTransaction.transactionId,
              orderId: handledOutcome.orderId || "N/A",
              amount: priceValidation.amount,
              purchaseDate: new Date().toLocaleDateString("en-IN", { dateStyle: "medium" }),
            },
            priority: "high",
            idempotencyKey,
          });
        }
      } catch (emailErr) {
        console.warn("[VERIFY_APPLE] Email enqueue non-blocking exception:", emailErr);
      }
    }

    return new Response(JSON.stringify(handledOutcome), {
      status: handledOutcome.statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (fatalErr: any) {
    console.error("[VERIFY_APPLE_FATAL] Unexpected error in verify-apple-purchase:", fatalErr);
    return new Response(
      JSON.stringify({
        success: false,
        error: "An unexpected error occurred during purchase verification.",
        code: "INTERNAL_SERVER_ERROR",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

