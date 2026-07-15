// ============================================================================
// Edge Function: create-payment-order
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Creates a Razorpay payment order for a Course or PYQ Package purchase and
// stores the order details locally in the existing commerce schema.
//
// Supports two product types:
//   1. Course      (item_type = 'course',       course_id populated)
//   2. PYQ Package (item_type = 'pyq_package',  package_id populated)
//
// The client sends exactly one of:
//   - courseId  → Course purchase (existing flow, unchanged)
//   - packageId → PYQ Package purchase (new)
//
// All pricing is determined server-side from the database. The client must
// NOT send amount, currency, or pricing data.
//
// Architecture:
//   Client → create-payment-order → Razorpay API → local orders/order_items/payments
//       ↓
//   Response with razorpayOrderId → Client opens Razorpay Checkout
//       ↓
//   razorpay-webhook → {complete-course-purchase | complete-pyq-purchase}
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
//   • All pricing read from the database (never trust the client)
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

/**
 * Discriminator for the type of product being purchased.
 * Controls which FK is populated in order_items and which completion
 * function the webhook routes to.
 */
type ProductType = 'course' | 'pyq_package';

interface RequestBody {
  /** Course ID — mutually exclusive with packageId. */
  courseId?: string;
  /** PYQ Package ID — mutually exclusive with courseId. */
  packageId?: string;
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
  /** The display name of the purchased item (course or PYQ package). */
  itemName: string;
  /**
   * Kept for backward compatibility with existing clients.
   * Contains the same value as itemName.
   * @deprecated Use itemName instead.
   */
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

/**
 * Raw row type from the pyq_packages table.
 */
interface PyqPackageRow {
  package_id: string;
  institute_id: string;
  name: string;
  price: number;
  currency: string;
  is_active: boolean;
  published_at: string | null;
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
 * Convert a price in rupees (or smallest currency unit) to paise for Razorpay.
 *
 * Razorpay requires amount in the smallest currency unit:
 * INR → paise (multiply by 100)
 *
 * @param priceInRupees - The price in rupees (e.g., 499.00)
 * @returns amout in paise and the display amount
 */
function calculatePrice(priceInRupees: number): {
  amountInPaise: number;
  displayAmount: number;
} {
  const amountInPaise = Math.round(Number(priceInRupees) * 100);

  return {
    amountInPaise,
    displayAmount: Number(priceInRupees),
  };
}

/**
 * Determine the effective price for a course.
 * Uses discounted_price if available and non-zero, otherwise original_price.
 */
function getCourseEffectivePrice(course: CourseRow): number {
  return (course.discounted_price != null && course.discounted_price > 0)
    ? Number(course.discounted_price)
    : Number(course.original_price);
}

/**
 * Parse the pre-onboarding guardian and academic fields from the raw body.
 * All fields are optional; only string values are accepted.
 */
function parseGuardianFields(
  raw: Record<string, unknown>,
): Pick<RequestBody, 'guardianName' | 'guardianMobile' | 'guardianEmail' | 'targetYear' | 'dob'> {
  return {
    guardianName: typeof raw.guardianName === 'string' ? raw.guardianName : undefined,
    guardianMobile: typeof raw.guardianMobile === 'string' ? raw.guardianMobile : undefined,
    guardianEmail: typeof raw.guardianEmail === 'string' ? raw.guardianEmail : undefined,
    targetYear: typeof raw.targetYear === 'string' ? raw.targetYear : undefined,
    dob: typeof raw.dob === 'string' ? raw.dob : undefined,
  };
}

/**
 * Build the order.notes JSON payload containing the product info and
 * optional pre-onboarding guardian/academic fields.
 */
function buildOrderNotes(
  productType: ProductType,
  productId: string,
  productName: string,
  razorpayOrderId: string,
  profileId: string,
  guardianFields: Pick<RequestBody, 'guardianName' | 'guardianMobile' | 'guardianEmail' | 'targetYear' | 'dob'>,
): string {
  const notes: Record<string, string> = {
    razorpayOrderId,
    profileId,
  };

  if (productType === 'course') {
    notes.courseId = productId;
    notes.courseName = productName;
  } else {
    notes.packageId = productId;
    notes.packageName = productName;
  }

  // Pre-onboarding fields — consumed by razorpay-webhook
  if (guardianFields.guardianName) notes.guardianName = guardianFields.guardianName;
  if (guardianFields.guardianMobile) notes.guardianMobile = guardianFields.guardianMobile;
  if (guardianFields.guardianEmail) notes.guardianEmail = guardianFields.guardianEmail;
  if (guardianFields.targetYear) notes.targetYear = guardianFields.targetYear;
  if (guardianFields.dob) notes.dob = guardianFields.dob;

  return JSON.stringify(notes);
}

/**
 * Build the Razorpay order notes payload.
 */
function buildRazorpayNotes(
  productType: ProductType,
  productId: string,
  profileId: string,
  instituteId: string,
): Record<string, string> {
  const notes: Record<string, string> = {
    profile_id: profileId,
    institute_id: instituteId,
  };

  if (productType === 'course') {
    notes.course_id = productId;
  } else {
    notes.package_id = productId;
  }

  return notes;
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
  // The client must send exactly one of:
  //   - courseId  → Course purchase
  //   - packageId → PYQ Package purchase
  //
  // Never both. Guardian/academic fields are optional.
  let body: RequestBody;
  let productType: ProductType;
  let productId: string;

  try {
    const raw = await req.json() as Record<string, unknown>;

    const courseId = typeof raw.courseId === 'string' ? raw.courseId : undefined;
    const packageId = typeof raw.packageId === 'string' ? raw.packageId : undefined;

    // Validate exactly one of courseId or packageId
    if (!courseId && !packageId) {
      return errorResponse(
        'Provide either courseId or packageId. Exactly one is required.',
        400,
        'MISSING_PRODUCT_ID',
      );
    }

    if (courseId && packageId) {
      return errorResponse(
        'Provide exactly one of courseId or packageId, not both.',
        400,
        'CONFLICTING_PRODUCT_IDS',
      );
    }

    // Resolve the product type and ID
    productType = courseId ? 'course' : 'pyq_package';
    productId = (courseId ?? packageId)!;

    body = {
      courseId,
      packageId,
      ...parseGuardianFields(raw),
    };

    structuredLog('request_validated', {
      productType,
      productId,
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
  // Step 4: Load and validate the product
  // ═════════════════════════════════════════════════════════════════════
  // Branch based on productType — each product has its own validation rules.
  let instituteId: string;
  let productName: string;
  let currency: string;
  let effectivePrice: number;

  if (productType === 'course') {
    // ── Course validation (existing logic, unchanged) ─────────────────
    structuredLog('loading_course', { courseId: productId });

    const { data: course, error: courseError } = await serviceClient
      .from('courses')
      .select('course_id, institute_id, title, original_price, discounted_price, currency, status, deleted_at')
      .eq('course_id', productId)
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

    instituteId = course.institute_id;
    productName = course.title;
    currency = course.currency || 'INR';
    effectivePrice = getCourseEffectivePrice(course);
  } else {
    // ── PYQ Package validation ──────────────────────────────────────
    structuredLog('loading_pyq_package', { packageId: productId });

    const { data: pkg, error: pkgError } = await serviceClient
      .from('pyq_packages')
      .select('package_id, institute_id, name, price, currency, is_active, published_at')
      .eq('package_id', productId)
      .single();

    if (pkgError || !pkg) {
      return errorResponse('PYQ Package not found.', 404, 'PACKAGE_NOT_FOUND', pkgError?.message);
    }

    // Validate the package is purchasable
    if (!pkg.is_active) {
      return errorResponse('This PYQ Package is no longer available for purchase.', 410, 'PACKAGE_INACTIVE');
    }

    if (!pkg.published_at) {
      return errorResponse('This PYQ Package has not been published yet.', 400, 'PACKAGE_NOT_PUBLISHED');
    }

    if (Number(pkg.price) <= 0) {
      return errorResponse('This PYQ Package has no valid price configured.', 400, 'PACKAGE_NO_PRICE');
    }

    structuredLog('pyq_package_validated', {
      packageId: pkg.package_id,
      name: pkg.name,
      instituteId: pkg.institute_id,
      isActive: pkg.is_active,
    });

    instituteId = pkg.institute_id;
    productName = pkg.name;
    currency = pkg.currency || 'INR';
    effectivePrice = Number(pkg.price);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 5: Check for existing access (prevent duplicate purchase)
  // ═════════════════════════════════════════════════════════════════════
  // Each product type has its own access table:
  //   course      → course_enrollments (via student_details)
  //   pyq_package → student_pyq_purchases
  structuredLog('checking_existing_access', { productType, productId, profileId });

  if (productType === 'course') {
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
        .eq('course_id', productId)
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
  } else {
    // Resolve student_id from student_details (may not exist yet)
    const { data: existingStudent } = await serviceClient
      .from('student_details')
      .select('student_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (existingStudent) {
      const { data: existingPurchase } = await serviceClient
        .from('student_pyq_purchases')
        .select('purchase_id')
        .eq('package_id', productId)
        .eq('student_id', existingStudent.student_id)
        .eq('is_active', true)
        .maybeSingle();

      if (existingPurchase) {
        structuredLog('already_purchased', {
          purchaseId: existingPurchase.purchase_id,
        });

        return errorResponse(
          'You have already purchased this PYQ Package.',
          409,
          'ALREADY_PURCHASED',
        );
      }
    }

    structuredLog('no_existing_pyq_purchase', {});
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 6: Calculate the payment amount
  // ═════════════════════════════════════════════════════════════════════
  // All pricing is computed server-side from the database.
  // The client must never influence the amount.
  const { amountInPaise, displayAmount } = calculatePrice(effectivePrice);

  structuredLog('price_calculated', {
    displayAmount,
    amountInPaise,
    currency,
    productType,
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
      currency,
      receipt: receiptId,
      notes: buildRazorpayNotes(productType, productId, profileId, instituteId),
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
      productType,
      productId,
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
  // Uses the profile_id column (migration 042) since student_details
  // may not exist at this point. The order is linked to the student later
  // during the completion function (complete-course-purchase or
  // complete-pyq-purchase).

  // ── 8a: Insert the order ────────────────────────────────────────────
  structuredLog('creating_local_order', {
    productType,
    productId,
    profileId,
    instituteId,
    amount: displayAmount,
  });

  const guardianFields = {
    guardianName: body.guardianName,
    guardianMobile: body.guardianMobile,
    guardianEmail: body.guardianEmail,
    targetYear: body.targetYear,
    dob: body.dob,
  };

  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .insert({
      profile_id: profileId,
      institute_id: instituteId,
      student_id: null,          // Not yet created — will be set during onboarding
      status: 'pending',
      currency,
      subtotal_amount: displayAmount,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: displayAmount,
      notes: buildOrderNotes(productType, productId, productName, razorpayOrder.id, profileId, guardianFields),
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
  // The item_type and FK vary by product type. The CHECK constraint
  // ck_order_items_item_type_consistency enforces the correct FK is set.
  const orderItemInsert = productType === 'course'
    ? {
        order_id: order.order_id,
        institute_id: instituteId,
        item_type: 'course' as const,
        course_id: productId,
        item_name: productName,
        unit_price: displayAmount,
        quantity: 1,
        discount_amount: 0,
        line_total: displayAmount,
      }
    : {
        order_id: order.order_id,
        institute_id: instituteId,
        item_type: 'pyq_package' as const,
        package_id: productId,
        item_name: productName,
        unit_price: displayAmount,
        quantity: 1,
        discount_amount: 0,
        line_total: displayAmount,
      };

  const { error: itemError } = await serviceClient
    .from('order_items')
    .insert(orderItemInsert);

  if (itemError) {
    structuredLog('local_order_item_failed', {
      error: itemError.message,
      orderId: order.order_id,
      productType,
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
      currency,
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
    productType,
    productId,
  });

  return jsonResponse({
    success: true,
    orderId: order.order_id,
    razorpayOrderId: razorpayOrder.id,
    amount: amountInPaise,
    currency: razorpayOrder.currency,
    itemName: productName,
    courseName: productName,  // Backward compat — same value
    description: `Purchase of ${productName}`,
    razorpayKey: RAZORPAY_KEY_ID,
  });
});
