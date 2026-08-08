// ============================================================================
// Edge Function: razorpay-webhook
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Production-grade Razorpay webhook handler for course, PYQ package, and
// subscription plan purchases. This is the ONLY trusted source that marks
// a payment as successful and grants product access. The mobile app must
// never grant access directly.
//
// Architecture:
//   Student
//     ↓
//   Buy Product (Course / PYQ Package / Subscription Plan)
//     ↓
//   create-payment-order        ← Creates order + payment record
//     ↓
//   Razorpay Checkout           ← Student completes payment on Razorpay
//     ↓
//   payment.captured            ← Razorpay sends webhook event
//     ↓
//   razorpay-webhook (YOU ARE HERE)
//     ↓
//   Verify Signature            ← HMAC-SHA256 with RAZORPAY_WEBHOOK_SECRET
//     ↓
//   Update Orders               ← status = confirmed, confirmed_at = now()
//     ↓
//   Read order_items.item_type  ← Determines routing
//     ↓
//   ├── course ────────────→ complete-course-purchase  (existing)
//   ├── pyq_package ───────→ complete-pyq-purchase    (existing)
//   └── subscription_plan ─→ complete-subscription-purchase (new)
//
// Security:
//   • No Supabase authentication required — verified via Razorpay webhook secret
//   • Rejects every request with an invalid signature before any processing
//   • Never trusts amount, product ID, or profileId from the webhook payload
//   • Only trusts: Razorpay signature, existing local order, existing DB records
//   • SQL errors, secrets, and stack traces are NEVER exposed to the caller
//
// Idempotency (grant-aware, H1):
//   • A captured payment does NOT prove onboarding succeeded.
//   • Duplicate webhooks return HTTP 200 ONLY when the product grant exists;
//     otherwise the order is healed and onboarding is re-run (idempotent).
//   • Onboarding failure returns HTTP 500 so Razorpay retries the delivery.
//
// @module edge-functions/razorpay-webhook
// ============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-razorpay-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Razorpay webhook event payload — only the fields we need. */
interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment: {
      entity: {
        id: string;                   // Razorpay payment_id (e.g., pay_xxx)
        order_id: string;             // Razorpay order_id (e.g., order_xxx)
        amount: number;               // In paise (smallest currency unit)
        currency: string;
        status: string;
        method: string;
        captured: boolean;
        description: string;
        notes: Record<string, string>;
        created_at: number;           // Unix timestamp
        fee: number | null;
        tax: number | null;
        error_code: string | null;
        error_description: string | null;
      };
    };
  };
  created_at: number;
}

interface SuccessResponse {
  success: true;
  message: string;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type FunctionResponse = SuccessResponse | ErrorResponse;

/** Result of the onboarding invocation helper. */
interface OnboardingResult {
  success: boolean;
  message: string;
  /** Product item_type when known (populated on failure for diagnostics). */
  itemType?: string;
}

/** A single order_item row loaded for routing. */
interface OrderItemRow {
  item_id: string;
  item_type: string;
  course_id: string | null;
  package_id: string | null;
  plan_id: string | null;
}

/** Raw row from orders — fields needed for routing and grant checks. */
interface OrderRow {
  order_id: string;
  profile_id: string | null;
  student_id: string | null;
  institute_id: string | null;
  status: string | null;
  notes: string | null;
}

/** Result of loadOrderAndItems — the order + items, or the failing stage. */
interface LoadedOrder {
  order: OrderRow | null;
  orderItems: OrderItemRow[] | null;
  loadError: { stage: 'order' | 'items'; message: string } | null;
}

/** Parsed guardian and academic fields from order.notes. */
interface GuardianInfo {
  guardianName: string | null;
  guardianMobile: string | null;
  guardianEmail: string | null;
  targetYear: string | null;
  dateOfBirth: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a shared metadata object added to every error log.
 */
function errorMeta(req: Request): Record<string, unknown> {
  return {
    requestUrl: req.url,
    requestMethod: req.method,
  };
}

/**
 * Create a JSON response with standard CORS headers.
 */
function jsonResponse(
  body: FunctionResponse,
  status: number = 200,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
    },
  );
}

/**
 * Structured log helper for production debugging.
 * Every log entry is a JSON string with consistent fields.
 */
function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'razorpay-webhook',
      event,
      ...data,
    }),
  );
}

/**
 * Structured error logger — same format as structuredLog but at error level.
 *
 * Automatically includes request metadata. The caller should supply:
 *   - eventType:  the logical stage where the error occurred
 *   - gatewayOrderId / gatewayPaymentId: if available
 *   - httpStatus: the HTTP status being returned
 *   - message:    a human-readable description
 *   - stack:      error stack trace (only if available; never null)
 *
 * Secrets (RAZORPAY_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY, etc.)
 * are NEVER logged.
 */
function structuredError(event: string, data: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      service: 'razorpay-webhook',
      event,
      ...data,
    }),
  );
}

/**
 * Compute the HMAC-SHA256 digest of a payload and return it as a hex string.
 *
 * Razorpay webhook docs specify:
 *   expected_signature = hmac('sha256', webhook_body, webhook_secret)
 * where the result is a hex-encoded HMAC SHA256 digest.
 *
 * This replaces the previous (broken) approach that used atob() (Base64)
 * because Razorpay uses hex encoding, NOT Base64.
 *
 * @param rawBody - The raw webhook request body as a string
 * @param secret - The webhook secret from Supabase Secrets
 * @returns The hex-encoded HMAC-SHA256 digest
 */
async function computeHmacHex(
  rawBody: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(rawBody),
  );

  // Convert the ArrayBuffer to a hex string
  return Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if both strings are identical.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify the Razorpay webhook signature using HMAC-SHA256.
 *
 * Razorpay computes the signature as:
 *   expected_signature = hmac('sha256', webhook_body, webhook_secret)
 *
 * The X-Razorpay-Signature header contains the hex-encoded HMAC-SHA256
 * digest. This function re-computes the HMAC locally and compares
 * the hex digests in constant time.
 *
 * ⚠️ IMPORTANT: Razorpay uses HEX encoding for the signature, NOT Base64.
 * The previous implementation incorrectly used atob() (Base64 decoding),
 * which caused signature verification to always fail.
 *
 * @param computedHex - The pre-computed HMAC-SHA256 hex string (call
 *                       computeHmacHex() once and reuse the result).
 *                       Avoids re-computing the HMAC for every call.
 * @param signature - The hex-encoded signature from X-Razorpay-Signature header
 * @returns true if the signature is valid
 */
function verifyWebhookSignature(
  computedHex: string,
  signature: string,
): boolean {
  try {
    return constantTimeEqual(computedHex, signature);
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      eventType: 'crypto_operation',
      message: err instanceof Error ? err.message : 'Unknown error during signature verification',
      stack: err instanceof Error ? err.stack : undefined,
    });
    return false;
  }
}

/**
 * Sanitize error messages for external responses.
 * Never expose SQL errors, secrets, or stack traces to the caller.
 */
function sanitizeErrorMessage(raw: string): string {
  if (/duplicate key value violates unique constraint/i.test(raw)) {
    return 'A duplicate record was detected. The operation is idempotent.';
  }
  if (/not found/i.test(raw) && /profile/i.test(raw)) {
    return 'Referenced record not found.';
  }
  return 'An unexpected error occurred. Please contact support.';
}

/**
 * Parse guardian and academic info from order.notes JSON.
 * Returns defaulted nulls for any missing or unparseable fields.
 */
function parseGuardianInfo(notes: unknown): GuardianInfo {
  let parsed: Record<string, unknown> = {};

  if (notes) {
    try {
      parsed = typeof notes === 'string' ? JSON.parse(notes) : notes as Record<string, unknown>;
    } catch {
      structuredLog('NOTES_PARSE', {
        message: 'Failed to parse order.notes JSON — guardian fields defaulted to null',
      });
    }
  }

  return {
    guardianName: (typeof parsed.guardianName === 'string' ? parsed.guardianName : null) ?? null,
    guardianMobile: (typeof parsed.guardianMobile === 'string' ? parsed.guardianMobile : null) ?? null,
    guardianEmail: (typeof parsed.guardianEmail === 'string' ? parsed.guardianEmail : null) ?? null,
    targetYear: (typeof parsed.targetYear === 'string' ? parsed.targetYear : null) ?? null,
    dateOfBirth: (typeof parsed.dob === 'string' ? parsed.dob : null) ?? null,
  };
}

/**
 * Phase 11K.5 — read the Full Course conversion marker from order.notes.
 * create-payment-order writes notes.conversion = 'true' for conversion
 * orders. The marker is server-derived from the ORDER (immutable billing
 * data) and passed through to complete-course-purchase so it can cancel the
 * subscription and grant permanent ownership after payment.
 */
function parseConversionFlag(notes: unknown): boolean {
  let parsed: Record<string, unknown> = {};
  if (notes) {
    try {
      parsed = typeof notes === 'string' ? JSON.parse(notes) : notes as Record<string, unknown>;
    } catch {
      // Unparseable notes — treat as a normal (non-conversion) order.
    }
  }
  return parsed.conversion === 'true' || parsed.conversion === true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Onboarding Router — dispatches to product-specific completion functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Route a course purchase to the complete-course-purchase Edge Function.
 *
 * This replicates the exact logic from the original single-product webhook:
 * calls complete-course-purchase with internal=true flag and all guardian
 * fields extracted from order.notes.
 */
async function routeToCoursePurchase(
  orderId: string,
  orderItem: OrderItemRow,
  profileId: string,
  guardian: GuardianInfo,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  meta?: Record<string, unknown>,
  /** Phase 11K.5 — Full Course conversion marker from order.notes. */
  conversion = false,
): Promise<OnboardingResult> {
  const courseId = orderItem.course_id;
  if (!courseId) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'missing_course_id',
      message: 'Course item missing course_id',
      orderId,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      httpStatus: 200,
    });
    return { success: false, message: 'Course item missing course_id.' };
  }

  structuredLog('ROUTING_TO_COURSE', {
    orderId,
    courseId,
    profileId,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  // ── Invoke complete-course-purchase ─────────────────────────────────
  structuredLog('CALLING_COMPLETE_COURSE_PURCHASE', {
    orderId,
    courseId,
    profileId,
    hasGuardianName: !!guardian.guardianName,
    hasGuardianMobile: !!guardian.guardianMobile,
    hasGuardianEmail: !!guardian.guardianEmail,
    hasTargetYear: !!guardian.targetYear,
    hasDob: !!guardian.dateOfBirth,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  try {
    const functionUrl = `${SUPABASE_URL}/functions/v1/complete-course-purchase`;

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        courseId,
        orderId,
        profileId,
        guardianName: guardian.guardianName,
        guardianMobile: guardian.guardianMobile,
        guardianEmail: guardian.guardianEmail,
        targetYear: guardian.targetYear,
        dob: guardian.dateOfBirth,
        conversion,     // Phase 11K.5: Full Course conversion marker
        internal: true,  // Skip JWT auth; use provided profileId
      }),
    });

    // Log the HTTP status first
    structuredLog('COMPLETE_COURSE_PURCHASE_RESPONSE_STATUS', {
      statusCode: response.status,
      statusText: response.statusText,
      ok: response.ok,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    // IMPORTANT: Read the raw response body as text BEFORE any JSON parsing.
    // This ensures we capture the full response even if it's not JSON
    // (e.g., a 500 HTML error page from Supabase infrastructure).
    const responseText = await response.text();

    structuredLog('COMPLETE_COURSE_PURCHASE_RESPONSE_BODY', {
      bodyLength: responseText.length,
      bodyPreview: responseText.slice(0, 2000),
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    // Parse the response text as JSON
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(responseText) as Record<string, unknown>;
    } catch (parseErr) {
      // Response was not valid JSON — log the raw text and return
      structuredError('WEBHOOK_ERROR', {
        ...meta,
        eventType: 'onboarding_response_parse',
        message: 'complete-course-purchase returned non-JSON response',
        responseBody: responseText.slice(0, 1000),
        statusCode: response.status,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
        httpStatus: 200,
      });
      return {
        success: false,
        message: `Onboarding returned non-JSON response (HTTP ${response.status}).`,
      };
    }

    if (response.ok && result.success) {
      structuredLog('COMPLETE_COURSE_PURCHASE_RESPONSE', {
        success: true,
        studentId: result.studentId as string,
        enrollmentId: result.enrollmentId as string,
        enrollmentNumber: result.enrollmentNumber as string,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
      });
      return { success: true, message: 'Course onboarding completed successfully.' };
    }

    // Log the error details but don't fail the webhook
    structuredLog('COMPLETE_COURSE_PURCHASE_RESPONSE', {
      success: false,
      statusCode: response.status,
      error: result.error as string ?? 'Unknown onboarding error',
      details: result.details as string ?? null,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    return {
      success: false,
      message: `Course onboarding returned: ${result.error as string ?? 'unknown error'}`,
    };
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'onboarding_invocation',
      message: err instanceof Error ? err.message : 'Network/HTTP error calling complete-course-purchase',
      stack: err instanceof Error ? err.stack : undefined,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 200,
    });
    return { success: false, message: 'Failed to invoke complete-course-purchase.' };
  }
}

/**
 * Route a PYQ package purchase to the complete-pyq-purchase Edge Function.
 *
 * Mirrors the course purchase routing: calls complete-pyq-purchase with
 * internal=true flag and all guardian fields extracted from order.notes.
 */
async function routeToPyqPurchase(
  orderId: string,
  orderItem: OrderItemRow,
  profileId: string,
  guardian: GuardianInfo,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  meta?: Record<string, unknown>,
): Promise<OnboardingResult> {
  const packageId = orderItem.package_id;
  if (!packageId) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'missing_package_id',
      message: 'PYQ item missing package_id',
      orderId,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      httpStatus: 200,
    });
    return { success: false, message: 'PYQ item missing package_id.' };
  }

  structuredLog('ROUTING_TO_PYQ', {
    orderId,
    packageId,
    profileId,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  // ── Invoke complete-pyq-purchase ────────────────────────────────────
  structuredLog('CALLING_COMPLETE_PYQ_PURCHASE', {
    orderId,
    packageId,
    profileId,
    hasGuardianName: !!guardian.guardianName,
    hasGuardianMobile: !!guardian.guardianMobile,
    hasGuardianEmail: !!guardian.guardianEmail,
    hasTargetYear: !!guardian.targetYear,
    hasDob: !!guardian.dateOfBirth,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  try {
    const functionUrl = `${SUPABASE_URL}/functions/v1/complete-pyq-purchase`;

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        packageId,
        orderId,
        profileId,
        guardianName: guardian.guardianName,
        guardianMobile: guardian.guardianMobile,
        guardianEmail: guardian.guardianEmail,
        targetYear: guardian.targetYear,
        dob: guardian.dateOfBirth,
        internal: true,  // Skip JWT auth; use provided profileId
      }),
    });

    // Log the HTTP status first
    structuredLog('COMPLETE_PYQ_PURCHASE_RESPONSE_STATUS', {
      statusCode: response.status,
      statusText: response.statusText,
      ok: response.ok,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    // IMPORTANT: Read the raw response body as text BEFORE any JSON parsing.
    // This ensures we capture the full response even if it's not JSON
    // (e.g., a 500 HTML error page from Supabase infrastructure).
    const responseText = await response.text();

    structuredLog('COMPLETE_PYQ_PURCHASE_RESPONSE_BODY', {
      bodyLength: responseText.length,
      bodyPreview: responseText.slice(0, 2000),
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    // Parse the response text as JSON
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(responseText) as Record<string, unknown>;
    } catch (parseErr) {
      // Response was not valid JSON — log the raw text and return
      structuredError('WEBHOOK_ERROR', {
        ...meta,
        eventType: 'onboarding_response_parse',
        message: 'complete-pyq-purchase returned non-JSON response',
        responseBody: responseText.slice(0, 1000),
        statusCode: response.status,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
        httpStatus: 200,
      });
      return {
        success: false,
        message: `Onboarding returned non-JSON response (HTTP ${response.status}).`,
      };
    }

    if (response.ok && result.success) {
      structuredLog('COMPLETE_PYQ_PURCHASE_RESPONSE', {
        success: true,
        studentId: result.studentId as string,
        purchaseId: result.purchaseId as string,
        packageId: result.packageId as string,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
      });
      return { success: true, message: 'PYQ onboarding completed successfully.' };
    }

    // Log the error details but don't fail the webhook
    structuredLog('COMPLETE_PYQ_PURCHASE_RESPONSE', {
      success: false,
      statusCode: response.status,
      error: result.error as string ?? 'Unknown onboarding error',
      details: result.details as string ?? null,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    return {
      success: false,
      message: `PYQ onboarding returned: ${result.error as string ?? 'unknown error'}`,
    };
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'onboarding_invocation',
      message: err instanceof Error ? err.message : 'Network/HTTP error calling complete-pyq-purchase',
      stack: err instanceof Error ? err.stack : undefined,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 200,
    });
    return { success: false, message: 'Failed to invoke complete-pyq-purchase.' };
  }
}

/**
 * Route a subscription plan purchase to the complete-subscription-purchase
 * Edge Function.
 *
 * Mirrors the course/pyq routing: calls complete-subscription-purchase with
 * internal=true flag, all guardian fields extracted from order.notes, and
 * the Razorpay payment id as the payment reference for audit history.
 */
async function routeToSubscriptionPurchase(
  orderId: string,
  orderItem: OrderItemRow,
  profileId: string,
  guardian: GuardianInfo,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  meta?: Record<string, unknown>,
): Promise<OnboardingResult> {
  const planId = orderItem.plan_id;
  if (!planId) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'missing_plan_id',
      message: 'Subscription item missing plan_id',
      orderId,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      httpStatus: 200,
    });
    return { success: false, message: 'Subscription item missing plan_id.' };
  }

  structuredLog('ROUTING_TO_SUBSCRIPTION', {
    orderId,
    planId,
    profileId,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  // ── Invoke complete-subscription-purchase ─────────────────────────
  structuredLog('CALLING_COMPLETE_SUBSCRIPTION_PURCHASE', {
    orderId,
    planId,
    profileId,
    hasGuardianName: !!guardian.guardianName,
    hasGuardianMobile: !!guardian.guardianMobile,
    hasGuardianEmail: !!guardian.guardianEmail,
    hasTargetYear: !!guardian.targetYear,
    hasDob: !!guardian.dateOfBirth,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  try {
    const functionUrl = `${SUPABASE_URL}/functions/v1/complete-subscription-purchase`;

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        planId,
        orderId,
        profileId,
        paymentReference: razorpayPaymentId,
        guardianName: guardian.guardianName,
        guardianMobile: guardian.guardianMobile,
        guardianEmail: guardian.guardianEmail,
        targetYear: guardian.targetYear,
        dob: guardian.dateOfBirth,
        internal: true,  // Skip JWT auth; use provided profileId
      }),
    });

    // Log the HTTP status first
    structuredLog('COMPLETE_SUBSCRIPTION_PURCHASE_RESPONSE_STATUS', {
      statusCode: response.status,
      statusText: response.statusText,
      ok: response.ok,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    // IMPORTANT: Read the raw response body as text BEFORE any JSON parsing.
    // This ensures we capture the full response even if it's not JSON
    // (e.g., a 500 HTML error page from Supabase infrastructure).
    const responseText = await response.text();

    structuredLog('COMPLETE_SUBSCRIPTION_PURCHASE_RESPONSE_BODY', {
      bodyLength: responseText.length,
      bodyPreview: responseText.slice(0, 2000),
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    // Parse the response text as JSON
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(responseText) as Record<string, unknown>;
    } catch (parseErr) {
      // Response was not valid JSON — log the raw text and return
      structuredError('WEBHOOK_ERROR', {
        ...meta,
        eventType: 'onboarding_response_parse',
        message: 'complete-subscription-purchase returned non-JSON response',
        responseBody: responseText.slice(0, 1000),
        statusCode: response.status,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
        httpStatus: 200,
      });
      return {
        success: false,
        message: `Onboarding returned non-JSON response (HTTP ${response.status}).`,
      };
    }

    if (response.ok && result.success) {
      structuredLog('COMPLETE_SUBSCRIPTION_PURCHASE_RESPONSE', {
        success: true,
        studentId: result.studentId as string,
        subscriptionId: result.subscriptionId as string,
        planId: result.planId as string,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
      });
      return { success: true, message: 'Subscription onboarding completed successfully.' };
    }

    // Log the error details but don't fail the webhook
    structuredLog('COMPLETE_SUBSCRIPTION_PURCHASE_RESPONSE', {
      success: false,
      statusCode: response.status,
      error: result.error as string ?? 'Unknown onboarding error',
      details: result.details as string ?? null,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    return {
      success: false,
      message: `Subscription onboarding returned: ${result.error as string ?? 'unknown error'}`,
    };
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'onboarding_invocation',
      message: err instanceof Error ? err.message : 'Network/HTTP error calling complete-subscription-purchase',
      stack: err instanceof Error ? err.stack : undefined,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 200,
    });
    return { success: false, message: 'Failed to invoke complete-subscription-purchase.' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// loadOrderAndItems — shared authoritative order + items loader
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load an order and its order_items in one authoritative call.
 *
 * Shared by invokeOnboarding (routing) and Step 12 (grant-aware idempotency)
 * so both paths reason about the SAME order/profile/item data. Preserves the
 * original query and row shape (plus `status`, which the heal step needs).
 *
 * @returns A discriminated result: on failure `loadError` is set with the
 *          failing stage ('order' | 'items'); on success both rows are set.
 */
async function loadOrderAndItems(
  serviceClient: SupabaseClient,
  orderId: string,
): Promise<LoadedOrder> {
  const { data: order, error: orderLoadError } = await serviceClient
    .from('orders')
    .select('order_id, profile_id, student_id, institute_id, status, notes')
    .eq('order_id', orderId)
    .single();

  if (orderLoadError || !order) {
    return {
      order: null,
      orderItems: null,
      loadError: {
        stage: 'order',
        message: orderLoadError?.message ?? 'Order not found',
      },
    };
  }

  // order_items carry item_type and the product ID (course_id / package_id /
  // plan_id) that determine routing and grant checking.
  const { data: orderItems, error: itemsLoadError } = await serviceClient
    .from('order_items')
    .select('item_id, item_type, course_id, package_id, plan_id')
    .eq('order_id', orderId);

  if (itemsLoadError || !orderItems || orderItems.length === 0) {
    return {
      order,
      orderItems: null,
      loadError: {
        stage: 'items',
        message: itemsLoadError?.message ?? 'No items found for order',
      },
    };
  }

  return { order, orderItems, loadError: null };
}

/**
 * H1 grant check — does THIS order's product grant already exist?
 *
 * A captured payment does not prove onboarding succeeded. Each product has an
 * order-tied grant row:
 *   • subscription_plan → student_subscriptions.order_id = order.order_id.
 *     Renewals REPLACE order_id with the new order id, so a match proves THIS
 *     order completed. Existence is the proof — no status filter.
 *   • course → course_enrollments (course_id from the item, student_id from
 *     orders.student_id set by THIS order's onboarding).
 *   • pyq_package → student_pyq_purchases.order_item_id = item.item_id
 *     (fallback: package_id + orders.student_id).
 *
 * Never a generic "some grant exists" check. Fails safe (returns false) when
 * required identifying information is missing or a query errors, so the caller
 * re-runs onboarding instead of claiming an unverified success.
 */
async function grantExistsForOrder(
  serviceClient: SupabaseClient,
  order: OrderRow,
  orderItems: OrderItemRow[],
): Promise<boolean> {
  const orderItem = orderItems[0];
  if (!orderItem) {
    structuredError('GRANT_CHECK_INVALID', {
      message: 'No order item to evaluate grant for',
      orderId: order.order_id,
    });
    return false;
  }

  // ── Subscription plan: the order-linked subscription row ─────────────
  if (orderItem.item_type === 'subscription_plan') {
    // Primary (overwrite-immune): orders.student_id is set by THIS order's
    // onboarding as its final step and is never replaced by a later renewal
    // (renewals overwrite student_subscriptions.order_id with newer orders,
    // so the order_id lookup alone would misclassify a late retry of an
    // earlier renewal order as "grant missing" and re-extend the period).
    if (order.student_id) return true;

    // Spec check: the order-linked subscription row proves onboarding.
    const { data, error } = await serviceClient
      .from('student_subscriptions')
      .select('subscription_id')
      .eq('order_id', order.order_id)
      .limit(1)
      .maybeSingle();

    if (error) {
      structuredError('GRANT_CHECK_ERROR', {
        message: error.message,
        orderId: order.order_id,
        itemType: orderItem.item_type,
      });
      return false;
    }
    return !!data;
  }

  // ── Course: enrollment for the student linked to THIS order ─────────
  if (orderItem.item_type === 'course') {
    if (!order.student_id || !orderItem.course_id) {
      structuredError('GRANT_CHECK_INVALID', {
        message: 'Course grant check missing order.student_id or course_id',
        orderId: order.order_id,
        itemType: orderItem.item_type,
      });
      return false;
    }

    const { data, error } = await serviceClient
      .from('course_enrollments')
      .select('enrollment_id')
      .eq('course_id', orderItem.course_id)
      .eq('student_id', order.student_id)
      .limit(1)
      .maybeSingle();

    if (error) {
      structuredError('GRANT_CHECK_ERROR', {
        message: error.message,
        orderId: order.order_id,
        itemType: orderItem.item_type,
      });
      return false;
    }
    return !!data;
  }

  // ── PYQ package: order-item tie, then student+package fallback ───────
  if (orderItem.item_type === 'pyq_package') {
    if (!orderItem.package_id) {
      structuredError('GRANT_CHECK_INVALID', {
        message: 'PYQ grant check missing package_id',
        orderId: order.order_id,
        itemType: orderItem.item_type,
      });
      return false;
    }

    // Primary: exact order-item tie (complete-pyq-purchase sets order_item_id).
    if (orderItem.item_id) {
      const { data, error } = await serviceClient
        .from('student_pyq_purchases')
        .select('purchase_id')
        .eq('order_item_id', orderItem.item_id)
        .limit(1)
        .maybeSingle();

      if (error) {
        structuredError('GRANT_CHECK_ERROR', {
          message: error.message,
          orderId: order.order_id,
          itemType: orderItem.item_type,
        });
        return false;
      }
      if (data) return true;
    }

    // Fallback: student + package (requires the order to be student-linked).
    if (!order.student_id) {
      structuredError('GRANT_CHECK_INVALID', {
        message: 'PYQ grant check missing order.student_id for fallback',
        orderId: order.order_id,
        itemType: orderItem.item_type,
      });
      return false;
    }

    const { data: fallback, error: fallbackError } = await serviceClient
      .from('student_pyq_purchases')
      .select('purchase_id')
      .eq('package_id', orderItem.package_id)
      .eq('student_id', order.student_id)
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      structuredError('GRANT_CHECK_ERROR', {
        message: fallbackError.message,
        orderId: order.order_id,
        itemType: orderItem.item_type,
      });
      return false;
    }
    return !!fallback;
  }

  // Unsupported item type — fail safe, never claim onboarded.
  structuredError('GRANT_CHECK_INVALID', {
    message: `Unsupported item_type for grant check: ${orderItem.item_type}`,
    orderId: order.order_id,
    itemType: orderItem.item_type,
  });
  return false;
}

// invokeOnboarding — load order_items and route to the right completion fn
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load the order, its items, and route to the correct product-specific
 * completion function based on order_items.item_type.
 *
 * Routing:
 *   'course'      → routeToCoursePurchase  (calls complete-course-purchase)
 *   'pyq_package' → routeToPyqPurchase     (calls complete-pyq-purchase)
 *   unknown       → logs UNSUPPORTED_ITEM_TYPE error
 *
 * @returns OnboardingResult — always succeeds logically; errors are logged
 *          and returned as non-critical messages (never thrown).
 */
async function invokeOnboarding(
  serviceClient: SupabaseClient,
  orderId: string,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  meta?: Record<string, unknown>,
): Promise<OnboardingResult> {
  // ── Load the order and its items via the shared loader ──────────────
  const { order, orderItems, loadError } = await loadOrderAndItems(
    serviceClient,
    orderId,
  );

  if (loadError?.stage === 'order' || !order) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'order_load',
      message: loadError?.message ?? 'Order not found',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 500,
    });
    return { success: false, message: 'Order not found for onboarding.' };
  }

  structuredLog('ORDER_FOUND', {
    orderId: order.order_id,
    profileId: order.profile_id,
    hasStudentId: !!order.student_id,
    instituteId: order.institute_id,
    hasNotes: !!order.notes,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  const profileId = order.profile_id;
  if (!profileId) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'missing_profile_id',
      message: 'Profile ID not found on order',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 500,
    });
    return { success: false, message: 'Profile ID not found on order.' };
  }

  if (loadError?.stage === 'items' || !orderItems || orderItems.length === 0) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'order_items_load',
      message: loadError?.message ?? 'No items found for order',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 500,
    });
    return { success: false, message: 'Order item not found for onboarding.' };
  }

  const orderItem: OrderItemRow = orderItems[0];
  const itemType = orderItem.item_type;

  structuredLog('ORDER_ITEM_LOADED', {
    orderId,
    itemType,
    courseId: orderItem.course_id ?? null,
    packageId: orderItem.package_id ?? null,
    planId: orderItem.plan_id ?? null,
    itemCount: orderItems.length,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  structuredLog('ITEM_TYPE_DETECTED', {
    orderId,
    itemType,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  // ── Parse guardian info from order.notes ────────────────────────────
  const guardian = parseGuardianInfo(order.notes);
  // Phase 11K.5: conversion marker — server-derived from the ORDER.
  const conversion = parseConversionFlag(order.notes);

  // ── Route based on item_type ────────────────────────────────────────
  // Each product type has its own completion function that handles
  // product-specific onboarding (student creation, enrollment, purchase).
  if (itemType === 'course') {
    const result = await routeToCoursePurchase(
      orderId,
      orderItem,
      profileId,
      guardian,
      razorpayPaymentId,
      razorpayOrderId,
      meta,
      conversion,
    );
    if (!result.success) result.itemType = itemType;
    return result;
  }

  if (itemType === 'pyq_package') {
    const result = await routeToPyqPurchase(
      orderId,
      orderItem,
      profileId,
      guardian,
      razorpayPaymentId,
      razorpayOrderId,
      meta,
    );
    if (!result.success) result.itemType = itemType;
    return result;
  }

  if (itemType === 'subscription_plan') {
    const result = await routeToSubscriptionPurchase(
      orderId,
      orderItem,
      profileId,
      guardian,
      razorpayPaymentId,
      razorpayOrderId,
      meta,
    );
    if (!result.success) result.itemType = itemType;
    return result;
  }

  // ── Unknown item_type — log and fail safe ───────────────────────────
  // Do NOT corrupt payment records. The payment is already captured and
  // the order is confirmed. Onboarding will need to be handled manually
  // or after the unknown item type is deployed.
  structuredError('WEBHOOK_ERROR', {
    ...meta,
    eventType: 'UNSUPPORTED_ITEM_TYPE',
    message: `Unsupported item_type: ${itemType}`,
    itemType,
    orderId,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
    httpStatus: 500,
  });

  return {
    success: false,
    itemType,
    message: `Unsupported item type "${itemType}". Onboarding not available for this product.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  const meta = errorMeta(req);

  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ── Method check ────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'method_check',
      message: 'Method not allowed. Use POST.',
      httpStatus: 405,
    });
    return jsonResponse({ success: false, error: 'Method not allowed. Use POST.' }, 405);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 1: Log request received
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('WEBHOOK_REQUEST_RECEIVED', {
    ...meta,
    contentType: req.headers.get('content-type'),
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 2: Log all headers received
  // ═════════════════════════════════════════════════════════════════════
  // Dump every incoming header to verify X-Razorpay-Signature arrives.
  structuredLog('ALL_HEADERS', {
    headers: Object.fromEntries([...req.headers.entries()]),
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 3: Read raw body for signature verification
  // ═════════════════════════════════════════════════════════════════════
  // IMPORTANT: We read the raw body as text before any JSON parsing.
  // The signature was computed over the exact raw JSON string by Razorpay.
  // Any whitespace alteration would invalidate the signature.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'read_body',
      message: err instanceof Error ? err.message : 'Failed to read request body',
      stack: err instanceof Error ? err.stack : undefined,
      httpStatus: 400,
    });
    return jsonResponse({ success: false, error: 'Failed to read request body.' }, 400);
  }

  if (!rawBody || rawBody.trim().length === 0) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'empty_body',
      message: 'Empty request body received',
      httpStatus: 400,
    });
    return jsonResponse({ success: false, error: 'Empty request body.' }, 400);
  }

  structuredLog('BODY_RECEIVED', {
    bodyLengthBytes: rawBody.length,
  });

  // ═══════════════════════════════════════════════════════════════════
  // 🔍 RAW_BODY_HASH — SHA256 digest of the raw body (for debugging
  // body integrity across the transport)
  // ═══════════════════════════════════════════════════════════════════
  const rawBodyHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  structuredLog('RAW_BODY_HASH', {
    sha256Prefix: rawBodyHash.slice(0, 16) + '...',
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 4: Check for the Razorpay webhook signature
  // ═════════════════════════════════════════════════════════════════════
  const signature = req.headers.get('X-Razorpay-Signature');

  if (!signature) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'missing_signature',
      message: 'X-Razorpay-Signature header is missing',
      httpStatus: 401,
    });
    return jsonResponse({ success: false, error: 'Missing webhook signature.' }, 401);
  }

  structuredLog('SIGNATURE_PRESENT', {
    signaturePrefix: signature.slice(0, 16) + '...',
    signatureLength: signature.length,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 5: Verify the webhook signature
  // ═════════════════════════════════════════════════════════════════════
  let computedHex: string;
  try {
    computedHex = await computeHmacHex(rawBody, RAZORPAY_WEBHOOK_SECRET);
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'hmac_computation',
      message: err instanceof Error ? err.message : 'HMAC computation failed',
      stack: err instanceof Error ? err.stack : undefined,
      httpStatus: 401,
    });
    return jsonResponse({ success: false, error: 'Invalid webhook signature.' }, 401);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔍 DEBUG LOGS — Remove before merging to main
  // ═══════════════════════════════════════════════════════════════════
  structuredLog('SIGNATURE_DEBUG', {
    rawBodyLength: rawBody.length,
    receivedSignaturePrefix: signature.slice(0, 16) + '...',
    receivedSignatureLength: signature.length,
    computedSignaturePrefix: computedHex.slice(0, 16) + '...',
    computedSignatureLength: computedHex.length,
    signatureMatch: computedHex === signature,
    isHexSignature: /^[0-9a-f]+$/i.test(signature),
  });

  const isValid = verifyWebhookSignature(computedHex, signature); // Not async anymore
  if (!isValid) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'signature_verification_failed',
      message: 'HMAC-SHA256 signature verification failed',
      signaturePrefix: signature.slice(0, 12) + '...',
      httpStatus: 401,
    });
    return jsonResponse({ success: false, error: 'Invalid webhook signature.' }, 401);
  }

  structuredLog('SIGNATURE_VERIFIED', {});

  // ═════════════════════════════════════════════════════════════════════
  // Step 6: Parse the webhook payload
  // ═════════════════════════════════════════════════════════════════════
  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'payload_parse',
      message: err instanceof Error ? err.message : 'Invalid JSON in webhook body',
      stack: err instanceof Error ? err.stack : undefined,
      httpStatus: 400,
    });
    return jsonResponse({ success: false, error: 'Invalid webhook payload.' }, 400);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 7: Log the event type
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('EVENT_TYPE', {
    event: payload.event,
    created_at: payload.created_at,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 8: Handle only payment.captured events
  // ═════════════════════════════════════════════════════════════════════
  if (payload.event !== 'payment.captured') {
    structuredLog('WEBHOOK_SUCCESS', {
      eventType: payload.event,
      message: `Event "${payload.event}" ignored. Only "payment.captured" is processed.`,
    });
    return jsonResponse({
      success: true,
      message: `Event "${payload.event}" ignored. Only "payment.captured" is processed.`,
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 9: Extract payment entity details
  // ═════════════════════════════════════════════════════════════════════
  const paymentEntity = payload.payload.payment.entity;

  const {
    id: razorpayPaymentId,
    order_id: razorpayOrderId,
    amount: razorpayAmountPaise,
    currency: razorpayCurrency,
    method: razorpayPaymentMethod,
    created_at: razorpayCreatedAt,
  } = paymentEntity;

  structuredLog('PAYMENT_CAPTURED', {
    razorpayPaymentId,
    razorpayOrderId,
    amountPaise: razorpayAmountPaise,
    currency: razorpayCurrency,
    method: razorpayPaymentMethod,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 10: Create the service-role client
  // ═════════════════════════════════════════════════════════════════════
  const serviceClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  // ═════════════════════════════════════════════════════════════════════
  // Step 11: Find the local payment record using gateway_order_id
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('PAYMENT_LOOKUP_STARTED', {
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  const { data: localPayment, error: paymentFindError } = await serviceClient
    .from('payments')
    .select('payment_id, order_id, institute_id, amount, currency, status, gateway_order_id, gateway_payment_id, attempt_number')
    .eq('gateway', 'razorpay')
    .eq('gateway_order_id', razorpayOrderId)
    .maybeSingle();

  if (paymentFindError) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'payment_lookup',
      message: paymentFindError.message,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      httpStatus: 200,  // Still 200 to Razorpay (payment was captured)
    });
    return jsonResponse({
      success: true,
      message: 'Webhook received and acknowledged.',
    });
  }

  if (!localPayment) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'payment_not_found',
      message: 'No matching local payment record found for this Razorpay order',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      httpStatus: 200,  // Acknowledge to Razorpay, flag for investigation
    });
    return jsonResponse({
      success: true,
      message: 'No matching payment record found. Webhook acknowledged.',
    });
  }

  structuredLog('PAYMENT_LOOKUP_SUCCESS', {
    localPaymentId: localPayment.payment_id,
    localOrderId: localPayment.order_id,
    localAmount: localPayment.amount,
    localStatus: localPayment.status,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 12: Idempotency + recovery check (grant-aware, H1)
  // ═════════════════════════════════════════════════════════════════════
  // A captured payment (or a matching gateway_payment_id) does NOT prove
  // onboarding succeeded. Verify the product grant before treating the
  // webhook as a duplicate:
  //   • grant exists   → idempotent HTTP 200 (no re-onboarding)
  //   • grant missing  → heal a pending order, then fall through to the
  //                      capture-confirm-onboard path below (Steps 14-16
  //                      are idempotent; completion functions are too).
  if (
    localPayment.status === 'captured' ||
    localPayment.gateway_payment_id === razorpayPaymentId
  ) {
    structuredLog('PAYMENT_ALREADY_CAPTURED_GRANT_CHECK', {
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      localPaymentId: localPayment.payment_id,
      localOrderId: localPayment.order_id,
    });

    const { order, orderItems, loadError } = await loadOrderAndItems(
      serviceClient,
      localPayment.order_id,
    );

    if (loadError || !order || !orderItems) {
      structuredError('WEBHOOK_ERROR', {
        ...meta,
        eventType: loadError?.stage === 'items' ? 'order_items_load' : 'order_load',
        message: loadError?.message ?? 'Order not found',
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId: localPayment.order_id,
        httpStatus: 500,
      });
      // Cannot verify the grant state — fail closed so Razorpay retries.
      return jsonResponse({
        success: false,
        error: 'Unable to verify order state for captured payment.',
      }, 500);
    }

    // Heal a pending order (partial failure: payment captured, order not
    // yet confirmed). Idempotent — only touches status='pending'.
    if (order.status === 'pending') {
      const { error: healError } = await serviceClient
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('order_id', order.order_id)
        .eq('status', 'pending');

      if (healError) {
        structuredError('ORDER_HEAL_FAILED', {
          ...meta,
          orderId: order.order_id,
          gatewayOrderId: razorpayOrderId,
          gatewayPaymentId: razorpayPaymentId,
          message: healError.message,
          httpStatus: 500,
        });
        return jsonResponse({
          success: false,
          error: 'Unable to confirm the order for a captured payment.',
        }, 500);
      }
      structuredLog('ORDER_HEALED_ON_RETRY', {
        orderId: order.order_id,
        status: 'confirmed',
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
      });
    } else if (order.status !== 'confirmed') {
      structuredLog('ORDER_HEAL_SKIPPED', {
        orderId: order.order_id,
        orderStatus: order.status ?? null,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
      });
    }

    const grantExists = await grantExistsForOrder(serviceClient, order, orderItems);

    if (grantExists) {
      structuredLog('GRANT_EXISTS_IDEMPOTENT_SUCCESS', {
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        localPaymentId: localPayment.payment_id,
        localOrderId: order.order_id,
      });
      return jsonResponse({
        success: true,
        message: 'Payment already processed and product access granted. Duplicate webhook ignored.',
      });
    }

    structuredLog('GRANT_MISSING_REPROCESSING', {
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      localPaymentId: localPayment.payment_id,
      localOrderId: order.order_id,
      itemType: orderItems[0]?.item_type ?? 'unknown',
    });

    // Fall through: re-run the standard capture-confirm-onboard path below.
    // Steps 14/15 are idempotent re-updates; Step 16 re-invokes onboarding.
    // This is the critical H1 recovery path.
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 13: Verify the payment amount
  // ═════════════════════════════════════════════════════════════════════
  const expectedAmountInRupees = Number(localPayment.amount);
  const actualAmountInRupees = razorpayAmountPaise / 100;
  const amountDifference = Math.abs(expectedAmountInRupees - actualAmountInRupees);

  if (amountDifference > 0.01) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'amount_mismatch',
      message: 'Payment amount mismatch',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      expectedAmountInRupees,
      actualAmountInRupees,
      httpStatus: 200,
    });
    return jsonResponse({
      success: true,
      message: 'Payment amount mismatch detected. Webhook acknowledged for investigation.',
    });
  }

  if (razorpayCurrency !== localPayment.currency) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'currency_mismatch',
      message: 'Currency mismatch',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      expectedCurrency: localPayment.currency,
      actualCurrency: razorpayCurrency,
      httpStatus: 200,
    });
    return jsonResponse({
      success: true,
      message: 'Currency mismatch detected. Webhook acknowledged for investigation.',
    });
  }

  structuredLog('AMOUNT_VERIFIED', {
    amountInRupees: expectedAmountInRupees,
    currency: localPayment.currency,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 14: Update the payment record
  // ═════════════════════════════════════════════════════════════════════
  const paidAt = new Date(razorpayCreatedAt * 1000).toISOString();

  const { error: paymentUpdateError } = await serviceClient
    .from('payments')
    .update({
      status: 'captured',
      gateway_payment_id: razorpayPaymentId,
      gateway_response: JSON.parse(rawBody), // Store raw webhook for audit
      paid_at: paidAt,
    })
    .eq('payment_id', localPayment.payment_id);

  if (paymentUpdateError) {
    structuredError('PAYMENT_UPDATE_FAILED', {
      ...meta,
      eventType: 'payment_update',
      message: paymentUpdateError.message,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      localPaymentId: localPayment.payment_id,
      httpStatus: 500,
    });
    // H1: fail closed so Razorpay retries and the payment can become
    // consistent. Do NOT proceed to order confirmation or onboarding.
    return jsonResponse({
      success: false,
      error: 'Unable to mark the payment as captured.',
    }, 500);
  }
  structuredLog('PAYMENT_UPDATED', {
    localPaymentId: localPayment.payment_id,
    gatewayPaymentId: razorpayPaymentId,
    status: 'captured',
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 15: Update the order record
  // ═════════════════════════════════════════════════════════════════════
  const orderId = localPayment.order_id;
  const confirmedAt = new Date().toISOString();

  const { error: orderUpdateError } = await serviceClient
    .from('orders')
    .update({
      status: 'confirmed',
      confirmed_at: confirmedAt,
    })
    .eq('order_id', orderId)
    .eq('status', 'pending'); // confirm only pending orders (idempotent heal)

  if (orderUpdateError) {
    structuredError('ORDER_UPDATE_FAILED', {
      ...meta,
      eventType: 'order_update',
      message: orderUpdateError.message,
      gatewayOrderId: razorpayOrderId,
      localPaymentId: localPayment.payment_id,
      orderId,
      httpStatus: 500,
    });
    // H1: fail closed so Razorpay retries and the order can be healed.
    // Do NOT proceed to onboarding.
    return jsonResponse({
      success: false,
      error: 'Unable to confirm the order.',
    }, 500);
  }
  structuredLog('ORDER_UPDATED', {
    orderId,
    status: 'confirmed',
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 16: Invoke product-specific onboarding based on item_type
  // ═════════════════════════════════════════════════════════════════════
  // Delegates ALL onboarding logic to invokeOnboarding which loads the
  // order_items, reads item_type, and routes to the appropriate completion
  // function (complete-course-purchase, complete-pyq-purchase, etc.).
  const onboardingResult = await invokeOnboarding(
    serviceClient,
    orderId,
    razorpayPaymentId,
    razorpayOrderId,
    meta,
  );

  // ═════════════════════════════════════════════════════════════════════
  // Step 17: Return based on onboarding outcome (H1)
  // ═════════════════════════════════════════════════════════════════════
  // Onboarding failure MUST return HTTP 500 so Razorpay retries the
  // delivery; the grant-aware Step 12 then recovers the grant on retry.
  // Never expose internal errors or secrets to Razorpay.
  if (onboardingResult.success) {
    structuredLog('ONBOARDING_COMPLETED', {
      orderId,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
    });

    structuredLog('WEBHOOK_SUCCESS', {
      razorpayPaymentId,
      razorpayOrderId,
      localPaymentId: localPayment.payment_id,
      localOrderId: orderId,
    });

    return jsonResponse({
      success: true,
      message: 'Payment captured successfully.',
    });
  }

  structuredError('ONBOARDING_FAILED', {
    ...meta,
    eventType: 'onboarding_failed',
    message: onboardingResult.message,
    itemType: onboardingResult.itemType ?? null,
    orderId,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
    localPaymentId: localPayment.payment_id,
    httpStatus: 500,
  });

  return jsonResponse({
    success: false,
    error: 'Payment captured but product onboarding failed. Will retry.',
  }, 500);
});
