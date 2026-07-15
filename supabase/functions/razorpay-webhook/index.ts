// ============================================================================
// Edge Function: razorpay-webhook
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Production-grade Razorpay webhook handler for course purchase payments.
// This is the ONLY trusted source that marks a payment as successful and
// grants course access. The mobile app must never grant access directly.
//
// Architecture:
//   Student
//     ↓
//   Buy Course
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
//   complete-course-purchase    ← Create student_details + course_enrollment
//     ↓
//   Student Enrolled
//
// Security:
//   • No Supabase authentication required — verified via Razorpay webhook secret
//   • Rejects every request with an invalid signature before any processing
//   • Never trusts amount, courseId, or profileId from the webhook payload
//   • Only trusts: Razorpay signature, existing local order, existing DB records
//   • SQL errors, secrets, and stack traces are NEVER exposed to the caller
//
// Idempotency:
//   • Checks for existing captured payment before any mutation
//   • Duplicate webhooks return HTTP 200 immediately
//
// @module edge-functions/razorpay-webhook
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

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
 * Invoke the complete-course-purchase Edge Function to trigger student
 * onboarding. This helper:
 *   1. Loads the order to extract profileId and guardian notes
 *   2. Loads order_items to extract courseId
 *   3. Parses guardian info from order.notes
 *   4. Calls complete-course-purchase with internal=true flag
 *   5. Returns the result
 *
 * @returns OnboardingResult — always succeeds logically; errors are logged
 *          and returned as non-critical messages (never thrown).
 */
async function invokeOnboarding(
  serviceClient: ReturnType<typeof createClient>,
  orderId: string,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  meta?: Record<string, unknown>,
): Promise<OnboardingResult> {
  // ── Load the order ──────────────────────────────────────────────────
  const { data: order, error: orderLoadError } = await serviceClient
    .from('orders')
    .select('order_id, profile_id, student_id, institute_id, notes')
    .eq('order_id', orderId)
    .single();

  if (orderLoadError || !order) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'order_load',
      message: orderLoadError?.message ?? 'Order not found',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 200,
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
      httpStatus: 200,
    });
    return { success: false, message: 'Profile ID not found on order.' };
  }

  // ── Load order_items to get courseId ────────────────────────────────
  const { data: orderItems, error: itemsLoadError } = await serviceClient
    .from('order_items')
    .select('item_id, course_id')
    .eq('order_id', orderId)
    .eq('item_type', 'course');

  if (itemsLoadError || !orderItems || orderItems.length === 0) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'order_items_load',
      message: itemsLoadError?.message ?? 'No course items found for order',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      orderId,
      httpStatus: 200,
    });
    return { success: false, message: 'Course item not found for onboarding.' };
  }

  const courseId = orderItems[0].course_id!;

  structuredLog('ORDER_ITEM_FOUND', {
    orderId,
    courseId,
    itemCount: orderItems.length,
    gatewayOrderId: razorpayOrderId,
    gatewayPaymentId: razorpayPaymentId,
  });

  // ── Parse guardian info from order.notes ────────────────────────────
  let guardianName: string | null = null;
  let guardianMobile: string | null = null;
  let guardianEmail: string | null = null;
  let targetYear: string | null = null;
  let dateOfBirth: string | null = null;

  if (order.notes) {
    try {
      const notes = typeof order.notes === 'string'
        ? JSON.parse(order.notes)
        : order.notes;
      guardianName = notes.guardianName ?? null;
      guardianMobile = notes.guardianMobile ?? null;
      guardianEmail = notes.guardianEmail ?? null;
      targetYear = notes.targetYear ?? null;
      dateOfBirth = notes.dob ?? null;
    } catch {
      structuredLog('NOTES_PARSE', {
        message: 'Failed to parse order.notes JSON — guardian fields defaulted to null',
        orderId,
      });
    }
  }

  // ── Invoke complete-course-purchase ─────────────────────────────────
  structuredLog('CALLING_COMPLETE_COURSE_PURCHASE', {
    orderId,
    courseId,
    profileId,
    hasGuardianName: !!guardianName,
    hasGuardianMobile: !!guardianMobile,
    hasGuardianEmail: !!guardianEmail,
    hasTargetYear: !!targetYear,
    hasDob: !!dateOfBirth,
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
        guardianName,
        guardianMobile,
        guardianEmail,
        targetYear,
        dob: dateOfBirth,
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
      return { success: true, message: 'Onboarding completed successfully.' };
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
      message: `Onboarding returned: ${result.error as string ?? 'unknown error'}`,
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
  // Step 12: Idempotency check
  // ═════════════════════════════════════════════════════════════════════
  if (localPayment.status === 'captured') {
    structuredLog('WEBHOOK_SUCCESS', {
      eventType: 'duplicate_webhook',
      message: 'Payment already processed. Duplicate webhook ignored.',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      localPaymentId: localPayment.payment_id,
    });
    return jsonResponse({
      success: true,
      message: 'Payment already processed. Duplicate webhook ignored.',
    });
  }

  if (localPayment.gateway_payment_id === razorpayPaymentId) {
    structuredLog('WEBHOOK_SUCCESS', {
      eventType: 'duplicate_webhook',
      message: 'Payment already processed (gateway_payment_id match). Duplicate webhook ignored.',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      localPaymentId: localPayment.payment_id,
    });
    return jsonResponse({
      success: true,
      message: 'Payment already processed (gateway_payment_id match). Duplicate webhook ignored.',
    });
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
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'payment_update',
      message: paymentUpdateError.message,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      localPaymentId: localPayment.payment_id,
      httpStatus: 200,
    });
  } else {
    structuredLog('PAYMENT_UPDATED', {
      localPaymentId: localPayment.payment_id,
      gatewayPaymentId: razorpayPaymentId,
      status: 'captured',
    });
  }

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
    .eq('order_id', orderId);

  if (orderUpdateError) {
    structuredError('WEBHOOK_ERROR', {
      ...meta,
      eventType: 'order_update',
      message: orderUpdateError.message,
      gatewayOrderId: razorpayOrderId,
      localPaymentId: localPayment.payment_id,
      orderId,
      httpStatus: 200,
    });
  } else {
    structuredLog('ORDER_UPDATED', {
      orderId,
      status: 'confirmed',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 16: Invoke complete-course-purchase for student onboarding
  // ═════════════════════════════════════════════════════════════════════
  // Delegates ALL onboarding logic to invokeOnboarding which handles
  // CALLING_COMPLETE_COURSE_PURCHASE, COMPLETE_COURSE_PURCHASE_RESPONSE,
  // and error logging internally.
  const onboardingResult = await invokeOnboarding(
    serviceClient,
    orderId,
    razorpayPaymentId,
    razorpayOrderId,
    meta,
  );

  if (onboardingResult.success) {
    structuredLog('ENROLLMENT_CREATED', {
      orderId,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 17: Return success
  // ═════════════════════════════════════════════════════════════════════
  // Always return 200 — the payment was captured. Any onboarding issues
  // are logged and can be handled via the admin panel. Never expose
  // internal errors to Razorpay.
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
});
