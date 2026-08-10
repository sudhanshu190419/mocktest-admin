// ============================================================================
// Edge Function: create-payment-order
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Creates a Razorpay payment order for a Course, PYQ Package, or
// Subscription Plan purchase and stores the order details locally in the
// existing commerce schema.
//
// Supports three product types:
//   1. Course             (item_type = 'course',            course_id populated)
//   2. PYQ Package        (item_type = 'pyq_package',       package_id populated)
//   3. Subscription Plan  (item_type = 'subscription_plan', plan_id populated)
//
// The client sends one of the following valid combinations (Phase 11H.1):
//   1. courseId only      → Course purchase (existing flow, unchanged)
//   2. packageId only     → PYQ Package purchase (existing flow, unchanged)
//   3. planId + courseId  → Subscription Plan purchase (planId wins the
//                           product-type resolution; courseId is the
//                           companion used to validate plan.course_id)
//
// Every other combination of courseId / packageId / planId is rejected.
//
// All pricing is determined server-side from the database. The client must
// NOT send amount, currency, or pricing data.
//
// Architecture:
//   Client → create-payment-order → Razorpay API → local orders/order_items/payments
//       ↓
//   Response with razorpayOrderId → Client opens Razorpay Checkout
//       ↓
//   razorpay-webhook → {complete-course-purchase | complete-pyq-purchase | complete-subscription-purchase}
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
type ProductType = 'course' | 'pyq_package' | 'subscription_plan';

interface RequestBody {
  /**
   * Course UUID.
   * - Course purchase (courseId only): the course being bought (existing
   *   behaviour).
   * - Subscription plan purchase (planId + courseId, Phase 11G/11H): the
   *   course the student is buying the plan FROM — the backend validates it
   *   matches plan.course_id and rejects mismatches (PLAN_COURSE_MISMATCH).
   * Valid alone (course purchase) or as the required companion of planId.
   */
  courseId?: string;
  /** PYQ Package ID — valid only by itself (packageId only). */
  packageId?: string;
  /**
   * Subscription Plan ID — valid only together with courseId
   * (planId + courseId). Rejected on its own (PLAN_REQUIRES_COURSE).
   */
  planId?: string;
  /**
   * Phase 11K.5 — Full Course Conversion. Valid ONLY together with
   * courseId (conversion is a discounted one-time course purchase).
   * When true, the payable amount is the REMAINING balance:
   *   max(0, (discounted_price ?? original_price) −
   *          total_subscription_payments(student_id, course_id))
   * and complete-course-purchase cancels the student's subscription after
   * granting permanent ownership. Rejected with packageId / planId.
   */
  conversion?: boolean;
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
  /** Phase 11K.6 — true when an existing pending order was reused. */
  reused?: boolean;
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

/**
 * Raw row type from the subscription_plans table.
 */
interface SubscriptionPlanRow {
  plan_id: string;
  institute_id: string;
  name: string;
  price: number;
  currency_code: string;
  billing_cycle: string;
  duration_days: number;
  is_active: boolean;
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
  /** Phase 11K.5 — Full Course conversion marker (persisted in order.notes). */
  conversion?: boolean,
): string {
  const notes: Record<string, string> = {
    razorpayOrderId,
    profileId,
  };

  // Phase 11K.5: conversion marker — consumed by razorpay-webhook so it can
  // pass `conversion: true` to complete-course-purchase (which cancels the
  // subscription and grants permanent ownership). Server-derived on the
  // completion side; the amount itself is fixed at order creation.
  if (conversion) {
    notes.conversion = 'true';
  }

  if (productType === 'course') {
    notes.courseId = productId;
    notes.courseName = productName;
  } else if (productType === 'pyq_package') {
    notes.packageId = productId;
    notes.packageName = productName;
  } else {
    notes.planId = productId;
    notes.planName = productName;
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
  } else if (productType === 'pyq_package') {
    notes.package_id = productId;
  } else {
    notes.plan_id = productId;
  }

  return notes;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 11K.6 — pending-order reuse guard.
 *
 * If the student already has a PENDING order for the SAME purchase
 * (same profile, same product signature in order.notes, same conversion
 * flag) created within the last 24h, return it instead of creating a
 * second payable order. This kills the "open two tabs / click Pay twice"
 * double-payment vector at the front door — the client reopens checkout
 * against the SAME Razorpay order, and the webhook/completion idempotency
 * layers handle the rest.
 *
 * Notes are JSON text; we parse and compare the product signature exactly
 * (never a substring LIKE on the raw notes).
 */
async function findPendingReusableOrder(
  serviceClient: any,
  profileId: string,
  productType: ProductType,
  productId: string,
  conversion: boolean,
): Promise<{
  order_id: string;
  razorpayOrderId: string;
  total_amount: number;
  currency: string;
} | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await serviceClient
    .from('orders')
    .select('order_id, notes, total_amount, currency, created_at')
    .eq('profile_id', profileId)
    .eq('status', 'pending')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    structuredLog('pending_order_lookup_failed', {
      error: error.message,
      productType,
      productId,
    });
    return null;
  }

  for (const order of orders ?? []) {
    let notes: Record<string, unknown> = {};
    try {
      notes = JSON.parse(order.notes ?? '{}') as Record<string, unknown>;
    } catch {
      continue; // Unparseable notes — skip; never guess.
    }

    const notesConversion = notes.conversion === 'true';
    if (notesConversion !== conversion) continue;

    let signatureMatches = false;
    if (productType === 'course' && notes.courseId === productId) signatureMatches = true;
    else if (productType === 'pyq_package' && notes.packageId === productId) signatureMatches = true;
    else if (productType === 'subscription_plan' && notes.planId === productId) signatureMatches = true;

    if (!signatureMatches) continue;

    const razorpayOrderId = typeof notes.razorpayOrderId === 'string'
      ? notes.razorpayOrderId
      : '';
    if (!razorpayOrderId) continue; // Defensive: an order without a gateway reference cannot be reused.

    structuredLog('pending_order_reuse_found', {
      existingOrderId: order.order_id,
      productType,
      productId,
      conversion,
    });

    return {
      order_id: order.order_id,
      razorpayOrderId,
      total_amount: Number(order.total_amount ?? 0),
      currency: order.currency ?? 'INR',
    };
  }

  return null;
}

/**
 * M4 Fix C — cancel STALE pending orders for the same purchase.
 *
 * The partial unique pending-order indexes (migration 105) cannot encode the
 * 24-hour reuse window (index predicates must be immutable and cannot depend
 * on now()). Without cleanup, a stale pending (>24h) for the same product
 * would block a fresh order forever. Cancelling it restores the exact legacy
 * behaviour: <=24h → reuse, >24h → a new order may be created.
 *
 * Only orders matching the SAME product signature (profile, product type,
 * product id, conversion flag) are touched — different products are never
 * affected. The update is idempotent (status filter) and non-fatal.
 */
async function cancelStalePendingOrders(
  serviceClient: any,
  profileId: string,
  productType: ProductType,
  productId: string,
  conversion: boolean,
): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await serviceClient
    .from('orders')
    .select('order_id, notes, created_at')
    .eq('profile_id', profileId)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(25);

  if (error || !orders) return;

  for (const order of orders ?? []) {
    let notes: Record<string, unknown> = {};
    try {
      notes = JSON.parse(order.notes ?? '{}') as Record<string, unknown>;
    } catch {
      continue; // Unparseable notes — never touch.
    }

    const notesConversion = notes.conversion === 'true';
    if (notesConversion !== conversion) continue;

    let signatureMatches = false;
    if (productType === 'course' && notes.courseId === productId) signatureMatches = true;
    else if (productType === 'pyq_package' && notes.packageId === productId) signatureMatches = true;
    else if (productType === 'subscription_plan' && notes.planId === productId) signatureMatches = true;
    if (!signatureMatches) continue;

    await serviceClient
      .from('orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('order_id', order.order_id)
      .eq('status', 'pending');

    structuredLog('pending_order_stale_cancelled', {
      orderId: order.order_id,
      productType,
      productId,
      conversion,
      createdBefore: order.created_at,
    });
  }
}

/**
 * M4 — true when a PostgREST error is a unique-constraint violation
 * (SQLSTATE 23505). Mirrors the established pattern used by
 * complete-subscription-purchase and the shared enrollment helper.
 */
function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === '23505' ||
    /duplicate key/i.test(error?.message ?? '')
  );
}

/**
 * M4 — build the success response for a REUSED pending order.
 * Shared by the Step 5.5 reuse guard and the 23505 recovery path so both
 * return the identical shape (reused:true).
 */
function reuseSuccessResponse(
  pending: {
    order_id: string;
    razorpayOrderId: string;
    total_amount: number;
    currency: string;
  },
  productName: string,
): Response {
  return jsonResponse({
    success: true,
    reused: true,
    orderId: pending.order_id,
    razorpayOrderId: pending.razorpayOrderId,
    amount: Math.round(pending.total_amount * 100),
    currency: pending.currency,
    itemName: productName,
    courseName: productName,  // Backward compat — same value
    description: `Purchase of ${productName}`,
    razorpayKey: RAZORPAY_KEY_ID,
  });
}

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
  // Valid combinations (Phase 11H.1):
  //   1. courseId only      → Course purchase
  //   2. packageId only     → PYQ Package purchase
  //   3. planId + courseId  → Subscription Plan purchase
  //                            (planId wins resolution; courseId is the
  //                            companion used for the PLAN_COURSE_MISMATCH
  //                            guard against plan.course_id)
  //
  // Every other combination is rejected with a clear error.
  // Guardian/academic fields are optional.
  let body: RequestBody;
  let productType: ProductType;
  let productId: string;

  try {
    const raw = await req.json() as Record<string, unknown>;

    const courseId = typeof raw.courseId === 'string' ? raw.courseId : undefined;
    const packageId = typeof raw.packageId === 'string' ? raw.packageId : undefined;
    const planId = typeof raw.planId === 'string' ? raw.planId : undefined;
    // Phase 11K.5: Full Course conversion — a discounted one-time course
    // purchase. Only meaningful together with courseId.
    const conversion = raw.conversion === true;

    const hasCourse = !!courseId;
    const hasPackage = !!packageId;
    const hasPlan = !!planId;

    // Phase 11H.1 contract — only these combinations are valid:
    //   courseId only      → course purchase
    //   packageId only     → PYQ package purchase
    //   planId + courseId  → subscription plan purchase
    if (!hasCourse && !hasPackage && !hasPlan) {
      return errorResponse(
        'Provide courseId (course purchase), packageId (PYQ purchase), ' +
          'or planId with courseId (subscription purchase).',
        400,
        'MISSING_PRODUCT_ID',
      );
    }

    if (conversion && (hasPackage || hasPlan)) {
      // Conversion is only a course-purchase variant (courseId only).
      return errorResponse(
        'Full Course conversion is only valid with courseId (no packageId/planId).',
        400,
        'CONVERSION_INVALID_COMBO',
      );
    }

    if (hasPlan) {
      // Subscription plan purchase — planId must be accompanied by courseId.
      if (hasPackage) {
        return errorResponse(
          'Invalid combination: planId cannot be combined with packageId.',
          400,
          'CONFLICTING_PRODUCT_IDS',
        );
      }
      if (!hasCourse) {
        return errorResponse(
          'planId requires courseId: subscription plans are course-scoped. ' +
            'Provide both planId and the courseId it belongs to.',
          400,
          'PLAN_REQUIRES_COURSE',
        );
      }
      // planId wins the resolution over the companion courseId.
      productType = 'subscription_plan';
      productId = planId;
    } else if (hasPackage) {
      // PYQ package purchase — packageId only.
      if (hasCourse) {
        return errorResponse(
          'Invalid combination: packageId cannot be combined with courseId.',
          400,
          'CONFLICTING_PRODUCT_IDS',
        );
      }
      productType = 'pyq_package';
      productId = packageId;
    } else {
      // Course purchase — courseId only.
      productType = 'course';
      productId = courseId as string;
    }

    body = {
      courseId,
      packageId,
      planId,
      conversion,
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
  /** Course id of the subscription plan (subscription_plan purchases only). */
  let planCourseIdForItem: string | null = null;

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
  } else if (productType === 'pyq_package') {
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
  } else {
    // ── Subscription Plan validation ────────────────────────────────
    structuredLog('loading_subscription_plan', { planId: productId });

    const { data: plan, error: planError } = await serviceClient
      .from('subscription_plans')
      .select('plan_id, institute_id, course_id, name, price, currency_code, billing_cycle, duration_days, is_active')
      .eq('plan_id', productId)
      .single();

    if (planError || !plan) {
      return errorResponse('Subscription plan not found.', 404, 'PLAN_NOT_FOUND', planError?.message);
    }

    // Validate the plan is purchasable
    if (!plan.is_active) {
      return errorResponse('This subscription plan is no longer available for purchase.', 410, 'PLAN_INACTIVE');
    }

    if (Number(plan.price) <= 0) {
      return errorResponse('This subscription plan has no valid price configured.', 400, 'PLAN_NO_PRICE');
    }

    // Phase 11G/11H: plans are course-scoped. The plan's course_id is the
    // single source of truth. If the client supplied a courseId, it must
    // match the plan's course — otherwise reject (prevents buying Course B's
    // plan from inside Course A's purchase flow).
    const planCourseId = plan.course_id;
    if (!planCourseId) {
      return errorResponse('This subscription plan is not assigned to a course.', 500, 'PLAN_NO_COURSE');
    }
    if (body.courseId && body.courseId !== planCourseId) {
      structuredLog('plan_course_mismatch', {
        planId: plan.plan_id,
        planCourseId,
        bodyCourseId: body.courseId,
      });
      return errorResponse(
        'This subscription plan does not belong to the selected course.',
        400,
        'PLAN_COURSE_MISMATCH',
      );
    }

    structuredLog('subscription_plan_validated', {
      planId: plan.plan_id,
      name: plan.name,
      instituteId: plan.institute_id,
      courseId: planCourseId,
      billingCycle: plan.billing_cycle,
      durationDays: plan.duration_days,
      isActive: plan.is_active,
    });

    instituteId = plan.institute_id;
    productName = plan.name;
    currency = plan.currency_code || 'INR';
    effectivePrice = Number(plan.price);

    // Expose the plan's course so the order_items insert below can populate
    // course_id (required by ck_order_items_item_type_consistency, migration
    // 089) and the duplicate check can be course-scoped.
    planCourseIdForItem = planCourseId;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 5: Check for existing access (prevent duplicate purchase)
  // ═════════════════════════════════════════════════════════════════════
  // Each product type has its own access table:
  //   course            → course_enrollments (via student_details)
  //   pyq_package       → student_pyq_purchases
  //   subscription_plan → student_subscriptions (active/grace = no re-purchase)
  structuredLog('checking_existing_access', { productType, productId, profileId });

  if (productType === 'course') {
    // Resolve student_id from student_details (may not exist yet)
    const { data: existingStudent } = await serviceClient
      .from('student_details')
      .select('student_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (existingStudent) {
      if (body.conversion) {
        // ── Phase 11K.5: Full Course Conversion ──────────────────────
        // A conversion is a discounted one-time course purchase. It is only
        // valid when the student has a current (renewable) subscription for
        // the course and does NOT already permanently own it. The payable
        // amount is the REMAINING balance (course price minus everything the
        // student already paid in subscription plans for this course, clamped
        // at 0) — computed via the migration-096 SQL helper.
        //
        // 1. Permanent-ownership guard — a subscription-type enrollment is
        //    fine (it will be upgraded by complete-course-purchase); a
        //    purchase-type active enrollment means the student already owns
        //    the course permanently.
        const { data: ownedEnrollment } = await serviceClient
          .from('course_enrollments')
          .select('enrollment_id')
          .eq('course_id', productId)
          .eq('student_id', existingStudent.student_id)
          .eq('enrollment_type', 'purchase')
          .eq('is_active', true)
          .maybeSingle();

        if (ownedEnrollment) {
          structuredLog('already_permanently_owned', {
            courseId: productId,
            studentId: existingStudent.student_id,
          });
          return errorResponse(
            'You already permanently own this course.',
            409,
            'ALREADY_OWNED',
          );
        }

        // 2. Current subscription required (renewable statuses only —
        //    matches the renewal/renewal-options model).
        const { data: currentSubscription } = await serviceClient
          .from('student_subscriptions')
          .select('subscription_id, status')
          .eq('course_id', productId)
          .eq('student_id', existingStudent.student_id)
          .in('status', ['active', 'grace', 'expired'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!currentSubscription) {
          structuredLog('conversion_no_subscription', {
            courseId: productId,
            studentId: existingStudent.student_id,
          });
          return errorResponse(
            'You need an active subscription for this course before you can ' +
              'convert to full course.',
            409,
            'CONVERSION_NOT_ELIGIBLE',
          );
        }

        // 3. Remaining amount = course effective price − total subscription
        //    payments, clamped at 0 (Phase 11K.1 decision D1: identical
        //    pricing basis as a one-time buyer).
        const { data: totalPaidRaw, error: totalPaidError } = await serviceClient.rpc(
          'total_subscription_payments',
          {
            p_student_id: existingStudent.student_id,
            p_course_id: productId,
          },
        );

        if (totalPaidError) {
          structuredLog('conversion_pricing_unavailable', {
            courseId: productId,
            studentId: existingStudent.student_id,
            error: totalPaidError.message,
            sqlState: (totalPaidError as { code?: string })?.code ?? 'unknown',
          });
          return errorResponse(
            'Unable to compute the conversion amount. Please try again.',
            500,
            'CONVERSION_PRICING_UNAVAILABLE',
          );
        }

        const totalPaid = Number(totalPaidRaw ?? 0);
        // `course` is block-scoped to Step 4; `effectivePrice` is its already-
        // computed effective price (getCourseEffectivePrice(course)) — reuse it.
        const courseBasePrice = effectivePrice;
        const remainingAmount = Math.max(
          0,
          Math.round((courseBasePrice - totalPaid) * 100) / 100,
        );

        if (remainingAmount <= 0) {
          // The student has already paid at least the full course price via
          // subscription plans — a ₹0 Razorpay order is not viable. Reject
          // with a clear message; ownership can be granted by support.
          structuredLog('conversion_fully_paid', {
            courseId: productId,
            studentId: existingStudent.student_id,
            courseBasePrice,
            totalPaid,
          });
          return errorResponse(
            'You have already paid the full course price through your ' +
              'subscription payments. Please contact support to complete ' +
              'your ownership.',
            409,
            'CONVERSION_FULLY_PAID',
          );
        }

        structuredLog('conversion_amount_computed', {
          courseId: productId,
          studentId: existingStudent.student_id,
          subscriptionId: currentSubscription.subscription_id,
          status: currentSubscription.status,
          courseBasePrice,
          totalPaid,
          remainingAmount,
        });

        // Override the payable amount with the remaining balance BEFORE
        // Step 6 (price calc) so the Razorpay order + order_items reflect it.
        effectivePrice = remainingAmount;
      } else {
        // Normal one-time course purchase — reject if already enrolled
        // (existing behaviour, unchanged).
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
    }

    structuredLog('no_existing_enrollment', {});
  } else if (productType === 'pyq_package') {
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
  } else {
    // Resolve student_id from student_details (may not exist yet)
    const { data: existingStudent } = await serviceClient
      .from('student_details')
      .select('student_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (existingStudent) {
      // planCourseIdForItem is guaranteed non-null here: the subscription
      // branch validated it (PLAN_NO_COURSE) before reaching this point.
      if (!planCourseIdForItem) {
        return errorResponse(
          'This subscription plan is not assigned to a course.',
          500,
          'PLAN_NO_COURSE',
        );
      }

      // ── Phase 11K.4: permanent-ownership guard ─────────────────────
      // A student who permanently owns the course (one-time purchase or
      // Full Course conversion → enrollment_type='purchase', is_active)
      // can never buy a subscription for it again (11K.1 decision D2).
      const { data: ownedEnrollment } = await serviceClient
        .from('course_enrollments')
        .select('enrollment_id')
        .eq('course_id', planCourseIdForItem)
        .eq('student_id', existingStudent.student_id)
        .eq('enrollment_type', 'purchase')
        .eq('is_active', true)
        .maybeSingle();

      if (ownedEnrollment) {
        structuredLog('already_permanently_owned', {
          courseId: planCourseIdForItem,
          studentId: existingStudent.student_id,
        });

        return errorResponse(
          'You already permanently own this course.',
          409,
          'ALREADY_OWNED',
        );
      }

      // ── Phase 11K.4: server-derived renewal classification ─────────
      // The CURRENT subscription row (newest by created_at) is the renewal
      // anchor (Phase 11K.1 decision D3 — never a historical row). The
      // client does NOT declare intent; the plan requested against the
      // existing row decides:
      //   • no current row           → initial purchase (any plan allowed)
      //   • same plan                → RENEWAL allowed (billing cycle is
      //                                permanently locked to this plan)
      //   • different plan           → 409 PLAN_LOCKED — switching
      //                                Monthly↔Quarterly↔Half-Yearly↔Yearly
      //                                is NEVER allowed after first purchase
      //   • cancelled/refunded       → 409 SUBSCRIPTION_NOT_RENEWABLE
      const { data: currentSubscription } = await serviceClient
        .from('student_subscriptions')
        .select('subscription_id, plan_id, status')
        .eq('course_id', planCourseIdForItem)
        .eq('student_id', existingStudent.student_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (currentSubscription) {
        if (currentSubscription.plan_id !== productId) {
          structuredLog('billing_cycle_locked', {
            subscriptionId: currentSubscription.subscription_id,
            currentPlanId: currentSubscription.plan_id,
            requestedPlanId: productId,
            courseId: planCourseIdForItem,
          });

          return errorResponse(
            'Your subscription billing cycle is locked to your current plan. ' +
              'Renew the same plan or convert to full course.',
            409,
            'PLAN_LOCKED',
          );
        }

        // Renewable statuses only (matches trg_student_subscriptions_validate_status).
        if (
          currentSubscription.status !== 'active' &&
          currentSubscription.status !== 'grace' &&
          currentSubscription.status !== 'expired'
        ) {
          structuredLog('subscription_not_renewable', {
            subscriptionId: currentSubscription.subscription_id,
            status: currentSubscription.status,
          });

          return errorResponse(
            'Your current subscription cannot be renewed. Please contact support.',
            409,
            'SUBSCRIPTION_NOT_RENEWABLE',
          );
        }

        // Same plan → renewal is allowed (the existing row will be UPDATED
        // by complete-subscription-purchase — never a new row).
        structuredLog('renewal_allowed', {
          subscriptionId: currentSubscription.subscription_id,
          planId: productId,
          status: currentSubscription.status,
        });
      } else {
        structuredLog('no_existing_subscription', {});
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 5.5: Pending-order reuse guard (Phase 11K.6)
  // ═════════════════════════════════════════════════════════════════════
  // Only reached when Step 5's access checks passed (not already enrolled /
  // owned / subscribed). A recent PENDING order for the identical purchase
  // is reused — never a second Razorpay order for the same product.
  const reusablePending = await findPendingReusableOrder(
    serviceClient,
    profileId,
    productType,
    productId,
    body.conversion === true,
  );

  if (reusablePending) {
    // Phase 11K.6 review: a conversion's remaining amount is computed at
    // ORDER-CREATION time (effectivePrice was set to remainingAmount in
    // Step 5). If total_subscription_payments increased since (e.g. a
    // concurrent renewal completed), the stored total_amount is STALE and
    // higher than the fresh remaining balance — reusing it would overcharge.
    // For conversions, only reuse when the stored amount still matches the
    // freshly computed amount; otherwise cancel the stale order and create
    // a new one (the student was quoted a different price).
    if (
      body.conversion === true &&
      Math.round(effectivePrice * 100) !== Math.round(reusablePending.total_amount * 100)
    ) {
      structuredLog('pending_order_reuse_stale_amount', {
        existingOrderId: reusablePending.order_id,
        storedAmountInPaise: Math.round(reusablePending.total_amount * 100),
        freshAmountInPaise: Math.round(effectivePrice * 100),
        productType,
        productId,
      });

      // Cancel the stale pending order so it can never be paid later.
      // Non-fatal — if the cancel fails, the stale order stays pending and
      // will simply never match the (different) signature again after 24h.
      await serviceClient
        .from('orders')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('order_id', reusablePending.order_id)
        .eq('status', 'pending');
    } else {
      structuredLog('pending_order_reused', {
        existingOrderId: reusablePending.order_id,
        razorpayOrderId: reusablePending.razorpayOrderId,
        productType,
        productId,
        conversion: body.conversion === true,
        amountInPaise: Math.round(reusablePending.total_amount * 100),
      });

      return reuseSuccessResponse(reusablePending, productName);
    }
  }

  // ── M4 Fix C: cancel stale (>24h) pendings for the same purchase ──────
  // The unique pending-order indexes (migration 105) cannot encode the 24h
  // window; without this step a stale pending would block a fresh order.
  await cancelStalePendingOrders(
    serviceClient,
    profileId,
    productType,
    productId,
    body.conversion === true,
  );

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
      notes: buildOrderNotes(productType, productId, productName, razorpayOrder.id, profileId, guardianFields, body.conversion === true),
    })
    .select('order_id')
    .single();

  if (orderError || !order) {
    // ── M4 Fix D: concurrent pending-order race (SQLSTATE 23505) ─────────
    // The partial unique pending-order indexes (migration 105) allow only ONE
    // pending order per (profile, product, conversion). If a concurrent
    // request inserted its order first, recover by re-running the reuse
    // lookup and returning the WINNER's order — never a generic 500 and never
    // a second payable order. The orphaned Razorpay order created in Step 7
    // is never paid and needs no cleanup (Razorpay orders expire on their
    // own; no auto-charge can occur).
    if (isUniqueViolation(orderError)) {
      const winner = await findPendingReusableOrder(
        serviceClient,
        profileId,
        productType,
        productId,
        body.conversion === true,
      );

      if (winner) {
        // Conversion guard: only reuse when the stored amount still matches
        // the freshly computed amount (identical rule to the Step 5.5 reuse
        // path — a concurrent renewal may have advanced the balance). A
        // stale winner is cancelled so the client's retry computes fresh.
        if (
          body.conversion === true &&
          Math.round(effectivePrice * 100) !== Math.round(winner.total_amount * 100)
        ) {
          await serviceClient
            .from('orders')
            .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
            .eq('order_id', winner.order_id)
            .eq('status', 'pending');

          structuredLog('pending_order_conflict_stale_amount_cancelled', {
            orderId: winner.order_id,
            productType,
            productId,
          });

          return errorResponse(
            'Another payment attempt was in progress with a different amount. ' +
              'Please try again.',
            409,
            'PENDING_ORDER_CONFLICT',
          );
        }

        structuredLog('pending_order_conflict_recovered', {
          winnerOrderId: winner.order_id,
          razorpayOrderId: winner.razorpayOrderId,
          productType,
          productId,
          conversion: body.conversion === true,
        });

        return reuseSuccessResponse(winner, productName);
      }

      structuredLog('pending_order_conflict_unresolved', {
        productType,
        productId,
        error: orderError.message,
      });

      return errorResponse(
        'Another payment attempt is in progress. Please try again.',
        409,
        'PENDING_ORDER_CONFLICT',
      );
    }

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
  let orderItemInsert: Record<string, unknown>;

  if (productType === 'course') {
    orderItemInsert = {
      order_id: order.order_id,
      institute_id: instituteId,
      item_type: 'course' as const,
      course_id: productId,
      item_name: productName,
      unit_price: displayAmount,
      quantity: 1,
      discount_amount: 0,
      line_total: displayAmount,
    };
  } else if (productType === 'pyq_package') {
    orderItemInsert = {
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
  } else {
    orderItemInsert = {
      order_id: order.order_id,
      institute_id: instituteId,
      item_type: 'subscription_plan' as const,
      plan_id: productId,
      course_id: planCourseIdForItem,
      item_name: productName,
      unit_price: displayAmount,
      quantity: 1,
      discount_amount: 0,
      line_total: displayAmount,
    };
  }

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
