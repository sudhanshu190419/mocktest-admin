import {
  convertPaiseToRupeesStrict,
  convertPaiseToRupees,
  InvalidCurrencyValueError,
} from './currency.ts';
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
import Razorpay from 'npm:razorpay@^2.9.6';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!;
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-razorpay-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Razorpay refund entity in webhook payload. */
interface RazorpayRefundEntity {
  id: string;                   // rfnd_xxx
  entity: string;             // 'refund'
  amount: number;             // In paise
  currency: string;
  payment_id: string;         // pay_xxx
  status: string;             // 'created' | 'processed' | 'failed'
  speed_processed?: string;   // 'instant' | 'normal'
  created_at: number;         // Unix timestamp
  notes?: Record<string, string>;
}

/** Razorpay dispute entity in webhook payload. */
interface RazorpayDisputeEntity {
  id: string;                   // disp_xxx
  entity: string;             // 'dispute'
  amount: number;             // Disputed amount in paise
  currency: string;
  payment_id: string;         // pay_xxx
  amount_deducted?: number;   // Amount actually deducted by Razorpay in paise
  status: string;             // 'open' | 'under_review' | 'action_required' | 'won' | 'lost' | 'closed'
  created_at: number;         // Unix timestamp
  reason_code?: string;
}

/** Razorpay webhook event payload — supporting payments, refunds, and disputes. */
interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: {
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
        error_source?: string | null;
        error_step?: string | null;
        error_reason?: string | null;
      };
    };
    refund?: {
      entity: RazorpayRefundEntity;
    };
    dispute?: {
      entity: RazorpayDisputeEntity;
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
  requiresReview?: boolean;
  reviewReason?: string;
  reviewDetails?: string;
}

/** A single order_item row loaded for routing. */
interface OrderItemRow {
  item_id: string;
  item_type: string;
  course_id: string | null;
  package_id: string | null;
  plan_id: string | null;
  installment_plan_id?: string | null;
  agreement_id?: string | null;
}

/** Raw row from orders — fields needed for routing and grant checks. */
interface OrderRow {
  order_id: string;
  profile_id: string | null;
  student_id: string | null;
  institute_id: string | null;
  status: string | null;
  fulfillment_status?: string | null;
  admin_review_reason?: string | null;
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

/**
 * Route an installment purchase to the complete-installment-purchase Edge Function.
 *
 * Calls complete-installment-purchase with internal=true, guardian fields,
 * and the internal payments.payment_id UUID.
 */
async function routeToInstallmentPurchase(
  orderId: string,
  orderItem: OrderItemRow,
  profileId: string,
  guardian: GuardianInfo,
  localPaymentId: string,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  meta?: Record<string, unknown>,
): Promise<OnboardingResult> {
  const planId = orderItem.installment_plan_id;
  if (!planId) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'missing_installment_plan_id',
      message: 'Installment item missing installment_plan_id',
      orderId,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      httpStatus: 500,
    });
    return { success: false, message: 'Installment item missing installment_plan_id.' };
  }

  structuredLog('ROUTING_TO_INSTALLMENT', {
    orderId,
    planId,
    profileId,
    paymentId: localPaymentId,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  try {
    const functionUrl = `${SUPABASE_URL}/functions/v1/complete-installment-purchase`;

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
        paymentId: localPaymentId, // Internal payments.payment_id UUID!
        guardianName: guardian.guardianName,
        guardianMobile: guardian.guardianMobile,
        guardianEmail: guardian.guardianEmail,
        targetYear: guardian.targetYear,
        dob: guardian.dateOfBirth,
        internal: true,
      }),
    });

    const responseText = await response.text();

    structuredLog('COMPLETE_INSTALLMENT_PURCHASE_RESPONSE_BODY', {
      bodyLength: responseText.length,
      bodyPreview: responseText.slice(0, 1000),
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      structuredError('WEBHOOK_ERROR', {
        ...meta,
        eventType: 'onboarding_response_parse',
        message: 'complete-installment-purchase returned non-JSON response',
        responseBody: responseText.slice(0, 1000),
        statusCode: response.status,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
        httpStatus: 500,
      });
      return {
        success: false,
        message: `Installment onboarding returned non-JSON response (HTTP ${response.status}).`,
      };
    }

    if (result.status === 'requires_review') {
      structuredLog('INSTALLMENT_PURCHASE_REQUIRES_REVIEW', {
        orderId,
        reason: result.reason,
        details: result.details,
      });
      return {
        success: false,
        requiresReview: true,
        reviewReason: (result.reason as string) || 'ADMIN_REVIEW_REQUIRED',
        reviewDetails: (result.details as string) || '',
        message: `Installment requires administrative review: ${result.reason}`,
      };
    }

    if (response.ok && result.success) {
      structuredLog('COMPLETE_INSTALLMENT_PURCHASE_RESPONSE', {
        success: true,
        studentId: result.studentId as string,
        agreementId: result.agreementId as string,
        enrollmentId: result.enrollmentId as string,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        orderId,
      });
      return { success: true, message: 'Installment onboarding completed successfully.' };
    }

    structuredLog('COMPLETE_INSTALLMENT_PURCHASE_RESPONSE', {
      success: false,
      statusCode: response.status,
      error: (result.error as string) ?? 'Unknown onboarding error',
      details: (result.details as string) ?? null,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
    });

    return {
      success: false,
      message: `Installment onboarding returned: ${(result.error as string) ?? 'unknown error'}`,
    };
  } catch (err) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'onboarding_invocation',
      message: err instanceof Error ? err.message : 'Network/HTTP error calling complete-installment-purchase',
      stack: err instanceof Error ? err.stack : undefined,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 500,
    });
    return { success: false, message: 'Failed to invoke complete-installment-purchase.' };
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
    .select('order_id, profile_id, student_id, institute_id, status, fulfillment_status, admin_review_reason, notes')
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
    .select('item_id, item_type, course_id, package_id, plan_id, installment_plan_id, agreement_id')
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
  localPaymentId?: string,
): Promise<boolean> {
  const orderItem = orderItems[0];
  if (!orderItem) {
    structuredError('GRANT_CHECK_INVALID', {
      message: 'No order item to evaluate grant for',
      orderId: order.order_id,
    });
    return false;
  }

  // ── Installment plan: fulfillment_status or allocation check ──
  if (orderItem.item_type === 'installment') {
    // 1. Order-level fulfillment check: if order is already marked fulfilled in DB, grant exists
    if (order.fulfillment_status === 'fulfilled') return true;

    // 2. Settlement allocation check: inspect public.installment_payment_allocations for an allocation
    // associated with the exact captured payment's internal payment_id UUID.
    if (localPaymentId) {
      const { data: alloc, error: allocErr } = await serviceClient
        .from('installment_payment_allocations')
        .select('allocation_id')
        .eq('payment_id', localPaymentId)
        .limit(1)
        .maybeSingle();

      if (allocErr) {
        structuredError('GRANT_CHECK_ERROR', {
          message: allocErr.message,
          orderId: order.order_id,
          paymentId: localPaymentId,
          itemType: orderItem.item_type,
        });
        return false;
      }

      if (alloc) return true;
    }

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
  localPaymentId?: string,
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

  if (order.status === 'cancelled' || order.status === 'refunded') {
    structuredError('ONBOARDING_ABORTED_ORDER_CANCELLED_OR_REFUNDED', {
      orderId,
      status: order.status,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
    });
    return { success: false, message: `Order is ${order.status}. Onboarding aborted.` };
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

  if (itemType === 'installment') {
    const result = await routeToInstallmentPurchase(
      orderId,
      orderItem,
      profileId,
      guardian,
      localPaymentId || '',
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

/**
 * Handle Razorpay refund lifecycle events (refund.created, refund.processed, refund.failed, refund.speed_changed).
 * Implements strict lifecycle ordering and anti-downgrade logic:
 * - 'created' (initiated): zero credit reduction, payments.refund_amount unchanged.
 * - 'processed' (confirmed): credit reduction applied, payments.refund_amount updated.
 * - 'failed' (terminal failure): evidence preserved in status = 'failed', excluded from reductions, summary recalculated.
 * - 'speed_changed': acknowledged as informational event without financial adjustment.
 * Stale events (e.g. delayed 'created' arriving after 'processed' or 'failed') are safely ignored.
 */
async function handleRazorpayRefund(
  serviceClient: SupabaseClient,
  payload: RazorpayWebhookPayload,
  meta?: Record<string, unknown>,
): Promise<Response> {
  // Speed changed has no financial effect
  if (payload.event === 'refund.speed_changed') {
    structuredLog('REFUND_SPEED_CHANGED_ACKNOWLEDGED', {
      event: payload.event,
      refundId: payload.payload.refund?.entity?.id,
    });
    return jsonResponse({ success: true, message: 'Speed change event acknowledged; no financial adjustment required.' });
  }

  const refundEntity = payload.payload.refund?.entity;
  if (!refundEntity || !refundEntity.id || !refundEntity.payment_id) {
    structuredError('REFUND_PAYLOAD_INVALID', {
      ...meta,
      eventType: 'refund_payload_invalid',
      message: 'Webhook payload missing required refund entity or identifiers.',
      httpStatus: 400,
    });
    return jsonResponse({ success: false, error: 'Invalid refund payload.' }, 400);
  }

  const {
    id: refundId,
    payment_id: razorpayPaymentId,
    amount: refundAmountPaise,
    status: refundRawStatus,
    created_at: refundCreatedAtSec,
  } = refundEntity;

  // Strict ingestion boundary (Revision 32): validate minor units, currency, non-negative, and reject zero for refunds
  let refundAmountRupees: number;
  try {
    refundAmountRupees = convertPaiseToRupeesStrict(
      refundAmountPaise,
      refundEntity.currency || 'INR',
      { allowZero: false } // Refund amount cannot be zero
    );
  } catch (err) {
    structuredError('REFUND_CURRENCY_INVALID_QUARANTINE', {
      ...meta,
      eventType: 'refund_currency_invalid',
      message: err instanceof Error ? err.message : 'Invalid refund currency or amount.',
      refundId,
      refundAmountPaise,
      httpStatus: 200,
    });

    // Durable quarantine of authenticated malformed event into public.webhook_quarantine_events (Revision 34, Issue 2)
    const gatewayEventId = (meta?.eventId as string) || (payload as any).event_id || `${refundId}_${payload.event}_${payload.created_at || Date.now()}`;
    let localPaymentId: string | null = null;
    let agreementId: string | null = null;

    try {
      const { data: localPayment, error: paymentLookupError } = await serviceClient
        .from('payments')
        .select('payment_id, order_id')
        .eq('gateway', 'razorpay')
        .eq('gateway_payment_id', razorpayPaymentId)
        .maybeSingle();

      if (paymentLookupError) {
        structuredError('QUARANTINE_PAYMENT_LOOKUP_FAILED', { error: paymentLookupError.message, refundId });
        return jsonResponse({ success: false, error: 'Database failure during malformed event quarantine' }, 500);
      }

      if (localPayment) {
        localPaymentId = localPayment.payment_id;
        const { data: alloc } = await serviceClient
          .from('installment_payment_allocations')
          .select('agreement_id')
          .eq('payment_id', localPayment.payment_id)
          .limit(1)
          .maybeSingle();

        if (alloc?.agreement_id) {
          agreementId = alloc.agreement_id;
        }
      }

      // 1. Durably persist to dedicated ledger public.webhook_quarantine_events (idempotent on gateway_event_id)
      const { error: qInsertError } = await serviceClient
        .from('webhook_quarantine_events')
        .insert({
          gateway_event_id: gatewayEventId,
          event_type: payload.event,
          entity_id: refundId,
          gateway_payment_id: razorpayPaymentId,
          payment_id: localPaymentId,
          agreement_id: agreementId,
          failure_code: 'MALFORMED_FINANCIAL_DATA',
          failure_reason: err instanceof Error ? err.message : String(err),
          payload: payload as unknown as Record<string, unknown>,
        });

      if (qInsertError) {
        // Unique violation on gateway_event_id indicates idempotent retry of already quarantined event
        if (qInsertError.code === '23505' && qInsertError.message?.includes('uq_webhook_quarantine_event')) {
          structuredLog('DUPLICATE_QUARANTINE_EVENT_ACKNOWLEDGED', { refundId, gatewayEventId });
          return jsonResponse({ success: true, quarantined: true, duplicate: true, message: 'Duplicate malformed event acknowledged.' });
        }
        structuredError('QUARANTINE_PERSISTENCE_FAILED', { error: qInsertError.message, refundId, gatewayEventId });
        return jsonResponse({ success: false, error: 'Database failure during malformed event quarantine persistence' }, 500);
      }

      // 2. If agreement linkage exists, flag agreement for administrative review
      if (agreementId) {
        const { error: flagError } = await serviceClient
          .from('student_course_agreements')
          .update({ requires_admin_review: true, updated_at: new Date().toISOString() })
          .eq('agreement_id', agreementId);

        if (flagError) {
          structuredError('QUARANTINE_RECORDING_FAILED', { error: flagError.message, refundId });
          return jsonResponse({ success: false, error: 'Database failure during malformed event quarantine' }, 500);
        }
      }

      // 3. If payment linkage exists, update failure_reason
      if (localPaymentId) {
        await serviceClient
          .from('payments')
          .update({
            failure_reason: 'MALFORMED_REFUND_QUARANTINE: ' + (err instanceof Error ? err.message : String(err)) + ' (event: ' + payload.event + ', id: ' + refundId + ')',
            updated_at: new Date().toISOString(),
          })
          .eq('payment_id', localPaymentId);
      }
    } catch (dbErr) {
      structuredError('QUARANTINE_DB_EXCEPTION', { error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
      return jsonResponse({ success: false, error: 'Database exception during malformed event quarantine' }, 500);
    }

    // Acknowledge delivery after durable quarantine without claiming financial effect was processed
    return jsonResponse({
      success: true,
      quarantined: true,
      message: 'Authenticated malformed refund event quarantined for administrator review; no financial effect applied.',
    });
  }
  const refundCreatedAtIso = refundCreatedAtSec
    ? new Date(refundCreatedAtSec * 1000).toISOString()
    : new Date().toISOString();

  // Determine target lifecycle status from payload event & provider status
  let targetStatus = 'processed';
  if (payload.event === 'refund.failed' || refundRawStatus === 'failed') {
    targetStatus = 'failed';
  } else if (payload.event === 'refund.created' && refundRawStatus !== 'processed') {
    targetStatus = 'created';
  }

  structuredLog('REFUND_EVENT_RECEIVED', {
    refundId,
    razorpayPaymentId,
    amountRupees: refundAmountRupees,
    event: payload.event,
    targetStatus,
  });

  const { data: localPayment, error: paymentFindError } = await serviceClient
    .from('payments')
    .select('payment_id, order_id, institute_id, amount, status, refund_amount, gateway_payment_id')
    .eq('gateway', 'razorpay')
    .eq('gateway_payment_id', razorpayPaymentId)
    .maybeSingle();

  if (paymentFindError || !localPayment) {
    // C1: never acknowledge-and-discard an authentic refund event. Out-of-order delivery (refund
    // before payment.captured, or a refund on an attempt whose gateway_payment_id is still null)
    // previously returned 200 and lost the money permanently, because Razorpay does not redeliver
    // an acknowledged event.
    //
    // Durable quarantine instead: the complete authentic payload is persisted in
    // public.webhook_quarantine_events, keyed deterministically on (event, refund id) so a redelivery
    // can never create a second row. No payment/refund association is fabricated.
    //
    // Later reconciliation: replaying this authenticated event once the payments row exists flows
    // through reconcile_standard_refund, whose unique gateway_refund_id constraint and
    // ALREADY_PROCESSED branch keep it idempotent (no duplicate ledger entry).
    const quarantineKey = `${payload.event}:${refundId}`;

    const { error: qErr } = await serviceClient
      .from('webhook_quarantine_events')
      .insert({
        gateway_event_id: quarantineKey,
        event_type: payload.event,
        entity_id: refundId,
        gateway_payment_id: razorpayPaymentId,
        payment_id: null,
        agreement_id: null,
        failure_code: 'REFUND_PAYMENT_NOT_FOUND',
        failure_reason: paymentFindError?.message ??
          'No local payment row matches the refund payment_id yet (out-of-order or unlinked attempt).',
        payload: payload as unknown as Record<string, unknown>,
      });

    if (qErr) {
      if (qErr.code === '23505') {
        structuredLog('DUPLICATE_UNRECONCILED_REFUND_ACKNOWLEDGED', {
          refundId,
          razorpayPaymentId,
          quarantineKey,
        });
        return jsonResponse({
          success: true,
          quarantined: true,
          duplicate: true,
          message: 'Refund event already quarantined pending reconciliation.',
        });
      }

      // Durable persistence failed: fail closed so Razorpay retries this delivery.
      structuredError('REFUND_QUARANTINE_PERSISTENCE_FAILED', {
        ...meta,
        eventType: 'refund_quarantine_insert',
        message: qErr.message,
        refundId,
        razorpayPaymentId,
        httpStatus: 500,
      });
      return jsonResponse({
        success: false,
        error: 'Unable to durably record refund event. Retry required.',
      }, 500);
    }

    structuredError('REFUND_QUARANTINED_AWAITING_PAYMENT', {
      ...meta,
      eventType: 'refund_quarantine',
      message: 'Refund event could not be matched to a payment row; quarantined for later reconciliation.',
      refundId,
      razorpayPaymentId,
      targetStatus,
      quarantineKey,
      httpStatus: 200,
    });

    return jsonResponse({
      success: true,
      quarantined: true,
      message: 'Refund event durably quarantined for later reconciliation; no financial effect applied yet.',
    });
  }

  // Resolve agreement linkage
  let agreementId: string | null = null;
  const { data: alloc } = await serviceClient
    .from('installment_payment_allocations')
    .select('agreement_id')
    .eq('payment_id', localPayment.payment_id)
    .limit(1)
    .maybeSingle();

  if (alloc?.agreement_id) {
    agreementId = alloc.agreement_id;
  } else {
    // C2: installment processing must be driven by THIS payment's relationship to an agreement.
    // The previous fallback matched on (student_id, course_id) alone, so a standard checkout
    // payment was diverted into installment adjustment handling whenever the student happened to
    // hold an unrelated agreement for the same course. That skipped reconcile_standard_refund and
    // left the order confirmed with live entitlements after a full refund.
    //
    // The fallback is now gated on the order actually being an installment order. This keeps
    // legitimate legacy installment refunds (allocation row missing) working while guaranteeing a
    // standard checkout always reaches standard refund reconciliation.
    const { data: orderRow } = await serviceClient
      .from('orders')
      .select('student_id')
      .eq('order_id', localPayment.order_id)
      .maybeSingle();

    const { data: orderItems } = await serviceClient
      .from('order_items')
      .select('item_type, course_id')
      .eq('order_id', localPayment.order_id);

    const isInstallmentOrder = (orderItems ?? []).some((item: any) => item?.item_type === 'installment');
    const orderCourseId = (orderItems ?? [])
      .map((item: any) => item?.course_id)
      .find((courseId: any) => !!courseId) ?? null;

    if (isInstallmentOrder && orderRow?.student_id && orderCourseId) {
      const { data: sca } = await serviceClient
        .from('student_course_agreements')
        .select('agreement_id')
        .eq('student_id', orderRow.student_id)
        .eq('course_id', orderCourseId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sca?.agreement_id) {
        agreementId = sca.agreement_id;
      }
    } else {
      structuredLog('STANDARD_CHECKOUT_REFUND_ROUTED_TO_STANDARD_PATH', {
        refundId,
        razorpayPaymentId,
        orderId: localPayment.order_id,
        isInstallmentOrder,
      });
    }
  }

  if (agreementId) {
    // Check if adjustment row already exists for this gateway_event_id
    const { data: existingAdj } = await serviceClient
      .from('installment_adjustments')
      .select('adjustment_id, status, amount')
      .eq('gateway_event_id', refundId)
      .maybeSingle();

    if (existingAdj) {
      const currentStatus = existingAdj.status;

      // 1. Identical repeated delivery -> duplicate acknowledgment
      if (currentStatus === targetStatus) {
        structuredLog('DUPLICATE_REFUND_EVENT_ACKNOWLEDGED', {
          refundId,
          razorpayPaymentId,
          status: targetStatus,
          message: 'Refund event already recorded in target lifecycle status. Idempotent 200 returned.',
        });
        return jsonResponse({ success: true, message: 'Duplicate refund event acknowledged.' });
      }

      // 2. Duplicate contradictory notification while already under review
      if (currentStatus === 'under_review' && targetStatus === 'failed') {
        structuredLog('DUPLICATE_CONTRADICTORY_REFUND_EVENT_ACKNOWLEDGED', {
          refundId,
          razorpayPaymentId,
          message: 'Contradictory refund.failed event already under administrative review. Idempotent 200 returned.',
        });
        return jsonResponse({ success: true, message: 'Contradictory refund event already under review.' });
      }

      // 3. Anti-downgrade guard: cannot downgrade 'processed', 'failed', or 'under_review' back to 'created'
      if ((currentStatus === 'processed' || currentStatus === 'failed' || currentStatus === 'under_review') && targetStatus === 'created') {
        structuredLog('STALE_REFUND_EVENT_IGNORED', {
          refundId,
          currentStatus,
          incomingStatus: targetStatus,
          message: 'Delayed refund.created notification ignored; current verified state preserved.',
        });
        return jsonResponse({ success: true, message: 'Stale refund event ignored; existing state preserved.' });
      }

      // 4. Failed refund is terminal; unexpected transition to processed flags review
      if (currentStatus === 'failed' && targetStatus === 'processed') {
        structuredError('UNEXPECTED_TRANSITION_AFTER_FAILED', {
          ...meta,
          refundId,
          currentStatus,
          incomingStatus: targetStatus,
          message: 'Received processed event for refund that was already marked failed. Flagging for administrative review.',
          httpStatus: 200,
        });
        await serviceClient
          .from('student_course_agreements')
          .update({ requires_admin_review: true, updated_at: new Date().toISOString() })
          .eq('agreement_id', agreementId);
        return jsonResponse({ success: true, message: 'Unexpected transition flagged for review.' });
      }

      // 5. Contradictory notification: refund.failed arrives after refund was processed (Revision 32, Issue 1)
      if (currentStatus === 'processed' && targetStatus === 'failed') {
        structuredError('CONTRADICTORY_REFUND_FAILED_EVENT', {
          ...meta,
          refundId,
          currentStatus,
          incomingStatus: targetStatus,
          message: 'Received refund.failed after refund was already marked processed. Flagging for administrative review without automatically restoring credit.',
          httpStatus: 200,
        });

        // Transition adjustment status to 'under_review' to reflect contested financial state
        const { error: updateError } = await serviceClient
          .from('installment_adjustments')
          .update({
            status: 'under_review',
            reason: 'Contradictory Razorpay refund.failed received after processed status: ' + refundId + '. Retaining financial reduction pending administrative reconciliation.',
          })
          .eq('adjustment_id', existingAdj.adjustment_id);

        if (updateError) {
          structuredError('REFUND_ADJUSTMENT_UPDATE_FAILED', {
            ...meta,
            message: updateError.message,
            refundId,
          });
          return jsonResponse({ success: false, error: 'Failed to update refund adjustment to under_review.' }, 500);
        }

        // Flag student agreement for administrative review
        await serviceClient
          .from('student_course_agreements')
          .update({ requires_admin_review: true, updated_at: new Date().toISOString() })
          .eq('agreement_id', agreementId);

        // DO NOT change payments.refund_amount.
        // Leaving payments.refund_amount at its confirmed value while adjustment status is 'under_review'
        // causes v_is_reconciled to evaluate to false in database triggers (350.00 != 0.00).
        // This natively blocks new allocations from this payment while leaving existing allocations and student entitlements untouched.

        return jsonResponse({
          success: true,
          message: 'Contradictory refund.failed event flagged for review; existing financial reduction preserved.',
        });
      }

      // 6. Legitimate lifecycle state transitions (e.g. created -> processed, created -> failed, under_review -> processed)
      const confirmedAmount = Number(existingAdj.amount) > 0 ? Number(existingAdj.amount) : refundAmountRupees;
      const { error: updateError } = await serviceClient
        .from('installment_adjustments')
        .update({
          status: targetStatus,
          amount: confirmedAmount,
          reason: 'Razorpay refund lifecycle transition from ' + currentStatus + ' to ' + targetStatus + ': ' + refundId + ' (' + payload.event + ')',
        })
        .eq('adjustment_id', existingAdj.adjustment_id);

      if (updateError) {
        structuredError('REFUND_ADJUSTMENT_UPDATE_FAILED', {
          ...meta,
          eventType: 'refund_adjustment_lifecycle_update',
          message: updateError.message,
          refundId,
          targetStatus,
          httpStatus: 500,
        });
        return jsonResponse({ success: false, error: 'Failed to update refund adjustment lifecycle status.' }, 500);
      }

      structuredLog('REFUND_LIFECYCLE_TRANSITION_APPLIED', {
        refundId,
        fromStatus: currentStatus,
        toStatus: targetStatus,
      });
    } else {
      // First appearance of this refund ID
      const { error: insertError } = await serviceClient
        .from('installment_adjustments')
        .insert({
          agreement_id: agreementId,
          adjustment_type: 'gateway_refund',
          amount: refundAmountRupees,
          status: targetStatus,
          reference_payment_id: localPayment.payment_id,
          gateway_event_id: refundId,
          reason: 'Razorpay webhook refund ' + targetStatus + ': ' + refundId + ' (' + payload.event + ')',
          approved_by_admin_id: null,
        });

      if (insertError) {
        // Only acknowledge specific gateway_event_id uniqueness violation (Postgres 23505)
        if (insertError.code === '23505' && insertError.message?.includes('uq_installment_adjustments_gateway_event')) {
          structuredLog('CONCURRENT_DUPLICATE_REFUND_ACKNOWLEDGED', { refundId });
          return jsonResponse({ success: true, message: 'Duplicate refund event acknowledged.' });
        }
        structuredError('REFUND_ADJUSTMENT_INSERT_FAILED', {
          ...meta,
          eventType: 'refund_adjustment_insert',
          message: insertError.message,
          refundId,
          httpStatus: 500,
        });
        return jsonResponse({ success: false, error: 'Failed to insert refund adjustment.' }, 500);
      }
    }
  }

  if (!agreementId) {
    // Standard Non-Installment Checkout Refund Synchronization:
    // Synchronize via atomic RPC public.reconcile_standard_refund under the shared transaction-scoped
    // advisory lock (pg_advisory_xact_lock on 'rzp_order_claim:' || gateway_order_id) and orders-before-payments
    // lock hierarchy. Guarantees monotonic refund accumulation, prevents races with checkout recovery
    // and payment.captured, validates authentic rfnd_ identifier format, and cancels internal order to revoke access.
    const { data: refundRecData, error: refundRecError } = await serviceClient.rpc(
      'reconcile_standard_refund',
      {
        p_gateway_payment_id: razorpayPaymentId,
        p_refund_gateway_id: refundId,
        p_refund_amount: refundAmountRupees,
        p_refund_status: targetStatus,
        p_refunded_at: refundCreatedAtIso,
        p_gateway_response: payload,
      }
    );

    if (refundRecError || !refundRecData?.success) {
      const code = refundRecData?.code || 'REFUND_RECONCILE_FAILED';
      const msg = refundRecError?.message || refundRecData?.error || 'Failed to reconcile standard refund';

      if (code === 'OVER_REFUND_DISCREPANCY') {
        structuredError('STANDARD_REFUND_OVER_REFUND_DISCREPANCY', {
          ...meta,
          refundId,
          razorpayPaymentId,
          code,
          error: msg,
          httpStatus: 200,
        });
        return jsonResponse({
          success: true,
          requires_admin_review: true,
          message: 'Over-refund discrepancy detected and quarantined for administrator review. Financial state preserved.',
        });
      }

      structuredError('STANDARD_REFUND_RECONCILE_FAILED', {
        ...meta,
        refundId,
        razorpayPaymentId,
        targetStatus,
        code,
        error: msg,
        httpStatus: 500,
      });
      return jsonResponse({ success: false, error: msg }, 500);
    }

    structuredLog('STANDARD_REFUND_RECONCILE_SUCCESS', {
      refundId,
      razorpayPaymentId,
      action: refundRecData?.action,
      code: refundRecData?.code,
    });

    return jsonResponse({ success: true, message: 'Standard refund ' + targetStatus + ' event processed successfully.' });
  }

  // Synchronize commerce payments table strictly with confirmed processed refunds for installment agreements
  const { data: allActiveAdjustments } = await serviceClient
    .from('installment_adjustments')
    .select('amount')
    .eq('reference_payment_id', localPayment.payment_id)
    .in('adjustment_type', ['gateway_refund', 'duplicate_charge_refund'])
    .eq('status', 'processed');

  const newRefundTotal = allActiveAdjustments
    ? allActiveAdjustments.reduce((sum, r) => sum + Number(r.amount), 0)
    : (targetStatus === 'processed' ? (Number(localPayment.refund_amount ?? 0) + refundAmountRupees) : Number(localPayment.refund_amount ?? 0));

  const isFullyRefunded = newRefundTotal >= Number(localPayment.amount);

  const { error: paymentUpdateError } = await serviceClient
    .from('payments')
    .update({
      refund_amount: newRefundTotal > 0 ? newRefundTotal : null,
      refund_gateway_id: targetStatus === 'processed' ? refundId : localPayment.refund_gateway_id,
      refunded_at: targetStatus === 'processed' ? refundCreatedAtIso : localPayment.refunded_at,
      status: isFullyRefunded ? 'refunded' : (newRefundTotal > 0 ? 'partially_refunded' : 'captured'),
    })
    .eq('payment_id', localPayment.payment_id);

  if (paymentUpdateError) {
    structuredError('REFUND_PAYMENT_UPDATE_FAILED', {
      ...meta,
      eventType: 'refund_payment_update',
      message: paymentUpdateError.message,
      refundId,
      httpStatus: 500,
    });
    return jsonResponse({ success: false, error: 'Failed to synchronize payment refund summary.' }, 500);
  }

  // If a refund failed, flag agreement for administrator review so staff can inspect failure reason
  if (targetStatus === 'failed' && agreementId) {
    await serviceClient
      .from('student_course_agreements')
      .update({ requires_admin_review: true, updated_at: new Date().toISOString() })
      .eq('agreement_id', agreementId);
  }

  return jsonResponse({ success: true, message: 'Refund ' + targetStatus + ' event processed successfully.' });
}

/**
 * Handle Razorpay dispute lifecycle events:
 * - payment.dispute.created, payment.dispute.under_review, payment.dispute.action_required
 * - payment.dispute.lost, payment.dispute.won, payment.dispute.closed
 *
 * Financial State Separation (Revision 31):
 * - 'amount' column retains immutable historical gross debit evidence.
 * - 'restored_amount' column tracks verified funds returned by provider.
 * - Active credit reduction = greatest(0.00, amount - restored_amount).
 * - Open dispute with amount_deducted = 0 does NOT create phantom reduction or premature review flag.
 * - Moving to 'closed' does NOT erase confirmed debit unless verified restored.
 * - Anti-downgrade logic prevents delayed created/under_review events from overwriting lost/won/closed outcomes.
 */
async function handleRazorpayDispute(
  serviceClient: SupabaseClient,
  payload: RazorpayWebhookPayload,
  meta?: Record<string, unknown>,
): Promise<Response> {
  const disputeEntity = payload.payload.dispute?.entity;
  if (!disputeEntity || !disputeEntity.id || !disputeEntity.payment_id) {
    structuredError('DISPUTE_PAYLOAD_INVALID', {
      ...meta,
      eventType: 'dispute_payload_invalid',
      message: 'Webhook payload missing required dispute entity or identifiers.',
      httpStatus: 400,
    });
    return jsonResponse({ success: false, error: 'Invalid dispute payload.' }, 400);
  }

  const {
    id: disputeId,
    payment_id: razorpayPaymentId,
    amount: disputeAmountPaise,
    amount_deducted: amountDeductedPaise = 0,
    status: disputeRawStatus,
  } = disputeEntity;

  // Strict ingestion boundary (Revision 32): validate minor units, currency, non-negative,
  // allow zero for amount_deducted, reject zero for dispute amount
  let disputedAmountRupees: number;
  let amountDeductedRupees: number;
  try {
    disputedAmountRupees = convertPaiseToRupeesStrict(
      disputeAmountPaise,
      disputeEntity.currency || 'INR',
      { allowZero: false } // Dispute claimed amount cannot be zero
    );
    amountDeductedRupees = convertPaiseToRupeesStrict(
      amountDeductedPaise,
      disputeEntity.currency || 'INR',
      { allowZero: true } // Dispute deduction can legitimately be zero (open dispute without deduction)
    );
  } catch (err) {
    structuredError('DISPUTE_CURRENCY_INVALID_QUARANTINE', {
      ...meta,
      eventType: 'dispute_currency_invalid',
      message: err instanceof Error ? err.message : 'Invalid dispute currency or amount.',
      disputeId,
      disputeAmountPaise,
      amountDeductedPaise,
      httpStatus: 200,
    });

    // Durable quarantine of authenticated malformed dispute event into public.webhook_quarantine_events (Revision 34, Issue 2)
    const gatewayEventId = (meta?.eventId as string) || (payload as any).event_id || `${disputeId}_${payload.event}_${payload.created_at || Date.now()}`;
    let localPaymentId: string | null = null;
    let agreementId: string | null = null;

    try {
      const { data: localPayment, error: paymentLookupError } = await serviceClient
        .from('payments')
        .select('payment_id, order_id')
        .eq('gateway', 'razorpay')
        .eq('gateway_payment_id', razorpayPaymentId)
        .maybeSingle();

      if (paymentLookupError) {
        structuredError('QUARANTINE_PAYMENT_LOOKUP_FAILED', { error: paymentLookupError.message, disputeId });
        return jsonResponse({ success: false, error: 'Database failure during malformed event quarantine' }, 500);
      }

      if (localPayment) {
        localPaymentId = localPayment.payment_id;
        const { data: alloc } = await serviceClient
          .from('installment_payment_allocations')
          .select('agreement_id')
          .eq('payment_id', localPayment.payment_id)
          .limit(1)
          .maybeSingle();

        if (alloc?.agreement_id) {
          agreementId = alloc.agreement_id;
        }
      }

      // 1. Durably persist to dedicated ledger public.webhook_quarantine_events (idempotent on gateway_event_id)
      const { error: qInsertError } = await serviceClient
        .from('webhook_quarantine_events')
        .insert({
          gateway_event_id: gatewayEventId,
          event_type: payload.event,
          entity_id: disputeId,
          gateway_payment_id: razorpayPaymentId,
          payment_id: localPaymentId,
          agreement_id: agreementId,
          failure_code: 'MALFORMED_FINANCIAL_DATA',
          failure_reason: err instanceof Error ? err.message : String(err),
          payload: payload as unknown as Record<string, unknown>,
        });

      if (qInsertError) {
        // Unique violation on gateway_event_id indicates idempotent retry of already quarantined event
        if (qInsertError.code === '23505' && qInsertError.message?.includes('uq_webhook_quarantine_event')) {
          structuredLog('DUPLICATE_QUARANTINE_EVENT_ACKNOWLEDGED', { disputeId, gatewayEventId });
          return jsonResponse({ success: true, quarantined: true, duplicate: true, message: 'Duplicate malformed event acknowledged.' });
        }
        structuredError('QUARANTINE_PERSISTENCE_FAILED', { error: qInsertError.message, disputeId, gatewayEventId });
        return jsonResponse({ success: false, error: 'Database failure during malformed event quarantine persistence' }, 500);
      }

      // 2. If agreement linkage exists, flag agreement for administrative review
      if (agreementId) {
        const { error: flagError } = await serviceClient
          .from('student_course_agreements')
          .update({ requires_admin_review: true, updated_at: new Date().toISOString() })
          .eq('agreement_id', agreementId);

        if (flagError) {
          structuredError('QUARANTINE_RECORDING_FAILED', { error: flagError.message, disputeId });
          return jsonResponse({ success: false, error: 'Database failure during malformed event quarantine' }, 500);
        }
      }

      // 3. If payment linkage exists, update failure_reason
      if (localPaymentId) {
        await serviceClient
          .from('payments')
          .update({
            failure_reason: 'MALFORMED_DISPUTE_QUARANTINE: ' + (err instanceof Error ? err.message : String(err)) + ' (event: ' + payload.event + ', id: ' + disputeId + ')',
            updated_at: new Date().toISOString(),
          })
          .eq('payment_id', localPaymentId);
      }
    } catch (dbErr) {
      structuredError('QUARANTINE_DB_EXCEPTION', { error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
      return jsonResponse({ success: false, error: 'Database exception during malformed event quarantine' }, 500);
    }

    return jsonResponse({
      success: true,
      quarantined: true,
      message: 'Authenticated malformed dispute event quarantined for administrator review; no financial effect applied.',
    });
  }

  structuredLog('DISPUTE_EVENT_RECEIVED', {
    disputeId,
    razorpayPaymentId,
    disputedAmountRupees,
    amountDeductedRupees,
    event: payload.event,
    rawStatus: disputeRawStatus,
  });

  const { data: localPayment, error: paymentFindError } = await serviceClient
    .from('payments')
    .select('payment_id, order_id, institute_id, amount, status')
    .eq('gateway', 'razorpay')
    .eq('gateway_payment_id', razorpayPaymentId)
    .maybeSingle();

  if (paymentFindError || !localPayment) {
    structuredError('DISPUTE_PAYMENT_NOT_FOUND', {
      ...meta,
      eventType: 'dispute_payment_lookup',
      message: paymentFindError?.message ?? 'Payment not found for dispute event.',
      disputeId,
      razorpayPaymentId,
      httpStatus: 200,
    });
    return jsonResponse({ success: true, message: 'Payment record not found; dispute event acknowledged.' });
  }

  let agreementId: string | null = null;
  const { data: alloc } = await serviceClient
    .from('installment_payment_allocations')
    .select('agreement_id')
    .eq('payment_id', localPayment.payment_id)
    .limit(1)
    .maybeSingle();

  if (alloc?.agreement_id) {
    agreementId = alloc.agreement_id;
  } else {
    const { data: order } = await serviceClient
      .from('orders')
      .select('student_id')
      .eq('order_id', localPayment.order_id)
      .maybeSingle();

    const { data: orderItem } = await serviceClient
      .from('order_items')
      .select('course_id')
      .eq('order_id', localPayment.order_id)
      .maybeSingle();

    if (order?.student_id && orderItem?.course_id) {
      const { data: sca } = await serviceClient
        .from('student_course_agreements')
        .select('agreement_id')
        .eq('student_id', order.student_id)
        .eq('course_id', orderItem.course_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sca?.agreement_id) {
        agreementId = sca.agreement_id;
      }
    }
  }

  if (agreementId) {
    // Check existing dispute record
    const { data: existingAdj } = await serviceClient
      .from('installment_adjustments')
      .select('adjustment_id, status, amount, restored_amount')
      .eq('gateway_event_id', disputeId)
      .maybeSingle();

    // Determine target lifecycle state and financial deduction (Revision 32: Immutable Historical Debit)
    let targetStatus = 'under_review';
    const currentAmount = existingAdj ? Number(existingAdj.amount) : 0.00;
    const currentRestoredAmount = existingAdj ? Number(existingAdj.restored_amount ?? 0) : 0.00;
    let targetAmount = currentAmount;
    let targetRestoredAmount = currentRestoredAmount;
    let flagReviewRequired = false;

    // Distinguish individual webhook event ID from dispute entity ID (Revision 33, Issue 2)
    const webhookEventId = (meta?.eventId as string) || (payload as any).event_id || (payload.payload?.dispute?.entity?.id ? `${payload.payload.dispute.entity.id}_${payload.event}_${payload.created_at || Date.now()}` : undefined);

    if (payload.event === 'payment.dispute.won' || disputeRawStatus === 'won') {
      targetStatus = 'won';
      // Historical debit is immutable once confirmed:
      targetAmount = currentAmount > 0.00 ? currentAmount : disputedAmountRupees;

      // Revision 34 (Issue 1): DO NOT infer money restoration from dispute status!
      // Razorpay dispute webhook notifications do not contain authoritative settlement
      // transfer references (provider_reference_id). Restoration amount must NOT be
      // increased automatically based solely on dispute status 'won', 'closed',
      // or amount_deducted = 0.
      targetRestoredAmount = currentRestoredAmount; // preserve existing verified restored amount
      flagReviewRequired = true; // flag agreement for reconciliation
      structuredLog('DISPUTE_WON_RESTORATION_PENDING_RECONCILIATION', {
        disputeId,
        gatewayEventId: webhookEventId,
        amountDeductedRupees,
        currentAmount,
        currentRestoredAmount,
        message: 'Dispute won status acknowledged. Financial restoration left pending authorized settlement reconciliation.',
      });
    } else if (payload.event === 'payment.dispute.lost' || disputeRawStatus === 'lost') {
      targetStatus = 'lost';
      // Historical debit is immutable once confirmed; initial confirmation permitted if currentAmount is 0
      targetAmount = currentAmount > 0.00 ? currentAmount : (amountDeductedRupees > 0 ? amountDeductedRupees : disputedAmountRupees);
      targetRestoredAmount = currentRestoredAmount;
      flagReviewRequired = true;
    } else if (payload.event === 'payment.dispute.closed' || disputeRawStatus === 'closed') {
      targetStatus = 'closed';
      // Moving to closed preserves existing debit and restoration amounts
      targetAmount = currentAmount > 0.00 ? currentAmount : (amountDeductedRupees > 0 ? amountDeductedRupees : disputedAmountRupees);
      targetRestoredAmount = currentRestoredAmount;
      if (targetAmount > targetRestoredAmount) {
        flagReviewRequired = true; // closed with active unreversed debit
      }
    } else {
      // payment.dispute.created / under_review / action_required
      targetStatus = 'under_review';
      if (currentAmount > 0.00) {
        targetAmount = currentAmount; // preserve established debit
        targetRestoredAmount = currentRestoredAmount;
        flagReviewRequired = true;
      } else if (amountDeductedRupees > 0) {
        targetAmount = amountDeductedRupees; // initial confirmation of debit
        targetRestoredAmount = 0.00;
        flagReviewRequired = true;
      } else {
        // Open dispute with zero deduction
        targetAmount = 0.00;
        targetRestoredAmount = 0.00;
        flagReviewRequired = false; // Zero financial deduction; no premature review flag
      }
    }

    // Restored amount monotonicity: verified returned funds cannot decrease
    targetRestoredAmount = Math.max(currentRestoredAmount, targetRestoredAmount);
    // Restored amount ceiling: cannot exceed gross historical amount
    targetRestoredAmount = Math.min(targetAmount, targetRestoredAmount);

    if (existingAdj) {
      const currentStatus = existingAdj.status;

      // Anti-downgrade guard: cannot downgrade terminal/outcome states back to 'under_review'
      if ((currentStatus === 'lost' || currentStatus === 'won' || currentStatus === 'closed') && targetStatus === 'under_review') {
        structuredLog('STALE_DISPUTE_EVENT_IGNORED', {
          disputeId,
          currentStatus,
          incomingStatus: targetStatus,
          message: 'Delayed dispute event ignored; verified outcome state preserved.',
        });
        return jsonResponse({ success: true, message: 'Stale dispute event ignored; existing state preserved.' });
      }

      // Duplicate delivery check: identical status and monetary fields
      if (
        currentStatus === targetStatus &&
        Number(existingAdj.amount) === targetAmount &&
        Number(existingAdj.restored_amount ?? 0) === targetRestoredAmount
      ) {
        structuredLog('DUPLICATE_DISPUTE_EVENT_ACKNOWLEDGED', { disputeId, targetStatus });
        return jsonResponse({ success: true, message: 'Duplicate dispute event acknowledged.' });
      }

      // Lifecycle update
      const { error: updateError } = await serviceClient
        .from('installment_adjustments')
        .update({
          status: targetStatus,
          amount: targetAmount,
          restored_amount: targetRestoredAmount,
          reason: 'Razorpay dispute transition to ' + targetStatus + ': ' + disputeId + ' (gross debit: ₹' + targetAmount + ', restored: ₹' + targetRestoredAmount + ')',
        })
        .eq('adjustment_id', existingAdj.adjustment_id);

      if (updateError) {
        structuredError('DISPUTE_ADJUSTMENT_UPDATE_FAILED', { ...meta, message: updateError.message });
        return jsonResponse({ success: false, error: 'Failed to update dispute adjustment status.' }, 500);
      }

      structuredLog('DISPUTE_LIFECYCLE_TRANSITION_APPLIED', {
        disputeId,
        fromStatus: currentStatus,
        toStatus: targetStatus,
        amount: targetAmount,
        restoredAmount: targetRestoredAmount,
      });
    } else {
      // First insertion of dispute
      const { error: insertError } = await serviceClient
        .from('installment_adjustments')
        .insert({
          agreement_id: agreementId,
          adjustment_type: 'gateway_reversal',
          amount: targetAmount,
          restored_amount: targetRestoredAmount,
          status: targetStatus,
          reference_payment_id: localPayment.payment_id,
          gateway_event_id: disputeId,
          reason: 'Razorpay dispute ' + targetStatus + ': ' + disputeId + ' (gross debit: ₹' + targetAmount + ', restored: ₹' + targetRestoredAmount + ')',
          approved_by_admin_id: null,
        });

      if (insertError) {
        if (insertError.code === '23505' && insertError.message?.includes('uq_installment_adjustments_gateway_event')) {
          structuredLog('CONCURRENT_DUPLICATE_DISPUTE_ACKNOWLEDGED', { disputeId });
          return jsonResponse({ success: true, message: 'Duplicate dispute event acknowledged.' });
        }
        structuredError('DISPUTE_ADJUSTMENT_INSERT_FAILED', { ...meta, message: insertError.message });
        return jsonResponse({ success: false, error: 'Failed to insert dispute adjustment.' }, 500);
      }
    }

    // Flag agreement for review if required (confirmed debits, deficits, or unverified won dispute)
    if (flagReviewRequired) {
      await serviceClient
        .from('student_course_agreements')
        .update({ requires_admin_review: true, updated_at: new Date().toISOString() })
        .eq('agreement_id', agreementId);
    }
  }

  return jsonResponse({ success: true, message: 'Dispute event processed successfully.' });
}
// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handles verified 'payment.failed' webhook event from Razorpay.
 *
 * Requirements:
 * 1. Signature is already verified by established HMAC-SHA256 check.
 * 2. Extracts razorpayPaymentId and razorpayOrderId.
 * 3. Resolves local payment and order records.
 * 4. Records the failure using existing public.payments schema (status='failed', failure_reason, gateway_payment_id, gateway_response).
 * 5. Preserves retry capability: orders.status remains 'pending', fulfillment_status remains 'unfulfilled', agreement is NOT cancelled.
 * 6. Anti-downgrade: if order or payment was already captured, failure event MUST NOT overwrite or downgrade it.
 * 7. Multi-attempt safety: preserves earlier failed attempts without violating unique constraints or throwing PGRST116.
 * 8. Returns HTTP 200 with structured diagnostic logs.
 */
async function handleRazorpayPaymentFailed(
  serviceClient: SupabaseClient,
  payload: RazorpayWebhookPayload,
  rawBody: string,
  meta?: Record<string, unknown>,
): Promise<Response> {
  const paymentEntity = payload.payload?.payment?.entity;
  if (!paymentEntity || !paymentEntity.id) {
    structuredError('PAYMENT_FAILED_PAYLOAD_INVALID', {
      ...meta,
      eventType: 'payment_failed_payload_invalid',
      message: 'Webhook payload missing required payment entity or identifier.',
      httpStatus: 400,
    });
    return jsonResponse({ success: false, error: 'Invalid payment.failed payload.' }, 400);
  }

  const razorpayPaymentId = paymentEntity.id;
  const razorpayOrderId = paymentEntity.order_id;
  const rawErrorCode = paymentEntity.error_code || null;
  const rawErrorDesc = paymentEntity.error_description || null;
  const rawErrorSource = paymentEntity.error_source || null;
  const rawErrorStep = paymentEntity.error_step || null;
  const rawErrorReason = paymentEntity.error_reason || null;

  // Format concise, diagnostic failure reason without leaking private student info
  const failureDetails = [
    rawErrorCode ? `Code: ${rawErrorCode}` : null,
    rawErrorDesc ? `Desc: ${rawErrorDesc}` : null,
    rawErrorSource ? `Source: ${rawErrorSource}` : null,
    rawErrorStep ? `Step: ${rawErrorStep}` : null,
    rawErrorReason ? `Reason: ${rawErrorReason}` : null,
  ].filter(Boolean).join(' | ');

  const failureReason = failureDetails || 'Payment failed';

  structuredLog('PAYMENT_FAILED_RECEIVED', {
    gatewayPaymentId: razorpayPaymentId,
    gatewayOrderId: razorpayOrderId,
    errorCode: rawErrorCode,
    errorSource: rawErrorSource,
    errorStep: rawErrorStep,
    errorReason: rawErrorReason,
  });

  // 1. Check if this exact gateway_payment_id was already recorded
  const { data: existingPaymentByGatewayId, error: lookupByGatewayIdError } = await serviceClient
    .from('payments')
    .select('payment_id, order_id, institute_id, amount, currency, status, gateway_order_id, gateway_payment_id, attempt_number')
    .eq('gateway', 'razorpay')
    .eq('gateway_payment_id', razorpayPaymentId)
    .maybeSingle();

  if (lookupByGatewayIdError) {
    structuredError('PAYMENT_FAILED_LOOKUP_ERROR', {
      error: lookupByGatewayIdError.message,
      gatewayPaymentId: razorpayPaymentId,
      gatewayOrderId: razorpayOrderId,
    });
    return jsonResponse({ success: false, error: 'Database error looking up payment.' }, 500);
  }

  if (existingPaymentByGatewayId) {
    // Anti-downgrade rule: Never downgrade captured payment
    if (existingPaymentByGatewayId.status === 'captured') {
      structuredLog('PAYMENT_FAILED_IGNORED_ALREADY_CAPTURED', {
        paymentId: existingPaymentByGatewayId.payment_id,
        orderId: existingPaymentByGatewayId.order_id,
        gatewayPaymentId: razorpayPaymentId,
        message: 'Payment attempt was already captured; ignoring delayed failure event.',
      });
      return jsonResponse({
        success: true,
        message: 'Payment attempt was already captured; failure event ignored.',
      });
    }

    // Idempotency: Already marked as failed
    if (existingPaymentByGatewayId.status === 'failed') {
      structuredLog('PAYMENT_FAILED_ALREADY_RECORDED', {
        paymentId: existingPaymentByGatewayId.payment_id,
        orderId: existingPaymentByGatewayId.order_id,
        gatewayPaymentId: razorpayPaymentId,
      });
      return jsonResponse({
        success: true,
        message: 'Payment failure already recorded.',
      });
    }

    // Existing payment row has this gateway_payment_id but is pending: update it
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = { payload };
    }

    const { error: updateErr } = await serviceClient
      .from('payments')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        gateway_response: parsedBody,
        updated_at: new Date().toISOString(),
      })
      .eq('payment_id', existingPaymentByGatewayId.payment_id)
      .eq('status', 'pending');

    if (updateErr) {
      structuredError('PAYMENT_FAILED_UPDATE_ERROR', {
        error: updateErr.message,
        paymentId: existingPaymentByGatewayId.payment_id,
      });
      return jsonResponse({ success: false, error: 'Failed to record payment failure.' }, 500);
    }

    structuredLog('PAYMENT_FAILED_RECORDED', {
      paymentId: existingPaymentByGatewayId.payment_id,
      orderId: existingPaymentByGatewayId.order_id,
      attemptNumber: existingPaymentByGatewayId.attempt_number,
      gatewayPaymentId: razorpayPaymentId,
      status: 'failed',
    });

    return jsonResponse({
      success: true,
      message: 'Payment failure recorded successfully.',
    });
  }

  // 2. Not found by gateway_payment_id. Locate via gateway_order_id.
  if (!razorpayOrderId) {
    structuredError('PAYMENT_FAILED_NO_ORDER_ID', {
      gatewayPaymentId: razorpayPaymentId,
      message: 'Payment failed event does not contain razorpay order_id; cannot correlate with local order.',
    });
    return jsonResponse({
      success: true,
      message: 'Payment failed acknowledged without order correlation.',
    });
  }

  // Find all payment attempts for this gateway_order_id
  let { data: orderPayments, error: orderPaymentsError } = await serviceClient
    .from('payments')
    .select('payment_id, order_id, institute_id, amount, currency, status, gateway_order_id, gateway_payment_id, attempt_number')
    .eq('gateway', 'razorpay')
    .eq('gateway_order_id', razorpayOrderId)
    .order('attempt_number', { ascending: false });

  // Fallback: If not found, attempt Bounded Gateway Recovery via Deterministic Receipt
  if ((!orderPayments || orderPayments.length === 0) && RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    structuredLog('RECONCILING_MISSING_GATEWAY_ORDER_FOR_FAILURE_BY_RECEIPT', {
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
    });

    try {
      const razorpay = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
      });

      const rzpOrder = await razorpay.orders.fetch(razorpayOrderId);
      const rzpReceipt = rzpOrder?.receipt;

      if (rzpReceipt && rzpReceipt.startsWith('rcpt_')) {
        const cleanId = rzpReceipt.slice(5);
        if (cleanId.length === 32) {
          const candidateUuid = `${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20, 32)}`;

          // 1. Database-level atomic advisory-locked gateway order reconciliation RPC
          const { data: recResult, error: recError } = await serviceClient.rpc(
            'reconcile_razorpay_gateway_order',
            {
              p_payment_id: candidateUuid,
              p_gateway_order_id: razorpayOrderId,
              p_expected_amount: Number(rzpOrder.amount) / 100,
              p_expected_currency: (rzpOrder.currency || 'INR').toUpperCase(),
              p_event_type: 'payment.failed',
            }
          );

          if (!recError && recResult?.success) {
            if (recResult.action === 'ignored_captured') {
              // Anti-downgrade rule: Never downgrade or associate captured payment with failure event
              structuredLog('RECEIPT_RECONCILIATION_FAILED_EVENT_IGNORED_CAPTURED', {
                candidatePaymentId: candidateUuid,
                gatewayOrderId: razorpayOrderId,
                gatewayPaymentId: razorpayPaymentId,
              });
              return jsonResponse({
                success: true,
                message: 'Payment attempt was already captured; failure event ignored.',
              });
            }

            if (recResult.action === 'already_failed') {
              structuredLog('RECEIPT_RECONCILIATION_FAILED_EVENT_ALREADY_RECORDED', {
                candidatePaymentId: candidateUuid,
                gatewayOrderId: razorpayOrderId,
              });
            }

            if (recResult.payment) {
              orderPayments = [recResult.payment];
            }
          } else if (recResult && !recResult.success && recResult.code !== 'PAYMENT_NOT_FOUND') {
            structuredError('RECEIPT_RECONCILIATION_FAILED_RPC_REJECTED', {
              candidatePaymentId: candidateUuid,
              gatewayOrderId: razorpayOrderId,
              code: recResult.code,
              error: recResult.error,
            });

            if (recResult.code === 'GATEWAY_ORDER_ALREADY_ASSOCIATED') {
              return jsonResponse({
                success: true,
                message: 'Gateway order ID is already associated with another payment attempt.',
              });
            }
          } else {
            // 2. Fallback: candidateUuid is candidateOrderId (standard checkout)
            // Route through reconcile_standard_order_gateway_order using order-level isolation
            const { data: candPmt } = await serviceClient
              .from('payments')
              .select('payment_id, amount, currency')
              .eq('order_id', candidateUuid)
              .eq('gateway', 'razorpay')
              .eq('status', 'pending')
              .is('gateway_order_id', null)
              .order('attempt_number', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (candPmt?.payment_id) {
              const { data: recResult, error: recError } = await serviceClient.rpc(
                'reconcile_standard_order_gateway_order',
                {
                  p_order_id: candidateUuid,
                  p_payment_id: candPmt.payment_id,
                  p_gateway_order_id: razorpayOrderId,
                  p_expected_amount: Number(rzpOrder.amount) / 100,
                  p_expected_currency: (rzpOrder.currency || 'INR').toUpperCase(),
                  p_event_type: 'payment.failed',
                }
              );

              if (!recError && recResult?.success && recResult?.payment) {
                orderPayments = [recResult.payment];
              }
            } else {
              // No unassigned pending payment row: create the failed attempt directly
              const { data: attemptRes, error: attemptErr } = await serviceClient.rpc(
                'create_standard_payment_attempt',
                {
                  p_order_id: candidateUuid,
                  p_gateway_order_id: razorpayOrderId,
                  p_amount: Number(rzpOrder.amount) / 100,
                  p_currency: (rzpOrder.currency || 'INR').toUpperCase(),
                  p_status: 'failed',
                  p_gateway_payment_id: razorpayPaymentId,
                  p_failure_reason: failureReason,
                  p_gateway_response: parsedBody,
                }
              );

              if (!attemptErr && attemptRes?.success && attemptRes?.payment) {
                orderPayments = [attemptRes.payment];
              }
            }
          }
        }
      }
    } catch (recErr) {
      structuredError('RECEIPT_RECONCILIATION_EXCEPTION_ON_FAILURE', {
        error: recErr instanceof Error ? recErr.message : String(recErr),
      });
    }
  }

  if (orderPaymentsError) {
    structuredError('PAYMENT_FAILED_QUERY_ERROR', {
      error: orderPaymentsError.message,
      gatewayOrderId: razorpayOrderId,
    });
    return jsonResponse({ success: false, error: 'Database error resolving payments.' }, 500);
  }

  if (!orderPayments || orderPayments.length === 0) {
    structuredError('PAYMENT_FAILED_NO_LOCAL_RECORD', {
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      message: 'No matching local payment record found for this Razorpay order ID.',
    });
    return jsonResponse({
      success: true,
      message: 'No matching payment record found. Webhook acknowledged.',
    });
  }

  // Parse raw body for audit storage
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    parsedBody = { payload };
  }

  // Check if order already has a captured payment (Anti-Downgrade & Out-of-order Protection)
  const capturedPayment = orderPayments.find((p) => p.status === 'captured');
  if (capturedPayment) {
    // The order already succeeded! This is an out-of-order delayed failure event from an earlier attempt.
    // Insert a separate failed attempt record for audit via atomic create_standard_payment_attempt RPC
    const basePayment = orderPayments[0];

    const { data: createAttemptRes, error: insertAuditErr } = await serviceClient.rpc(
      'create_standard_payment_attempt',
      {
        p_order_id: basePayment.order_id,
        p_gateway_order_id: razorpayOrderId,
        p_amount: Number(basePayment.amount),
        p_currency: basePayment.currency,
        p_status: 'failed',
        p_gateway_payment_id: razorpayPaymentId,
        p_failure_reason: failureReason,
        p_gateway_response: parsedBody,
      }
    );

    if (insertAuditErr || !createAttemptRes?.success) {
      structuredError('PAYMENT_FAILED_AUDIT_INSERT_FAILED', {
        error: insertAuditErr?.message || createAttemptRes?.error,
        orderId: basePayment.order_id,
        gatewayPaymentId: razorpayPaymentId,
      });
    } else {
      structuredLog('PAYMENT_FAILED_AUDIT_RECORDED_AFTER_CAPTURE', {
        orderId: basePayment.order_id,
        capturedPaymentId: capturedPayment.payment_id,
        attemptNumber: createAttemptRes.payment?.attempt_number,
        gatewayPaymentId: razorpayPaymentId,
        message: 'Failed attempt recorded for audit; captured payment and order remain intact.',
      });
    }

    return jsonResponse({
      success: true,
      message: 'Payment failure recorded for audit; order remains captured.',
    });
  }

  // The order has not been captured yet.
  // Check if there is an unassigned pending placeholder attempt (created by create-payment-order)
  const pendingPlaceholder = orderPayments.find(
    (p) => p.status === 'pending' && !p.gateway_payment_id
  );

  if (pendingPlaceholder) {
    // Associate this failed attempt with the initial placeholder payment row
    const { error: updatePendingErr } = await serviceClient
      .from('payments')
      .update({
        status: 'failed',
        gateway_payment_id: razorpayPaymentId,
        failure_reason: failureReason,
        gateway_response: parsedBody,
        updated_at: new Date().toISOString(),
      })
      .eq('payment_id', pendingPlaceholder.payment_id)
      .eq('status', 'pending');

    if (updatePendingErr) {
      structuredError('PAYMENT_FAILED_UPDATE_PENDING_ERROR', {
        error: updatePendingErr.message,
        paymentId: pendingPlaceholder.payment_id,
      });
      return jsonResponse({ success: false, error: 'Failed to update payment attempt.' }, 500);
    }

    structuredLog('PAYMENT_FAILED_RECORDED_ON_PLACEHOLDER', {
      paymentId: pendingPlaceholder.payment_id,
      orderId: pendingPlaceholder.order_id,
      attemptNumber: pendingPlaceholder.attempt_number,
      gatewayPaymentId: razorpayPaymentId,
      status: 'failed',
    });

    // NOTE: Order remains status='pending' and fulfillment_status='unfulfilled'
    // so the student can retry. Agreement remains pending_initial_payment (not cancelled).
    return jsonResponse({
      success: true,
      message: 'Payment failure recorded successfully on initial attempt.',
    });
  }

  // All existing attempts already have gateway_payment_ids or are already marked failed.
  // This represents an additional failed attempt on retry! Atomically record via create_standard_payment_attempt
  const basePayment = orderPayments[0];

  const { data: createAttemptRes, error: insertFailedAttemptErr } = await serviceClient.rpc(
    'create_standard_payment_attempt',
    {
      p_order_id: basePayment.order_id,
      p_gateway_order_id: razorpayOrderId,
      p_amount: Number(basePayment.amount),
      p_currency: basePayment.currency,
      p_status: 'failed',
      p_gateway_payment_id: razorpayPaymentId,
      p_failure_reason: failureReason,
      p_gateway_response: parsedBody,
    }
  );

  if (insertFailedAttemptErr || !createAttemptRes?.success) {
    structuredError('PAYMENT_FAILED_INSERT_NEW_ATTEMPT_ERROR', {
      error: insertFailedAttemptErr?.message || createAttemptRes?.error,
      orderId: basePayment.order_id,
      gatewayPaymentId: razorpayPaymentId,
    });
    return jsonResponse({ success: false, error: 'Failed to record subsequent payment failure.' }, 500);
  }

  const newFailedAttempt = createAttemptRes.payment;

  structuredLog('PAYMENT_FAILED_RECORDED_NEW_ATTEMPT', {
    paymentId: newFailedAttempt.payment_id,
    orderId: newFailedAttempt.order_id,
    attemptNumber: newFailedAttempt.attempt_number,
    gatewayPaymentId: razorpayPaymentId,
    status: 'failed',
  });

  return jsonResponse({
    success: true,
    message: 'Subsequent payment failure attempt recorded successfully.',
  });
}

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
  // Step 8: Route supported event types (payment.captured, refund.*, payment.dispute.*)
  // ═════════════════════════════════════════════════════════════════════
  if (payload.event.startsWith('refund.')) {
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
    return await handleRazorpayRefund(serviceClient, payload, meta);
  }

  if (payload.event.startsWith('payment.dispute.')) {
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
    return await handleRazorpayDispute(serviceClient, payload, meta);
  }

  if (payload.event === 'payment.failed') {
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
    return await handleRazorpayPaymentFailed(serviceClient, payload, rawBody, meta);
  }

  if (payload.event !== 'payment.captured') {
    structuredLog('WEBHOOK_SUCCESS', {
      eventType: payload.event,
      message: `Event "${payload.event}" ignored. Only "payment.captured", "payment.failed", "refund.*", and "payment.dispute.*" are processed.`,
    });
    return jsonResponse({
      success: true,
      message: `Event "${payload.event}" ignored.`,
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

  // Authoritative event creation timestamp: In Razorpay, payload.created_at represents the
  // event creation timestamp when Razorpay generated the verified 'payment.captured' event.
  // Distinguish this from paymentEntity.created_at (client checkout attempt initiation) and local
  // webhook processing time (new Date()). If payload.created_at is missing or invalid, do NOT
  // silently fall back to paymentEntity.created_at or local time. Leave paid_at as null so downstream
  // subscription activation fails closed and flags the agreement for administrative reconciliation
  // while preserving the captured payment evidence.
  const eventCreatedAtSec = (typeof payload.created_at === 'number' && payload.created_at > 0)
    ? payload.created_at
    : null;

  const paidAt = eventCreatedAtSec ? new Date(eventCreatedAtSec * 1000).toISOString() : null;

  const gatewayPaymentCreatedAtSec = (typeof razorpayCreatedAt === 'number' && razorpayCreatedAt > 0)
    ? razorpayCreatedAt
    : null;

  // Determine an appropriate attempt creation timestamp that strictly satisfies ck_payments_paid_at
  // (paid_at is null or paid_at >= created_at):
  // 1. Prefer verified gateway payment creation timestamp when valid and <= authoritative paid_at
  // 2. Fall back to authoritative capture timestamp when gateway creation timestamp is unavailable
  // 3. Fall back to local time only when paidAt is null
  let attemptCreatedAt: string;
  if (
    gatewayPaymentCreatedAtSec &&
    (!eventCreatedAtSec || gatewayPaymentCreatedAtSec <= eventCreatedAtSec)
  ) {
    attemptCreatedAt = new Date(gatewayPaymentCreatedAtSec * 1000).toISOString();
  } else if (paidAt) {
    attemptCreatedAt = paidAt;
  } else if (gatewayPaymentCreatedAtSec) {
    attemptCreatedAt = new Date(gatewayPaymentCreatedAtSec * 1000).toISOString();
  } else {
    attemptCreatedAt = new Date().toISOString();
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 11: Find the local payment record using gateway_order_id
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('PAYMENT_LOOKUP_STARTED', {
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  // 1. Look up exact payment attempt by gateway_payment_id
  let { data: localPayment, error: paymentFindError } = await serviceClient
    .from('payments')
    .select('payment_id, order_id, institute_id, amount, currency, status, gateway_order_id, gateway_payment_id, attempt_number, created_at')
    .eq('gateway', 'razorpay')
    .eq('gateway_payment_id', razorpayPaymentId)
    .maybeSingle();

  // 2. If not matched by gateway_payment_id, inspect all attempts for this gateway_order_id
  if (!localPayment && !paymentFindError) {
    const { data: existingAttempts, error: attemptsError } = await serviceClient
      .from('payments')
      .select('payment_id, order_id, institute_id, amount, currency, status, gateway_order_id, gateway_payment_id, attempt_number, created_at')
      .eq('gateway', 'razorpay')
      .eq('gateway_order_id', razorpayOrderId)
      .order('attempt_number', { ascending: false });

    if (attemptsError) {
      paymentFindError = attemptsError;
    } else if (existingAttempts && existingAttempts.length > 0) {
      // Prioritize an already captured attempt (for idempotency and grant verification)
      const capturedAttempt = existingAttempts.find((p) => p.status === 'captured');
      // Prioritize an unassigned pending placeholder created during checkout initialization
      const pendingPlaceholder = existingAttempts.find(
        (p) => p.status === 'pending' && !p.gateway_payment_id
      );

      if (capturedAttempt) {
        localPayment = capturedAttempt;
      } else if (pendingPlaceholder) {
        localPayment = pendingPlaceholder;
      } else {
        // All existing attempts were failed (e.g. earlier failed attempts).
        // This is a successful retry! Atomically create a new payment attempt row under the shared advisory lock
        const baseAttempt = existingAttempts[0];

        const { data: createAttemptRes, error: insertAttemptError } = await serviceClient.rpc(
          'create_standard_payment_attempt',
          {
            p_order_id: baseAttempt.order_id,
            p_gateway_order_id: razorpayOrderId,
            p_amount: Number(baseAttempt.amount),
            p_currency: baseAttempt.currency,
            p_status: 'pending',
            p_gateway_payment_id: razorpayPaymentId,
            p_created_at: attemptCreatedAt,
          }
        );

        if (insertAttemptError || !createAttemptRes?.success) {
          const errorMsg = insertAttemptError?.message || createAttemptRes?.error || 'Failed to create payment attempt';
          structuredError('PAYMENT_ATTEMPT_INSERT_FAILED', {
            error: errorMsg,
            code: createAttemptRes?.code,
            orderId: baseAttempt.order_id,
            gatewayOrderId: razorpayOrderId,
            gatewayPaymentId: razorpayPaymentId,
          });
          paymentFindError = insertAttemptError || new Error(errorMsg);
        } else {
          localPayment = createAttemptRes.payment;
          structuredLog('NEW_PAYMENT_ATTEMPT_CREATED_FOR_CAPTURE', {
            orderId: baseAttempt.order_id,
            attemptNumber: createAttemptRes.payment?.attempt_number,
            localPaymentId: createAttemptRes.payment?.payment_id,
            gatewayPaymentId: razorpayPaymentId,
          });
        }
      }
    }
  }

  // Bounded Gateway Recovery via Deterministic Receipt (Requirement 4)
  if (!localPayment && razorpayOrderId && RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    structuredLog('RECONCILING_MISSING_GATEWAY_ORDER_BY_RECEIPT', {
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
    });

    try {
      const razorpay = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
      });

      const rzpOrder = await razorpay.orders.fetch(razorpayOrderId);
      const rzpReceipt = rzpOrder?.receipt;

      if (rzpReceipt && rzpReceipt.startsWith('rcpt_')) {
        const cleanId = rzpReceipt.slice(5);
        if (cleanId.length === 32) {
          const candidateUuid = `${cleanId.slice(0, 8)}-${cleanId.slice(8, 12)}-${cleanId.slice(12, 16)}-${cleanId.slice(16, 20)}-${cleanId.slice(20, 32)}`;

          // 1. Database-level atomic advisory-locked gateway order reconciliation RPC
          const { data: recResult, error: recError } = await serviceClient.rpc(
            'reconcile_razorpay_gateway_order',
            {
              p_payment_id: candidateUuid,
              p_gateway_order_id: razorpayOrderId,
              p_expected_amount: Number(rzpOrder.amount) / 100,
              p_expected_currency: (rzpOrder.currency || 'INR').toUpperCase(),
              p_event_type: 'payment.captured',
            }
          );

          if (!recError && recResult?.success) {
            if (recResult.action === 'already_captured') {
              structuredLog('RECEIPT_RECONCILIATION_CAPTURE_ALREADY_CAPTURED', {
                candidatePaymentId: candidateUuid,
                gatewayOrderId: razorpayOrderId,
              });
            } else {
              structuredLog('RECEIPT_RECONCILIATION_VERIFIED_BY_PAYMENT_ID', {
                candidatePaymentId: candidateUuid,
                gatewayOrderId: razorpayOrderId,
                receipt: rzpReceipt,
                action: recResult.action,
              });
            }

            if (recResult.payment) {
              localPayment = recResult.payment;
            }
          } else if (recResult && !recResult.success && recResult.code !== 'PAYMENT_NOT_FOUND') {
            structuredError('RECEIPT_RECONCILIATION_CAPTURE_RPC_REJECTED', {
              candidatePaymentId: candidateUuid,
              gatewayOrderId: razorpayOrderId,
              code: recResult.code,
              error: recResult.error,
            });

            if (recResult.code === 'GATEWAY_ORDER_ALREADY_ASSOCIATED') {
              return jsonResponse({
                success: true,
                message: 'Gateway order ID is already associated with another payment attempt.',
              });
            }
          }

          // 2. Fallback: candidateUuid is legacy candidateOrderId
          if (!localPayment && (!recResult || recResult.code === 'PAYMENT_NOT_FOUND')) {
            const { data: conflictRow } = await serviceClient
              .from('payments')
              .select('payment_id, order_id')
              .eq('gateway_order_id', razorpayOrderId)
              .eq('gateway', 'razorpay')
              .maybeSingle();

            if (!conflictRow || conflictRow.order_id === candidateUuid) {
              const { data: candOrder } = await serviceClient
                .from('orders')
                .select('order_id, profile_id, total_amount, currency, notes')
                .eq('order_id', candidateUuid)
                .maybeSingle();

              if (candOrder) {
                const expectedAmt = Number(candOrder.total_amount);
                const actualAmt = Number(rzpOrder.amount) / 100;
                const isAmountMatch = Math.abs(expectedAmt - actualAmt) <= 0.01;
                const isCurrencyMatch = (candOrder.currency || 'INR').toUpperCase() === (rzpOrder.currency || 'INR').toUpperCase();
                const isCustomerMatch = !rzpOrder.notes?.profile_id || rzpOrder.notes.profile_id === candOrder.profile_id;

                if (isAmountMatch && isCurrencyMatch && isCustomerMatch) {
                  structuredLog('RECEIPT_RECONCILIATION_VERIFIED_BY_ORDER_ID', {
                    candidateOrderId: candidateUuid,
                    gatewayOrderId: razorpayOrderId,
                    receipt: rzpReceipt,
                  });

                  // Route order-level receipt reconciliation through reconcile_standard_order_gateway_order
                  const { data: candPmt } = await serviceClient
                    .from('payments')
                    .select('payment_id, amount, currency')
                    .eq('order_id', candidateUuid)
                    .eq('gateway', 'razorpay')
                    .eq('status', 'pending')
                    .is('gateway_order_id', null)
                    .order('attempt_number', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  if (candPmt?.payment_id) {
                    const { data: recResult, error: recError } = await serviceClient.rpc(
                      'reconcile_standard_order_gateway_order',
                      {
                        p_order_id: candidateUuid,
                        p_payment_id: candPmt.payment_id,
                        p_gateway_order_id: razorpayOrderId,
                        p_expected_amount: Number(rzpOrder.amount) / 100,
                        p_expected_currency: (rzpOrder.currency || 'INR').toUpperCase(),
                        p_event_type: 'payment.captured',
                      }
                    );

                    if (!recError && recResult?.success && recResult?.payment) {
                      localPayment = recResult.payment;

                      try {
                        const ordNotes = JSON.parse(candOrder.notes || '{}');
                        ordNotes.razorpayOrderId = razorpayOrderId;
                        await serviceClient
                          .from('orders')
                          .update({ notes: JSON.stringify(ordNotes) })
                          .eq('order_id', candidateUuid);
                      } catch (_nErr) {}
                    }
                  } else {
                    // No unassigned pending payment row: create the attempt directly via create_standard_payment_attempt
                    const { data: attemptRes, error: attemptErr } = await serviceClient.rpc(
                      'create_standard_payment_attempt',
                      {
                        p_order_id: candidateUuid,
                        p_gateway_order_id: razorpayOrderId,
                        p_amount: Number(rzpOrder.amount) / 100,
                        p_currency: (rzpOrder.currency || 'INR').toUpperCase(),
                        p_status: 'pending',
                        p_gateway_payment_id: razorpayPaymentId,
                        p_created_at: attemptCreatedAt,
                      }
                    );

                    if (!attemptErr && attemptRes?.success && attemptRes?.payment) {
                      localPayment = attemptRes.payment;
                      try {
                        const ordNotes = JSON.parse(candOrder.notes || '{}');
                        ordNotes.razorpayOrderId = razorpayOrderId;
                        await serviceClient
                          .from('orders')
                          .update({ notes: JSON.stringify(ordNotes) })
                          .eq('order_id', candidateUuid);
                      } catch (_nErr) {}
                    }
                  }
                } else {
                  structuredError('RECEIPT_RECONCILIATION_VERIFICATION_FAILED', {
                    candidateOrderId: candidateUuid,
                    isAmountMatch,
                    isCurrencyMatch,
                    isCustomerMatch,
                  });
                }
              }
            }
          }
        }
      }
    } catch (recErr) {
      structuredError('RECEIPT_RECONCILIATION_EXCEPTION', {
        error: recErr instanceof Error ? recErr.message : String(recErr),
      });
    }
  }

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
    localPayment.status === 'captured'
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

    const isInstallmentOrder = orderItems[0]?.item_type === 'installment';

    // Heal a pending order (partial failure: payment captured, order not
    // yet confirmed). Idempotent — only touches status='pending'.
    // Installment orders remain pending until installment fulfillment succeeds (Step 17).
    if (order.status === 'pending' && !isInstallmentOrder) {
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

    const grantExists = await grantExistsForOrder(serviceClient, order, orderItems, localPayment.payment_id);

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
  const paymentUpdateFields: Record<string, unknown> = {
    status: 'captured',
    gateway_payment_id: razorpayPaymentId,
    gateway_response: JSON.parse(rawBody), // Store raw webhook for audit
    paid_at: paidAt,
  };

  // Repair handling for retry records: if this pending payment record was created with a created_at
  // timestamp later than paidAt (specifically the webhook-created attempt placeholder e55a37a5-... whose created_at
  // defaulted to now() upon insertion), safely correct created_at to attemptCreatedAt before applying captured status.
  if (
    paidAt &&
    localPayment.status === 'pending' &&
    localPayment.gateway_payment_id === razorpayPaymentId &&
    localPayment.created_at &&
    new Date(localPayment.created_at) > new Date(paidAt)
  ) {
    paymentUpdateFields.created_at = attemptCreatedAt;
    structuredLog('REPAIRING_EXISTING_RETRY_RECORD_CREATED_AT', {
      localPaymentId: localPayment.payment_id,
      gatewayPaymentId: razorpayPaymentId,
      originalCreatedAt: localPayment.created_at,
      repairedCreatedAt: attemptCreatedAt,
      paidAt,
    });
  }

  let updatedPaymentRows: any[] | null = null;
  let paymentUpdateError: any = null;

  const orderId = localPayment.order_id;

  if (!orderId) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'order_missing',
      message: 'Payment record is missing associated order_id',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      localPaymentId: localPayment.payment_id,
      httpStatus: 500,
    });
    return jsonResponse({
      success: false,
      error: 'Unable to classify payment: order_id is missing.',
    }, 500);
  }

  // Load order items to determine if this is an installment purchase
  const { data: checkItems, error: checkItemsError } = await serviceClient
    .from('order_items')
    .select('item_type')
    .eq('order_id', orderId)
    .limit(1);

  if (checkItemsError || !checkItems || checkItems.length === 0) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'order_items_classification_failed',
      message: checkItemsError?.message ?? 'No order items found for classification',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 500,
    });
    return jsonResponse({
      success: false,
      error: 'Unable to classify product type for captured payment.',
    }, 500);
  }

  const isInstallmentOrder = checkItems[0].item_type === 'installment';

  // Standard Non-Installment Checkout Synchronization:
  // Route standard orders through reconcile_standard_paid_order under transaction-scoped advisory lock
  // and orders-before-payments lock hierarchy. Guarantees 100% lock symmetry and atomic idempotency
  // with checkout recovery. Strictly preserves installment-specific workflows in the else branch.
  if (!isInstallmentOrder && localPayment?.order_id && razorpayOrderId) {
    const { data: recData, error: recError } = await serviceClient.rpc(
      'reconcile_standard_paid_order',
      {
        p_order_id: localPayment.order_id,
        p_gateway_order_id: razorpayOrderId,
        p_gateway_payment_id: razorpayPaymentId,
        p_payment_status: 'captured',
        p_amount: expectedAmountInRupees,
        p_currency: localPayment.currency,
        p_paid_at: paidAt,
        p_gateway_response: JSON.parse(rawBody),
      }
    );

    if (recError || !recData?.success) {
      paymentUpdateError = recError || new Error(recData?.error || 'Failed to reconcile standard payment attempt');
      structuredError('STANDARD_CHECKOUT_WEBHOOK_RECONCILE_FAILED', {
        ...meta,
        error: paymentUpdateError.message,
        code: recData?.code,
        orderId: localPayment.order_id,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
      });
    } else {
      localPayment = recData.payment;
      updatedPaymentRows = [recData.payment];
      structuredLog('STANDARD_CHECKOUT_WEBHOOK_RECONCILE_SUCCESS', {
        orderId: localPayment.order_id,
        paymentId: localPayment.payment_id,
        action: recData.action,
        code: recData.code,
      });
    }
  } else {
    // Installment Orders / Fallback: Conditional update allowing capture transition from pending, failed, or captured
    // Strictly prevents overwriting terminal refund states (refunded, partially_refunded)
    const res = await serviceClient
      .from('payments')
      .update(paymentUpdateFields)
      .eq('payment_id', localPayment.payment_id)
      .in('status', ['pending', 'failed', 'captured'])
      .select('payment_id, status, gateway_order_id, amount, currency');

    updatedPaymentRows = res.data;
    paymentUpdateError = res.error;
  }

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

  // If zero rows updated, re-read payment state to safely handle refunded/partially_refunded states
  if (!updatedPaymentRows || updatedPaymentRows.length === 0) {
    const { data: freshPayment } = await serviceClient
      .from('payments')
      .select('payment_id, status, refund_amount, gateway_order_id')
      .eq('payment_id', localPayment.payment_id)
      .maybeSingle();

    structuredLog('PAYMENT_CAPTURE_IGNORED_TERMINAL_STATE', {
      localPaymentId: localPayment.payment_id,
      actualStatus: freshPayment?.status,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
    });

    if (freshPayment?.status === 'refunded' || freshPayment?.status === 'partially_refunded') {
      return jsonResponse({
        success: true,
        message: `Payment is already ${freshPayment.status}. Capture event ignored to prevent settlement regression.`,
      });
    }

    return jsonResponse({
      success: true,
      message: `Payment update condition not met (current status: ${freshPayment?.status ?? 'unknown'}). Event acknowledged.`,
    });
  }

  structuredLog('PAYMENT_UPDATED', {
    localPaymentId: localPayment.payment_id,
    gatewayPaymentId: razorpayPaymentId,
    status: 'captured',
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 15: Check product item_type & update order record
  // ═════════════════════════════════════════════════════════════════════
  const confirmedAt = new Date().toISOString();

  if (!isInstallmentOrder) {
    // Legacy flow: confirm pending order prior to onboarding
    const { error: orderUpdateError } = await serviceClient
      .from('orders')
      .update({
        status: 'confirmed',
        confirmed_at: confirmedAt,
      })
      .eq('order_id', orderId)
      .eq('status', 'pending');

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
      return jsonResponse({
        success: false,
        error: 'Unable to confirm the order.',
      }, 500);
    }
    structuredLog('ORDER_UPDATED', {
      orderId,
      status: 'confirmed',
    });
  } else {
    structuredLog('INSTALLMENT_ORDER_DECOUPLED_PENDING_FULFILLMENT', {
      orderId,
      message: 'Payment captured. Order status held pending fulfillment completion.',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 16: Invoke product-specific onboarding based on item_type
  // ═════════════════════════════════════════════════════════════════════
  const onboardingResult = await invokeOnboarding(
    serviceClient,
    orderId,
    razorpayPaymentId,
    razorpayOrderId,
    meta,
    localPayment.payment_id,
  );

  // ═════════════════════════════════════════════════════════════════════
  // Step 17: Return based on onboarding outcome (Decoupled Fulfillment)
  // ═════════════════════════════════════════════════════════════════════
  if (isInstallmentOrder) {
    if (onboardingResult.success) {
      // Fulfillment succeeded: Mark fulfillment complete & confirm order (clearing cancelled_at if previously cancelled)
      await serviceClient
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_at: confirmedAt,
          cancelled_at: null,
          fulfillment_status: 'fulfilled',
        })
        .eq('order_id', orderId);

      structuredLog('INSTALLMENT_FULFILLMENT_SUCCESS', {
        orderId,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
      });

      return jsonResponse({
        success: true,
        message: 'Installment payment captured and agreement fulfilled successfully.',
      });
    }

    if (onboardingResult.requiresReview) {
      // Business conflict requiring manual administrator review:
      // Captured payment is preserved; fulfillment marked requires_review.
      const reasonText = (onboardingResult.reviewReason || 'BUSINESS_CONFLICT') +
        (onboardingResult.reviewDetails ? (`: ${onboardingResult.reviewDetails}`) : '');

      await serviceClient
        .from('orders')
        .update({
          fulfillment_status: 'requires_review',
          admin_review_reason: reasonText,
        })
        .eq('order_id', orderId);

      structuredLog('INSTALLMENT_FULFILLMENT_REQUIRES_REVIEW_RECORDED', {
        orderId,
        reason: reasonText,
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
      });

      // HTTP 200 acknowledged to gateway — conflict is durably recorded for admin review queue
      return jsonResponse({
        success: true,
        message: 'Payment captured. Fulfillment queued for administrative review.',
      });
    }

    // Transient failure: mark failed/unfulfilled and return HTTP 500 for gateway retry
    await serviceClient
      .from('orders')
      .update({
        fulfillment_status: 'failed',
      })
      .eq('order_id', orderId);

    structuredError('INSTALLMENT_FULFILLMENT_TRANSIENT_FAILURE', {
      ...meta,
      orderId,
      message: onboardingResult.message,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      httpStatus: 500,
    });

    return jsonResponse({
      success: false,
      error: 'Installment fulfillment failed due to temporary error. Will retry.',
    }, 500);
  }

  // Legacy (course, pyq_package, subscription_plan)
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
