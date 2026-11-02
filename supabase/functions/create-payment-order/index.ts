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
type ProductType = 'course' | 'pyq_package' | 'subscription_plan' | 'installment';

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
   * Installment Plan ID — valid only together with courseId (installmentPlanId + courseId).
   * Rejected on its own or when combined with packageId/planId/conversion.
   */
  installmentPlanId?: string;
  /**
   * Installment Agreement ID — for subsequent installment payments.
   * When provided, executes reserve_subsequent_installment_order.
   */
  agreementId?: string;
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
  razorpayOrderId?: string;
  amount?: number;
  currency?: string;
  /** The display name of the purchased item (course or PYQ package). */
  itemName?: string;
  /**
   * Kept for backward compatibility with existing clients.
   * Contains the same value as itemName.
   * @deprecated Use itemName instead.
   */
  courseName?: string;
  description?: string;
  /** Razorpay publishable key for the client to open the checkout. */
  razorpayKey?: string;
  paymentId?: string;
  receiptId?: string;
  alreadySettled?: boolean;
  recovered?: boolean;
  studentId?: string;
  agreementId?: string;
  enrollmentId?: string;
  settlement?: Record<string, unknown>;
  message?: string;
  allocationCount?: number;
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
 * Structured error helper for consistent log formatting.
 */
function structuredError(event: string, data: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      service: 'create-payment-order',
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
  razorpayOrderId: string | null,
  profileId: string,
  guardianFields: Pick<RequestBody, 'guardianName' | 'guardianMobile' | 'guardianEmail' | 'targetYear' | 'dob'>,
  /** Phase 11K.5 — Full Course conversion marker (persisted in order.notes). */
  conversion?: boolean,
): string {
  const notes: Record<string, string> = {
    profileId,
  };
  if (razorpayOrderId) {
    notes.razorpayOrderId = razorpayOrderId;
  }

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
  } else if (productType === 'installment') {
    notes.installmentPlanId = productId;
    notes.planName = productName;
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
  } else if (productType === 'installment') {
    notes.installment_plan_id = productId;
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
type ReceiptRecoveryResult =
  | {
      status: 'FOUND';
      razorpayOrder: { id: string; amount: number; currency: string; receipt: string; status: string };
      orderStatus: 'created' | 'attempted';
    }
  | {
      status: 'PAID';
      razorpayOrder: { id: string; amount: number; currency: string; receipt: string; status: string };
      orderStatus: 'paid';
    }
  | { status: 'NOT_FOUND' }
  | { status: 'AMBIGUOUS'; reason: string }
  | { status: 'ERROR'; error: string };

interface PaidReconciliationResult {
  success: boolean;
  status: 'CAPTURED' | 'FULLY_REFUNDED' | 'PARTIALLY_REFUNDED' | 'UNVERIFIED' | 'AMBIGUOUS';
  paymentId?: string;
  error?: string;
  reconciled?: boolean;
  canProceedToPayment?: boolean;
  requiresAdminReview?: boolean;
  adminReviewReason?: string;
  razorpayOrderId?: string;
  message?: string;
  action?: string;
}

/**
 * Invokes the existing idempotent product completion Edge Functions to fulfill
 * a captured order (reusing complete-course-purchase, complete-pyq-purchase, etc.).
 */
async function triggerOrderFulfillment(
  serviceClient: any,
  orderId: string,
  razorpayPaymentId: string,
  razorpayOrderId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const { data: order } = await serviceClient
      .from('orders')
      .select('order_id, profile_id, status, fulfillment_status, notes')
      .eq('order_id', orderId)
      .single();

    if (!order) {
      structuredError('FULFILLMENT_ORDER_MISSING', { orderId });
      return { success: false, message: 'Order missing' };
    }

    if (order.status === 'cancelled' || order.status === 'refunded') {
      structuredError('FULFILLMENT_ABORTED_ORDER_CANCELLED_OR_REFUNDED', {
        orderId,
        status: order.status,
      });
      return { success: false, message: `Order is ${order.status}. Fulfillment aborted.` };
    }

    if (order.fulfillment_status === 'requires_review') {
      structuredError('FULFILLMENT_ABORTED_ORDER_REQUIRES_REVIEW', {
        orderId,
        fulfillmentStatus: order.fulfillment_status,
      });
      return { success: false, message: 'Order requires administrative review. Fulfillment aborted.' };
    }

    const { data: items } = await serviceClient
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (!order || !items || items.length === 0) {
      structuredError('FULFILLMENT_ORDER_OR_ITEMS_MISSING', { orderId });
      return { success: false, message: 'Order or order items missing' };
    }

    const orderItem = items[0];
    const itemType = orderItem.item_type;
    const profileId = order.profile_id;
    let notes: Record<string, unknown> = {};
    try {
      notes = JSON.parse(order.notes ?? '{}');
    } catch {}

    const guardian = {
      guardianName: typeof notes.guardianName === 'string' ? notes.guardianName : undefined,
      guardianMobile: typeof notes.guardianMobile === 'string' ? notes.guardianMobile : undefined,
      guardianEmail: typeof notes.guardianEmail === 'string' ? notes.guardianEmail : undefined,
      targetYear: typeof notes.targetYear === 'string' ? notes.targetYear : undefined,
      dateOfBirth: typeof notes.dob === 'string' ? notes.dob : undefined,
    };
    const conversion = notes.conversion === 'true';

    if (itemType === 'course') {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/complete-course-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          courseId: orderItem.course_id,
          orderId,
          profileId,
          guardianName: guardian.guardianName,
          guardianMobile: guardian.guardianMobile,
          guardianEmail: guardian.guardianEmail,
          targetYear: guardian.targetYear,
          dateOfBirth: guardian.dateOfBirth,
          razorpayPaymentId,
          razorpayOrderId,
          conversion,
        }),
      });
      return { success: res.ok };
    } else if (itemType === 'pyq_package') {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/complete-pyq-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          packageId: orderItem.package_id,
          orderId,
          profileId,
          guardianName: guardian.guardianName,
          guardianMobile: guardian.guardianMobile,
          guardianEmail: guardian.guardianEmail,
          targetYear: guardian.targetYear,
          dateOfBirth: guardian.dateOfBirth,
          razorpayPaymentId,
          razorpayOrderId,
        }),
      });
      return { success: res.ok };
    } else if (itemType === 'subscription_plan') {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/complete-subscription-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          planId: orderItem.plan_id,
          courseId: orderItem.course_id,
          orderId,
          profileId,
          guardianName: guardian.guardianName,
          guardianMobile: guardian.guardianMobile,
          guardianEmail: guardian.guardianEmail,
          targetYear: guardian.targetYear,
          dateOfBirth: guardian.dateOfBirth,
          razorpayPaymentId,
          razorpayOrderId,
        }),
      });
      return { success: res.ok };
    } else if (itemType === 'installment') {
      let internalPaymentId = razorpayPaymentId;
      const { data: payRow } = await serviceClient
        .from('payments')
        .select('payment_id')
        .eq('order_id', orderId)
        .order('attempt_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (payRow?.payment_id) {
        internalPaymentId = payRow.payment_id;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/complete-installment-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          planId: orderItem.installment_plan_id,
          orderId,
          profileId,
          paymentId: internalPaymentId,
          guardianName: guardian.guardianName,
          guardianMobile: guardian.guardianMobile,
          guardianEmail: guardian.guardianEmail,
          targetYear: guardian.targetYear,
          dob: guardian.dateOfBirth,
          internal: true,
        }),
      });
      return { success: res.ok };
    }
  } catch (err) {
    structuredError('TRIGGER_FULFILLMENT_FETCH_ERROR', {
      orderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, message: String(err) };
  }

  return { success: true };
}

/**
 * Reconciles an external Razorpay Order that has already been marked paid by Razorpay.
 * Fetches underlying payments, validates amounts and currencies, distinguishes captured vs.
 * refunded states, ensures single settled-payment invariant, and safely fulfills or cancels.
 */
async function reconcilePaidRazorpayOrder(
  serviceClient: any,
  razorpay: any,
  orderId: string,
  razorpayOrderId: string,
  expectedAmountInPaise: number,
  expectedCurrency: string,
  claimantId: string,
): Promise<PaidReconciliationResult> {
  try {
    structuredLog('RECONCILING_PAID_RAZORPAY_ORDER_START', {
      orderId,
      razorpayOrderId,
      expectedAmountInPaise,
      expectedCurrency,
    });

    const paymentsRes = await razorpay.orders.fetchPayments(razorpayOrderId);
    const items: any[] = paymentsRes?.items ?? [];

    const orderPayments = items.filter((p: any) => p.order_id === razorpayOrderId);
    const settledPayments = orderPayments.filter(
      (p: any) => p.status === 'captured' || p.status === 'refunded' || Number(p.amount_refunded || 0) > 0,
    );

    if (settledPayments.length === 0) {
      structuredError('RECONCILE_PAID_NO_SETTLED_PAYMENTS', {
        orderId,
        razorpayOrderId,
        totalPayments: orderPayments.length,
      });
      return { success: false, status: 'UNVERIFIED', error: 'No settled payment found on paid Razorpay order' };
    }

    if (settledPayments.length > 1) {
      structuredError('RECONCILE_PAID_MULTIPLE_SETTLED_PAYMENTS', {
        orderId,
        razorpayOrderId,
        count: settledPayments.length,
        paymentIds: settledPayments.map((p: any) => p.id),
      });
      return { success: false, status: 'AMBIGUOUS', error: 'Multiple settled payments found on Razorpay order' };
    }

    const payment = settledPayments[0];

    // Validate payment properties
    if (typeof payment.id !== 'string' || !payment.id.startsWith('pay_')) {
      structuredError('RECONCILE_PAID_INVALID_PAYMENT_ID', { orderId, paymentId: payment.id });
      return { success: false, status: 'UNVERIFIED', error: 'Invalid Razorpay payment ID format' };
    }

    if (Number(payment.amount) !== expectedAmountInPaise) {
      structuredError('RECONCILE_PAID_AMOUNT_MISMATCH', {
        orderId,
        expectedAmountInPaise,
        actualAmount: payment.amount,
      });
      return { success: false, status: 'UNVERIFIED', error: 'Payment amount mismatch' };
    }

    if ((payment.currency || 'INR').toUpperCase() !== expectedCurrency.toUpperCase()) {
      structuredError('RECONCILE_PAID_CURRENCY_MISMATCH', {
        orderId,
        expectedCurrency,
        actualCurrency: payment.currency,
      });
      return { success: false, status: 'UNVERIFIED', error: 'Payment currency mismatch' };
    }

    // Determine settlement / refund state
    const amt = Number(payment.amount);
    const refundedAmt = Number(payment.amount_refunded || 0);

    // Contradiction Check 1: Gateway claims full refund, but cumulative amount_refunded is positive and smaller than payment amount
    if ((payment.status === 'refunded' || payment.refund_status === 'full') && refundedAmt > 0 && refundedAmt < amt) {
      structuredError('RECONCILE_PAID_CONTRADICTORY_FULL_REFUND', {
        orderId,
        razorpayOrderId,
        paymentId: payment.id,
        paymentStatus: payment.status,
        refundStatus: payment.refund_status,
        amount: amt,
        amountRefunded: refundedAmt,
      });
      return { success: false, status: 'UNVERIFIED', error: 'Contradictory full refund: refund amount is less than payment amount' };
    }

    // Contradiction Check 2: Gateway claims partial refund, but cumulative amount_refunded equals or exceeds payment amount
    if (payment.refund_status === 'partial' && refundedAmt >= amt) {
      structuredError('RECONCILE_PAID_CONTRADICTORY_PARTIAL_REFUND', {
        orderId,
        razorpayOrderId,
        paymentId: payment.id,
        paymentStatus: payment.status,
        refundStatus: payment.refund_status,
        amount: amt,
        amountRefunded: refundedAmt,
      });
      return { success: false, status: 'UNVERIFIED', error: 'Contradictory partial refund: refund amount equals or exceeds payment amount' };
    }

    const isFullyRefunded = payment.status === 'refunded' || payment.refund_status === 'full' || (refundedAmt > 0 && refundedAmt >= amt);
    const isPartiallyRefunded = !isFullyRefunded && (payment.refund_status === 'partial' || (refundedAmt > 0 && refundedAmt < amt));
    const isCaptured = !isFullyRefunded && !isPartiallyRefunded && (payment.status === 'captured' || payment.captured === true);

    if (!isFullyRefunded && !isPartiallyRefunded && !isCaptured) {
      structuredError('RECONCILE_PAID_UNVERIFIED_STATUS', {
        orderId,
        paymentStatus: payment.status,
        refundStatus: payment.refund_status,
      });
      return { success: false, status: 'UNVERIFIED', error: 'Unrecognized payment settlement state' };
    }

    const amtInRupees = amt / 100;
    let refundAmountInRupees: number | null = null;
    let verifiedRefundGatewayId: string | null = null;
    let allProcessedRefunds: any[] = [];

    if (isFullyRefunded || isPartiallyRefunded) {
      try {
        const refundsRes = await razorpay.payments.refunds(payment.id);
        allProcessedRefunds = (refundsRes?.items ?? []).filter((r: any) => r.status === 'processed');
        const latest = allProcessedRefunds[allProcessedRefunds.length - 1];
        if (typeof latest?.id === 'string' && latest.id.startsWith('rfnd_')) {
          verifiedRefundGatewayId = latest.id;
        }
      } catch (refErr: any) {
        structuredLog('RECONCILE_PAID_FETCH_REFUNDS_LIST_OPTIONAL_ERROR', {
          orderId,
          paymentId: payment.id,
          error: refErr?.message,
        });
      }
    }

    if (isFullyRefunded) {
      if (refundedAmt >= amt) {
        refundAmountInRupees = amtInRupees;
      } else {
        const totalRefundedPaise = allProcessedRefunds.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
        if (totalRefundedPaise >= amt) {
          refundAmountInRupees = amtInRupees;
        } else {
          structuredError('RECONCILE_PAID_UNVERIFIED_FULL_REFUND_AMOUNT', {
            orderId,
            paymentId: payment.id,
            expectedPaise: amt,
            foundPaise: totalRefundedPaise,
          });
          return { success: false, status: 'UNVERIFIED', error: 'Authoritative refund verification failed for full refund' };
        }
      }
    } else if (isPartiallyRefunded) {
      if (refundedAmt > 0 && refundedAmt < amt) {
        refundAmountInRupees = refundedAmt / 100;
      } else {
        const totalRefundedPaise = allProcessedRefunds.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
        if (totalRefundedPaise > 0 && totalRefundedPaise < amt) {
          refundAmountInRupees = totalRefundedPaise / 100;
        } else {
          structuredError('RECONCILE_PAID_PARTIAL_REFUND_AMOUNT_UNAVAILABLE', {
            orderId,
            paymentId: payment.id,
            foundPaise: totalRefundedPaise,
          });
          return { success: false, status: 'UNVERIFIED', error: 'Partial refund amount is unavailable and cannot be verified' };
        }
      }
    } else {
      // Captured payment
      refundAmountInRupees = null;
      verifiedRefundGatewayId = null;
    }

    const targetStatus = isCaptured
      ? 'captured'
      : isFullyRefunded
        ? 'refunded'
        : 'partially_refunded';

    const paymentCreatedAt = payment.created_at
      ? new Date(payment.created_at * 1000).toISOString()
      : new Date().toISOString();

    // Reconcile via dedicated atomic RPC public.reconcile_standard_paid_order
    // Operates under transaction-scoped advisory lock and orders-before-payments lock hierarchy.
    // Enforces monotonic refund transitions (cannot regress to captured or decrease refund amount),
    // verifies exact payment matching (order_id, gateway_order_id, gateway_payment_id),
    // safely resolves NULL gateway_order_id via Option A under lock,
    // registers authentic refund events in public.payment_refund_events,
    // reconciles pending attempts while preserving attempt_number, creates new attempts if prior
    // attempts failed (preserving history), and preserves authentic refund IDs.
    const { data: recData, error: recError } = await serviceClient.rpc(
      'reconcile_standard_paid_order',
      {
        p_order_id: orderId,
        p_gateway_order_id: razorpayOrderId,
        p_gateway_payment_id: payment.id,
        p_payment_status: targetStatus,
        p_amount: amtInRupees,
        p_currency: expectedCurrency,
        p_refund_amount: refundAmountInRupees,
        p_refund_gateway_id: verifiedRefundGatewayId,
        p_paid_at: paymentCreatedAt,
        p_refunded_at: (isFullyRefunded || isPartiallyRefunded) ? new Date().toISOString() : null,
      },
    );

    if (recError || !recData?.success) {
      const recCode = recData?.code || 'RECONCILE_FAILED';
      const recMsg = recError?.message || recData?.error || 'Failed to reconcile paid Razorpay order';

      if (recCode === 'ORDER_SETTLED_BY_DIFFERENT_PAYMENT') {
        structuredError('RECONCILE_PAID_DIFFERENT_PAYMENT_SETTLED', {
          orderId,
          razorpayOrderId,
          paymentId: payment.id,
          conflictPaymentId: recData?.conflict_payment_id,
          conflictGatewayPaymentId: recData?.conflict_gateway_payment_id,
        });
        return { success: false, status: 'AMBIGUOUS', error: 'Order settled by a different payment ID' };
      }

      if (recCode === 'OVER_REFUND_DISCREPANCY') {
        structuredError('RECONCILE_PAID_OVER_REFUND_DISCREPANCY', {
          orderId,
          razorpayOrderId,
          paymentId: payment.id,
          code: recCode,
          error: recMsg,
        });
        return { success: false, status: 'UNVERIFIED', error: 'Over-refund discrepancy detected. Payment flagged for administrator review.' };
      }

      if (recCode === 'ORDER_ALREADY_ASSOCIATED_WITH_ANOTHER_GATEWAY_ORDER') {
        structuredError('RECONCILE_PAID_GATEWAY_ORDER_MISMATCH', {
          orderId,
          razorpayOrderId,
          paymentId: payment.id,
          existingGatewayOrderId: recData?.existing_gateway_order_id,
        });
        return { success: false, status: 'UNVERIFIED', error: 'Order associated with different gateway order' };
      }

      structuredError('RECONCILE_PAID_RPC_FAILED', {
        orderId,
        razorpayOrderId,
        paymentId: payment.id,
        code: recCode,
        error: recMsg,
      });
      return { success: false, status: 'UNVERIFIED', error: recMsg };
    }

    structuredLog('RECONCILE_PAID_RPC_SUCCESS', {
      orderId,
      razorpayOrderId,
      paymentId: payment.id,
      action: recData.action,
      code: recData.code,
      paymentRecordId: recData.payment?.payment_id,
    });

    // Register all processed refunds into payment_refund_events ledger via atomic RPC
    if ((isFullyRefunded || isPartiallyRefunded) && allProcessedRefunds.length > 0) {
      const validRefundEvents = allProcessedRefunds
        .filter((ref: any) => typeof ref.id === 'string' && ref.id.startsWith('rfnd_') && Number(ref.amount) > 0)
        .map((ref: any) => ({
          id: ref.id,
          amount_inr: Number(ref.amount) / 100,
          currency: (typeof ref.currency === 'string' && ref.currency.trim()) ? ref.currency.trim().toUpperCase() : 'INR',
          status: 'processed',
          created_at: ref.created_at ?? Math.floor(Date.now() / 1000),
          gateway_payment_id: (typeof ref.payment_id === 'string' && ref.payment_id.trim()) ? ref.payment_id.trim() : payment.id,
          gateway_order_id: razorpayOrderId,
        }));

      if (validRefundEvents.length > 0) {
        const { data: recoveryRefData, error: recoveryRefError } = await serviceClient.rpc(
          'reconcile_standard_recovery_refunds',
          {
            p_order_id: orderId,
            p_gateway_payment_id: payment.id,
            p_gateway_order_id: razorpayOrderId,
            p_refund_events: validRefundEvents,
            p_gateway_response: payment,
          }
        );

        if (recoveryRefError || recoveryRefData?.success === false) {
          structuredError('RECONCILE_RECOVERY_REFUNDS_FAILED', {
            orderId,
            razorpayOrderId,
            paymentId: payment.id,
            error: recoveryRefError?.message ?? recoveryRefData?.error,
            code: recoveryRefData?.code,
          });
          if (recoveryRefData?.code === 'OVER_REFUND_DISCREPANCY' || recoveryRefData?.requires_admin_review) {
            return {
              success: false,
              status: 'UNVERIFIED',
              reconciled: true,
              canProceedToPayment: false,
              requiresAdminReview: true,
              adminReviewReason: recoveryRefData?.error ?? 'OVER_REFUND_DISCREPANCY',
              paymentId: payment.id,
              razorpayOrderId,
              message: recoveryRefData?.error ?? 'Payment flagged for admin review',
            };
          }
        } else {
          structuredLog('RECONCILE_RECOVERY_REFUNDS_SUCCESS', {
            orderId,
            razorpayOrderId,
            refundCount: validRefundEvents.length,
            ledgerTotal: recoveryRefData?.ledger_processed_total,
          });
        }
      }
    }

    // H2: a gateway-confirmed full refund with no retrievable refund records is a genuine
    // inconsistency. Entitlement revocation and order cancellation have already been applied inside
    // reconcile_standard_paid_order, but no authentic refund id/amount is invented here. The gap is
    // recorded durably on the order and further fulfilment is blocked pending administrator review.
    if (isFullyRefunded && allProcessedRefunds.length === 0) {
      structuredError('RECOVERY_REFUND_LEDGER_DETAILS_UNAVAILABLE', {
        orderId,
        razorpayOrderId,
        paymentId: payment.id,
        targetStatus,
      });

      await serviceClient
        .from('orders')
        .update({
          fulfillment_status: 'requires_review',
          admin_review_reason:
            'REFUND_LEDGER_DETAILS_UNAVAILABLE: gateway reports a full refund for payment ' +
            payment.id +
            ' but returned no refund records. Entitlement revocation applied; ledger detail pending administrator review.',
          updated_at: new Date().toISOString(),
        })
        .eq('order_id', orderId);
    }

    // Fulfillment / refund routing
    if (isCaptured) {
      // Re-verify that the order is actually eligible for confirmation and has not been cancelled by a concurrent refund!
      const { data: confirmedOrder } = await serviceClient
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          cancelled_at: null,
        })
        .eq('order_id', orderId)
        .in('status', ['pending', 'confirmed'])
        .select('order_id, status')
        .maybeSingle();

      if (!confirmedOrder) {
        structuredError('RECONCILE_PAID_ORDER_NOT_CONFIRMED_ALREADY_CANCELLED', {
          orderId,
          razorpayOrderId,
          paymentId: payment.id,
        });
        return { success: false, status: 'UNVERIFIED', error: 'Order is no longer eligible for confirmation (cancelled or refunded)' };
      }

      await triggerOrderFulfillment(serviceClient, orderId, payment.id, razorpayOrderId);

      await serviceClient.rpc('release_standard_order_creation_claim', {
        p_order_id: orderId,
        p_claimant: claimantId,
      });

      structuredLog('RECONCILE_PAID_ORDER_CAPTURED_SUCCESS', {
        orderId,
        razorpayOrderId,
        paymentId: payment.id,
      });

      return {
        success: true,
        status: 'CAPTURED',
        paymentId: payment.id,
      };
    } else {
      // Refunded or partially refunded: NEVER GRANT ACCESS!
      await serviceClient
        .from('orders')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('order_id', orderId);

      await serviceClient.rpc('release_standard_order_creation_claim', {
        p_order_id: orderId,
        p_claimant: claimantId,
      });

      structuredLog('RECONCILE_PAID_ORDER_REFUNDED_PROCESSED', {
        orderId,
        razorpayOrderId,
        status: targetStatus,
        refundAmount: refundAmountInRupees ?? 0,
      });

      return {
        success: true,
        status: isFullyRefunded ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED',
        paymentId: payment.id,
      };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    structuredError('RECONCILE_PAID_ORDER_EXCEPTION', {
      orderId,
      razorpayOrderId,
      error: errorMsg,
    });
    return { success: false, status: 'UNVERIFIED', error: errorMsg };
  }
}

/**
 * Recovers an external Razorpay Order using its deterministic receiptId (rcpt_<order_uuid_hex>).
 * Validates receipt exact match, amount in paise, currency, Order ID format, and status.
 */
async function recoverRazorpayOrderByReceipt(
  razorpay: any,
  receiptId: string,
  expectedAmountInPaise: number,
  expectedCurrency: string,
  orderId: string,
): Promise<ReceiptRecoveryResult> {
  try {
    structuredLog('RECOVERING_RAZORPAY_ORDER_BY_RECEIPT_START', {
      orderId,
      receiptId,
      expectedAmountInPaise,
      expectedCurrency,
    });

    const res = await razorpay.orders.all({
      count: 10,
      receipt: receiptId,
    });

    const items: any[] = res?.items ?? [];
    const matching = items.filter((item: any) => item.receipt === receiptId);

    if (matching.length === 0) {
      structuredLog('RECOVERING_RAZORPAY_ORDER_BY_RECEIPT_NOT_FOUND', { orderId, receiptId });
      return { status: 'NOT_FOUND' };
    }

    if (matching.length > 1) {
      structuredError('RECOVERING_RAZORPAY_ORDER_BY_RECEIPT_MULTIPLE_RESULTS', {
        orderId,
        receiptId,
        count: matching.length,
        orderIds: matching.map((m: any) => m.id),
      });
      return {
        status: 'AMBIGUOUS',
        reason: `Multiple matching Razorpay orders found for receipt ${receiptId} (${matching.length} orders)`,
      };
    }

    const candidate = matching[0];

    // Validation checks per Requirement 3:
    // 1. Receipt exact match (verified above)
    // 2. Expected amount in paise
    if (Number(candidate.amount) !== expectedAmountInPaise) {
      structuredError('RECOVERED_ORDER_AMOUNT_MISMATCH', {
        orderId,
        receiptId,
        expectedAmountInPaise,
        actualAmount: candidate.amount,
      });
      return { status: 'AMBIGUOUS', reason: 'Amount mismatch on recovered order' };
    }

    // 3. Expected currency
    if ((candidate.currency || 'INR').toUpperCase() !== expectedCurrency.toUpperCase()) {
      structuredError('RECOVERED_ORDER_CURRENCY_MISMATCH', {
        orderId,
        receiptId,
        expectedCurrency,
        actualCurrency: candidate.currency,
      });
      return { status: 'AMBIGUOUS', reason: 'Currency mismatch on recovered order' };
    }

    // 4. Correct Razorpay Order ID format
    if (typeof candidate.id !== 'string' || !candidate.id.startsWith('order_')) {
      structuredError('RECOVERED_ORDER_INVALID_ID_FORMAT', {
        orderId,
        receiptId,
        candidateId: candidate.id,
      });
      return { status: 'AMBIGUOUS', reason: 'Invalid Razorpay Order ID format' };
    }

    // 5. Status restrictions: created & attempted are reusable; paid must reconcile; others fail closed
    if (candidate.status === 'created' || candidate.status === 'attempted') {
      structuredLog('RECOVERED_RAZORPAY_ORDER_BY_RECEIPT_SUCCESS', {
        orderId,
        receiptId,
        razorpayOrderId: candidate.id,
        status: candidate.status,
      });

      return {
        status: 'FOUND',
        razorpayOrder: {
          id: candidate.id,
          amount: Number(candidate.amount),
          currency: candidate.currency,
          receipt: candidate.receipt,
          status: candidate.status,
        },
        orderStatus: candidate.status,
      };
    }

    if (candidate.status === 'paid') {
      structuredLog('RECOVERED_RAZORPAY_ORDER_BY_RECEIPT_PAID', {
        orderId,
        receiptId,
        razorpayOrderId: candidate.id,
        status: candidate.status,
      });

      return {
        status: 'PAID',
        razorpayOrder: {
          id: candidate.id,
          amount: Number(candidate.amount),
          currency: candidate.currency,
          receipt: candidate.receipt,
          status: candidate.status,
        },
        orderStatus: 'paid',
      };
    }

    structuredError('RECOVERED_ORDER_INVALID_STATUS', {
      orderId,
      receiptId,
      candidateStatus: candidate.status,
    });
    return { status: 'AMBIGUOUS', reason: `Unsupported Razorpay order status: ${candidate.status}` };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    structuredError('RECOVERING_RAZORPAY_ORDER_BY_RECEIPT_ERROR', {
      orderId,
      receiptId,
      error: errorMsg,
    });
    return { status: 'ERROR', error: errorMsg };
  }
}

async function findPendingReusableOrder(
  serviceClient: any,
  profileId: string,
  productType: ProductType,
  productId: string,
  conversion: boolean,
  razorpay?: any,
  expectedAmountInPaise?: number,
  expectedCurrency?: string,
): Promise<{
  order_id: string;
  razorpayOrderId: string;
  total_amount: number;
  currency: string;
  leaseActive?: boolean;
  retryAfterSeconds?: number;
  alreadyPaid?: boolean;
  isRefunded?: boolean;
  reconciliationError?: string;
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

    // Requirement 3: If razorpayOrderId is already present in notes, verify whether it is settled or paid
    // before ever returning it for checkout reuse.
    if (razorpayOrderId) {
      const { data: localSettled } = await serviceClient
        .from('payments')
        .select('payment_id, status, refund_amount')
        .eq('order_id', order.order_id)
        .eq('gateway', 'razorpay')
        .in('status', ['captured', 'refunded', 'partially_refunded'])
        .limit(1)
        .maybeSingle();

      if (localSettled) {
        if (localSettled.status === 'captured') {
          structuredLog('pending_order_reuse_already_captured_locally', {
            orderId: order.order_id,
            razorpayOrderId,
            paymentId: localSettled.payment_id,
          });
          await serviceClient
            .from('orders')
            .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
            .eq('order_id', order.order_id)
            .eq('status', 'pending');

          await triggerOrderFulfillment(serviceClient, order.order_id, localSettled.payment_id, razorpayOrderId);

          return {
            order_id: order.order_id,
            razorpayOrderId,
            total_amount: Number(order.total_amount ?? 0),
            currency: order.currency ?? 'INR',
            alreadyPaid: true,
          };
        } else {
          structuredLog('pending_order_reuse_refunded_locally', {
            orderId: order.order_id,
            razorpayOrderId,
            status: localSettled.status,
          });
          await serviceClient
            .from('orders')
            .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
            .eq('order_id', order.order_id)
            .eq('status', 'pending');

          return {
            order_id: order.order_id,
            razorpayOrderId,
            total_amount: Number(order.total_amount ?? 0),
            currency: order.currency ?? 'INR',
            isRefunded: true,
          };
        }
      }

      if (razorpay) {
        const claimantId = crypto.randomUUID();
        const targetAmount = expectedAmountInPaise ?? Math.round(Number(order.total_amount ?? 0) * 100);
        const targetCurrency = expectedCurrency ?? (order.currency ?? 'INR');

        try {
          const fetchedOrder = await razorpay.orders.fetch(razorpayOrderId);
          const rzpReceipt = fetchedOrder?.receipt;
          const expectedReceipt = `rcpt_${order.order_id.replace(/-/g, '')}`;

          if (rzpReceipt === expectedReceipt && Number(fetchedOrder.amount) === targetAmount) {
            if (fetchedOrder.status === 'paid') {
              structuredLog('pending_order_reuse_detected_paid_remote', {
                orderId: order.order_id,
                razorpayOrderId,
              });

              const rec = await reconcilePaidRazorpayOrder(
                serviceClient,
                razorpay,
                order.order_id,
                razorpayOrderId,
                targetAmount,
                targetCurrency,
                claimantId,
              );

              if (rec.status === 'CAPTURED') {
                return {
                  order_id: order.order_id,
                  razorpayOrderId,
                  total_amount: Number(order.total_amount ?? 0),
                  currency: order.currency ?? 'INR',
                  alreadyPaid: true,
                };
              } else if (rec.status === 'FULLY_REFUNDED' || rec.status === 'PARTIALLY_REFUNDED') {
                return {
                  order_id: order.order_id,
                  razorpayOrderId,
                  total_amount: Number(order.total_amount ?? 0),
                  currency: order.currency ?? 'INR',
                  isRefunded: true,
                };
              } else {
                return {
                  order_id: order.order_id,
                  razorpayOrderId: '',
                  total_amount: Number(order.total_amount ?? 0),
                  currency: order.currency ?? 'INR',
                  reconciliationError: 'Payment verification is pending. Please retry in a few moments.',
                };
              }
            }

            if (fetchedOrder.status === 'created' || fetchedOrder.status === 'attempted') {
              structuredLog('pending_order_reuse_found', {
                existingOrderId: order.order_id,
                productType,
                productId,
                conversion,
                razorpayOrderId,
                status: fetchedOrder.status,
              });

              return {
                order_id: order.order_id,
                razorpayOrderId,
                total_amount: Number(order.total_amount ?? 0),
                currency: order.currency ?? 'INR',
              };
            }

            continue;
          }
        } catch (fetchErr) {
          structuredError('REUSE_ORDER_FETCH_ERROR', {
            orderId: order.order_id,
            razorpayOrderId,
            error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          });
          return {
            order_id: order.order_id,
            razorpayOrderId: '',
            total_amount: Number(order.total_amount ?? 0),
            currency: order.currency ?? 'INR',
            reconciliationError: 'Unable to verify existing payment order status.',
          };
        }
      }

      return {
        order_id: order.order_id,
        razorpayOrderId,
        total_amount: Number(order.total_amount ?? 0),
        currency: order.currency ?? 'INR',
      };
    }

    // Razorpay Order ID is missing from notes:
    // If razorpay client is provided, coordinate with database lease and perform receipt recovery
    if (razorpay) {
      const claimantId = crypto.randomUUID();
      const receiptId = `rcpt_${order.order_id.replace(/-/g, '')}`;
      const targetAmount = expectedAmountInPaise ?? Math.round(Number(order.total_amount ?? 0) * 100);
      const targetCurrency = expectedCurrency ?? (order.currency ?? 'INR');

      const { data: claimRes, error: claimErr } = await serviceClient.rpc(
        'acquire_standard_order_creation_claim',
        {
          p_order_id: order.order_id,
          p_claimant: claimantId,
          p_lease_seconds: 25,
        }
      );

      if (!claimErr && claimRes) {
        if (claimRes.status === 'ALREADY_SETTLED') {
          if (claimRes.payment_status === 'captured') {
            await serviceClient
              .from('orders')
              .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
              .eq('order_id', order.order_id)
              .eq('status', 'pending');

            if (claimRes.gateway_order_id) {
              await triggerOrderFulfillment(serviceClient, order.order_id, null as any, claimRes.gateway_order_id);
            }

            return {
              order_id: order.order_id,
              razorpayOrderId: claimRes.gateway_order_id || '',
              total_amount: Number(order.total_amount ?? 0),
              currency: order.currency ?? 'INR',
              alreadyPaid: true,
            };
          } else {
            await serviceClient
              .from('orders')
              .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
              .eq('order_id', order.order_id)
              .eq('status', 'pending');

            return {
              order_id: order.order_id,
              razorpayOrderId: claimRes.gateway_order_id || '',
              total_amount: Number(order.total_amount ?? 0),
              currency: order.currency ?? 'INR',
              isRefunded: true,
            };
          }
        }

        if (claimRes.status === 'ALREADY_COMPLETED' && claimRes.gateway_order_id) {
          try {
            const fetchedOrder = await razorpay.orders.fetch(claimRes.gateway_order_id);
            if (fetchedOrder.status === 'paid') {
              const rec = await reconcilePaidRazorpayOrder(
                serviceClient,
                razorpay,
                order.order_id,
                claimRes.gateway_order_id,
                targetAmount,
                targetCurrency,
                claimantId,
              );

              if (rec.status === 'CAPTURED') {
                return {
                  order_id: order.order_id,
                  razorpayOrderId: claimRes.gateway_order_id,
                  total_amount: Number(order.total_amount ?? 0),
                  currency: order.currency ?? 'INR',
                  alreadyPaid: true,
                };
              } else if (rec.status === 'FULLY_REFUNDED' || rec.status === 'PARTIALLY_REFUNDED') {
                return {
                  order_id: order.order_id,
                  razorpayOrderId: claimRes.gateway_order_id,
                  total_amount: Number(order.total_amount ?? 0),
                  currency: order.currency ?? 'INR',
                  isRefunded: true,
                };
              } else {
                return {
                  order_id: order.order_id,
                  razorpayOrderId: '',
                  total_amount: Number(order.total_amount ?? 0),
                  currency: order.currency ?? 'INR',
                  reconciliationError: 'Payment verification is pending. Please retry in a few moments.',
                };
              }
            } else if (fetchedOrder.status === 'created' || fetchedOrder.status === 'attempted') {
              return {
                order_id: order.order_id,
                razorpayOrderId: claimRes.gateway_order_id,
                total_amount: Number(order.total_amount ?? 0),
                currency: order.currency ?? 'INR',
              };
            }
          } catch (fetchErr) {
            return {
              order_id: order.order_id,
              razorpayOrderId: '',
              total_amount: Number(order.total_amount ?? 0),
              currency: order.currency ?? 'INR',
              reconciliationError: 'Unable to verify existing payment order status.',
            };
          }
        }

        if (claimRes.status === 'LEASE_ACTIVE') {
          structuredLog('PENDING_ORDER_REUSE_LEASE_ACTIVE_ANOTHER_WORKER', {
            orderId: order.order_id,
            claimant: claimRes.claimant,
            retryAfter: claimRes.retry_after_seconds,
          });
          return {
            order_id: order.order_id,
            razorpayOrderId: '',
            total_amount: Number(order.total_amount ?? 0),
            currency: order.currency ?? 'INR',
            leaseActive: true,
            retryAfterSeconds: claimRes.retry_after_seconds,
          };
        }

        if (claimRes.status === 'CLAIMED') {
          // Exclusive claim acquired: execute receipt recovery
          const recovery = await recoverRazorpayOrderByReceipt(
            razorpay,
            receiptId,
            targetAmount,
            targetCurrency,
            order.order_id,
          );

          if (recovery.status === 'FOUND') {
            const recoveredId = recovery.razorpayOrder.id;

            // Persist into orders.notes
            // Atomically create standard payment attempt & reserve gateway order under advisory lock
            // Prevents stale workers from associating a conflicting gateway order
            const { data: attemptRes, error: attemptErr } = await serviceClient.rpc('create_standard_payment_attempt', {
              p_order_id: order.order_id,
              p_gateway_order_id: recoveredId,
              p_amount: targetAmount / 100,
              p_currency: targetCurrency,
              p_status: 'pending',
            });

            if (attemptErr || !attemptRes?.success) {
              structuredError('RECOVERED_ORDER_CREATE_ATTEMPT_FAILED', {
                orderId: order.order_id,
                recoveredId,
                code: attemptRes?.code,
                error: attemptErr?.message || attemptRes?.error,
              });
              return {
                order_id: order.order_id,
                razorpayOrderId: '',
                total_amount: Number(order.total_amount || 0),
                currency: order.currency || 'INR',
                reconciliationError: attemptRes?.error || 'Failed to record recovered payment attempt',
              };
            }

            return {
              order_id: order.order_id,
              razorpayOrderId: recoveredId,
              total_amount: Number(order.total_amount ?? 0),
              currency: order.currency ?? 'INR',
            };
          }

          if (recovery.status === 'PAID') {
            const rec = await reconcilePaidRazorpayOrder(
              serviceClient,
              razorpay,
              order.order_id,
              recovery.razorpayOrder.id,
              targetAmount,
              targetCurrency,
              claimantId,
            );

            if (rec.status === 'CAPTURED') {
              return {
                order_id: order.order_id,
                razorpayOrderId: recovery.razorpayOrder.id,
                total_amount: Number(order.total_amount ?? 0),
                currency: order.currency ?? 'INR',
                alreadyPaid: true,
              };
            } else if (rec.status === 'FULLY_REFUNDED' || rec.status === 'PARTIALLY_REFUNDED') {
              return {
                order_id: order.order_id,
                razorpayOrderId: recovery.razorpayOrder.id,
                total_amount: Number(order.total_amount ?? 0),
                currency: order.currency ?? 'INR',
                isRefunded: true,
              };
            } else {
              return {
                order_id: order.order_id,
                razorpayOrderId: '',
                total_amount: Number(order.total_amount ?? 0),
                currency: order.currency ?? 'INR',
                reconciliationError: 'Payment verification is pending. Please retry in a few moments.',
              };
            }
          }

          if (recovery.status === 'NOT_FOUND') {
            // Confirmed: previous creation definitely never completed on Razorpay!
            // Cancel this unlinked dead pending order so it does not block future orders.
            await serviceClient
              .from('orders')
              .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
              .eq('order_id', order.order_id)
              .eq('status', 'pending');

            await serviceClient.rpc('release_standard_order_creation_claim', {
              p_order_id: order.order_id,
              p_claimant: claimantId,
            });

            structuredLog('DEAD_PENDING_ORDER_CANCELLED_AFTER_VERIFIED_ABSENCE', {
              orderId: order.order_id,
              receiptId,
            });
            continue; // Continue scan for other candidates or proceed to fresh creation
          }

          if (recovery.status === 'ERROR' || recovery.status === 'AMBIGUOUS') {
            // Requirement 3C: Do not cancel internal order. Preserve recovery state and report lease active.
            return {
              order_id: order.order_id,
              razorpayOrderId: '',
              total_amount: Number(order.total_amount ?? 0),
              currency: order.currency ?? 'INR',
              leaseActive: true,
              retryAfterSeconds: 3,
            };
          }
        }
      }
    }
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
    else if (productType === 'installment') {
      if (notes.agreementId && notes.agreementId === productId) signatureMatches = true;
      else if (!notes.agreementId && notes.installmentPlanId === productId) signatureMatches = true;
    }
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
    razorpayKey: RAZORPAY_KEY_ID || '',
  });
}


interface InstallmentRecoveryParams {
  serviceClient: any;
  profileId: string;
  agreementId?: string;
  courseId?: string;
  planId?: string;
  knownOrderId?: string;
  knownPaymentId?: string;
  installmentIndex?: number;
  razorpay?: any;
}

/**
 * Handles safe recovery for an existing captured installment payment when a student
 * re-enters installment checkout.
 *
 * Implements authoritative validation, verification against Razorpay gateway where applicable,
 * allocation checks, idempotent fulfillment through complete-installment-purchase,
 * and fail-closed safety for administrator review flags and settlement failures.
 */
async function handleCapturedInstallmentRecovery({
  serviceClient,
  profileId,
  agreementId,
  courseId,
  planId,
  knownOrderId,
  knownPaymentId,
  installmentIndex,
  razorpay,
}: InstallmentRecoveryParams): Promise<Response> {
  structuredLog('CAPTURED_INSTALLMENT_RECOVERY_STARTED', {
    profileId,
    agreementId,
    courseId,
    planId,
    knownOrderId,
    knownPaymentId,
    installmentIndex,
  });

  // 1. Authorize student context
  const { data: studentDetail } = await serviceClient
    .from('student_details')
    .select('student_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  const studentId = studentDetail?.student_id;

  // 2. Resolve & validate agreement
  let targetAgreementId = agreementId;
  let targetPlanId = planId;
  let targetCourseId = courseId;
  let agreementRow: any = null;

  if (targetAgreementId) {
    const { data: agr } = await serviceClient
      .from('student_course_agreements')
      .select('agreement_id, student_id, course_id, plan_id, requires_admin_review, agreement_status')
      .eq('agreement_id', targetAgreementId)
      .maybeSingle();
    agreementRow = agr;
  } else if (targetCourseId && studentId) {
    const { data: agr } = await serviceClient
      .from('student_course_agreements')
      .select('agreement_id, student_id, course_id, plan_id, requires_admin_review, agreement_status')
      .eq('student_id', studentId)
      .eq('course_id', targetCourseId)
      .maybeSingle();
    agreementRow = agr;
    if (agr) {
      targetAgreementId = agr.agreement_id;
    }
  }

  // Security guard: Student authorization check
  if (agreementRow && studentId && agreementRow.student_id !== studentId) {
    structuredError('INSTALLMENT_RECOVERY_UNAUTHORIZED', {
      profileId,
      studentId,
      agreementStudentId: agreementRow.student_id,
      agreementId: targetAgreementId,
    });
    return errorResponse('Unauthorized access to installment agreement.', 403, 'UNAUTHORIZED_AGREEMENT');
  }

  // Security guard: Fail closed if agreement requires administrator review
  if (agreementRow?.requires_admin_review === true) {
    structuredLog('INSTALLMENT_RECOVERY_AGREEMENT_REQUIRES_ADMIN_REVIEW', {
      agreementId: targetAgreementId,
    });
    return errorResponse(
      'This installment agreement requires administrator review before processing can proceed.',
      400,
      'AGREEMENT_PENDING_ADMIN_REVIEW',
    );
  }

  if (agreementRow) {
    targetPlanId = targetPlanId || agreementRow.plan_id;
    targetCourseId = targetCourseId || agreementRow.course_id;
  }

  // 3. Identify the existing eligible installment order
  let orderRow: any = null;
  let orderItemRow: any = null;

  if (knownOrderId) {
    const { data: ord } = await serviceClient
      .from('orders')
      .select('order_id, profile_id, student_id, institute_id, status, fulfillment_status, admin_review_reason, notes, total_amount, currency')
      .eq('order_id', knownOrderId)
      .maybeSingle();
    orderRow = ord;

    const { data: items } = await serviceClient
      .from('order_items')
      .select('item_id, item_type, course_id, installment_plan_id, agreement_id, unit_price, line_total')
      .eq('order_id', knownOrderId)
      .eq('item_type', 'installment');
    orderItemRow = items?.[0];
  } else {
    // Search candidate orders for this agreement / student
    let query = serviceClient
      .from('orders')
      .select(`
        order_id,
        profile_id,
        student_id,
        institute_id,
        status,
        fulfillment_status,
        admin_review_reason,
        notes,
        total_amount,
        currency,
        created_at,
        order_items!inner (
          item_id,
          item_type,
          course_id,
          installment_plan_id,
          agreement_id,
          unit_price,
          line_total
        )
      `)
      .eq('order_items.item_type', 'installment')
      .order('created_at', { ascending: false })
      .limit(10);

    if (studentId) {
      query = query.or(`profile_id.eq.${profileId},student_id.eq.${studentId}`);
    } else {
      query = query.eq('profile_id', profileId);
    }

    const { data: candidateOrders } = await query;

    for (const cand of (candidateOrders || [])) {
      const itm = cand.order_items?.[0];
      const matchesAgr = targetAgreementId ? (itm?.agreement_id === targetAgreementId || (cand.notes && cand.notes.includes(targetAgreementId))) : true;
      let matchesIdx = true;
      if (installmentIndex !== undefined && installmentIndex !== null) {
        try {
          const pNotes = typeof cand.notes === 'string' ? JSON.parse(cand.notes) : (cand.notes || {});
          if (pNotes.installmentIndex && Number(pNotes.installmentIndex) !== Number(installmentIndex)) {
            matchesIdx = false;
          }
        } catch {}
      }
      if (matchesAgr && matchesIdx) {
        orderRow = cand;
        orderItemRow = itm;
        break;
      }
    }
  }

  if (!orderRow) {
    structuredError('INSTALLMENT_RECOVERY_ORDER_NOT_FOUND', {
      profileId,
      targetAgreementId,
      installmentIndex,
    });
    return errorResponse('Eligible installment order not found for recovery.', 404, 'ORDER_NOT_FOUND');
  }

  // Security guard: Order requires admin review
  if (orderRow.fulfillment_status === 'requires_review') {
    structuredLog('INSTALLMENT_RECOVERY_ORDER_REQUIRES_ADMIN_REVIEW', {
      orderId: orderRow.order_id,
      reason: orderRow.admin_review_reason,
    });
    return errorResponse(
      `This installment payment requires administrator review: ${orderRow.admin_review_reason || 'Pending review'}`,
      400,
      'ORDER_PENDING_ADMIN_REVIEW',
    );
  }

  // 4. Identify associated captured payment
  const { data: payments } = await serviceClient
    .from('payments')
    .select('payment_id, order_id, attempt_number, gateway, amount, currency, status, gateway_payment_id, gateway_order_id, paid_at, created_at')
    .eq('order_id', orderRow.order_id)
    .order('attempt_number', { ascending: false });

  let capturedPayment: any = null;
  if (knownPaymentId) {
    capturedPayment = (payments || []).find((p: any) => p.payment_id === knownPaymentId && p.status === 'captured');
  }
  if (!capturedPayment) {
    capturedPayment = (payments || []).find((p: any) => p.status === 'captured');
  }

  // If no captured payment found in DB, check gateway if gateway_order_id is available
  if (!capturedPayment && razorpay) {
    const latestPending = (payments || []).find((p: any) => p.status === 'pending' && p.gateway_order_id);
    if (latestPending) {
      try {
        const expectedPaise = Math.round(Number(orderRow.total_amount) * 100);
        const recResult = await reconcilePaidRazorpayOrder(
          serviceClient,
          razorpay,
          orderRow.order_id,
          latestPending.gateway_order_id,
          expectedPaise,
          orderRow.currency || 'INR',
          'recovery-worker',
        );
        if (recResult.success && recResult.action === 'SETTLED_TO_CAPTURED') {
          const { data: reloadedPay } = await serviceClient
            .from('payments')
            .select('*')
            .eq('order_id', orderRow.order_id)
            .eq('status', 'captured')
            .maybeSingle();
          capturedPayment = reloadedPay;
        }
      } catch (gwErr) {
        structuredLog('GATEWAY_RECHECK_OPTIONAL_ERROR', { error: String(gwErr) });
      }
    }
  }

  if (!capturedPayment) {
    structuredLog('INSTALLMENT_RECOVERY_NO_CAPTURED_PAYMENT', {
      orderId: orderRow.order_id,
    });
    return errorResponse('No captured payment found for this installment order.', 400, 'NO_CAPTURED_PAYMENT');
  }

  // 5. Check whether allocation already exists
  const { data: existingAllocations } = await serviceClient
    .from('installment_payment_allocations')
    .select('allocation_id, payment_id, schedule_id, allocated_amount, created_at')
    .eq('payment_id', capturedPayment.payment_id);

  if (existingAllocations && existingAllocations.length > 0) {
    structuredLog('INSTALLMENT_RECOVERY_ALREADY_ALLOCATED', {
      orderId: orderRow.order_id,
      paymentId: capturedPayment.payment_id,
      allocationCount: existingAllocations.length,
    });

    // Ensure order fulfillment status reflects complete fulfillment
    if (orderRow.status !== 'confirmed' || orderRow.fulfillment_status !== 'fulfilled') {
      await serviceClient
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          cancelled_at: null,
          fulfillment_status: 'fulfilled',
        })
        .eq('order_id', orderRow.order_id);
    }

    return jsonResponse({
      success: true,
      alreadySettled: true,
      recovered: false,
      orderId: orderRow.order_id,
      paymentId: capturedPayment.payment_id,
      message: 'This installment payment has already been settled and allocated.',
      allocationCount: existingAllocations.length,
    }, 200);
  }

  // 6. Invoke the existing complete-installment-purchase fulfillment pipeline
  structuredLog('INVOKING_INSTALLMENT_FULFILLMENT_PIPELINE', {
    orderId: orderRow.order_id,
    paymentId: capturedPayment.payment_id,
    planId: orderItemRow?.installment_plan_id || targetPlanId,
    agreementId: targetAgreementId,
  });

  let notes: any = {};
  try {
    notes = typeof orderRow.notes === 'string' ? JSON.parse(orderRow.notes) : (orderRow.notes || {});
  } catch {}

  const fulfillmentUrl = `${SUPABASE_URL}/functions/v1/complete-installment-purchase`;
  let fulfillmentResp: Response;
  try {
    fulfillmentResp = await fetch(fulfillmentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        planId: orderItemRow?.installment_plan_id || targetPlanId,
        orderId: orderRow.order_id,
        profileId,
        paymentId: capturedPayment.payment_id, // Internal UUID
        guardianName: notes.guardianName || null,
        guardianMobile: notes.guardianMobile || null,
        guardianEmail: notes.guardianEmail || null,
        targetYear: notes.targetYear || null,
        dob: notes.dob || notes.dateOfBirth || null,
        internal: true,
      }),
    });
  } catch (netErr) {
    structuredError('INSTALLMENT_RECOVERY_NETWORK_ERROR', {
      orderId: orderRow.order_id,
      error: netErr instanceof Error ? netErr.message : String(netErr),
    });
    return errorResponse(
      'Network error while attempting installment settlement recovery.',
      500,
      'SETTLEMENT_RECOVERY_FAILED',
    );
  }

  let result: any;
  try {
    result = await fulfillmentResp.json();
  } catch (parseErr) {
    structuredError('INSTALLMENT_RECOVERY_PARSE_ERROR', {
      orderId: orderRow.order_id,
      error: String(parseErr),
    });
    return errorResponse(
      'Failed to parse fulfillment response during installment recovery.',
      500,
      'SETTLEMENT_RECOVERY_FAILED',
    );
  }

  if (result.status === 'requires_review') {
    structuredLog('INSTALLMENT_RECOVERY_REQUIRES_REVIEW', {
      orderId: orderRow.order_id,
      reason: result.reason,
      details: result.details,
    });
    await serviceClient
      .from('orders')
      .update({
        fulfillment_status: 'requires_review',
        admin_review_reason: (result.reason || 'ADMIN_REVIEW_REQUIRED') + (result.details ? `: ${result.details}` : ''),
      })
      .eq('order_id', orderRow.order_id);

    return errorResponse(
      `Installment payment requires administrative review: ${result.reason || 'ADMIN_REVIEW_REQUIRED'}`,
      400,
      'SETTLEMENT_REVIEW_REQUIRED',
    );
  }

  if (!fulfillmentResp.ok || !result.success) {
    structuredError('INSTALLMENT_RECOVERY_SETTLEMENT_FAILED', {
      orderId: orderRow.order_id,
      paymentId: capturedPayment.payment_id,
      error: result.error,
    });

    // Requirement 4: Failure handling
    // Preserve captured payment, keep installment unpaid, do not mark order fulfilled, record diagnostics
    await serviceClient
      .from('orders')
      .update({
        fulfillment_status: 'failed',
      })
      .eq('order_id', orderRow.order_id);

    return errorResponse(
      result.error || 'Installment settlement recovery failed.',
      500,
      'SETTLEMENT_RECOVERY_FAILED',
    );
  }

  // 7. Verify that an allocation was actually created before marking order fulfilled
  const { data: verifiedAllocations } = await serviceClient
    .from('installment_payment_allocations')
    .select('allocation_id')
    .eq('payment_id', capturedPayment.payment_id)
    .limit(1);

  if (!verifiedAllocations || verifiedAllocations.length === 0) {
    structuredError('INSTALLMENT_RECOVERY_ALLOCATION_NOT_FOUND_AFTER_FULFILLMENT', {
      orderId: orderRow.order_id,
      paymentId: capturedPayment.payment_id,
    });
    return errorResponse(
      'Fulfillment completed but payment allocation could not be verified in database.',
      500,
      'ALLOCATION_VERIFICATION_FAILED',
    );
  }

  // 8. Success: Mark order fulfilled and confirmed
  await serviceClient
    .from('orders')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      cancelled_at: null,
      fulfillment_status: 'fulfilled',
    })
    .eq('order_id', orderRow.order_id);

  structuredLog('INSTALLMENT_RECOVERY_SUCCESS', {
    orderId: orderRow.order_id,
    paymentId: capturedPayment.payment_id,
    studentId: result.studentId,
    agreementId: result.agreementId,
    enrollmentId: result.enrollmentId,
  });

  return jsonResponse({
    success: true,
    recovered: true,
    alreadySettled: false,
    orderId: orderRow.order_id,
    paymentId: capturedPayment.payment_id,
    studentId: result.studentId,
    agreementId: result.agreementId,
    enrollmentId: result.enrollmentId,
    settlement: result.settlement,
    message: 'Existing captured installment payment was successfully recovered and fulfilled.',
  }, 200);
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
    const installmentPlanId = typeof raw.installmentPlanId === 'string' ? raw.installmentPlanId : undefined;
    const agreementId = typeof raw.agreementId === 'string' && raw.agreementId.trim().length > 0 ? raw.agreementId.trim() : undefined;
    // Phase 11K.5: Full Course conversion — a discounted one-time course
    // purchase. Only meaningful together with courseId.
    const conversion = raw.conversion === true;

    const hasCourse = !!courseId;
    const hasPackage = !!packageId;
    const hasPlan = !!planId;
    const hasInstallment = !!installmentPlanId;
    const hasAgreement = !!agreementId;

    // Phase 11H.1 contract — only these combinations are valid:
    //   courseId only      → course purchase
    //   packageId only     → PYQ package purchase
    //   planId + courseId  → subscription plan purchase
    if (!hasCourse && !hasPackage && !hasPlan && !hasInstallment && !hasAgreement) {
      return errorResponse(
        'Provide courseId (course purchase), packageId (PYQ purchase), ' +
          'planId with courseId (subscription purchase), installmentPlanId with courseId (installment purchase), ' +
          'or agreementId (subsequent installment payment).',
        400,
        'MISSING_PRODUCT_ID',
      );
    }

    if (hasAgreement) {
      if (hasPackage || hasPlan || conversion) {
        return errorResponse(
          'Invalid combination: agreementId cannot be combined with packageId, planId, or conversion.',
          400,
          'CONFLICTING_PRODUCT_IDS',
        );
      }
      productType = 'installment';
      productId = agreementId;
    } else if (hasInstallment) {
      if (hasPackage || hasPlan || conversion) {
        return errorResponse(
          'Invalid combination: installmentPlanId cannot be combined with packageId, planId, or conversion.',
          400,
          'CONFLICTING_PRODUCT_IDS',
        );
      }
      if (!hasCourse) {
        return errorResponse(
          'installmentPlanId requires courseId: installment plans are course-scoped. ' +
            'Provide both installmentPlanId and the courseId it belongs to.',
          400,
          'INSTALLMENT_REQUIRES_COURSE',
        );
      }
    }

    if (conversion && (hasPackage || hasPlan || hasInstallment || hasAgreement)) {
      // Conversion is only a course-purchase variant (courseId only).
      return errorResponse(
        'Full Course conversion is only valid with courseId (no packageId/planId/installmentPlanId/agreementId).',
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
    } else if (hasAgreement) {
      productType = 'installment';
      productId = agreementId;
    } else if (hasInstallment) {
      // Installment plan purchase — installmentPlanId accompanied by courseId
      productType = 'installment';
      productId = installmentPlanId;
    } else {
      // Course purchase — courseId only.
      productType = 'course';
      productId = courseId as string;
    }

    body = {
      courseId,
      packageId,
      planId,
      installmentPlanId,
      agreementId,
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

  // Transport-level safeguards and baseline socket timeout configuration on Razorpay Axios client
  const razorpayApi = (razorpay as unknown as {
    api?: {
      rq?: {
        defaults?: { timeout?: number };
        interceptors?: { request?: { use?: Function; eject?: Function } };
      };
    };
  })?.api;
  const rqInstance = razorpayApi?.rq;

  // Requirement 3: Confirm that the Axios request interceptor and AbortController are genuinely available
  const isAxiosTransportAvailable =
    typeof AbortController !== 'undefined' &&
    !!rqInstance &&
    !!rqInstance.interceptors?.request &&
    typeof rqInstance.interceptors.request.use === 'function' &&
    typeof rqInstance.interceptors.request.eject === 'function';

  if (!isAxiosTransportAvailable) {
    structuredError('RAZORPAY_TRANSPORT_SAFEGUARDS_UNAVAILABLE', {
      hasAbortController: typeof AbortController !== 'undefined',
      hasApi: !!razorpayApi,
      hasRq: !!rqInstance,
      hasRequestInterceptor: !!rqInstance?.interceptors?.request,
    });
    return errorResponse(
      'Payment gateway transport safeguards are unavailable. Please contact support.',
      500,
      'GATEWAY_TRANSPORT_SAFEGUARD_UNAVAILABLE',
    );
  }

  if (rqInstance.defaults) {
    rqInstance.defaults.timeout = 7000;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 3b: Installment Plan & Subsequent Agreement Handling
  // ═════════════════════════════════════════════════════════════════════
  if (productType === 'installment') {
    structuredLog('handling_installment_flow', {
      profileId,
      productId,
      agreementId: body.agreementId,
      courseId: body.courseId,
    });

    // 1. Check for reusable pending order
    const reusablePending = await findPendingReusableOrder(
      serviceClient,
      profileId,
      productType,
      productId,
      false,
    );

    if (reusablePending) {
      const rzpId = reusablePending.razorpayOrderId;
      if (rzpId) {
        reusablePending.razorpayOrderId = rzpId;
        let planName = 'Course Installment Plan';
        if (body.agreementId) {
          const { data: ordRow } = await serviceClient
            .from('orders')
            .select('notes')
            .eq('order_id', reusablePending.order_id)
            .single();
          try {
            let pNotes: Record<string, unknown> = {};
            if (typeof ordRow?.notes === 'string') {
              pNotes = JSON.parse(ordRow.notes);
            } else if (ordRow?.notes && typeof ordRow.notes === 'object') {
              pNotes = ordRow.notes as Record<string, unknown>;
            }
            planName = `${pNotes.courseName || 'Course'} - Installment #${pNotes.installmentIndex || 'Payment'}`;
          } catch {
            planName = 'Installment Payment';
          }
        } else {
          const { data: planRow } = await serviceClient
            .from('course_installment_plans')
            .select('plan_name')
            .eq('plan_id', productId)
            .maybeSingle();
          planName = planRow?.plan_name || 'Course Installment Plan';
        }
        return reuseSuccessResponse(reusablePending, planName);
      }
    }

    // 2. Validate course active state if courseId is available
    if (body.courseId) {
      const { data: courseRow } = await serviceClient
        .from('courses')
        .select('course_id, is_active')
        .eq('course_id', body.courseId)
        .maybeSingle();

      if (courseRow && !courseRow.is_active) {
        return errorResponse('This course is no longer available.', 410, 'COURSE_INACTIVE');
      }
    }

    // 3. Atomic Order Reservation RPC (ACID reservation in DB)
    let reserveRes: any;
    let rpcError: any;

    if (body.agreementId) {
      structuredLog('reserving_subsequent_installment_order', {
        agreementId: body.agreementId,
        profileId,
      });

      const subRes = await serviceClient.rpc(
        'reserve_subsequent_installment_order',
        {
          p_profile_id: profileId,
          p_agreement_id: body.agreementId,
        },
      );
      reserveRes = subRes.data;
      rpcError = subRes.error;
    } else {
      const initRes = await serviceClient.rpc(
        'reserve_installment_order',
        {
          p_profile_id: profileId,
          p_course_id: body.courseId,
          p_plan_id: productId,
          p_guardian_name: body.guardianName || null,
          p_guardian_mobile: body.guardianMobile || null,
          p_guardian_email: body.guardianEmail || null,
          p_target_year: body.targetYear || null,
          p_dob: body.dob || null,
        },
      );
      reserveRes = initRes.data;
      rpcError = initRes.error;
    }

    if (rpcError) {
      structuredError('RESERVE_INSTALLMENT_RPC_ERROR', { error: rpcError.message });
      return errorResponse(
        `Failed to reserve installment order: ${rpcError.message}`,
        500,
        'RESERVATION_RPC_FAILED',
      );
    }

    let res: any = reserveRes;
    if (typeof res === 'string') {
      try {
        res = JSON.parse(res);
      } catch (_e) {
        // Keep raw
      }
    }

    if (!res || typeof res !== 'object') {
      structuredError('INVALID_RESERVATION_RESPONSE', { reserveRes });
      return errorResponse(
        'Failed to reserve installment order: invalid database response.',
        500,
        'INVALID_RPC_RESPONSE',
      );
    }

    if (!res.success) {
      if (res.code === 'INSTALLMENT_ALREADY_PAID') {
        return await handleCapturedInstallmentRecovery({
          serviceClient,
          profileId,
          agreementId: body.agreementId,
          installmentIndex: res.installment_index,
          razorpay,
        });
      }
      const statusCode = res.code === 'ALREADY_OWNED' || res.code === 'AGREEMENT_ALREADY_EXISTS' ? 409 : 400;
      return errorResponse(res.error || 'Installment reservation failed', statusCode, res.code);
    } 

    const orderId = res.order_id;
    const paymentId = res.payment_id;
    const attemptNumber = res.attempt_number || 1;
    const receiptId = res.receipt_id;
    const amountInPaise = res.amount_paise;
    const currency = res.currency;
    const planName = res.plan_name;
    const courseName = res.course_name;

    if (!orderId || !paymentId || !receiptId) {
      structuredError('INVALID_RESERVATION_PAYMENT_METADATA', { res });
      return errorResponse(
        'Failed to reserve installment order: missing required payment identifiers.',
        500,
        'INVALID_RPC_RESPONSE',
      );
    }

    // Resolve institute_id
    const { data: profRow } = await serviceClient
      .from('profiles')
      .select('institute_id')
      .eq('profile_id', profileId)
      .single();
    const instId = profRow?.institute_id || '';

    // =========================================================================
    // FIX 1 & CONCURRENCY CONTROL: Transport-Level Timeout & Safe Lease Helpers
    // =========================================================================

    /**
     * Executes a Razorpay SDK call with real transport-level cancellation and timeout.
     * 
     * Safeguards (Requirement 3):
     * Verifies that the internal Axios client, request interceptor, and AbortController are
     * genuinely available on the resolved Razorpay instance. If any required component is
     * unavailable, fails closed rather than silently relying on Promise.race() alone.
     */
    const callRazorpayWithTransportTimeout = async <T>(
      razorpayInstance: any,
      fn: () => Promise<T>,
      ms: number,
      label: string,
    ): Promise<T> => {
      // 1. Confirm AbortController availability
      if (typeof AbortController === 'undefined') {
        structuredError('ABORT_CONTROLLER_UNAVAILABLE', { label });
        throw new Error(
          `Transport safeguard failure: AbortController is unavailable for ${label}. Failing closed.`
        );
      }

      // 2. Confirm Axios client and interceptor availability on Razorpay instance
      const rq = razorpayInstance?.api?.rq;
      const hasInterceptor =
        rq &&
        rq.interceptors &&
        rq.interceptors.request &&
        typeof rq.interceptors.request.use === 'function' &&
        typeof rq.interceptors.request.eject === 'function';

      if (!hasInterceptor) {
        structuredError('RAZORPAY_AXIOS_INTERCEPTOR_UNAVAILABLE', {
          label,
          hasApi: !!razorpayInstance?.api,
          hasRq: !!rq,
          hasInterceptors: !!rq?.interceptors,
          hasRequestInterceptor: !!rq?.interceptors?.request,
        });
        throw new Error(
          `Transport safeguard failure: Razorpay Axios request interceptor is unavailable for ${label}. Failing closed.`
        );
      }

      const controller = new AbortController();
      let interceptorId: number | null = null;

      try {
        interceptorId = rq.interceptors.request.use((config: any) => {
          config.signal = controller.signal;
          config.timeout = ms;
          return config;
        });
      } catch (interceptorErr: unknown) {
        structuredError('FAILED_TO_ATTACH_AXIOS_INTERCEPTOR', {
          label,
          error: interceptorErr instanceof Error ? interceptorErr.message : String(interceptorErr),
        });
        throw new Error(
          `Transport safeguard failure: could not register Axios request interceptor for ${label}. Failing closed.`
        );
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} transport timed out after ${ms}ms`));
        }, ms);
      });

      try {
        return await Promise.race([fn(), timeoutPromise]);
      } catch (err: unknown) {
        controller.abort();
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        if (interceptorId !== null) {
          try {
            rq.interceptors.request.eject(interceptorId);
          } catch {
            // Eject silently
          }
        }
      }
    };

    /**
     * Structured claim lease renewal result
     */
    interface ClaimLeaseResult {
      success: boolean;
      status: 'CLAIMED' | 'ALREADY_COMPLETED' | 'ALREADY_CAPTURED' | 'STALE_FAILED_ATTEMPT' | 'LEASE_ACTIVE' | 'ERROR';
      gatewayOrderId?: string;
      error?: string;
    }

    /**
     * Safe lease renewal helper
     * Atomically extends the lease duration in the database for the exact payment attempt.
     * Returns structured result distinguishing CLAIMED vs ALREADY_COMPLETED vs errors.
     */
    const safeRenewClaimLease = async (
      client: any,
      ordId: string,
      claimant: string,
      leaseSec = 15,
      pmtId?: string,
    ): Promise<ClaimLeaseResult> => {
      try {
        const { data: renewalData, error: renewalErr } = await client.rpc(
          'acquire_gateway_order_claim',
          {
            p_order_id: ordId,
            p_claimant: claimant,
            p_lease_seconds: leaseSec,
            p_payment_id: pmtId || null,
          },
        );

        if (renewalErr) {
          return {
            success: false,
            status: 'ERROR',
            error: renewalErr.message || 'RPC_ERROR',
          };
        }

        if (!renewalData || typeof renewalData !== 'object') {
          return {
            success: false,
            status: 'ERROR',
            error: 'EMPTY_RPC_RESPONSE',
          };
        }

        if (renewalData.status === 'CLAIMED') {
          return {
            success: true,
            status: 'CLAIMED',
          };
        }

        if (renewalData.status === 'ALREADY_COMPLETED') {
          const gwId = renewalData.gateway_order_id;
          if (typeof gwId === 'string' && gwId.startsWith('order_')) {
            return {
              success: true,
              status: 'ALREADY_COMPLETED',
              gatewayOrderId: gwId,
            };
          }
          // ALREADY_COMPLETED missing valid gateway_order_id fails closed!
          return {
            success: false,
            status: 'ERROR',
            error: 'ALREADY_COMPLETED_MISSING_GATEWAY_ORDER_ID',
          };
        }

        if (renewalData.status === 'ALREADY_CAPTURED') {
          return {
            success: false,
            status: 'ERROR',
            error: 'INSTALLMENT_ALREADY_PAID',
          };
        }

        if (renewalData.status === 'STALE_FAILED_ATTEMPT') {
          return {
            success: false,
            status: 'ERROR',
            error: 'PAYMENT_ATTEMPT_FAILED',
          };
        }

        if (renewalData.status === 'LEASE_ACTIVE') {
          return {
            success: false,
            status: 'LEASE_ACTIVE',
            error: 'LEASE_ACTIVE_HELD_BY_OTHER',
          };
        }

        return {
          success: false,
          status: 'ERROR',
          error: `UNEXPECTED_STATUS_${renewalData.status}`,
        };
      } catch (err: unknown) {
        return {
          success: false,
          status: 'ERROR',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    // =========================================================================
    // 4. Single-Creator Gateway Order Creation & Synchronization
    // =========================================================================
    // Prevents concurrent workers from creating duplicate Razorpay orders for the same internal order
    // and guarantees that retries on failed payments receive new attempts, distinct receipts, and fresh gateway orders.
    let finalRazorpayOrderId: string | null = null;

    // 4a. Immediate check: was gateway_order_id already returned by the reservation RPC?
    // ONLY adopt if confirmed to belong to the exact returned paymentId AND that payment row is still pending.
    if (res.reused && res.razorpay_order_id && paymentId) {
      const { data: checkPmt } = await serviceClient
        .from('payments')
        .select('status, gateway_order_id')
        .eq('payment_id', paymentId)
        .maybeSingle();

      if (checkPmt?.status === 'captured') {
        return errorResponse(
          'This installment has already been settled.',
          400,
          'INSTALLMENT_ALREADY_PAID',
        );
      } else if (
        checkPmt?.status === 'pending' &&
        checkPmt.gateway_order_id === res.razorpay_order_id &&
        typeof res.razorpay_order_id === 'string' &&
        res.razorpay_order_id.startsWith('order_')
      ) {
        finalRazorpayOrderId = res.razorpay_order_id;
        structuredLog('REUSING_CONFIRMED_PENDING_GATEWAY_ORDER_FROM_RESERVATION', {
          orderId,
          paymentId,
          attemptNumber,
          razorpayOrderId: finalRazorpayOrderId,
        });
      } else {
        structuredLog('DISCARDING_UNCONFIRMED_GATEWAY_ORDER_FROM_RESERVATION', {
          orderId,
          paymentId,
          rpcGatewayOrderId: res.razorpay_order_id,
          actualStatus: checkPmt?.status,
          actualGatewayOrderId: checkPmt?.gateway_order_id,
        });
      }
    }

    // 4b. Immediate check: check payments table in DB scoped to the exact paymentId and status = 'pending'
    if (!finalRazorpayOrderId && paymentId) {
      const { data: existingPaymentRow } = await serviceClient
        .from('payments')
        .select('status, gateway_order_id')
        .eq('payment_id', paymentId)
        .maybeSingle();

      if (existingPaymentRow?.status === 'captured') {
        return errorResponse(
          'This installment has already been settled.',
          400,
          'INSTALLMENT_ALREADY_PAID',
        );
      } else if (
        existingPaymentRow?.status === 'pending' &&
        existingPaymentRow?.gateway_order_id &&
        typeof existingPaymentRow.gateway_order_id === 'string' &&
        existingPaymentRow.gateway_order_id.startsWith('order_')
      ) {
        finalRazorpayOrderId = existingPaymentRow.gateway_order_id;
        structuredLog('REUSING_CONFIRMED_PENDING_GATEWAY_ORDER_FROM_PAYMENTS_TABLE', {
          orderId,
          paymentId,
          attemptNumber,
          razorpayOrderId: finalRazorpayOrderId,
        });
      }
    }

    // 4c. Single-Creator Claim & Polling Pipeline (Strict Fail-Closed Single Creator)
    if (!finalRazorpayOrderId) {
      const claimantId = crypto.randomUUID();
      let hasClaim = false;
      let claimAcquiredAt = 0;
      let claimAcquisitionError: string | null = null;

      try {
        const { data: claimData, error: claimErr } = await serviceClient.rpc(
          'acquire_gateway_order_claim',
          {
            p_order_id: orderId,
            p_claimant: claimantId,
            p_lease_seconds: 15,
            p_payment_id: paymentId,
          },
        );

        if (claimErr) {
          claimAcquisitionError = claimErr.message || 'CLAIM_RPC_ERROR';
          structuredError('GATEWAY_CLAIM_RPC_ERROR', { error: claimErr.message, orderId, paymentId });
        } else if (!claimData) {
          claimAcquisitionError = 'EMPTY_CLAIM_RESPONSE';
          structuredError('GATEWAY_CLAIM_EMPTY_DATA', { orderId, paymentId });
        } else if (claimData.status === 'ALREADY_CAPTURED') {
          return errorResponse(
            'This installment has already been settled.',
            400,
            'INSTALLMENT_ALREADY_PAID',
          );
        } else if (claimData.status === 'STALE_FAILED_ATTEMPT') {
          return errorResponse(
            'Payment attempt is no longer valid. Please try checking out again.',
            409,
            'PAYMENT_ATTEMPT_STALE',
          );
        } else if (claimData.status === 'ALREADY_COMPLETED' && claimData.gateway_order_id) {
          finalRazorpayOrderId = claimData.gateway_order_id;
          structuredLog('GATEWAY_ORDER_CLAIM_ALREADY_COMPLETED', {
            orderId,
            paymentId,
            attemptNumber,
            razorpayOrderId: finalRazorpayOrderId,
          });
        } else if (claimData.status === 'CLAIMED') {
          hasClaim = true;
          claimAcquiredAt = Date.now();
          structuredLog('GATEWAY_ORDER_CLAIM_GRANTED', { orderId, paymentId, claimantId });
        } else if (claimData.status === 'LEASE_ACTIVE') {
          structuredLog('GATEWAY_ORDER_LEASE_ACTIVE_WAITING', {
            orderId,
            paymentId,
            activeClaimant: claimData.claimant,
            expiresAt: claimData.expires_at,
          });

          // Bounded polling loop: poll payments for up to 8 seconds scoped to this exact payment attempt
          const pollStart = Date.now();
          const maxPollMs = 8000;
          while (Date.now() - pollStart < maxPollMs) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            const { data: polledPayment } = await serviceClient
              .from('payments')
              .select('status, gateway_order_id')
              .eq('payment_id', paymentId)
              .maybeSingle();

            if (polledPayment?.status === 'captured') {
              return await handleCapturedInstallmentRecovery({
                serviceClient,
                profileId,
                agreementId: body.agreementId,
                knownOrderId: orderId,
                knownPaymentId: paymentId,
                razorpay,
              });
            }
            if (
              polledPayment?.status === 'pending' &&
              polledPayment.gateway_order_id &&
              typeof polledPayment.gateway_order_id === 'string' &&
              polledPayment.gateway_order_id.startsWith('order_')
            ) {
              finalRazorpayOrderId = polledPayment.gateway_order_id;
              structuredLog('GATEWAY_ORDER_ACQUIRED_VIA_POLLING', {
                orderId,
                paymentId,
                razorpayOrderId: finalRazorpayOrderId,
              });
              break;
            }
          }

          // Immediate recheck of payments table if polling finished without an ID
          if (!finalRazorpayOrderId) {
            const { data: finalPaymentCheck } = await serviceClient
              .from('payments')
              .select('status, gateway_order_id')
              .eq('payment_id', paymentId)
              .maybeSingle();

            if (finalPaymentCheck?.status === 'captured') {
              return await handleCapturedInstallmentRecovery({
                serviceClient,
                profileId,
                agreementId: body.agreementId,
                knownOrderId: orderId,
                knownPaymentId: paymentId,
                razorpay,
              });
            }
            if (
              finalPaymentCheck?.status === 'pending' &&
              finalPaymentCheck.gateway_order_id &&
              typeof finalPaymentCheck.gateway_order_id === 'string' &&
              finalPaymentCheck.gateway_order_id.startsWith('order_')
            ) {
              finalRazorpayOrderId = finalPaymentCheck.gateway_order_id;
              structuredLog('GATEWAY_ORDER_ACQUIRED_VIA_FINAL_PAYMENT_RECHECK', {
                orderId,
                paymentId,
                razorpayOrderId: finalRazorpayOrderId,
              });
            }
          }

          // Check orders.notes backup ONLY if metadata matches the exact current paymentId
          if (!finalRazorpayOrderId) {
            const { data: finalOrderCheck } = await serviceClient
              .from('orders')
              .select('notes')
              .eq('order_id', orderId)
              .maybeSingle();

            try {
              let ordNotes: Record<string, unknown> = {};
              if (typeof finalOrderCheck?.notes === 'string') {
                ordNotes = JSON.parse(finalOrderCheck.notes);
              } else if (finalOrderCheck?.notes && typeof finalOrderCheck.notes === 'object') {
                ordNotes = finalOrderCheck.notes as Record<string, unknown>;
              }
              if (
                typeof ordNotes.razorpayOrderId === 'string' &&
                ordNotes.razorpayOrderId.startsWith('order_') &&
                ordNotes.paymentId === paymentId
              ) {
                finalRazorpayOrderId = ordNotes.razorpayOrderId;
                structuredLog('GATEWAY_ORDER_ACQUIRED_VIA_FINAL_ORDER_RECHECK', {
                  orderId,
                  paymentId,
                  razorpayOrderId: finalRazorpayOrderId,
                });
              }
            } catch {
              // Ignore parse errors
            }
          }

          // If still not resolved, attempt claim takeover scoped to paymentId:
          // If the original lease expired (e.g. claimant crashed), takeover is granted.
          if (!finalRazorpayOrderId) {
            const { data: retryClaim, error: retryErr } = await serviceClient.rpc(
              'acquire_gateway_order_claim',
              {
                p_order_id: orderId,
                p_claimant: claimantId,
                p_lease_seconds: 15,
                p_payment_id: paymentId,
              },
            );

            if (!retryErr && retryClaim) {
              if (retryClaim.status === 'ALREADY_CAPTURED') {
                return await handleCapturedInstallmentRecovery({
                  serviceClient,
                  profileId,
                  agreementId: body.agreementId,
                  knownOrderId: orderId,
                  knownPaymentId: paymentId,
                  razorpay,
                });
              } else if (retryClaim.status === 'ALREADY_COMPLETED' && retryClaim.gateway_order_id) {
                finalRazorpayOrderId = retryClaim.gateway_order_id;
              } else if (retryClaim.status === 'CLAIMED') {
                // Definitive claim takeover granted after lease expiration
                hasClaim = true;
                claimAcquiredAt = Date.now();
                structuredLog('GATEWAY_ORDER_CLAIM_TAKEOVER_GRANTED', {
                  orderId,
                  paymentId,
                  claimantId,
                });
              } else if (retryClaim.status === 'LEASE_ACTIVE') {
                // Another worker still holds the lease and is active. Fail closed!
                structuredLog('GATEWAY_ORDER_CLAIM_STILL_ACTIVE_FAIL_CLOSED', {
                  orderId,
                  paymentId,
                  activeClaimant: retryClaim.claimant,
                  expiresAt: retryClaim.expires_at,
                });
              } else {
                structuredError('GATEWAY_ORDER_RETRY_CLAIM_UNEXPECTED_STATUS', { retryClaim });
              }
            } else {
              structuredError('GATEWAY_ORDER_RETRY_CLAIM_ERROR', { error: retryErr?.message });
            }
          }
        } else {
          // Unexpected status fails closed
          claimAcquisitionError = `UNEXPECTED_STATUS_${claimData.status}`;
          structuredError('GATEWAY_CLAIM_UNEXPECTED_STATUS', { claimData, orderId, paymentId });
        }
      } catch (rpcEx) {
        claimAcquisitionError = rpcEx instanceof Error ? rpcEx.message : String(rpcEx);
        structuredError('GATEWAY_CLAIM_RPC_EXCEPTION', { error: claimAcquisitionError, orderId, paymentId });
      }

      // Pre-failure check: check whether gateway_order_id was durably persisted on this exact payment attempt
      if (!finalRazorpayOrderId && !hasClaim) {
        const { data: fallbackPayment } = await serviceClient
          .from('payments')
          .select('status, gateway_order_id')
          .eq('payment_id', paymentId)
          .maybeSingle();

        if (fallbackPayment?.status === 'captured') {
          return await handleCapturedInstallmentRecovery({
            serviceClient,
            profileId,
            agreementId: body.agreementId,
            knownOrderId: orderId,
            knownPaymentId: paymentId,
            razorpay,
          });
        }
        if (
          fallbackPayment?.status === 'pending' &&
          fallbackPayment?.gateway_order_id &&
          typeof fallbackPayment.gateway_order_id === 'string' &&
          fallbackPayment.gateway_order_id.startsWith('order_')
        ) {
          finalRazorpayOrderId = fallbackPayment.gateway_order_id;
          structuredLog('REUSED_PERSISTED_ORDER_BEFORE_CLAIM_ERROR', {
            orderId,
            paymentId,
            razorpayOrderId: finalRazorpayOrderId,
          });
        }
      }

      // If we do not possess a definitive CLAIMED status and have no persisted order, return retryable HTTP 503
      if (!finalRazorpayOrderId && !hasClaim) {
        structuredError('GATEWAY_ORDER_CLAIM_FAILED_CLOSED', {
          orderId,
          paymentId,
          claimantId,
          error: claimAcquisitionError,
        });
        return errorResponse(
          'Payment order is currently being prepared. Please try again in a few moments.',
          503,
          'GATEWAY_ORDER_PENDING',
        );
      }

    /**
     * Validates and selects a recovered Razorpay order by receipt.
     * Enforces strict attempt correlation:
     * 1. Exact receipt equals the current receiptId.
     * 2. notes.payment_id equals the current paymentId.
     * 3. notes.attempt_number matches the current attemptNumber.
     * 4. amount equals the expected installment amount in paise.
     * 5. currency equals the expected currency.
     * 6. Gateway order ID is valid (starts with 'order_').
     * If multiple orders match, fails closed (ambiguous).
     */
    const validateRecoveredRazorpayOrder = (
      items: any[] | undefined,
      expectedReceipt: string,
      expectedPaymentId: string,
      expectedAttemptNumber: number,
      expectedAmountPaise: number,
      expectedCurrency: string,
      stage: 'pre-check' | 'recovery',
    ): { matchedOrderId: string | null; ambiguous: boolean } => {
      if (!items || !Array.isArray(items) || items.length === 0) {
        return { matchedOrderId: null, ambiguous: false };
      }

      const matchingOrders = items.filter((item: any) => {
        if (!item || typeof item.id !== 'string' || !item.id.startsWith('order_')) {
          return false;
        }
        if (item.receipt !== expectedReceipt) {
          return false;
        }
        const itemPaymentId = item.notes?.payment_id;
        if (!itemPaymentId || itemPaymentId !== expectedPaymentId) {
          return false;
        }
        const itemAttempt = item.notes?.attempt_number;
        if (
          itemAttempt === undefined ||
          itemAttempt === null ||
          String(itemAttempt) !== String(expectedAttemptNumber)
        ) {
          return false;
        }
        if (Number(item.amount) !== Number(expectedAmountPaise)) {
          return false;
        }
        if (
          String(item.currency || '').toUpperCase() !==
          String(expectedCurrency || '').toUpperCase()
        ) {
          return false;
        }
        return true;
      });

      if (matchingOrders.length === 1) {
        return { matchedOrderId: matchingOrders[0].id, ambiguous: false };
      }

      if (matchingOrders.length > 1) {
        structuredError('AMBIGUOUS_RECOVERED_RAZORPAY_ORDERS', {
          stage,
          expectedReceipt,
          expectedPaymentId,
          expectedAttemptNumber,
          matchingCount: matchingOrders.length,
          orderIds: matchingOrders.map((o: any) => o.id),
        });
        return { matchedOrderId: null, ambiguous: true };
      }

      structuredLog('RECOVERED_ORDERS_NO_EXACT_MATCH', {
        stage,
        expectedReceipt,
        expectedPaymentId,
        expectedAttemptNumber,
        itemsCount: items.length,
      });
      return { matchedOrderId: null, ambiguous: false };
    };

      // 4d. The claimed worker creates or recovers the Razorpay order
      // (Only executed when hasClaim === true and no order ID is yet present)
      if (!finalRazorpayOrderId && hasClaim) {
        // Pre-create bounded check: check if an order with this receipt already exists on Razorpay
        try {
          const existingOrders = await callRazorpayWithTransportTimeout(
            razorpay,
            () => razorpay.orders.all({ receipt: receiptId }),
            3000,
            'razorpay.orders.all pre-check',
          );
          const { matchedOrderId, ambiguous } = validateRecoveredRazorpayOrder(
            existingOrders?.items,
            receiptId,
            paymentId,
            attemptNumber,
            amountInPaise,
            currency,
            'pre-check',
          );
          if (ambiguous) {
            return errorResponse(
              'Multiple payment gateway orders detected for this attempt. Please try again in a few moments.',
              503,
              'GATEWAY_ORDER_AMBIGUOUS',
            );
          }
          if (matchedOrderId) {
            finalRazorpayOrderId = matchedOrderId;
            structuredLog('RECOVERED_EXISTING_GATEWAY_ORDER_BY_RECEIPT', {
              orderId,
              paymentId,
              attemptNumber,
              receiptId,
              razorpayOrderId: finalRazorpayOrderId,
            });
          }
        } catch (_lookupErr) {
          // Non-fatal lookup error, proceed to creation renewal
        }

        // Immediately before starting external Razorpay order creation,
        // atomically renew the claim lease in the database to guarantee the full 15s window.
        if (!finalRazorpayOrderId) {
          structuredLog('RENEWING_LEASE_BEFORE_RAZORPAY_CREATE', { orderId, paymentId, claimantId });
          const renewalResult = await safeRenewClaimLease(serviceClient, orderId, claimantId, 15, paymentId);

          if (renewalResult.status === 'ALREADY_CAPTURED') {
            return await handleCapturedInstallmentRecovery({
              serviceClient,
              profileId,
              agreementId: body.agreementId,
              knownOrderId: orderId,
              knownPaymentId: paymentId,
              razorpay,
            });
          }

          if (renewalResult.status === 'ALREADY_COMPLETED' && renewalResult.gatewayOrderId) {
            finalRazorpayOrderId = renewalResult.gatewayOrderId;
            structuredLog('LEASE_RENEWAL_DETECTED_ALREADY_COMPLETED', {
              orderId,
              paymentId,
              razorpayOrderId: finalRazorpayOrderId,
            });
          } else if (renewalResult.status === 'CLAIMED' && renewalResult.success) {
            claimAcquiredAt = Date.now();
            structuredLog('LEASE_RENEWAL_CONFIRMED_BEFORE_CREATE', { orderId, paymentId, claimantId });
          } else {
            structuredError('GATEWAY_ORDER_LEASE_RENEWAL_FAILED_BEFORE_CREATE', {
              orderId,
              paymentId,
              claimantId,
              renewalResult,
            });

            // Pre-error check: check if payments table already has gateway_order_id
            const { data: checkBeforeAbort } = await serviceClient
              .from('payments')
              .select('status, gateway_order_id')
              .eq('payment_id', paymentId)
              .maybeSingle();

            if (checkBeforeAbort?.status === 'captured') {
              return await handleCapturedInstallmentRecovery({
                serviceClient,
                profileId,
                agreementId: body.agreementId,
                knownOrderId: orderId,
                knownPaymentId: paymentId,
                razorpay,
              });
            }
            if (
              checkBeforeAbort?.status === 'pending' &&
              checkBeforeAbort?.gateway_order_id &&
              typeof checkBeforeAbort.gateway_order_id === 'string' &&
              checkBeforeAbort.gateway_order_id.startsWith('order_')
            ) {
              finalRazorpayOrderId = checkBeforeAbort.gateway_order_id;
            } else {
              return errorResponse(
                'Payment order coordination timed out. Please try again in a few moments.',
                503,
                'GATEWAY_ORDER_PENDING',
              );
            }
          }
        }

        // External Razorpay order creation with strict transport-level timeout
        if (!finalRazorpayOrderId) {
          try {
            const createdOrder = await callRazorpayWithTransportTimeout(
              razorpay,
              () => razorpay.orders.create({
                amount: amountInPaise,
                currency,
                receipt: receiptId,
                notes: {
                  profile_id: profileId,
                  institute_id: instId,
                  course_id: body.courseId || res.course_id,
                  installment_plan_id: res.plan_id || productId,
                  order_id: orderId,
                  payment_id: paymentId,
                  attempt_number: String(attemptNumber),
                  ...(body.agreementId ? {
                    agreement_id: body.agreementId,
                    installment_index: String(res.installment_index),
                    is_subsequent_installment: 'true',
                  } : {}),
                },
              }),
              6000,
              'razorpay.orders.create',
            );
            finalRazorpayOrderId = createdOrder.id;

            structuredLog('installment_razorpay_order_created', {
              orderId,
              paymentId,
              attemptNumber,
              razorpayOrderId: finalRazorpayOrderId,
              receiptId,
            });
          } catch (rzpErr: unknown) {
            structuredLog('RAZORPAY_CREATE_ERROR_ATTEMPTING_RECOVERY', {
              orderId,
              paymentId,
              receiptId,
              error: rzpErr instanceof Error ? rzpErr.message : String(rzpErr),
            });

            try {
              const recoveryRes = await callRazorpayWithTransportTimeout(
                razorpay,
                () => razorpay.orders.all({ receipt: receiptId }),
                3000,
                'razorpay.orders.all recovery',
              );
              const { matchedOrderId, ambiguous } = validateRecoveredRazorpayOrder(
                recoveryRes?.items,
                receiptId,
                paymentId,
                attemptNumber,
                amountInPaise,
                currency,
                'recovery',
              );
              if (ambiguous) {
                return errorResponse(
                  'Multiple payment gateway orders detected during recovery. Please try again in a few moments.',
                  503,
                  'GATEWAY_ORDER_AMBIGUOUS',
                );
              }
              if (matchedOrderId) {
                finalRazorpayOrderId = matchedOrderId;
                structuredLog('RECOVERED_GATEWAY_ORDER_AFTER_CREATE_ERROR', {
                  orderId,
                  paymentId,
                  attemptNumber,
                  receiptId,
                  razorpayOrderId: finalRazorpayOrderId,
                });
              }
            } catch (_recErr) {
              // Bounded recovery failed
            }

            if (!finalRazorpayOrderId) {
              const msg = rzpErr instanceof Error ? rzpErr.message : 'Razorpay order creation failed';
              structuredError('RAZORPAY_INSTALLMENT_ORDER_FAILED', { error: msg, orderId, paymentId, receiptId });
              return errorResponse(
                'Failed to create payment order with gateway. Please try again.',
                502,
                'RAZORPAY_ERROR',
                msg,
              );
            }
          }
        }

        // =========================================================================
        // 5. REQUIRE DURABLE DATABASE PERSISTENCE
        // =========================================================================
        let confirmedPersistedOrderId: string | null = null;

        if (finalRazorpayOrderId && typeof finalRazorpayOrderId === 'string' && finalRazorpayOrderId.startsWith('order_')) {
          const candidateOrderId = finalRazorpayOrderId;

          // 5a. Route checkout persistence through the shared atomic mapping RPC
          // Serializes gateway order association using a transaction-scoped advisory lock
          // on candidateOrderId, preventing competing attempts from claiming the same gateway order.
          const expectedPaymentAmount = Number(res.amount ?? (Number(amountInPaise) / 100));
          const expectedPaymentCurrency = String(currency || 'INR').toUpperCase();

          const { data: mapData, error: mapErr } = await serviceClient.rpc(
            'reconcile_razorpay_gateway_order',
            {
              p_payment_id: paymentId,
              p_gateway_order_id: candidateOrderId,
              p_expected_amount: expectedPaymentAmount,
              p_expected_currency: expectedPaymentCurrency,
              p_event_type: 'checkout',
              p_order_id: orderId,
            }
          );

          if (mapErr) {
            structuredError('CHECKOUT_GATEWAY_ORDER_MAPPING_RPC_ERROR', {
              error: mapErr.message,
              paymentId,
              orderId,
              candidateOrderId,
            });
            return errorResponse(
              'Failed to associate payment gateway order. Please try again.',
              500,
              'GATEWAY_ORDER_PERSISTENCE_FAILED',
              mapErr.message,
            );
          }

          if (!mapData || !mapData.success) {
            structuredError('CHECKOUT_GATEWAY_ORDER_MAPPING_REJECTED', {
              code: mapData?.code,
              error: mapData?.error,
              paymentId,
              orderId,
              candidateOrderId,
            });

            if (mapData?.code === 'ALREADY_MAPPED_TO_ANOTHER_ATTEMPT') {
              return errorResponse(
                'This payment gateway order is already associated with another payment attempt.',
                409,
                'GATEWAY_ORDER_ALREADY_ASSOCIATED',
              );
            }
            if (mapData?.code === 'PAYMENT_STATUS_INELIGIBLE') {
              return errorResponse(
                'Payment attempt is not eligible for checkout order mapping.',
                400,
                'PAYMENT_STATUS_INELIGIBLE',
              );
            }
            if (mapData?.code === 'AMOUNT_OR_CURRENCY_MISMATCH') {
              return errorResponse(
                'Payment amount or currency mismatch with gateway order.',
                400,
                'AMOUNT_OR_CURRENCY_MISMATCH',
              );
            }
            if (mapData?.code === 'INVALID_ORDER_MAPPING') {
              return errorResponse(
                'Payment attempt does not belong to the requested order.',
                400,
                'INVALID_ORDER_MAPPING',
              );
            }

            return errorResponse(
              mapData?.error || 'Failed to map payment gateway order.',
              400,
              mapData?.code || 'GATEWAY_ORDER_MAPPING_FAILED',
            );
          }

          // 5b. Read-Back Verification:
          // Confirm the exact payment_id has the expected gateway_order_id and is still pending
          const { data: verifyRow, error: verifyErr } = await serviceClient
            .from('payments')
            .select('gateway_order_id, status')
            .eq('payment_id', paymentId)
            .maybeSingle();

          if (
            verifyErr ||
            verifyRow?.status !== 'pending' ||
            !verifyRow?.gateway_order_id ||
            verifyRow.gateway_order_id !== candidateOrderId
          ) {
            structuredError('CHECKOUT_GATEWAY_ORDER_PERSISTENCE_CONFIRMATION_FAILED', {
              paymentId,
              expected: candidateOrderId,
              persisted: verifyRow?.gateway_order_id,
              status: verifyRow?.status,
              verifyError: verifyErr?.message,
            });
            confirmedPersistedOrderId = null; // Invalidate: persistence could not be confirmed!
          } else {
            confirmedPersistedOrderId = verifyRow.gateway_order_id;
            structuredLog('CHECKOUT_GATEWAY_ORDER_PERSISTENCE_CONFIRMED', {
              orderId,
              paymentId,
              gatewayOrderId: confirmedPersistedOrderId,
              code: mapData.code,
            });
          }
          // 5e. Sync orders.notes metadata (best effort, secondary)
          if (confirmedPersistedOrderId) {
            try {
              const { data: ordRecord } = await serviceClient
                .from('orders')
                .select('notes')
                .eq('order_id', orderId)
                .maybeSingle();

              let ordNotes: Record<string, unknown> = {};
              if (typeof ordRecord?.notes === 'string') {
                try { ordNotes = JSON.parse(ordRecord.notes); } catch { ordNotes = {}; }
              } else if (ordRecord?.notes && typeof ordRecord.notes === 'object') {
                ordNotes = ordRecord.notes as Record<string, unknown>;
              }
              ordNotes.paymentId = paymentId;
              ordNotes.receiptId = receiptId;
              ordNotes.attemptNumber = attemptNumber;
              ordNotes.razorpayOrderId = confirmedPersistedOrderId;
              await serviceClient
                .from('orders')
                .update({ notes: JSON.stringify(ordNotes) })
                .eq('order_id', orderId);
            } catch (_notesErr) {
              // Non-fatal metadata sync
            }
          }

          // Only adopt the confirmed persisted order ID
          finalRazorpayOrderId = confirmedPersistedOrderId;
        } else {
          finalRazorpayOrderId = null;
        }
      }
    }

    // 5f. Strict validation guard: enforce valid, non-empty, durably confirmed gateway order ID
    if (
      !finalRazorpayOrderId ||
      typeof finalRazorpayOrderId !== 'string' ||
      !finalRazorpayOrderId.startsWith('order_')
    ) {
      structuredError('GATEWAY_ORDER_MISSING_OR_UNCONFIRMED_GUARD', {
        orderId,
        paymentId,
        receiptId,
        finalRazorpayOrderId,
      });
      return errorResponse(
        'Payment gateway order could not be confirmed. Please retry in a few moments.',
        503,
        'GATEWAY_ORDER_PENDING',
      );
    }

    // Final confirmation check: verify against payments table before returning success
    const { data: finalDbVerify } = await serviceClient
      .from('payments')
      .select('gateway_order_id, status')
      .eq('payment_id', paymentId)
      .maybeSingle();

    if (
      !finalDbVerify?.gateway_order_id ||
      finalDbVerify.status !== 'pending' ||
      finalDbVerify.gateway_order_id !== finalRazorpayOrderId
    ) {
      structuredError('FINAL_PERSISTED_ID_VERIFICATION_MISMATCH', {
        paymentId,
        expected: finalRazorpayOrderId,
        persisted: finalDbVerify?.gateway_order_id,
        status: finalDbVerify?.status,
      });
      return errorResponse(
        'Payment gateway order persistence verification failed. Please try again.',
        503,
        'GATEWAY_ORDER_PERSISTENCE_FAILED',
      );
    }
    // 6. Return standard success response
    return jsonResponse({
      success: true,
      reused: res.reused === true,
      orderId,
      paymentId,
      receiptId,
      razorpayOrderId: finalRazorpayOrderId,
      amount: amountInPaise,
      currency,
      itemName: body.agreementId
        ? `${courseName} - Installment #${res.installment_index}`
        : planName,
      courseName,
      description: body.agreementId
        ? `Installment #${res.installment_index} for ${courseName} (${planName})`
        : `First installment for ${courseName} (${planName})`,
      razorpayKey: RAZORPAY_KEY_ID,
    });
  }

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
  // Step 5.5: Pending-order reuse guard & Recovery (Phase 11K.6)
  // ═════════════════════════════════════════════════════════════════════
  // All pricing is computed server-side from the database.
  const { amountInPaise, displayAmount } = calculatePrice(effectivePrice);

  // Only reached when Step 5's access checks passed (not already enrolled /
  // owned / subscribed). A recent PENDING order for the identical purchase
  // is reused — never a second Razorpay order for the same product.
  const reusablePending = await findPendingReusableOrder(
    serviceClient,
    profileId,
    productType,
    productId,
    body.conversion === true,
    razorpay,
    amountInPaise,
    currency,
  );

  if (reusablePending?.leaseActive) {
    return errorResponse(
      'Another payment attempt is currently being initialized. Please try again in a few moments.',
      409,
      'PENDING_ORDER_CONFLICT',
    );
  }

  if (reusablePending?.reconciliationError) {
    return errorResponse(
      reusablePending.reconciliationError,
      504,
      'PAYMENT_VERIFICATION_PENDING',
    );
  }

  if (reusablePending?.alreadyPaid) {
    return errorResponse(
      'This purchase has already been completed and confirmed.',
      409,
      'ORDER_ALREADY_PAID',
    );
  }

  if (reusablePending?.isRefunded) {
    return errorResponse(
      'The previous payment attempt for this order was refunded. Please initiate a new checkout.',
      409,
      'ORDER_REFUNDED',
    );
  }

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
  // Price was pre-calculated for Step 5.5 recovery coordination.

  structuredLog('price_calculated', {
    displayAmount,
    amountInPaise,
    currency,
    productType,
  });

  // =========================================================================
  // Step 7: Create the local order record with deterministic order ID
  // =========================================================================
  // Generate the internal order_id up front so that:
  // 1. The local order record exists in PostgreSQL before calling Razorpay.
  // 2. The Razorpay receipt is constructed deterministically from order_id:
  //    rcpt_<order_id_compact_hex> (37 chars <= 40 chars).
  // 3. If a concurrent duplicate order creation occurs (SQLSTATE 23505),
  //    we recover and reuse the winner's pending order BEFORE calling Razorpay,
  //    preventing orphaned Razorpay orders.
  // =========================================================================
  const orderId = crypto.randomUUID();
  const orderCompactHex = orderId.replace(/-/g, '');
  const receiptId = `rcpt_${orderCompactHex}`;

  structuredLog('creating_local_order', {
    orderId,
    receiptId,
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

  let { data: order, error: orderError } = await serviceClient
    .from('orders')
    .insert({
      order_id: orderId,
      profile_id: profileId,
      institute_id: instituteId,
      student_id: null,          // Not yet created -- will be set during onboarding
      status: 'pending',
      currency,
      subtotal_amount: displayAmount,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: displayAmount,
      notes: buildOrderNotes(productType, productId, productName, null, profileId, guardianFields, body.conversion === true),
    })
    .select('order_id')
    .single();

  if (orderError || !order) {
    // Concurrent pending-order race (SQLSTATE 23505)
    // The partial unique pending-order indexes allow only ONE pending order per (profile, product, conversion).
    // If a concurrent request inserted its order first, recover by re-running the reuse
    // lookup and returning the WINNER's order.
    if (isUniqueViolation(orderError)) {
      const winner = await findPendingReusableOrder(
        serviceClient,
        profileId,
        productType,
        productId,
        body.conversion === true,
        razorpay,
        amountInPaise,
        currency,
      );

      if (winner?.leaseActive) {
        return errorResponse(
          'Another payment attempt is currently being initialized. Please try again in a few moments.',
          409,
          'PENDING_ORDER_CONFLICT',
        );
      }

      if (winner?.reconciliationError) {
        return errorResponse(
          winner.reconciliationError,
          504,
          'PAYMENT_VERIFICATION_PENDING',
        );
      }

      if (winner?.alreadyPaid) {
        return errorResponse(
          'This purchase has already been completed and confirmed.',
          409,
          'ORDER_ALREADY_PAID',
        );
      }

      if (winner?.isRefunded) {
        return errorResponse(
          'The previous payment attempt for this order was refunded. Please initiate a new checkout.',
          409,
          'ORDER_REFUNDED',
        );
      }

      if (winner && winner.razorpayOrderId) {
        // Conversion guard: only reuse when the stored amount still matches
        // the freshly computed amount.
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

      // If dead order was cancelled during recovery, retry local order insertion
      const { data: retryOrder, error: retryOrderError } = await serviceClient
        .from('orders')
        .insert({
          order_id: orderId,
          profile_id: profileId,
          institute_id: instituteId,
          student_id: null,
          status: 'pending',
          currency,
          subtotal_amount: displayAmount,
          discount_amount: 0,
          tax_amount: 0,
          total_amount: displayAmount,
          notes: buildOrderNotes(productType, productId, productName, null as any, profileId, guardianFields, body.conversion === true),
        })
        .select('order_id')
        .single();

      if (!retryOrderError && retryOrder) {
        order = retryOrder;
        orderError = null;
      } else {
        structuredLog('pending_order_conflict_unresolved', {
          productType,
          productId,
          error: retryOrderError?.message || orderError?.message,
        });

        return errorResponse(
          'Another payment attempt is in progress. Please try again.',
          409,
          'PENDING_ORDER_CONFLICT',
        );
      }
    } else {
      structuredLog('local_order_failed', {
        error: orderError?.message,
        orderId,
      });

      return errorResponse(
        'Failed to save order details. Please contact support.',
        500,
        'ORDER_CREATION_FAILED',
        orderError?.message,
      );
    }
  }

  structuredLog('local_order_created', { orderId: order.order_id });

  // =========================================================================
  // Step 8: Create the Razorpay order using deterministic receipt & claim lease
  // =========================================================================
  const claimantId = crypto.randomUUID();
  const { data: claimRes, error: claimErr } = await serviceClient.rpc(
    'acquire_standard_order_creation_claim',
    {
      p_order_id: order.order_id,
      p_claimant: claimantId,
      p_lease_seconds: 30,
    }
  );

  let razorpayOrder: {
    id: string;
    amount: number;
    currency: string;
    receipt: string;
    status: string;
  };

  if (claimRes?.status === 'ALREADY_SETTLED') {
    if (claimRes.payment_status === 'captured') {
      return errorResponse(
        'This purchase has already been completed and confirmed.',
        409,
        'ORDER_ALREADY_PAID',
      );
    } else {
      return errorResponse(
        'The previous payment attempt for this order was refunded. Please initiate a new checkout.',
        409,
        'ORDER_REFUNDED',
      );
    }
  } else if (claimRes?.status === 'ALREADY_COMPLETED' && claimRes.gateway_order_id) {
    try {
      const fetched = await razorpay.orders.fetch(claimRes.gateway_order_id);
      if (fetched.status === 'paid') {
        const rec = await reconcilePaidRazorpayOrder(
          serviceClient,
          razorpay,
          order.order_id,
          claimRes.gateway_order_id,
          amountInPaise,
          currency,
          claimantId,
        );
        if (rec.status === 'CAPTURED') {
          return errorResponse(
            'This purchase has already been completed and confirmed.',
            409,
            'ORDER_ALREADY_PAID',
          );
        } else if (rec.status === 'FULLY_REFUNDED' || rec.status === 'PARTIALLY_REFUNDED') {
          return errorResponse(
            'The previous payment attempt for this order was refunded. Please initiate a new checkout.',
            409,
            'ORDER_REFUNDED',
          );
        } else {
          return errorResponse(
            'Payment verification is pending. Please retry in a few moments.',
            504,
            'PAYMENT_VERIFICATION_PENDING',
          );
        }
      } else if (fetched.status === 'created' || fetched.status === 'attempted') {
        razorpayOrder = fetched as any;
      } else {
        return errorResponse(
          'Payment gateway order is in an invalid status. Please try again.',
          502,
          'INVALID_ORDER_STATUS',
        );
      }
    } catch (fetchErr) {
      return errorResponse(
        'Unable to verify existing payment order status.',
        504,
        'PAYMENT_VERIFICATION_PENDING',
      );
    }
  } else if (claimRes?.status === 'LEASE_ACTIVE') {
    return errorResponse(
      'Another checkout operation is in progress for this order. Please try again in a moment.',
      409,
      'LEASE_ACTIVE',
    );
  } else {
    try {
      razorpayOrder = (await razorpay.orders.create({
        amount: amountInPaise,
        currency,
        receipt: receiptId,
        notes: buildRazorpayNotes(productType, productId, profileId, instituteId),
      })) as any;

      structuredLog('razorpay_order_created', {
        orderId: order.order_id,
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt,
      });
    } catch (razorpayError: unknown) {
      // Ambiguous creation failure (network drop / timeout):
      // First perform receipt-based recovery to verify whether remote order exists
      structuredLog('razorpay_order_create_error_initiating_recovery', {
        orderId: order.order_id,
        receiptId,
        error: razorpayError instanceof Error ? razorpayError.message : String(razorpayError),
      });

      const recovery = await recoverRazorpayOrderByReceipt(
        razorpay,
        receiptId,
        amountInPaise,
        currency,
        order.order_id,
      );

      if (recovery.status === 'FOUND') {
        structuredLog('razorpay_order_create_recovered_after_error', {
          orderId: order.order_id,
          razorpayOrderId: recovery.razorpayOrder.id,
        });
        razorpayOrder = recovery.razorpayOrder;
      } else if (recovery.status === 'PAID') {
        structuredLog('razorpay_order_create_recovered_paid_after_error', {
          orderId: order.order_id,
          razorpayOrderId: recovery.razorpayOrder.id,
        });
        const rec = await reconcilePaidRazorpayOrder(
          serviceClient,
          razorpay,
          order.order_id,
          recovery.razorpayOrder.id,
          amountInPaise,
          currency,
          claimantId,
        );
        if (rec.status === 'CAPTURED') {
          return errorResponse(
            'This purchase has already been completed and confirmed.',
            409,
            'ORDER_ALREADY_PAID',
          );
        } else if (rec.status === 'FULLY_REFUNDED' || rec.status === 'PARTIALLY_REFUNDED') {
          return errorResponse(
            'The previous payment attempt for this order was refunded. Please initiate a new checkout.',
            409,
            'ORDER_REFUNDED',
          );
        } else {
          return errorResponse(
            'Payment verification is pending. Please retry in a few moments.',
            504,
            'PAYMENT_VERIFICATION_PENDING',
          );
        }
      } else if (recovery.status === 'NOT_FOUND') {
        // Confirmed that Razorpay did NOT create the order. Safe to cancel internal order.
        await serviceClient
          .from('orders')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('order_id', order.order_id)
          .eq('status', 'pending');

        await serviceClient.rpc('release_standard_order_creation_claim', {
          p_order_id: order.order_id,
          p_claimant: claimantId,
        });

        const errorMessage = razorpayError instanceof Error
          ? razorpayError.message
          : 'Unknown Razorpay API error';

        structuredLog('razorpay_order_failed', {
          error: errorMessage,
          orderId: order.order_id,
          productType,
          productId,
        });

        return errorResponse(
          'Failed to create payment order. Please try again.',
          502,
          'RAZORPAY_ERROR',
          errorMessage,
        );
      } else {
        // Ambiguous recovery result (timeout or network error on lookup as well)
        // Requirement 3C & 5: Do NOT cancel! Preserve recovery state and return retryable response.
        structuredError('RAZORPAY_ORDER_CREATE_AMBIGUOUS_RECOVERY', {
          orderId: order.order_id,
          receiptId,
          recoveryStatus: recovery.status,
        });

        return errorResponse(
          'Payment gateway response was ambiguous. Please retry in a few moments.',
          504,
          'GATEWAY_TIMEOUT_RECOVERY_PENDING',
        );
      }
    }
  }

  // =========================================================================
  // Step 8a: Atomically record payment attempt & reserve gateway order via create_standard_payment_attempt RPC
  // First line of defense: verifies lock, prevents stale workers from overwriting another gateway order,
  // increments attempt_number, atomically sets orders.notes.razorpayOrderId, and clears gatewayClaim.
  // =========================================================================
  const { data: attemptResult, error: attemptError } = await serviceClient.rpc(
    'create_standard_payment_attempt',
    {
      p_order_id: order.order_id,
      p_gateway_order_id: razorpayOrder.id,
      p_amount: displayAmount,
      p_currency: currency,
      p_status: 'pending',
    }
  );

  if (attemptError || !attemptResult?.success) {
    const errorMsg = attemptError?.message || attemptResult?.error || 'Failed to create payment attempt';
    structuredError('STANDARD_CHECKOUT_PAYMENT_ATTEMPT_CREATION_FAILED', {
      error: errorMsg,
      code: attemptResult?.code,
      orderId: order.order_id,
      gatewayOrderId: razorpayOrder.id,
    });

    return errorResponse(
      'Failed to record payment attempt. Please try again.',
      500,
      'PAYMENT_CREATION_FAILED',
      errorMsg,
    );
  }

  structuredLog('payment_attempt_created', {
    orderId: order.order_id,
    paymentId: attemptResult.payment?.payment_id,
    gatewayOrderId: razorpayOrder.id,
    attemptNumber: attemptResult.payment?.attempt_number,
  });

  // =========================================================================
  // Step 8b: Insert the order_item
  // =========================================================================
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
  }

  // =========================================================================
  // Step 8c: Sync full metadata into order notes
  // =========================================================================
  const { error: notesPersistError } = await serviceClient
    .from('orders')
    .update({
      notes: buildOrderNotes(productType, productId, productName, razorpayOrder.id, profileId, guardianFields, body.conversion === true),
    })
    .eq('order_id', order.order_id);

  if (notesPersistError) {
    structuredLog('orders_notes_metadata_sync_failed', {
      orderId: order.order_id,
      razorpayOrderId: razorpayOrder.id,
      error: notesPersistError.message,
    });
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
