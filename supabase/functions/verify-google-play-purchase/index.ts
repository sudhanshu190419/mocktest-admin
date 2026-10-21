/**
 * verify-google-play-purchase
 *
 * Supabase Edge Function to securely verify Google Play In-App and Subscription
 * purchases server-side, acknowledge the purchase, and grant entitlements
 * idempotently in Supabase PostgreSQL.
 *
 * Security Principles:
 *  1. User identity is derived EXCLUSIVELY from the verified JWT (auth.uid()).
 *  2. Purchase tokens are verified against Google Play Developer API (when credentials are set).
 *  3. Replay attacks are prevented via unique constraint on gateway_payment_id.
 *  4. Product-to-entitlement mapping is validated against active catalog data.
 *  5. Entitlements are created server-side with service-role database privileges.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  validateServiceAccountJson,
  verifyGooglePlayPurchaseState,
  calculateSubscriptionExpiry,
  calculateSubscriptionWindows,
  getInstituteSubscriptionSettings,
  validateSubscriptionCourseAssociation,
  cleanHexToUuid,
  authenticatePlayPurchaseRequest,
  sanitizeGoogleApiError,
  buildGooglePlayRpcPayload,
  handleGooglePlayRpcResponse,
  isRpcMissingError,
  classifyRpcError,
  buildOrderItemPayload,
  validateExistingOrderItem,
} from "./billingCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "";
const ANDROID_PACKAGE_NAME = Deno.env.get("ANDROID_PACKAGE_NAME") || "com.makemetopper.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyRequestPayload {
  productId: string;
  purchaseToken: string;
  orderId?: string;
  productType?: "inapp" | "subs";
  courseId?: string;
  planId?: string;
  packageId?: string;
  purchaseTime?: number;
}

/**
 * Generates an OAuth2 access token for Google Android Publisher API using service account key.
 * Fails safely if credentials are missing or malformed without leaking private secrets.
 */
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string | null> {
  try {
    const validation = validateServiceAccountJson(serviceAccountJson);
    if (!validation.valid || !validation.clientEmail || !validation.privateKey) {
      console.error("[GOOGLE_AUTH_ERROR] Invalid service account credentials:", validation.error);
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: validation.clientEmail,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    // Encode JWT header and payload
    const encodeBase64Url = (str: string) => btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = encodeBase64Url(JSON.stringify(claim));
    const unsignedToken = `${header}.${payload}`;

    // Clean private key PEM
    const pem = validation.privateKey
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s+/g, "");
    const binaryKey = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(unsignedToken)
    );

    const signatureBase64 = encodeBase64Url(String.fromCharCode(...new Uint8Array(signature)));
    const jwt = `${unsignedToken}.${signatureBase64}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      console.error("[GOOGLE_AUTH_ERROR] Token exchange failed:", await tokenRes.text());
      return null;
    }

    const tokenData = await tokenRes.json();
    return tokenData.access_token || null;
  } catch (err) {
    console.error("[GOOGLE_AUTH_ERROR] Exception getting access token:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");

    // Initialize Supabase Admin Client using service role key
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user identity securely (authoritative Supabase Auth validation)
    const authResult = await authenticatePlayPurchaseRequest(authHeader, supabaseAdmin.auth);
    if (!authResult.authenticated || !authResult.profileId) {
      console.warn(
        `[VERIFY_PLAY_DIAGNOSTIC] Verification stage: Authentication check failed - ${authResult.errorMessage || "Invalid session"}`,
      );
      return new Response(JSON.stringify({ success: false, error: authResult.errorMessage || "Invalid or expired session" }), {
        status: authResult.statusCode || 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profileId: string = authResult.profileId;
    console.log(`[VERIFY_PLAY_DIAGNOSTIC] Verification stage: User session identified via Supabase Auth (userId: ${profileId})`);

    const body: VerifyRequestPayload = await req.json();
    const { productId, purchaseToken, orderId, productType = "inapp", courseId, planId, packageId } = body;

    const hasRequiredFields = Boolean(productId && purchaseToken);
    console.log("[VERIFY_PLAY_DIAGNOSTIC] Verification stage: Required fields check:", {
      hasProductId: Boolean(productId),
      hasPurchaseToken: Boolean(purchaseToken),
      hasOrderId: Boolean(orderId),
      productType,
      courseId: courseId || null,
      planId: planId || null,
      packageId: packageId || null,
    });

    if (!hasRequiredFields) {
      console.warn("[VERIFY_PLAY_DIAGNOSTIC] Verification stage: Branch: Missing required purchase fields (productId, purchaseToken)");
      return new Response(JSON.stringify({ success: false, error: "Missing required purchase fields (productId, purchaseToken)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const effectiveOrderId = orderId || `GPA.${purchaseToken.slice(-16)}`;

    // cleanHexToUuid imported from billingCore.ts

    // ── 1. Replay / Cross-Account Ownership Check ──────────────────────────
    const { data: existingPayment } = await supabaseAdmin
      .from("payments")
      .select("payment_id, order_id, status, orders(profile_id, student_id)")
      .eq("gateway", "google_play")
      .or(`gateway_payment_id.eq.${effectiveOrderId},gateway_order_id.eq.${effectiveOrderId},gateway_order_id.eq.${purchaseToken}`)
      .eq("status", "captured")
      .maybeSingle();

    if (existingPayment) {
      const paymentOwnerProfileId = (existingPayment as any).orders?.profile_id;
      if (paymentOwnerProfileId && paymentOwnerProfileId !== profileId) {
        console.warn(`[VERIFY_PLAY_SECURITY] Token replay by different user. Original: ${paymentOwnerProfileId}, Attempted: ${profileId}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: "This purchase has already been claimed by another account. Please sign in with the original account or contact support.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[VERIFY_PLAY] Payment ${effectiveOrderId} already captured by current user. Returning success idempotently.`);

      // Ensure Google Play acknowledgment was not interrupted during earlier attempt
      try {
        const saValidation = validateServiceAccountJson(GOOGLE_SERVICE_ACCOUNT_JSON);
        if (saValidation.valid) {
          const accessToken = await getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_JSON);
          if (accessToken) {
            const isSub = productId.startsWith("sub_") || productType === "subs";
            const ackUrl = isSub
              ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`
              : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}:acknowledge`;
            await fetch(ackUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ developerPayload: profileId }),
            });
          }
        }
      } catch (replayAckErr) {
        console.warn("[VERIFY_PLAY] Idempotent replay acknowledge non-fatal warning:", replayAckErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          alreadyProcessed: true,
          orderId: existingPayment.order_id,
          message: "Purchase already processed and entitlement active",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Server-to-Server Google Play Verification (FAIL-CLOSED) ─────────
    // A. Validate Google Service Account Credentials
    const saValidation = validateServiceAccountJson(GOOGLE_SERVICE_ACCOUNT_JSON);
    if (!saValidation.valid) {
      console.error("[VERIFY_PLAY_SECURITY_FAIL_CLOSED] Missing or invalid GOOGLE_SERVICE_ACCOUNT_JSON secret.");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server billing configuration error. Authoritative Google Play verification is unavailable.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // B. Obtain Google API OAuth2 Access Token
    const accessToken = await getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_JSON);
    if (!accessToken) {
      console.error("[VERIFY_PLAY_SECURITY_FAIL_CLOSED] Failed to obtain Google API access token.");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to authenticate with Google Play verification service. Please try again later.",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // C. Query Google Play Developer API
    const isSub = productType === "subs" || Boolean(planId) || productId.startsWith("sub_");
    const verifyUrl = isSub
      ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${purchaseToken}`
      : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}`;

    console.log(`[VERIFY_PLAY_DIAGNOSTIC] Verification stage: Querying Google API for productId: ${productId} (type: ${isSub ? "subs" : "inapp"})`);
    const googleRes = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log(`[VERIFY_PLAY_DIAGNOSTIC] Verification stage: Google API HTTP status: ${googleRes.status}`);

    if (!googleRes.ok) {
      const errText = await googleRes.text();
      const sanitizedDiag = sanitizeGoogleApiError(googleRes.status, errText);
      const rawWwwAuth = googleRes.headers.get("www-authenticate");
      const sanitizedWwwAuth = rawWwwAuth ? rawWwwAuth.replace(/[A-Za-z0-9_-]{35,}/g, "[REDACTED]") : null;

      console.error(`[VERIFY_PLAY_DIAGNOSTIC] Verification stage: Branch: Google API validation failed:`, {
        status: sanitizedDiag.status,
        classification: sanitizedDiag.classification,
        errorStatus: sanitizedDiag.errorStatus || null,
        errorMessage: sanitizedDiag.errorMessage || null,
        errorReason: sanitizedDiag.errorReason || null,
        errorDomain: sanitizedDiag.errorDomain || null,
        wwwAuthenticate: sanitizedWwwAuth || null,
      });

      return new Response(
        JSON.stringify({ success: false, error: `Google Play verification failed (${googleRes.status})` }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let googleVerificationResult = await googleRes.json();
    console.log(`[VERIFY_PLAY_DIAGNOSTIC] Verification stage: Google API response received. purchaseState: ${googleVerificationResult.purchaseState ?? googleVerificationResult.subscriptionState ?? "N/A"}`);

    // D. Validate Transaction State (Must be completed/active, not canceled/pending/expired)
    const stateValidation = verifyGooglePlayPurchaseState(isSub, googleVerificationResult, productId);
    if (!stateValidation.valid) {
      console.warn(`[VERIFY_PLAY_SECURITY_FAIL_CLOSED] ${stateValidation.error}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: stateValidation.error,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // E. Verify Obfuscated Account Association (Deterministic SHA-256)
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(profileId.trim().toLowerCase()));
    const expectedObfuscatedAccountId = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const actualObfuscated =
      googleVerificationResult.obfuscatedExternalAccountId ||
      googleVerificationResult.externalAccountIdentifiers?.obfuscatedExternalAccountId;

    if (actualObfuscated && actualObfuscated.toLowerCase() !== expectedObfuscatedAccountId) {
      console.warn(`[VERIFY_PLAY_SECURITY] Account mismatch. Google: ${actualObfuscated}, Expected: ${expectedObfuscatedAccountId}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Purchase account mismatch. The Google Play transaction belongs to a different student profile.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // F. Pre-commit check completed.
    // NOTE: Google Play acknowledgement is intentionally deferred to Step 7 (post-commit).
    // Acknowledging Google Play prior to database commit is an architectural defect that leaves
    // purchases unrefunded if the database operation fails.

    // ── 3. Resolve Profile & Validate Purchase Eligibility ──────────────────
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("profile_id, institute_id, name, email, phone, role")
      .eq("profile_id", profileId)
      .single();

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ success: false, error: "User profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentRole = profile.role;
    if (currentRole === "teacher" || currentRole === "admin" || currentRole === "super_admin") {
      console.warn(`[VERIFY_PLAY_SECURITY] Profile ${profileId} with staff role '${currentRole}' attempted student checkout. Rejected.`);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Profile role '${currentRole}' is not eligible for student checkout. Staff accounts cannot be converted to students.`,
          code: "FORBIDDEN_ROLE",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const instituteId = profile.institute_id;

    // Resolve existing student_details if already present.
    // NOTE: For legitimate first-time purchasers with role = 'user', studentId remains null.
    // The atomic database RPC complete_google_play_purchase handles role promotion
    // and student_details initialization atomically inside the single purchase transaction.
    let studentId: string | null = null;
    const { data: studentRecord } = await supabaseAdmin
      .from("student_details")
      .select("student_id")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (studentRecord?.student_id) {
      studentId = studentRecord.student_id;
      console.log(`[VERIFY_PLAY] Existing student details resolved: ${studentId}`);
    } else {
      console.log(`[VERIFY_PLAY] No student details for profile ${profileId} (role: ${currentRole}). Will be initialized atomically by complete_google_play_purchase RPC.`);
    }

    // ── 4. Server-Authoritative Product & Price Resolution ─────────────────
    let resolvedItemType: "course" | "subscription_plan" | "pyq_package" = "course";
    let itemName = "Educational Product";
    let unitPrice = 0;
    let resolvedCourseId = courseId;
    let resolvedPlanId = planId;
    let resolvedPackageId = packageId;
    let resolvedDurationDays = 30;

    if (productId.startsWith("sub_") || planId || productType === "subs") {
      resolvedItemType = "subscription_plan";
      const planUuidFromSku = productId.startsWith("sub_") ? cleanHexToUuid(productId.slice(4)) : null;
      const targetPlanId = planUuidFromSku || planId;

      const { data: planData } = await supabaseAdmin
        .from("subscription_plans")
        .select("plan_id, name, price, course_id, billing_cycle, duration_days")
        .eq("plan_id", targetPlanId)
        .maybeSingle();

      if (planData) {
        resolvedPlanId = planData.plan_id;
        resolvedCourseId = planData.course_id;
        itemName = planData.name;
        unitPrice = Number(planData.price) || 0;
        resolvedDurationDays = Number(planData.duration_days) ||
          (planData.billing_cycle === 'yearly' ? 365 :
           planData.billing_cycle === 'half_yearly' ? 182 :
           planData.billing_cycle === 'quarterly' ? 90 : 30);
      }

      // Migration 090 requirement: validate subscription course association
      const courseAssoc = validateSubscriptionCourseAssociation(planData);
      if (!courseAssoc.valid) {
        console.error(`[VERIFY_PLAY_ERROR] Plan ${targetPlanId}: ${courseAssoc.error}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: courseAssoc.error,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      resolvedCourseId = courseAssoc.courseId;
    } else if (productId.startsWith("pyq_") || packageId) {
      resolvedItemType = "pyq_package";
      const pkgUuidFromSku = productId.startsWith("pyq_") ? cleanHexToUuid(productId.slice(4)) : null;
      const targetPackageId = pkgUuidFromSku || packageId;

      const { data: packageData } = await supabaseAdmin
        .from("pyq_packages")
        .select("package_id, name, price")
        .eq("package_id", targetPackageId)
        .maybeSingle();

      if (packageData) {
        resolvedPackageId = packageData.package_id;
        itemName = packageData.name;
        unitPrice = Number(packageData.price) || 0;
      }
    } else {
      resolvedItemType = "course";
      const courseUuidFromSku = productId.startsWith("course_") ? cleanHexToUuid(productId.slice(7)) : null;
      const targetCourseId = courseUuidFromSku || courseId;

      const { data: courseData } = await supabaseAdmin
        .from("courses")
        .select("course_id, title, discounted_price, original_price")
        .eq("course_id", targetCourseId)
        .maybeSingle();

      if (courseData) {
        resolvedCourseId = courseData.course_id;
        itemName = courseData.title;
        unitPrice = Number(courseData.discounted_price || courseData.original_price) || 0;
      }
    }

    // ── 5. Create Order & Payment Record (Atomic RPC with Resilient Client Fallback) ──
    const transactionTimestamp = new Date().toISOString();
    let effectiveFinalOrderId = "";
    let entitlementGranted = "";

    const autoRenewSetting = stateValidation.isAutoRenew !== undefined ? stateValidation.isAutoRenew : true;
    const subscriptionEndDate = resolvedItemType === "subscription_plan"
      ? calculateSubscriptionExpiry({
          startDate: new Date(),
          planDurationDays: resolvedDurationDays,
          googleExpiryTime: stateValidation.expiryTime || googleVerificationResult?.lineItems?.[0]?.expiryTime,
        })
      : null;

    const rpcPayload = buildGooglePlayRpcPayload({
      profileId,
      instituteId,
      studentId,
      resolvedItemType,
      resolvedCourseId,
      resolvedPlanId,
      resolvedPackageId,
      itemName,
      unitPrice,
      effectiveOrderId,
      purchaseToken,
      productId,
      googleVerificationResult,
      transactionTimestamp,
      subscriptionEndDate,
      autoRenewSetting,
      billingName: profile.name || "Student",
      billingEmail: profile.email || "student@makemetopper.com",
    });

    let rpcExecuted = false;
    let rpcUnavailable = false;

    const allowLegacyFallback = Deno.env.get("ALLOW_LEGACY_PURCHASE_FALLBACK") === "true";

    try {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("complete_google_play_purchase", rpcPayload);
      const rpcResult = handleGooglePlayRpcResponse(rpcData, rpcErr, { allowLegacyFallback });

      if (rpcResult.action === "proceed_to_post_commit") {
        effectiveFinalOrderId = rpcResult.effectiveFinalOrderId || "";
        entitlementGranted = rpcResult.entitlementGranted || "";
        rpcExecuted = true;
        console.log(`[VERIFY_PLAY_SUCCESS] Order ${effectiveFinalOrderId} completed atomically via RPC. Entitlement: ${entitlementGranted}`);
      } else if (rpcResult.action === "return_response") {
        console.error("[VERIFY_PLAY_ERROR] Atomic RPC rejected purchase:", rpcResult.responseBody?.error);
        return new Response(JSON.stringify(rpcResult.responseBody), {
          status: rpcResult.httpStatus || 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (rpcResult.action === "throw_fatal") {
        if (rpcResult.fatalError === "__RPC_UNAVAILABLE__") {
          rpcUnavailable = true;
          console.warn("[VERIFY_PLAY] complete_google_play_purchase RPC is not present in database and legacy fallback is explicitly allowed. Proceeding to client fallback.");
        } else {
          console.error(`[VERIFY_PLAY_FATAL] Atomic RPC execution failed [${rpcResult.errorClassification || 'DATABASE_ERROR'}]:`, rpcErr);
          throw new Error(rpcResult.fatalError || "Database atomic purchase execution failed");
        }
      }
    } catch (rpcEx: any) {
      if (rpcEx.message?.startsWith("Database atomic purchase execution failed")) {
        throw rpcEx; // Propagate fatal DB error
      }
      if (!rpcUnavailable) {
        console.error("[VERIFY_PLAY_FATAL] Unexpected RPC exception:", rpcEx);
        throw new Error(`RPC call failed: ${rpcEx.message}`);
      }
    }

    if (!rpcExecuted) {
      if (!rpcUnavailable) {
        throw new Error("RPC execution failed without valid fallback condition.");
      }

      // ── Client Fallback Path: Guarantees consistent timestamps and order reuse ──
      const orderNotes = JSON.stringify({
        gateway: "google_play",
        purchaseToken,
        orderId: effectiveOrderId,
        productId,
        itemType: resolvedItemType,
        courseId: resolvedCourseId || null,
        planId: resolvedPlanId || null,
        packageId: resolvedPackageId || null,
      });

      let orderIdToUse: string | null = null;
      let orderItemIdToUse: string | null = null;

      // Check if an order already exists for this profile with this specific purchaseToken
      const { data: existingOrders } = await supabaseAdmin
        .from("orders")
        .select("order_id, status, notes, order_items(item_id, item_type, course_id, plan_id, package_id)")
        .eq("profile_id", profileId)
        .order("placed_at", { ascending: false });

      const matchingOrder = existingOrders?.find((o: any) => {
        if (!o.notes) return false;
        try {
          const parsed = JSON.parse(o.notes);
          return parsed.purchaseToken === purchaseToken || parsed.orderId === effectiveOrderId;
        } catch {
          return false;
        }
      });

      if (matchingOrder) {
        const itemValidation = validateExistingOrderItem({
          orderItems: matchingOrder.order_items,
          expectedItemType: resolvedItemType,
          expectedCourseId: resolvedCourseId,
          expectedPlanId: resolvedPlanId,
          expectedPackageId: resolvedPackageId,
        });

        if (!itemValidation.valid) {
          console.error(`[VERIFY_PLAY_FATAL] Existing order ${matchingOrder.order_id} failed line item validation: ${itemValidation.error}`);
          return new Response(
            JSON.stringify({
              success: false,
              error: itemValidation.error,
              code: itemValidation.errorCode,
              orderId: matchingOrder.order_id,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        orderIdToUse = matchingOrder.order_id;
        orderItemIdToUse = itemValidation.orderItemId || null;
        console.log(`[VERIFY_PLAY] Reusing existing unfulfilled order ${orderIdToUse} with validated item ${orderItemIdToUse}.`);
      }

      if (!orderIdToUse) {
        const { data: order, error: orderErr } = await supabaseAdmin
          .from("orders")
          .insert({
            institute_id: instituteId,
            student_id: studentId,
            profile_id: profileId,
            status: "confirmed",
            currency: "INR",
            subtotal_amount: unitPrice,
            discount_amount: 0,
            tax_amount: 0,
            total_amount: unitPrice,
            notes: orderNotes,
            placed_at: transactionTimestamp,
            confirmed_at: transactionTimestamp,
            created_at: transactionTimestamp,
            updated_at: transactionTimestamp,
          })
          .select("order_id")
          .single();

        if (orderErr || !order) {
          throw new Error(`Failed to create order: ${orderErr?.message}`);
        }
        orderIdToUse = order.order_id;

        const orderItemPayload = buildOrderItemPayload({
          orderId: orderIdToUse,
          instituteId,
          itemType: resolvedItemType,
          courseId: resolvedCourseId,
          planId: resolvedPlanId,
          packageId: resolvedPackageId,
          itemName,
          unitPrice,
          createdAt: transactionTimestamp,
        });

        const { data: orderItem, error: itemErr } = await supabaseAdmin
          .from("order_items")
          .insert(orderItemPayload)
          .select("item_id")
          .single();

        if (itemErr || !orderItem) {
          throw new Error(`Failed to create order item: ${itemErr?.message}`);
        }
        orderItemIdToUse = orderItem.item_id;
      }

      effectiveFinalOrderId = orderIdToUse;

      // Insert captured payment with identical created_at and paid_at satisfying ck_payments_paid_at
      const { error: paymentErr } = await supabaseAdmin.from("payments").insert({
        order_id: effectiveFinalOrderId,
        institute_id: instituteId,
        attempt_number: 1,
        gateway: "google_play",
        gateway_order_id: effectiveOrderId,
        gateway_payment_id: effectiveOrderId,
        gateway_response: googleVerificationResult || {
          verified: true,
          productId,
          purchaseToken,
          verified_at: transactionTimestamp,
        },
        amount: unitPrice,
        currency: "INR",
        status: "captured",
        created_at: transactionTimestamp,
        paid_at: transactionTimestamp,
        updated_at: transactionTimestamp,
      });

      if (paymentErr) {
        throw new Error(`Failed to record payment: ${paymentErr.message}`);
      }

      // ── 6. Grant Entitlement ───────────────────────────────────────────────
      if (resolvedItemType === "course" && resolvedCourseId) {
        const { error: enrollErr } = await supabaseAdmin.from("course_enrollments").upsert(
          {
            course_id: resolvedCourseId,
            student_id: studentId,
            institute_id: instituteId,
            order_item_id: orderItemIdToUse || null,
            enrollment_type: "purchase",
            is_active: true,
            enrolled_at: transactionTimestamp,
            revoked_at: null,
            revoked_reason: null,
          },
          { onConflict: "course_id,student_id" }
        );

        if (enrollErr) {
          throw new Error(`Failed to grant course enrollment: ${enrollErr.message}`);
        }
        entitlementGranted = `course_enrollment:${resolvedCourseId}`;
      } else if (resolvedItemType === "subscription_plan" && resolvedPlanId) {
        // Enforce Migration 086 invariant: update existing active/grace row if present
        const { data: existingSub } = await supabaseAdmin
          .from("student_subscriptions")
          .select("subscription_id, status")
          .eq("student_id", studentId)
          .eq("plan_id", resolvedPlanId)
          .in("status", ["active", "grace"])
          .maybeSingle();

        const instSettings = await getInstituteSubscriptionSettings(supabaseAdmin, instituteId);
        const subWindows = subscriptionEndDate
          ? calculateSubscriptionWindows({
              endDate: subscriptionEndDate,
              graceDays: instSettings.graceDays,
              contentAccessDays: instSettings.contentAccessDays,
            })
          : { graceEndDate: null, contentAccessEndDate: null };

        if (existingSub) {
          const { error: subUpdateErr } = await supabaseAdmin
            .from("student_subscriptions")
            .update({
              order_id: effectiveFinalOrderId,
              status: "active",
              start_date: new Date(transactionTimestamp).toISOString().split("T")[0],
              end_date: subscriptionEndDate,
              grace_end_date: subWindows.graceEndDate,
              content_access_end_date: subWindows.contentAccessEndDate,
              is_auto_renew: autoRenewSetting,
              payment_method_id: purchaseToken,
              updated_at: transactionTimestamp,
            })
            .eq("subscription_id", existingSub.subscription_id);

          if (subUpdateErr) {
            throw new Error(`Failed to update student subscription: ${subUpdateErr.message}`);
          }
        } else {
          const { error: subInsertErr } = await supabaseAdmin
            .from("student_subscriptions")
            .insert({
              student_id: studentId,
              plan_id: resolvedPlanId,
              course_id: resolvedCourseId,
              institute_id: instituteId,
              order_id: effectiveFinalOrderId,
              status: "active",
              start_date: new Date(transactionTimestamp).toISOString().split("T")[0],
              end_date: subscriptionEndDate,
              grace_end_date: subWindows.graceEndDate,
              content_access_end_date: subWindows.contentAccessEndDate,
              is_auto_renew: autoRenewSetting,
              payment_method_id: purchaseToken,
              created_at: transactionTimestamp,
              updated_at: transactionTimestamp,
            });

          if (subInsertErr) {
            throw new Error(`Failed to create student subscription: ${subInsertErr.message}`);
          }
        }

        if (resolvedCourseId) {
          // Check if student already holds permanent ownership (enrollment_type = 'purchase') per Migration 096
          const { data: existingEnrollment } = await supabaseAdmin
            .from("course_enrollments")
            .select("enrollment_id, enrollment_type, enrolled_at")
            .eq("course_id", resolvedCourseId)
            .eq("student_id", studentId)
            .maybeSingle();

          const targetEnrollmentType = (existingEnrollment?.enrollment_type === "purchase") ? "purchase" : "subscription";

          const { error: enrollSubErr } = await supabaseAdmin.from("course_enrollments").upsert(
            {
              course_id: resolvedCourseId,
              student_id: studentId,
              institute_id: instituteId,
              enrollment_type: targetEnrollmentType,
              is_active: true,
              enrolled_at: existingEnrollment?.enrolled_at || transactionTimestamp,
              revoked_at: null,
              revoked_reason: null,
            },
            { onConflict: "course_id,student_id" }
          );

          if (enrollSubErr) {
            throw new Error(`Failed to grant subscription course enrollment: ${enrollSubErr.message}`);
          }
        }
        entitlementGranted = `student_subscription:${resolvedPlanId}`;
      } else if (resolvedItemType === "pyq_package" && resolvedPackageId) {
        const { error: pyqErr } = await supabaseAdmin.from("student_pyq_purchases").upsert(
          {
            package_id: resolvedPackageId,
            student_id: studentId,
            institute_id: instituteId,
            order_item_id: orderItemIdToUse || null,
            access_type: "purchase",
            is_active: true,
            purchased_at: transactionTimestamp,
            revoked_at: null,
            revoked_reason: null,
          },
          { onConflict: "package_id,student_id" }
        );
        if (pyqErr) {
          throw new Error(`Failed to grant PYQ access: ${pyqErr.message}`);
        }
        entitlementGranted = `pyq_purchase:${resolvedPackageId}`;
      }

      // Generate Invoice snapshot (non-blocking accounting artifact)
      try {
        const { error: invoiceErr } = await supabaseAdmin
          .from("invoices")
          .insert({
            order_id: effectiveFinalOrderId,
            institute_id: instituteId,
            invoice_number: `INV-GP-${new Date().getFullYear()}-${effectiveFinalOrderId.slice(0, 8).toUpperCase()}`,
            status: "draft",
            billing_name: profile.name || "Student",
            billing_email: profile.email || "student@makemetopper.com",
            subtotal_amount: unitPrice,
            discount_amount: 0,
            tax_amount: 0,
            total_amount: unitPrice,
            currency: "INR",
            created_at: transactionTimestamp,
            updated_at: transactionTimestamp,
          });

        if (invoiceErr) {
          console.warn("[INVOICE_WARNING] Invoice snapshot insert skipped:", invoiceErr.message);
        }
      } catch (invoiceEx) {
        console.warn("[INVOICE_WARNING] Invoice snapshot insert exception:", invoiceEx);
      }
    }

    // ── 7. Post-Commit Google Play Acknowledgement ────────────────────────
    // CRITICAL: Acknowledgement is executed ONLY AFTER database records are committed.
    // If database execution fails, this line is never reached.
    try {
      const ackUrl = isSub
        ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`
        : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}:acknowledge`;

      const ackResponse = await fetch(ackUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ developerPayload: profileId }),
      });

      if (!ackResponse.ok) {
        const ackBody = await ackResponse.text();
        console.warn(`[VERIFY_PLAY] Post-commit acknowledge returned non-200 (${ackResponse.status}): ${ackBody}`);
      } else {
        console.log(`[VERIFY_PLAY] Post-commit acknowledge succeeded for ${productId}`);
      }
    } catch (ackErr) {
      console.warn("[VERIFY_PLAY] Post-commit acknowledge network error (non-fatal, entitlement committed):", ackErr);
    }
console.log(`[VERIFY_PLAY_SUCCESS] Order ${effectiveFinalOrderId} verified. Entitlement: ${entitlementGranted}`);

    return new Response(
      JSON.stringify({
        success: true,
        verified: true,
        orderId: effectiveFinalOrderId,
        entitlement: entitlementGranted,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
} catch (err: any) {
    console.error("[VERIFY_PLAY_FATAL]", err);
    return new Response(JSON.stringify({ success: false, error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
