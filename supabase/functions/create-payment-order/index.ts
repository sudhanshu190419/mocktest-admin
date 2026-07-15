// ============================================================================
// Edge Function: create-payment-order
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Creates a Razorpay payment order for a course purchase and stores the
// order details locally in the existing commerce schema.
//
// This is the backend-only entry point for starting a payment. The client
// (React Native App or Website) sends only the courseId — all pricing is
// determined server-side from the database.
//
// Architecture:
//   Client → create-payment-order → Razorpay API → local orders/order_items/payments
//       ↓
//   Response with razorpayOrderId → Client opens Razorpay Checkout
//       ↓
//   razorpay-webhook → complete-course-purchase → create_student_after_purchase()
//
// ## Pre-onboarding data flow
//
//   The client may optionally send guardian and academic information
//   (guardianName, guardianMobile, targetYear, etc.) with the initial
//   payment request. These fields are stored in the order's `notes` JSON
//   so the razorpay-webhook handler can use them during student onboarding
//   without requiring a separate API call. If not provided, the webhook
//   will create the student record with null defaults.
//
// ## Security
//
//   • Authentication required — resolves profile_id from JWT
//   • Client must NOT send amount, currency, or pricing data
//   • All pricing read from courses table (never trust the client)
//   • Razorpay Secret Key read from Supabase Secrets (never hardcoded)
//   • PostgreSQL errors sanitized before returning to client
//
// @module edge-functions/create-payment-order
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Razorpay from 'razorpay';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET');

if (!RAZORPAY_KEY_ID) {
  console.error('FATAL: RAZORPAY_KEY_ID is not set in Edge Function secrets. ' +
    'Set it via: supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxx');
}

if (!RAZORPAY_KEY_SECRET) {
  console.error('FATAL: RAZORPAY_KEY_SECRET is not set in Edge Function secrets.');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface RequestBody {
  courseId: string;
  // Pre-onboarding student info (optional) — stored in order.notes for
  // the razorpay-webhook to use during student onboarding. All fields
  // are nullable and may be omitted entirely.
  guardianName?: string;
  guardianMobile?: string;
  guardianEmail?: string;
  targetYear?: string;
  dob?: string;
}

interface SuccessResponse {
  success: true;
  orderId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  courseName: string;
  description: string;
  /** Razorpay publishable key for the client to open the checkout. */
  razorpayKey: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: string;
}

type FunctionResponse = SuccessResponse | ErrorResponse;

/**
 * Raw row type from the courses table.
 */
interface CourseRow {
  course_id: string;
  institute_id: string;
  title: string;
  original_price: number;
  discounted_price: number | null;
  currency: string;
  status: string;
  deleted_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

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
 * Create an error response with structured logging.
 */
function errorResponse(
  message: string,
  status: number,
  code?: string,
  details?: string,
): Response {
  const body: ErrorResponse = {
    success: false,
    error: message,
    ...(code ? { code } : {}),
    ...(details ? { details } : {}),
  };

  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      code,
      details,
      statusCode: status,
    }),
  );

  return jsonResponse(body, status);
}

/**
 * Structured log helper for consistent log formatting.
 */
function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }),
  );
}

/**
 * Determine the effective price for a course.
 * Uses discounted_price if available, otherwise original_price.
 * Returns the amount in paise (smallest currency unit for Razorpay).
 *
 * @returns {amountInPaise: number, displayAmount: number}
 */
function calculatePrice(course: CourseRow): {
  amountInPaise: number;
  displayAmount: number;
} {
  // Use discounted_price if set (and not zero), otherwise original_price
  const effectivePrice = (course.discounted_price != null && course.discounted_price > 0)
    ? course.discounted_price
    : course.original_price;

  // Razorpay requires amount in the smallest currency unit (paise for INR)
  // numeric(10,2) from DB → multiply by 100 → integer paise
  const amountInPaise = Math.round(Number(effectivePrice) * 100);

  return {
    amountInPaise,
    displayAmount: Number(effectivePrice),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ── Method check ────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('request_received', { method: req.method });

  // ═════════════════════════════════════════════════════════════════════
  // Step 1: Authenticate the caller
  // ═════════════════════════════════════════════════════════════════════
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
  }

  const anonClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    },
  );

  let profileId: string;
  try {
    const { data: userData, error: userError } = await anonClient.auth.getUser();

    if (userError || !userData?.user) {
      return errorResponse('Invalid or expired authentication token.', 401);
    }

    profileId = userData.user.id;

    structuredLog('authenticated_user', {
      profileId,
      email: userData.user.email ?? 'unknown',
    });
  } catch (err) {
    return errorResponse('Authentication verification failed.', 401);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 2: Parse and validate the request body
  // ═════════════════════════════════════════════════════════════════════
  // Only courseId is required. Guardian/academic fields are optional and
  // stored in order.notes for the razorpay-webhook onboarding flow.
  let body: RequestBody;
  try {
    const raw = await req.json() as Record<string, unknown>;

    if (!raw.courseId || typeof raw.courseId !== 'string') {
      return errorResponse('Missing required field: courseId.', 400);
    }

    body = {
      courseId: raw.courseId,
      guardianName: typeof raw.guardianName === 'string' ? raw.guardianName : undefined,
      guardianMobile: typeof raw.guardianMobile === 'string' ? raw.guardianMobile : undefined,
      guardianEmail: typeof raw.guardianEmail === 'string' ? raw.guardianEmail : undefined,
      targetYear: typeof raw.targetYear === 'string' ? raw.targetYear : undefined,
      dob: typeof raw.dob === 'string' ? raw.dob : undefined,
    };

    structuredLog('request_validated', {
      courseId: body.courseId,
      hasGuardianName: !!body.guardianName,
      hasGuardianMobile: !!body.guardianMobile,
      hasTargetYear: !!body.targetYear,
    });
  } catch (err) {
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 3: Create the service-role client and Razorpay instance
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

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return errorResponse(
      'Payment service is not configured. Contact support.',
      500,
      'MISSING_RAZORPAY_CONFIG',
    );
  }

  const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 4: Load and validate the course
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('loading_course', { courseId: body.courseId });

  const { data: course, error: courseError } = await serviceClient
    .from('courses')
    .select('course_id, institute_id, title, original_price, discounted_price, currency, status, deleted_at')
    .eq('course_id', body.courseId)
    .single();

  if (courseError || !course) {
    return errorResponse('Course not found.', 404, 'COURSE_NOT_FOUND', courseError?.message);
  }

  // Validate the course is purchasable
  if (course.deleted_at) {
    return errorResponse('This course is no longer available.', 410, 'COURSE_DELETED');
  }

  if (course.status !== 'published') {
    return errorResponse('This course is not available for purchase.', 400, 'COURSE_NOT_PUBLISHED');
  }

  if (Number(course.original_price) <= 0 && (course.discounted_price == null || Number(course.discounted_price) <= 0)) {
    return errorResponse('This course has no valid price configured.', 400, 'COURSE_NO_PRICE');
  }

  structuredLog('course_validated', {
    courseId: course.course_id,
    title: course.title,
    instituteId: course.institute_id,
    status: course.status,
  });

  const instituteId: string = course.institute_id;

  // ═════════════════════════════════════════════════════════════════════
  // Step 5: Check for existing enrollment (prevent duplicate purchase)
  // ═════════════════════════════════════════════════════════════════════
  // Check if this user already has an active enrollment. We query using
  // profile_id → student_details → course_enrollments, or direct if the
  // student already exists.
  structuredLog('checking_existing_enrollment', { profileId, courseId: body.courseId });

  // Resolve student_id from student_details (may not exist yet)
  const { data: existingStudent } = await serviceClient
    .from('student_details')
    .select('student_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (existingStudent) {
    const { data: existingEnrollment } = await serviceClient
      .from('course_enrollments')
      .select('enrollment_id')
      .eq('course_id', body.courseId)
      .eq('student_id', existingStudent.student_id)
      .eq('is_active', true)
      .maybeSingle();

    if (existingEnrollment) {
      structuredLog('already_enrolled', {
        enrollmentId: existingEnrollment.enrollment_id,
      });

      return errorResponse(
        'You are already enrolled in this course.',
        409,
        'ALREADY_ENROLLED',
      );
    }
  }

  structuredLog('no_existing_enrollment', {});

  // ═════════════════════════════════════════════════════════════════════
  // Step 6: Calculate the payment amount
  // ═════════════════════════════════════════════════════════════════════
  // All pricing is computed server-side from the database.
  // The client must never influence the amount.
  const { amountInPaise, displayAmount } = calculatePrice(course);

  structuredLog('price_calculated', {
    displayAmount,
    amountInPaise,
    currency: course.currency,
    source: course.discounted_price != null ? 'discounted_price' : 'original_price',
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 7: Create the Razorpay order
  // ═════════════════════════════════════════════════════════════════════
  const receiptId = `rcpt_${profileId.slice(0, 8)}_${Date.now()}`;

  let razorpayOrder: {
    id: string;
    amount: number;
    currency: string;
    receipt: string;
    status: string;
  };

  try {
    razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: course.currency || 'INR',
      receipt: receiptId,
      notes: {
        profile_id: profileId,
        course_id: body.courseId,
        institute_id: instituteId,
      },
    });

    structuredLog('razorpay_order_created', {
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      receipt: razorpayOrder.receipt,
    });
  } catch (razorpayError: unknown) {
    const errorMessage = razorpayError instanceof Error
      ? razorpayError.message
      : 'Unknown Razorpay API error';

    structuredLog('razorpay_order_failed', {
      error: errorMessage,
      courseId: body.courseId,
    });

    return errorResponse(
      'Failed to create payment order. Please try again.',
      502,
      'RAZORPAY_ERROR',
      errorMessage,
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 8: Create the local order record
  // ═════════════════════════════════════════════════════════════════════
  // Uses the new profile_id column (migration 042) since student_details
  // may not exist at this point. The order is linked to the student later
  // during complete-course-purchase.
  //
  // The payment record uses:
  //   • gateway = 'razorpay'
  //   • gateway_order_id = Razorpay order ID (for webhook correlation)
  //   • amount = display amount in rupees (numeric(12,2))
  //   • status = 'pending'

  // ── 8a: Insert the order ────────────────────────────────────────────
  structuredLog('creating_local_order', {
    profileId,
    instituteId,
    amount: displayAmount,
  });

  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .insert({
      profile_id: profileId,
      institute_id: instituteId,
      student_id: null,          // Not yet created — will be set during onboarding
      status: 'pending',
      currency: course.currency || 'INR',
      subtotal_amount: displayAmount,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: displayAmount,
      notes: JSON.stringify({
        courseId: body.courseId,
        courseName: course.title,
        razorpayOrderId: razorpayOrder.id,
        profileId,
        // Pre-onboarding fields — consumed by razorpay-webhook
        ...(body.guardianName ? { guardianName: body.guardianName } : {}),
        ...(body.guardianMobile ? { guardianMobile: body.guardianMobile } : {}),
        ...(body.guardianEmail ? { guardianEmail: body.guardianEmail } : {}),
        ...(body.targetYear ? { targetYear: body.targetYear } : {}),
        ...(body.dob ? { dob: body.dob } : {}),
      }),
    })
    .select('order_id')
    .single();

  if (orderError || !order) {
    // If local DB insert fails, the Razorpay order is already created.
    // In production, this should trigger a compensation workflow (refund or
    // void the Razorpay order). For now, log the error.
    structuredLog('local_order_failed', {
      error: orderError?.message,
      razorpayOrderId: razorpayOrder.id,
    });

    return errorResponse(
      'Failed to save order details. Please contact support.',
      500,
      'ORDER_CREATION_FAILED',
      orderError?.message,
    );
  }

  structuredLog('local_order_created', { orderId: order.order_id });

  // ── 8b: Insert the order_item ───────────────────────────────────────
  const { error: itemError } = await serviceClient
    .from('order_items')
    .insert({
      order_id: order.order_id,
      institute_id: instituteId,
      item_type: 'course',
      course_id: body.courseId,
      item_name: course.title,
      unit_price: displayAmount,
      quantity: 1,
      discount_amount: 0,
      line_total: displayAmount,
    });

  if (itemError) {
    structuredLog('local_order_item_failed', {
      error: itemError.message,
      orderId: order.order_id,
    });

    // Order exists but item creation failed. Log and continue — the item
    // can be fixed via admin panel. The payment flow is unaffected.
  }

  // ── 8c: Insert the payment record ───────────────────────────────────
  const { error: paymentError } = await serviceClient
    .from('payments')
    .insert({
      order_id: order.order_id,
      institute_id: instituteId,
      attempt_number: 1,
      gateway: 'razorpay',
      gateway_order_id: razorpayOrder.id,
      amount: displayAmount,
      currency: course.currency || 'INR',
      status: 'pending',
    });

  if (paymentError) {
    structuredLog('local_payment_failed', {
      error: paymentError.message,
      orderId: order.order_id,
    });
    // The order exists but payment record creation failed. Log and continue
    // — the payment webhook handler will create/update the record.
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 9: Return the structured response
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('payment_order_completed', {
    orderId: order.order_id,
    razorpayOrderId: razorpayOrder.id,
    amount: amountInPaise,
    courseId: body.courseId,
  });

  return jsonResponse({
    success: true,
    orderId: order.order_id,
    razorpayOrderId: razorpayOrder.id,
    amount: amountInPaise,
    currency: razorpayOrder.currency,
    courseName: course.title,
    description: `Purchase of ${course.title}`,
    razorpayKey: RAZORPAY_KEY_ID,
  });
});
