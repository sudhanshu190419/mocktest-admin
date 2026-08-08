// ============================================================================
// Edge Function: complete-course-purchase
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Orchestrates student onboarding after a successful course purchase.
// This is the single backend entry point that:
//   1. Rejects direct calls (403 INTERNAL_ONLY) - webhook/internal only
//   2. Validates the request body
//   3. Confirms the course exists
//   4. Upgrades profile role from 'user' to 'student' (role upgrade)
//   5. Checks for existing student_details + course_enrollment (idempotent)
//   6. Calls create_student_after_purchase() RPC (Phase 1)
//   7. Creates the course_enrollment record
//   8. Returns a structured success response
//
// Architecture: Orchestration only — all business rules live in PostgreSQL RPCs.
//
// Flow:
//   razorpay-webhook (internal call ONLY - direct calls rejected with 403)
//       ↓
//   complete-course-purchase  ← YOU ARE HERE
//       ↓
//   create_student_after_purchase()  (Phase 1 RPC)
//       ↓
//   Create course_enrollment
//       ↓
//   Create In-App Notification (course_purchased)
//       ↓
//   Send Push Notification (awaited, errors caught inside — never blocks success)
//       ↓
//   Create In-App Notification (course_enrolled)
//       ↓
//   Success
//
// When called internally (by razorpay-webhook), authentication is skipped
// and the caller provides the profileId directly. Guardian fields become
// optional since they may not be available at webhook time.
//
// INTERNAL-ONLY: complete-course-purchase is callable ONLY by
// razorpay-webhook (internal=true). Direct calls are rejected with
// 403 INTERNAL_ONLY, mirroring complete-subscription-purchase. The
// webhook is the only trusted source that has already verified the
// Razorpay signature and captured the payment; allowing direct calls
// would let an authenticated user grant themselves permanent course
// ownership without paying (audit finding C1).
//
// @module edge-functions/complete-course-purchase
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/pushNotification.ts';
import { isServiceRoleCall } from '../_shared/serviceRoleAuth.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  orderId?: string;
  guardianName: string | null;
  guardianMobile: string | null;
  guardianEmail?: string | null;
  targetYear: string | null;
  dob?: string | null;

  // Phase 11K.5: Full Course conversion marker — set by razorpay-webhook
  // from order.notes (server-derived, never trusted from a direct caller).
  // When true, this payment converts the student's subscription into
  // permanent course ownership: the enrollment is upgraded to 'purchase'
  // and the current subscription row is cancelled.
  conversion?: boolean;

  // Internal call support (razorpay-webhook):
  // When internal is true, JWT authentication is skipped and the caller
  // provides the profileId directly. Guardian fields become optional.
  internal?: boolean;
  profileId?: string;
}

interface SuccessResponse {
  success: true;
  studentId: string;
  enrollmentId: string;
  enrollmentNumber: string;
  courseId: string;
  message: string;
  /**
   * Phase 11K.6 — set to true when this payment was detected as a duplicate
   * Full Course conversion (a prior confirmed conversion order already exists
   * for this student + course). Ownership is NOT granted twice; the current
   * order is flagged for refund/admin review.
   */
  duplicate?: boolean;
  /** Phase 11K.6 — the order_id of the earlier confirmed conversion. */
  duplicateOfOrderId?: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
}

type FunctionResponse = SuccessResponse | ErrorResponse;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a commerce purchase notification (notification + recipient rows).
 *
 * Designed for Phase 1 in-app notifications. Creates a single-row dispatch
 * (total_recipients = 1) with immediate dispatched_at. Idempotent: checks
 * for an existing notification_recipients row matching (profile_id,
 * event_type, reference_id) before inserting.
 *
 * @returns An object with `{ created, skipped }` indicating whether the
 *          notification was created or skipped due to an existing one.
 *          Errors are logged but NEVER thrown — notification creation must
 *          NOT block the purchase success response.
 */
async function createCommerceNotification(
  client: any,
  params: {
    eventType: string;
    title: string;
    body: string;
    profileId: string;
    instituteId: string;
    referenceType: string;
    referenceId: string;
  },
): Promise<{ created: boolean; skipped: boolean }> {
  const { eventType, title, body, profileId, instituteId, referenceType, referenceId } =
    params;

  structuredLog('NOTIFICATION_CREATE_START', {
    eventType,
    profileId,
    title,
    referenceType,
    referenceId,
  });

  try {
    // ── Idempotency check ─────────────────────────────────────────────
    structuredLog('IDEMPOTENCY_CHECK_START', {
      eventType,
      profileId,
      referenceType,
      referenceId,
    });

    // Check if a notification_recipients row already exists for this
    // profile + event_type + reference_id combination. This prevents
    // duplicate notifications on webhook retry.
    //
    // Start from notifications with an inner join to
    // notification_recipients so that PostgREST correctly applies ALL
    // filters — event_type, reference_id AND profile_id. The old approach
    // started from notification_recipients with embedded notifications,
    // which caused PostgREST to silently drop filters on embedded columns,
    // producing false-positive idempotency matches.
    const { data: existing } = await client
      .from('notifications')
      .select(`
        notification_id,
        event_type,
        reference_type,
        reference_id,
        notification_recipients!inner(recipient_id, profile_id)
      `)
      .eq('event_type', eventType)
      .eq('reference_type', referenceType)
      .eq('reference_id', referenceId)
      .eq('notification_recipients.profile_id', profileId)
      .maybeSingle();

    // Log the complete returned row for troubleshooting idempotency
    if (existing) {
      const existingObj = existing as any;
      structuredLog('IDEMPOTENCY_QUERY_RESULT', {
        eventType,
        profileId,
        referenceType,
        referenceId,
        notification_id: existingObj.notification_id ?? null,
        event_type: existingObj.event_type ?? null,
        reference_id: existingObj.reference_id ?? null,
        recipient_id: existingObj.notification_recipients?.recipient_id ?? null,
        matched_profile_id: existingObj.notification_recipients?.profile_id ?? null,
      });
    } else {
      structuredLog('IDEMPOTENCY_QUERY_RESULT_EMPTY', {
        eventType,
        profileId,
        referenceType,
        referenceId,
      });
    }

    if (existing) {
      structuredLog('NOTIFICATION_ALREADY_EXISTS', {
        eventType,
        profileId,
        referenceType,
        referenceId,
      });
      return { created: false, skipped: true };
    }

    // ── Insert notification row ───────────────────────────────────────
    const insertPayload = {
      institute_id: instituteId,
      title,
      body,
      channel: 'in_app',
      event_type: eventType,
      reference_type: referenceType,
      reference_id: referenceId,
      total_recipients: 1,
    };

    structuredLog('NOTIFICATION_DB_INSERT_START', {
      eventType,
      profileId,
      payload: insertPayload,
    });

    const { data: notification, error: notifError } = await client
      .from('notifications')
      .insert(insertPayload)
      .select('notification_id')
      .single();

    if (notifError || !notification) {
      structuredLog('NOTIFICATION_DB_INSERT_FAILED', {
        eventType,
        profileId,
        referenceType,
        referenceId,
        error: {
          message: notifError?.message ?? 'Insert returned no data',
          details: (notifError as any)?.details ?? null,
          hint: (notifError as any)?.hint ?? null,
          code: (notifError as any)?.code ?? null,
          status: (notifError as any)?.status ?? null,
        },
      });
      return { created: false, skipped: false };
    }

    structuredLog('NOTIFICATION_DB_INSERT_SUCCESS', {
      eventType,
      profileId,
      notification_id: notification.notification_id,
    });

    // ── Insert recipient row ──────────────────────────────────────────
    const recipientPayload = {
      notification_id: notification.notification_id,
      profile_id: profileId,
      institute_id: instituteId,
    };

    structuredLog('RECIPIENT_INSERT_START', {
      eventType,
      profileId,
      payload: recipientPayload,
    });

    const { error: recipientError } = await client
      .from('notification_recipients')
      .insert(recipientPayload);

    if (recipientError) {
      // Recipient insert failure should not leave orphan notification.
      // Since this is a non-critical operation and the purchase has
      // already succeeded, we log and continue.
      structuredLog('RECIPIENT_INSERT_FAILED', {
        eventType,
        profileId,
        notification_id: notification.notification_id,
        error: {
          message: recipientError.message,
          details: (recipientError as any)?.details ?? null,
          hint: (recipientError as any)?.hint ?? null,
          code: (recipientError as any)?.code ?? null,
          status: (recipientError as any)?.status ?? null,
        },
      });
      return { created: false, skipped: false };
    }

    structuredLog('RECIPIENT_INSERT_SUCCESS', {
      eventType,
      profileId,
      notification_id: notification.notification_id,
    });

    structuredLog('NOTIFICATION_FLOW_COMPLETE', {
      eventType,
      profileId,
      referenceType,
      referenceId,
      notificationId: notification.notification_id,
      recipientCreated: true,
    });

    return { created: true, skipped: false };
  } catch (err) {
    // Catch-all: never let notification creation throw.
    structuredLog('NOTIFICATION_UNEXPECTED_EXCEPTION', {
      eventType,
      profileId,
      referenceType,
      referenceId,
      message: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
      cause: err instanceof Error && (err as any).cause ? (err as any).cause : undefined,
    });
    return { created: false, skipped: false };
  }
}

/**
 * Send a push notification for a successful course purchase.
 *
 * Awaited in the purchase flow. Errors are caught and logged via
 * structuredLog() but NEVER rethrown, ensuring push delivery NEVER
 * blocks the purchase flow.
 */
async function sendCoursePurchasedPushNotification(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  courseId: string,
): Promise<void> {
  structuredLog('PUSH_NOTIFICATION_START', {
    profileId,
    courseId,
    notificationType: 'course_purchased',
    title: 'Course Purchased Successfully',
  });

  try {
    const result = await sendPushNotification(supabase, {
      profileId,
      title: 'Course Purchased Successfully',
      body: 'Your payment was successful. You now own this course.',
      data: {
        type: 'course_purchased',
        referenceType: 'course',
        referenceId: courseId,
      },
    });

    if (result.successful > 0) {
      structuredLog('PUSH_NOTIFICATION_SUCCESS', {
        profileId,
        courseId,
        totalDevices: result.totalDevices,
        successful: result.successful,
        failed: result.failed,
        invalidTokensCount: result.invalidTokens.length,
      });
    } else {
      structuredLog('PUSH_NOTIFICATION_FAILED', {
        profileId,
        courseId,
        totalDevices: result.totalDevices,
        successful: result.successful,
        failed: result.failed,
        invalidTokensCount: result.invalidTokens.length,
        hint: 'No devices received the notification. This may mean the user has no active device tokens.',
      });
    }

    structuredLog('PUSH_NOTIFICATION_SUMMARY', {
      profileId,
      courseId,
      totalDevices: result.totalDevices,
      successful: result.successful,
      failed: result.failed,
      invalidTokensCount: result.invalidTokens.length,
    });
  } catch (err) {
    structuredLog('PUSH_NOTIFICATION_FAILED', {
      profileId,
      courseId,
      error: err instanceof Error ? err.message : 'Unknown error in sendCoursePurchasedPushNotification',
      stack: err instanceof Error ? err.stack : undefined,
      context: 'fire_and_forget_catch_all',
    });
  }
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
 * Create an error response with structured logging.
 */
function errorResponse(
  message: string,
  status: number,
  details?: string,
): Response {
  const body: ErrorResponse = {
    success: false,
    error: message,
    ...(details ? { details } : {}),
  };

  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      details,
      statusCode: status,
    }),
  );

  return jsonResponse(body, status);
}

/**
 * Validate the request body has all required fields.
 * When internal=true, only courseId and profileId are required.
 * Returns an array of missing field names.
 */
function validateRequestBody(
  body: Record<string, unknown>,
  isInternal: boolean,
): string[] {
  const missing: string[] = [];

  if (!body.courseId || typeof body.courseId !== 'string') {
    missing.push('courseId');
  }

  if (isInternal) {
    // Internal call: only profileId is additionally required
    if (!body.profileId || typeof body.profileId !== 'string') {
      missing.push('profileId');
    }
  } else {
    // Direct call from mobile app: guardian and academic info required
    if (!body.guardianName || typeof body.guardianName !== 'string') {
      missing.push('guardianName');
    }
    if (!body.guardianMobile || typeof body.guardianMobile !== 'string') {
      missing.push('guardianMobile');
    }
    if (!body.targetYear || typeof body.targetYear !== 'string') {
      missing.push('targetYear');
    }
  }

  return missing;
}

/**
 * Do not expose raw PostgreSQL error messages to the client.
 * Map known error patterns to safe messages; fall back to generic.
 */
function sanitizeErrorMessage(raw: string, context: string): string {
  if (/duplicate key value violates unique constraint/i.test(raw)) {
    return 'A duplicate record was detected. The operation is idempotent — the record already exists.';
  }
  if (/profile not found/i.test(raw)) {
    return 'User profile not found. Please ensure your account is fully registered.';
  }
  if (/requires role = student/i.test(raw)) {
    return 'Only student accounts can complete a course purchase. Your account role does not permit this action.';
  }
  if (/student_details row already exists/i.test(raw)) {
    return 'A student record already exists for this account.';
  }

  return 'An unexpected error occurred. Please try again or contact support.';
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


// ═══════════════════════════════════════════════════════════════════════════
// Phase 11K.6 — payment idempotency helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append a duplicate-payment marker to an order's notes (JSON text).
 * Used to flag a second conversion/renewal payment for refund/admin review.
 * Idempotent: re-marking the same order only overwrites the marker.
 */
async function markOrderAsDuplicate(
  serviceClient: any,
  orderId: string | undefined,
  duplicateOfOrderId: string,
  duplicateKind: 'conversion' | 'renewal',
): Promise<void> {
  if (!orderId) return;

  const { data: order } = await serviceClient
    .from('orders')
    .select('order_id, notes')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!order) return;

  // Phase 11K.6 review: never DESTROY an order's existing notes. If notes is
  // not valid JSON (legacy/manual row), skip marking rather than overwrite
  // the original content. All app-created orders are JSON from
  // buildOrderNotes, so this is defensive-only.
  let notes: Record<string, unknown> = {};
  if (order.notes) {
    try {
      notes = JSON.parse(order.notes) as Record<string, unknown>;
    } catch {
      structuredLog('DUPLICATE_MARK_SKIPPED_UNPARSEABLE_NOTES', { orderId });
      return;
    }
  }

  notes.duplicate_of_order_id = duplicateOfOrderId;
  notes.duplicate_kind = duplicateKind;
  notes.duplicate_detected_at = new Date().toISOString();
  notes.flagged_for_refund = true;

  await serviceClient
    .from('orders')
    .update({ notes: JSON.stringify(notes) })
    .eq('order_id', orderId);
}

/**
 * Find a CONFIRMED conversion order for the same student + course that is
 * NOT the current order. Used to detect a duplicate Full Course conversion
 * payment (Phase 11K.6): only ONE conversion payment may ever succeed per
 * student/course.
 *
 * Order.notes is JSON text; we parse and compare exactly.
 */
async function findPriorConfirmedConversionOrder(
  serviceClient: any,
  profileId: string,
  courseId: string,
  excludeOrderId: string | undefined,
): Promise<{ order_id: string } | null> {
  const { data: orders, error } = await serviceClient
    .from('orders')
    .select('order_id, notes')
    .eq('profile_id', profileId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    structuredLog('PRIOR_CONVERSION_LOOKUP_FAILED', {
      profileId,
      courseId,
      error: error.message,
    });
    return null;
  }

  for (const order of orders ?? []) {
    if (order.order_id === excludeOrderId) continue;
    let notes: Record<string, unknown> = {};
    try {
      notes = order.notes ? JSON.parse(order.notes) as Record<string, unknown> : {};
    } catch {
      continue;
    }
    if (notes.conversion === 'true' && notes.courseId === courseId) {
      return { order_id: order.order_id };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 11K.5 - Full Course Conversion helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cancel the student's current subscription for the course because of a
 * Full Course conversion (Phase 11K.5).
 *
 * Rules (authoritative):
 *   - The EXISTING student_subscriptions row is UPDATED in place - never a
 *     new row (revised renewal architecture).
 *   - status -> 'cancelled', cancelled_at = now(), updated_at = now().
 *   - Only 'active' and 'grace' can transition to 'cancelled' (the
 *     trgfn_subscription_validate_status trigger allows both, but NOT
 *     expired->cancelled - an expired row is left untouched and ownership is
 *     granted regardless via the enrollment upgrade).
 *   - History: one 'cancellation' event in subscription_history. The
 *     auto-history trigger writes a 'system_action' row on the status
 *     change; it is enriched (per its own TODO) - never duplicated.
 *
 * Idempotent: safe to call on webhook retries.
 */
async function applyFullCourseConversion(
  serviceClient: any,
  params: {
    studentId: string;
    courseId: string;
    instituteId: string;
    profileId: string;
    orderId?: string;
    paymentReference?: string | null;
  },
): Promise<void> {
  const { studentId, courseId, instituteId, profileId, orderId, paymentReference } = params;

  structuredLog('CONVERSION_CANCEL_START', {
    studentId,
    courseId,
    orderId: orderId ?? null,
  });

  // Current subscription row (newest by created_at - 11K.1 D3)
  const { data: sub } = await serviceClient
    .from('student_subscriptions')
    .select('subscription_id, status, plan_id')
    .eq('course_id', courseId)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) {
    structuredLog('CONVERSION_NO_SUBSCRIPTION', { studentId, courseId });
    return;
  }

  // Idempotency: already converted (retry)
  if (sub.status === 'cancelled') {
    const { data: existingHistory } = await serviceClient
      .from('subscription_history')
      .select('history_id')
      .eq('subscription_id', sub.subscription_id)
      .eq('change_reason', 'cancellation')
      .eq('metadata->>reason', 'full_course_conversion')
      .maybeSingle();

    if (existingHistory) {
      structuredLog('CONVERSION_ALREADY_APPLIED', {
        subscriptionId: sub.subscription_id,
      });
      return;
    }
    // Cancelled by support earlier but no conversion event - fall through
    // to record the conversion history event below (but never re-cancel).
  }

  // Only active/grace can transition to cancelled (trigger)
  const oldStatus = sub.status;
  if (oldStatus !== 'active' && oldStatus !== 'grace') {
    structuredLog('CONVERSION_SKIP_CANCEL_STATUS', {
      subscriptionId: sub.subscription_id,
      status: oldStatus,
    });
    return;
  }

  const { data: updatedRows, error: cancelError } = await serviceClient
    .from('student_subscriptions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('subscription_id', sub.subscription_id)
    .eq('status', oldStatus) // optimistic guard - 0 rows if concurrently changed
    .select('subscription_id'); // return the row so the race guard sees the real match count

  if (cancelError) {
    structuredLog('CONVERSION_CANCEL_FAILED', {
      subscriptionId: sub.subscription_id,
      error: cancelError.message,
      sqlState: (cancelError as { code?: string })?.code ?? 'unknown',
    });
    // Non-fatal: permanent ownership (enrollment upgrade) is granted
    // regardless; the cancellation can be completed by support.
    return;
  }

  // Race guard (11K.5 review, HIGH): a concurrent webhook delivery that
  // also loaded status='active' may have won the UPDATE. If we matched 0
  // rows, the other invocation owns the cancellation + history write -
  // return without touching history (prevents a duplicate 'cancellation'
  // event when the winner already enriched the auto-history row).
  if (!updatedRows || updatedRows.length === 0) {
    structuredLog('CONVERSION_CANCEL_RACE_SKIPPED', {
      subscriptionId: sub.subscription_id,
      oldStatus,
    });
    return;
  }

  const conversionMetadata = {
    reason: 'full_course_conversion',
    order_id: orderId ?? null,
    course_id: courseId,
    plan_id: sub.plan_id,
  };

  // Enrich the auto-history trigger row (never duplicate)
  const { data: autoRow } = await serviceClient
    .from('subscription_history')
    .select('history_id')
    .eq('subscription_id', sub.subscription_id)
    .eq('change_reason', 'system_action')
    .eq('status_before', oldStatus)
    .eq('status_after', 'cancelled')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (autoRow) {
    const { error: enrichError } = await serviceClient
      .from('subscription_history')
      .update({
        change_reason: 'cancellation',
        changed_by: profileId,
        changed_by_role: 'student',
        payment_reference: paymentReference ?? null,
        metadata: conversionMetadata,
      })
      .eq('history_id', autoRow.history_id);

    if (enrichError) {
      structuredLog('CONVERSION_HISTORY_ENRICH_FAILED', {
        historyId: autoRow.history_id,
        error: enrichError.message,
      });
    } else {
      structuredLog('CONVERSION_HISTORY_ENRICHED', {
        historyId: autoRow.history_id,
        changeReason: 'cancellation',
      });
    }
  } else {
    // No auto row (edge) - insert the cancellation event explicitly.
    const { error: insertError } = await serviceClient
      .from('subscription_history')
      .insert({
        subscription_id: sub.subscription_id,
        student_id: studentId,
        institute_id: instituteId,
        status_before: oldStatus,
        status_after: 'cancelled',
        change_reason: 'cancellation',
        changed_by: profileId,
        changed_by_role: 'student',
        payment_reference: paymentReference ?? null,
        metadata: conversionMetadata,
      });

    if (insertError) {
      structuredLog('CONVERSION_HISTORY_INSERT_FAILED', {
        subscriptionId: sub.subscription_id,
        error: insertError.message,
      });
    } else {
      structuredLog('CONVERSION_HISTORY_INSERT_SUCCESS', {
        subscriptionId: sub.subscription_id,
        changeReason: 'cancellation',
      });
    }
  }

  structuredLog('CONVERSION_CANCEL_SUCCESS', {
    subscriptionId: sub.subscription_id,
    oldStatus,
    courseId,
  });
}

// =========================================================================
// Main Handler
// =========================================================================

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
  // Step 2: Parse and validate the request body
  // (Moved before auth so we can check the internal flag)
  // ═════════════════════════════════════════════════════════════════════
  let body: RequestBody;
  let isInternal = false;

  try {
    const raw = await req.json() as Record<string, unknown>;

    // Check if this is an internal call from razorpay-webhook
    isInternal = raw.internal === true;

    const missingFields = validateRequestBody(raw, isInternal);

    if (missingFields.length > 0) {
      return errorResponse(
        `Missing required fields: ${missingFields.join(', ')}`,
        400,
      );
    }

    body = {
      courseId: raw.courseId as string,
      orderId: (raw.orderId as string | undefined) ?? undefined,
      guardianName: (raw.guardianName as string) ?? null,
      guardianMobile: (raw.guardianMobile as string) ?? null,
      guardianEmail: (raw.guardianEmail as string | undefined) ?? null,
      targetYear: (raw.targetYear as string) ?? null,
      dob: (raw.dob as string | undefined) ?? null,
      conversion: raw.conversion === true,
      internal: isInternal,
      profileId: isInternal ? (raw.profileId as string) : undefined,
    };

    structuredLog('request_validated', {
      courseId: body.courseId,
      isInternal,
      hasGuardianName: !!body.guardianName,
      hasTargetYear: !!body.targetYear,
    });
  } catch (err) {
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }

  // ─────────────────────────────────────────────────────────────
  // Step 1b: INTERNAL-ONLY gate
  // ─────────────────────────────────────────────────────────────
  // Reject every non-internal call. Only razorpay-webhook (which has
  // already verified the Razorpay signature and captured the payment) may
  // complete a course purchase. This closes the 'grant yourself a free
  // course' vector that a direct-call path would open (audit C1).
  if (!isInternal) {
    structuredLog('DIRECT_CALL_REJECTED', {
      message: 'complete-course-purchase is internal-only. Direct calls are rejected.',
      courseId: body.courseId,
    });
    return errorResponse(
      'This operation is only available through the secure payment flow.',
      403,
      'INTERNAL_ONLY',
    );
  }

  // Step 1c: service-role credential check (audit C2)
  // The internal flag is client-settable, so the caller must additionally
  // prove it holds the project's SERVICE_ROLE_KEY (a service-role JWT).
  // The razorpay-webhook is the only caller that does; verify_jwt = true
  // is required at the platform so the JWT signature is always validated.
  if (isInternal) {
    const srCheck = isServiceRoleCall(req.headers.get('Authorization'));
    if (!srCheck.ok) {
      structuredLog('INTERNAL_AUTH_REJECTED', {
        courseId: body.courseId,
        ...srCheck,
      });
      return errorResponse(
        'This operation is only available through the secure payment flow.',
        403,
        'SERVICE_ROLE_REQUIRED',
      );
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 1: Resolve profileId
  // ═════════════════════════════════════════════════════════════════════
  // Internal call: profileId is provided by the caller (razorpay-webhook
  // already verified the signature). Direct call: resolve from JWT.
  let profileId: string;

  if (isInternal) {
    profileId = body.profileId!;

    // Validate the profileId exists in the database
    const { data: profile } = await (() => {
      const client = createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      return client.from('profiles').select('profile_id').eq('profile_id', profileId).maybeSingle();
    })();

    if (!profile) {
      return errorResponse('Profile not found for the provided profileId.', 404);
    }

    structuredLog('internal_auth_success', { profileId });

    structuredLog('PROFILE_LOOKUP_SUCCESS', {
      profileId,
      isInternal: true,
      hasGuardianName: !!body.guardianName,
      hasGuardianMobile: !!body.guardianMobile,
      hasTargetYear: !!body.targetYear,
    });
  } else {
    // Direct call: authenticate via JWT
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

      structuredLog('PROFILE_LOOKUP_SUCCESS', {
        profileId,
        isInternal: false,
      });
    } catch (err) {
      return errorResponse('Authentication verification failed.', 401);
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 3: Create the service-role client for write operations
  // ═════════════════════════════════════════════════════════════════════
  // The service_role bypasses RLS, allowing us to perform administrative
  // operations (RPC calls, inserts) that the student could not do alone.
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
  // Step 4: Verify the course exists
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('checking_course', { courseId: body.courseId });

  const { data: course, error: courseError } = await serviceClient
    .from('courses')
    .select('course_id, institute_id, title, status')
    .eq('course_id', body.courseId)
    .is('deleted_at', null)
    .single();

  if (courseError || !course) {
    structuredLog('COURSE_LOOKUP_FAILED', {
      courseId: body.courseId,
      error: courseError?.message ?? 'Course not found',
    });
    return errorResponse(
      `Course not found: ${body.courseId}`,
      404,
      courseError?.message,
    );
  }

  structuredLog('COURSE_LOOKUP_SUCCESS', {
    courseId: course.course_id,
    title: course.title,
    instituteId: course.institute_id,
    status: course.status,
  });

  const instituteId: string = course.institute_id;

  // ═════════════════════════════════════════════════════════════════════
  // Step 5: Upgrade profile role from 'user' to 'student'
  // ═════════════════════════════════════════════════════════════════════
  // After confirming the course exists, read the current role and upgrade
  // it from 'user' to 'student' if applicable. This MUST happen BEFORE
  // creating student_details because the create_student_after_purchase RPC
  // requires role = 'student'.
  //
  // Rules:
  //   'user'    → upgrade to 'student'
  //   'student' → no-op (idempotent)
  //   'teacher' → return error (cannot convert)
  //   'admin'   → return error (cannot convert)
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('ROLE_BEFORE_UPGRADE', { profileId });

  const { data: profileRow, error: profileRowError } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('profile_id', profileId)
    .single();

  if (profileRowError || !profileRow) {
    structuredLog('ROLE_LOOKUP_FAILED', {
      profileId,
      error: profileRowError?.message ?? 'Profile not found',
    });
    return errorResponse('Profile not found. Cannot complete course purchase.', 404);
  }

  const currentRole = profileRow.role;

  if (currentRole === 'user') {
    structuredLog('ROLE_UPGRADE_STARTED', {
      profileId,
      fromRole: currentRole,
      toRole: 'student',
    });

    const { error: updateError } = await serviceClient
      .from('profiles')
      .update({ role: 'student' })
      .eq('profile_id', profileId);

    if (updateError) {
      structuredLog('ROLE_UPGRADE_FAILED', {
        profileId,
        error: updateError.message,
      });
      return errorResponse('Failed to upgrade profile role. Please contact support.', 500);
    }

    structuredLog('ROLE_UPGRADE_SUCCESS', { profileId });
    structuredLog('ROLE_AFTER_UPGRADE', { profileId, newRole: 'student' });
  } else if (currentRole === 'student') {
    structuredLog('ROLE_ALREADY_STUDENT', { profileId });
  } else if (currentRole === 'teacher' || currentRole === 'admin') {
    structuredLog('ROLE_INVALID', {
      profileId,
      currentRole,
      message: `Profile role '${currentRole}' cannot be converted to student through purchase flow`,
    });
    return errorResponse(
      `Profile role '${currentRole}' cannot be converted to student. ` +
      'Only user and student roles are valid for course purchases.',
      403,
    );
  } else {
    // Unknown role — treat as invalid
    structuredLog('ROLE_INVALID', {
      profileId,
      currentRole,
      message: `Unknown profile role '${currentRole}' — cannot complete purchase`,
    });
    return errorResponse(
      `Unknown profile role '${currentRole}'. Cannot complete course purchase.`,
      403,
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 6: Check whether the user already has a student_details row
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('checking_existing_student', { profileId });

  const { data: existingStudent } = await serviceClient
    .from('student_details')
    .select('student_id, enrollment_no')
    .eq('profile_id', profileId)
    .maybeSingle();

  let studentId: string | null = existingStudent?.student_id ?? null;
  let enrollmentNo: string | null = existingStudent?.enrollment_no ?? null;

  // ═════════════════════════════════════════════════════════════════════
  // Step 7: Create student_details if not already present
  // ═════════════════════════════════════════════════════════════════════
  if (!studentId) {
    structuredLog('CREATE_STUDENT_RPC_START', {
      profileId,
      hasGuardianName: !!body.guardianName,
      hasGuardianMobile: !!body.guardianMobile,
      hasTargetYear: !!body.targetYear,
      hasDob: !!body.dob,
    });

    const { data: rpcResult, error: rpcError } = await serviceClient.rpc(
      'create_student_after_purchase',
      {
        p_profile_id: profileId,
        p_guardian_name: body.guardianName,
        p_guardian_mobile: body.guardianMobile,
        p_guardian_email: body.guardianEmail ?? null,
        p_target_year: body.targetYear,
        p_dob: body.dob ?? null,
      },
    );

    if (rpcError) {
      structuredLog('CREATE_STUDENT_RPC_FAILED', {
        profileId,
        sqlState: rpcError.code ?? 'unknown',
        message: rpcError.message,
        stack: rpcError.details ?? undefined,
      });
      const safeMessage = sanitizeErrorMessage(
        rpcError.message,
        'create_student_after_purchase RPC',
      );
      return errorResponse(safeMessage, 500, rpcError.message);
    }

    // The RPC returns a JSON object. Check for a business-logic error
    // (e.g. duplicate student_details, which returns { error: "..." }
    // instead of raising an exception).
    const rpcData = rpcResult as Record<string, unknown> | null;
    if (!rpcData) {
      structuredLog('CREATE_STUDENT_RPC_FAILED', {
        profileId,
        message: 'RPC returned empty response',
      });
      return errorResponse(
        'Student creation returned an empty response.',
        500,
      );
    }

    if (rpcData.error) {
      // ── Idempotency: handle concurrent webhook deliveries ──────────
      // If two requests arrive simultaneously, both can pass the "existing
      // student_details" check, but only the first RPC call succeeds. The
      // second call receives { error: "..." }. Instead of returning an error,
      // re-query for the student that was just created by the first request.
      structuredLog('CREATE_STUDENT_RPC_RACE', {
        error: String(rpcData.error),
        profileId,
      });

      const { data: recovered } = await serviceClient
        .from('student_details')
        .select('student_id, enrollment_no')
        .eq('profile_id', profileId)
        .maybeSingle();

      if (recovered) {
        studentId = recovered.student_id;
        enrollmentNo = recovered.enrollment_no;
        structuredLog('student_recovered_after_race', { studentId });
      } else {
        structuredLog('CREATE_STUDENT_RPC_FAILED', {
          profileId,
          message: String(rpcData.error),
        });
        return errorResponse(
          sanitizeErrorMessage(String(rpcData.error), 'RPC business logic'),
          409,
          String(rpcData.error),
        );
      }
    }

    if (!studentId) {
      studentId = rpcData.student_id as string;
      enrollmentNo = rpcData.enrollment_no as string;
    }

    structuredLog('CREATE_STUDENT_RPC_SUCCESS', {
      studentId,
      enrollmentNo,
      instituteId: rpcData?.institute_id as string ?? instituteId,
    });

    structuredLog('STUDENT_DETAILS_CREATED', { studentId, enrollmentNo });
  } else {
    structuredLog('STUDENT_DETAILS_CREATED', {
      studentId,
      enrollmentNo,
      note: 'Already existed (idempotent)',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 8: Check for existing course_enrollment (idempotent)
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('checking_existing_enrollment', {
    courseId: body.courseId,
    studentId,
    conversion: body.conversion === true,
  });

  // ── Phase 11K.6: duplicate Full Course conversion detection ────────
  // Only ONE conversion payment may ever succeed per student/course. If a
  // prior CONFIRMED conversion order exists for the same profile + course
  // (a different order), this payment is a duplicate: mark it for refund /
  // admin review and return a deterministic status WITHOUT touching
  // enrollment or subscription again. Ownership is already granted.
  if (body.conversion === true) {
    const priorConversion = await findPriorConfirmedConversionOrder(
      serviceClient,
      profileId,
      body.courseId,
      body.orderId,
    );

    if (priorConversion) {
      structuredLog('CONVERSION_DUPLICATE_DETECTED', {
        courseId: body.courseId,
        studentId,
        currentOrderId: body.orderId ?? null,
        priorOrderId: priorConversion.order_id,
      });

      await markOrderAsDuplicate(
        serviceClient,
        body.orderId,
        priorConversion.order_id,
        'conversion',
      );

      return jsonResponse({
        success: true,
        duplicate: true,
        duplicateOfOrderId: priorConversion.order_id,
        studentId,
        enrollmentId: '', // Not re-granted — ownership already exists.
        enrollmentNumber: '',
        courseId: body.courseId,
        message: 'This course was already converted to full ownership by an earlier payment. ' +
          'The duplicate payment has been flagged for refund.',
      });
    }
  }

  const { data: existingEnrollment } = await serviceClient
    .from('course_enrollments')
    .select('enrollment_id, enrollment_type')
    .eq('course_id', body.courseId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (existingEnrollment) {
    structuredLog('enrollment_already_exists', {
      enrollmentId: existingEnrollment.enrollment_id,
      enrollmentType: existingEnrollment.enrollment_type,
      conversion: body.conversion === true,
    });

    // ── Phase 11K.5: Full Course conversion on an existing enrollment ──
    // A subscription purchase created a 'subscription'-type enrollment
    // (Phase 11I.2 sync). Conversion upgrades it to 'purchase' so
    // is_permanent_course_owner() returns TRUE - never a duplicate row
    // (uq_course_enrollments_course_student enforces one per student/course).
    if (body.conversion === true && existingEnrollment.enrollment_type !== 'purchase') {
      structuredLog('CONVERSION_UPGRADE_ENROLLMENT', {
        enrollmentId: existingEnrollment.enrollment_id,
        fromType: existingEnrollment.enrollment_type,
        toType: 'purchase',
      });

      const { error: upgradeError } = await serviceClient
        .from('course_enrollments')
        .update({ enrollment_type: 'purchase', is_active: true })
        .eq('enrollment_id', existingEnrollment.enrollment_id);

      if (upgradeError) {
        structuredLog('CONVERSION_UPGRADE_ENROLLMENT_FAILED', {
          enrollmentId: existingEnrollment.enrollment_id,
          error: upgradeError.message,
        });
      }
    }

    // ── Phase 11K.5: cancel the subscription (idempotent) ─────────────
    if (body.conversion === true) {
      await applyFullCourseConversion(serviceClient, {
        studentId,
        courseId: body.courseId,
        instituteId,
        profileId,
        orderId: body.orderId,
        paymentReference: null,
      });
    }

    // ── Ensure notifications exist (idempotent) ────────────────────────
    // If a previous webhook delivery succeeded for enrollment but failed
    // before creating notifications, this call creates them now. The
    // idempotency check inside createCommerceNotification prevents dupes.
    structuredLog('NOTIFICATION_FLOW_START', {
      profileId,
      studentId,
      courseId: body.courseId,
      orderId: body.orderId ?? null,
      eventTypes: ['course_purchased', 'course_enrolled'],
      context: 'existing_enrollment',
    });

    await createCommerceNotification(serviceClient, {
      eventType: 'course_purchased',
      title: 'Course Purchased Successfully',
      body: 'Your payment was successful. You now own this course.',
      profileId,
      instituteId,
      referenceType: 'course',
      referenceId: body.courseId,
    });

    // ── Send push notification (awaited) ─────────────────────────────
    // After the in-app notification is created, send a push
    // notification to the user's active devices. We await it so the
    // Edge Function does not return before push delivery completes.
    // Errors are caught inside and NEVER propagate to the caller.
    try {
      await sendCoursePurchasedPushNotification(
        serviceClient,
        profileId,
        body.courseId,
      );
    } catch (error) {
      structuredLog('PUSH_NOTIFICATION_FAILED', {
        error: String(error),
      });
    }

    structuredLog('NOTIFICATION_FLOW_START', {
      profileId,
      studentId,
      courseId: body.courseId,
      orderId: body.orderId ?? null,
      eventTypes: ['course_enrolled'],
      context: 'existing_enrollment',
    });

    await createCommerceNotification(serviceClient, {
      eventType: 'course_enrolled',
      title: 'Enrollment Successful',
      body: 'You have been successfully enrolled. Start learning anytime.',
      profileId,
      instituteId,
      referenceType: 'course',
      referenceId: body.courseId,
    });

    return jsonResponse({
      success: true,
      studentId,
      enrollmentId: existingEnrollment.enrollment_id,
      enrollmentNumber: enrollmentNo ?? '',
      courseId: body.courseId,
      message: 'Student is already enrolled in this course.',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 9: Create the course_enrollment record
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('COURSE_ENROLLMENT_INSERT_START', {
    courseId: body.courseId,
    studentId,
    instituteId,
  });

  const { data: newEnrollment, error: enrollmentError } = await serviceClient
    .from('course_enrollments')
    .insert({
      course_id: body.courseId,
      student_id: studentId,
      institute_id: instituteId,
      enrollment_type: 'purchase',
    })
    .select('enrollment_id')
    .single();

  if (enrollmentError || !newEnrollment) {
    structuredLog('COURSE_ENROLLMENT_INSERT_FAILED', {
      courseId: body.courseId,
      studentId,
      error: enrollmentError?.message ?? 'Insert returned no data',
      sqlState: (enrollmentError as { code?: string })?.code ?? 'unknown',
    });
    const safeMessage = sanitizeErrorMessage(
      enrollmentError?.message ?? 'Insert returned no data.',
      'course_enrollments insert',
    );
    return errorResponse(safeMessage, 500, enrollmentError?.message);
  }

  structuredLog('COURSE_ENROLLMENT_INSERT_SUCCESS', {
    enrollmentId: newEnrollment.enrollment_id,
    courseId: body.courseId,
    studentId,
  });

  // ── Phase 11K.5: Full Course conversion — cancel the subscription ──
  // (The insert above already used enrollment_type='purchase', so
  // permanent ownership is in place; the subscription lifecycle must end.)
  if (body.conversion === true) {
    await applyFullCourseConversion(serviceClient, {
      studentId,
      courseId: body.courseId,
      instituteId,
      profileId,
      orderId: body.orderId,
      paymentReference: null,
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 10: Update orders.student_id
  // ═════════════════════════════════════════════════════════════════════
  // After creating the student_details and course_enrollment, link the
  // order to the student record so subsequent queries can resolve the
  // student_id directly from the order.
  if (body.orderId) {
    structuredLog('UPDATE_ORDER_STUDENT_ID', {
      orderId: body.orderId,
      studentId,
      profileId,
    });

    const { error: orderUpdateError } = await serviceClient
      .from('orders')
      .update({ student_id: studentId })
      .eq('order_id', body.orderId);

    if (orderUpdateError) {
      // Non-fatal: the student is already created and enrolled.
      // The order can be linked later via admin panel.
      structuredLog('UPDATE_ORDER_STUDENT_ID_FAILED', {
        orderId: body.orderId,
        studentId,
        error: orderUpdateError.message,
      });
    } else {
      structuredLog('UPDATE_ORDER_STUDENT_ID_SUCCESS', {
        orderId: body.orderId,
        studentId,
      });
    }
  } else {
    structuredLog('UPDATE_ORDER_STUDENT_ID_SKIPPED', {
      note: 'No orderId provided — caller should update orders.student_id separately',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 11: Create purchase notifications
  // ═════════════════════════════════════════════════════════════════════
  // Create TWO notifications after the entire purchase flow succeeds:
  //   1. course_purchased — payment confirmation
  //   2. course_enrolled  — enrollment confirmation
  //
  // These are awaited but errors are caught internally. Notification
  // failure does NOT block the success response because the purchase
  // is already complete.
  structuredLog('NOTIFICATION_FLOW_START', {
      profileId,
      studentId,
      courseId: body.courseId,
      orderId: body.orderId ?? null,
      eventTypes: ['course_purchased'],
      context: 'main_flow',
    });

  await createCommerceNotification(serviceClient, {
      eventType: 'course_purchased',
      title: 'Course Purchased Successfully',
      body: 'Your payment was successful. You now own this course.',
      profileId,
      instituteId,
      referenceType: 'course',
      referenceId: body.courseId,
    });

  // ── Send push notification (awaited) ─────────────────────────────
  // After the in-app notification is created, send a push
  // notification to the user's active devices. We await it so the
  // Edge Function does not return before push delivery completes.
  // Errors are caught inside and NEVER propagate to the caller.
  try {
    await sendCoursePurchasedPushNotification(
      serviceClient,
      profileId,
      body.courseId,
    );
  } catch (error) {
    structuredLog('PUSH_NOTIFICATION_FAILED', {
      error: String(error),
    });
  }

  structuredLog('NOTIFICATION_FLOW_START', {
      profileId,
      studentId,
      courseId: body.courseId,
      orderId: body.orderId ?? null,
      eventTypes: ['course_enrolled'],
      context: 'main_flow',
    });

  await createCommerceNotification(serviceClient, {
      eventType: 'course_enrolled',
      title: 'Enrollment Successful',
      body: 'You have been successfully enrolled. Start learning anytime.',
      profileId,
      instituteId,
      referenceType: 'course',
      referenceId: body.courseId,
    });

  // ═════════════════════════════════════════════════════════════════════
  // Step 12: Return the structured success response
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('ONBOARDING_COMPLETE', {
    studentId,
    enrollmentId: newEnrollment.enrollment_id,
    courseId: body.courseId,
    orderId: body.orderId ?? null,
  });

  return jsonResponse({
    success: true,
    studentId,
    enrollmentId: newEnrollment.enrollment_id,
    enrollmentNumber: enrollmentNo ?? '',
    courseId: body.courseId,
    message: 'Student onboarding completed successfully.',
  });
});
