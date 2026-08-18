// ============================================================================
// Edge Function: complete-subscription-purchase
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Orchestrates subscription activation after a successful subscription plan
// purchase. This is the single backend entry point that:
//   1. Verifies authentication (profile_id from JWT) or accepts an internal
//      service-role call from razorpay-webhook
//   2. Validates the request body (planId + orderId)
//   3. Confirms the subscription plan exists and is active
//   4. Upgrades profile role from 'user' to 'student' (idempotent)
//   5. Ensures a student_details row exists (create_student_after_purchase RPC)
//   6. Classifies the payment as a renewal or an initial purchase using the
//      CURRENT student_subscriptions row (Phase 11K.4):
//        - no current row                  → initial purchase (INSERT below)
//        - same plan + active/grace/expired → RENEWAL (UPDATE in place)
//        - different plan                  → 409 PLAN_LOCKED (cycle locked)
//        - cancelled/refunded              → 409 SUBSCRIPTION_NOT_RENEWABLE
//        - permanent owner                 → 409 ALREADY_OWNED
//   7. Computes subscription dates using Phase 11A rules:
//        start_date            = today (or the day after the current end_date
//                                 for an early renewal — no overlap, no lost
//                                 days)
//        end_date              = start_date + plan.duration_days
//        grace_end_date        = end_date + grace_days (default 7, from system_settings)
//        content_access_end_date = grace_end_date + content_access_days (default 30)
//   8. Renewal path: UPDATES the existing student_subscriptions row in place
//      (exactly one current row per student per course — never a new row),
//      keyed on the observed end_date for optimistic concurrency. Initial
//      purchase path: inserts a new row (status = 'active').
//   9. Inserts/enriches subscription_history (change_reason = 'renewal' or
//      'new_purchase' — the auto-history trigger row is enriched, never
//      duplicated)
//  10. Links the order to the student (orders.student_id)
//  11. Syncs course_enrollments (Phase 11I.2 — idempotent, non-fatal):
//        creates an active 'subscription' enrollment when missing, or
//        re-activates the existing row. Mirrors complete-course-purchase so
//        subscription users appear under "My Courses" / dashboards /
//        analytics. Renewals reuse the same row; expiry NEVER deactivates it
//        (access is revoked by the entitlement helpers / RLS instead).
//  12. Returns a structured success response
//
// Architecture: Orchestration only — all business rules live in PostgreSQL
// (triggers validate status transitions and capacity).
//
// Flow:
//   razorpay-webhook (internal call)  OR  Mobile App (direct call)
//       ↓
//   complete-subscription-purchase  ← YOU ARE HERE
//       ↓
//   create_student_after_purchase()  (if student_details missing)
//       ↓
//   Insert student_subscriptions (status = 'active')
//       ↓
//   Insert subscription_history (change_reason = 'new_purchase')
//       ↓
//   Update orders.student_id
//       ↓
//   Success
//
// ⚠️ INTERNAL-ONLY: This function is intentionally callable ONLY by the
// razorpay-webhook (internal=true). It must never be invoked directly by
// the mobile app — matching the project convention documented in
// paymentService.ts ('complete-*-purchase functions must never be called
// from the mobile app'). The webhook is the ONLY trusted source that has
// already verified the Razorpay signature and marked the payment captured;
// allowing direct calls would let an authenticated user grant themselves a
// free subscription without paying.
//
// When called internally, authentication is skipped and the caller
// provides the profileId directly. Guardian fields become optional since
// they may not be available at webhook time.
//
// ## Renewal policy (Phase 11K.4 — finalized architecture)
//
//   • There is ALWAYS exactly one current student_subscriptions row per
//     student per course. A renewal UPDATES that row in place — it never
//     inserts a new one. Payment history lives in orders/order_items
//     (immutable billing history); audit history lives in subscription_history
//     (one 'renewal' event per renewal — the auto-history trigger row is
//     enriched, never duplicated).
//   • The billing cycle is permanently locked after the first purchase:
//     Monthly ↔ Quarterly ↔ Half-Yearly ↔ Yearly switching is NEVER allowed.
//     A student can only renew the SAME plan, or convert to a one-time full
//     course purchase (handled by the course purchase flow).
//   • Renewable statuses are active / grace / expired. cancelled / refunded
//     rows are never resurrected (409 SUBSCRIPTION_NOT_RENEWABLE).
//   • Permanent owners (enrollment_type = 'purchase') can never buy a
//     subscription again (409 ALREADY_OWNED).
//   • One-time Course and PYQ purchases remain completely independent and are
//     never affected by subscription expiry (legacy access compatibility).
//
// @module edge-functions/complete-subscription-purchase
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { syncCourseEnrollment } from '../_shared/courseEnrollment.ts';
import { isServiceRoleCall } from '../_shared/serviceRoleAuth.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Phase 11A defaults — used only when the per-institute system_settings
 * rows (seeded by migration 085) are absent. The lifecycle/expiry job
 * (Phase 11A.4+) is responsible for keeping values in sync going forward.
 */
const DEFAULT_GRACE_DAYS = 7;
const DEFAULT_CONTENT_ACCESS_DAYS = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface RequestBody {
  planId: string;
  orderId?: string;
  guardianName: string | null;
  guardianMobile: string | null;
  guardianEmail?: string | null;
  targetYear: string | null;
  dob?: string | null;
  /** Razorpay payment id — stored on subscription_history for audit. */
  paymentReference?: string | null;

  // Internal call support (razorpay-webhook):
  // When internal is true, JWT authentication is skipped and the caller
  // provides the profileId directly. Guardian fields become optional.
  internal?: boolean;
  profileId?: string;
}

interface SuccessResponse {
  success: true;
  studentId: string;
  subscriptionId: string;
  planId: string;
  startDate: string;
  endDate: string;
  graceEndDate: string | null;
  contentAccessEndDate: string | null;
  message: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
}

type FunctionResponse = SuccessResponse | ErrorResponse;

/** Raw row type from the subscription_plans table. */
interface SubscriptionPlanRow {
  plan_id: string;
  institute_id: string;
  name: string;
  price: number;
  currency_code: string;
  billing_cycle: string;
  duration_days: number;
  trial_days: number;
  is_active: boolean;
}

/** Raw row type from the student_details table. */
interface StudentRow {
  student_id: string;
  enrollment_no: string | null;
}

// ## Day-boundary convention
//
//   start_date / end_date / grace_end_date / content_access_end_date are
//   computed as UTC calendar dates (YYYY-MM-DD) via todayUtc()/addDays().
//   For a student near midnight IST this can differ by one day from their
//   local 'today' (e.g. 00:30 IST = previous UTC day). This is intentional:
//   the Supabase Edge runtime clock is UTC, and the future expiry job must
//   compare against the same UTC day boundary (now()::date is UTC-derived)
//   so subscription end/grace/content comparisons never drift. Keep this
//   convention when the Phase 11A.4+ lifecycle job is implemented.

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 11K.6 — append a duplicate-payment marker to an order's notes (JSON).
 * Flags the LOSING order of a renewal race (or duplicate payment) for refund /
 * admin review. Idempotent.
 */
async function markOrderAsDuplicate(
  serviceClient: any,
  orderId: string | undefined,
  duplicateOfOrderId: string,
  duplicateKind: 'conversion' | 'renewal' | 'course_purchase' | 'pyq_purchase' | 'subscription_purchase',
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
 * Create a commerce purchase notification (notification + recipient rows).
 *
 * Mirrors the helper in complete-course-purchase so subscription purchases
 * produce the same in-app 'course_purchased' notification. Idempotent: skips
 * when a notification_recipients row already exists for (profile_id,
 * event_type, reference_id). Errors are logged via structuredLog but NEVER
 * thrown — notification creation must not fail a successful payment.
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
    // filters — event_type, reference_id AND profile_id.
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
      // Recipient insert failure should not leave an orphan notification.
      // Non-critical: the subscription purchase has already succeeded.
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
    return 'Only student accounts can complete a subscription purchase. Your account role does not permit this action.';
  }
  if (/student_details row already exists/i.test(raw)) {
    return 'A student record already exists for this account.';
  }
  if (/reached maximum capacity/i.test(raw)) {
    return 'This plan has reached its maximum student capacity. Please contact support.';
  }

  return 'An unexpected error occurred. Please try again or contact support.';
}

/**
 * Validate the request body has all required fields.
 * When internal=true, only planId and profileId are required.
 * Returns an array of missing field names.
 */
function validateRequestBody(
  body: Record<string, unknown>,
  isInternal: boolean,
): string[] {
  const missing: string[] = [];

  if (!body.planId || typeof body.planId !== 'string') {
    missing.push('planId');
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
 * Read an integer system setting for an institute, falling back to a
 * default when the setting is missing or invalid. Settings are seeded by
 * migration 085 (grace_days, content_access_days, expiry_notice_days).
 */
async function getInstituteIntSetting(
  client: ReturnType<typeof createClient>,
  instituteId: string,
  settingKey: string,
  fallback: number,
): Promise<number> {
  try {
    const { data } = await client
      .from('system_settings')
      .select('setting_value, data_type')
      .eq('institute_id', instituteId)
      .eq('setting_key', settingKey)
      .eq('is_active', true)
      .maybeSingle();

    if (data && (data.data_type === 'integer' || data.data_type === 'decimal')) {
      const parsed = Number(data.setting_value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.round(parsed);
      }
    }
  } catch (err) {
    structuredLog('SETTING_LOOKUP_FAILED', {
      instituteId,
      settingKey,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  return fallback;
}

/**
 * Add whole days to an ISO date string (YYYY-MM-DD) and return the result
 * as an ISO date string. Date arithmetic is done in UTC to avoid timezone
 * drift; the columns in student_subscriptions are `date` (day granularity).
 */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Compute the current date in UTC as an ISO date string (YYYY-MM-DD).
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Phase 11I.2 — Sync the course_enrollments row for a successfully created
 * subscription.
 *
 * Mirrors complete-course-purchase enrollment behavior so subscription users
 * appear under "My Courses" / dashboards / analytics exactly like one-time
 * purchasers. Idempotent: never creates a duplicate (UNIQUE (course_id,
 * student_id)); a renewal or webhook retry reuses/reactivates the existing
 * row. NEVER deactivates on expiry — entitlement revocation is handled by
 * the 11G–11J helpers / RLS / Edge Functions, not by the enrollment row.
 *
 * Non-fatal by design (same policy as subscription_history insert and
 * orders.student_id linking): the subscription is already active; an
 * enrollment failure must not roll the purchase back. Logged loudly for
 * monitoring/reconciliation.
 */
async function syncEnrollmentForSubscription(
  client: ReturnType<typeof createClient>,
  params: { studentId: string; courseId: string; instituteId: string },
): Promise<void> {
  const { studentId, courseId, instituteId } = params;

  structuredLog('ENROLLMENT_SYNC_START', {
    studentId,
    courseId,
    instituteId,
  });

  const result = await syncCourseEnrollment(client, {
    studentId,
    courseId,
    instituteId,
    enrollmentType: 'subscription',
  });

  if (result) {
    structuredLog('ENROLLMENT_SYNC_SUCCESS', {
      studentId,
      courseId,
      enrollmentId: result.enrollmentId,
      created: result.created,
      note: result.created
        ? 'New subscription-backed enrollment created'
        : 'Existing enrollment reused/reactivated — no duplicate',
    });
  } else {
    structuredLog('ENROLLMENT_SYNC_FAILED', {
      studentId,
      courseId,
      note: 'Enrollment sync failed — subscription remains active (non-fatal).',
    });
  }
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
  // Step 1: Parse and validate the request body
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
      planId: raw.planId as string,
      orderId: (raw.orderId as string | undefined) ?? undefined,
      guardianName: (raw.guardianName as string) ?? null,
      guardianMobile: (raw.guardianMobile as string) ?? null,
      guardianEmail: (raw.guardianEmail as string | undefined) ?? null,
      targetYear: (raw.targetYear as string) ?? null,
      dob: (raw.dob as string | undefined) ?? null,
      paymentReference: (raw.paymentReference as string | undefined) ?? null,
      internal: isInternal,
      profileId: isInternal ? (raw.profileId as string) : undefined,
    };

    structuredLog('request_validated', {
      planId: body.planId,
      orderId: body.orderId ?? null,
      isInternal,
      hasGuardianName: !!body.guardianName,
      hasTargetYear: !!body.targetYear,
    });
  } catch (err) {
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 1b: INTERNAL-ONLY gate
  // ═════════════════════════════════════════════════════════════════════
  // Reject every non-internal call. Only razorpay-webhook (which has
  // already verified the Razorpay signature and captured the payment) may
  // activate a subscription. This closes the 'grant yourself a free
  // subscription' vector that a direct-call path would open.
  if (!isInternal) {
    structuredLog('DIRECT_CALL_REJECTED', {
      message: 'complete-subscription-purchase is internal-only. Direct calls are rejected.',
      planId: body.planId,
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
        planId: body.planId,
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
  // Step 2: Create the service-role client for write operations
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
  // Step 3: Resolve profileId (internal call only)
  // ═════════════════════════════════════════════════════════════════════
  // profileId is provided by the caller (razorpay-webhook already verified
  // the signature). Validate it exists before proceeding.
  const profileId = body.profileId!;

  const { data: profile } = await serviceClient
    .from('profiles')
    .select('profile_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!profile) {
    return errorResponse('Profile not found for the provided profileId.', 404);
  }

  structuredLog('internal_auth_success', { profileId });

  // ═════════════════════════════════════════════════════════════════════
  // Step 4: Verify the subscription plan exists and is purchasable
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('checking_plan', { planId: body.planId });

  const { data: plan, error: planError } = await serviceClient
    .from('subscription_plans')
    .select('plan_id, institute_id, course_id, name, price, currency_code, billing_cycle, duration_days, trial_days, is_active')
    .eq('plan_id', body.planId)
    .single();

  if (planError || !plan) {
    structuredLog('PLAN_LOOKUP_FAILED', {
      planId: body.planId,
      error: planError?.message ?? 'Plan not found',
    });
    return errorResponse(
      `Subscription plan not found: ${body.planId}`,
      404,
      planError?.message,
    );
  }

  if (!plan.is_active) {
    return errorResponse('This subscription plan is no longer available.', 410, 'PLAN_INACTIVE');
  }

  structuredLog('PLAN_LOOKUP_SUCCESS', {
    planId: plan.plan_id,
    name: plan.name,
    instituteId: plan.institute_id,
    billingCycle: plan.billing_cycle,
    durationDays: plan.duration_days,
  });

  const instituteId: string = plan.institute_id;

  // Phase 11G/11H: the purchased subscription is course-scoped. The plan's
  // course_id is the authoritative source — the student_subscriptions insert
  // below MUST carry it (column is NOT NULL after migration 089, and the
  // trg_student_subscriptions_validate_course trigger enforces consistency
  // with the plan).
  const courseId: string = plan.course_id;
  if (!courseId) {
    structuredLog('PLAN_COURSE_MISSING', { planId: body.planId });
    return errorResponse('This subscription plan is not assigned to a course.', 500, 'PLAN_NO_COURSE');
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 5: Upgrade profile role from 'user' to 'student'
  // ═════════════════════════════════════════════════════════════════════
  // Same rules as complete-course-purchase / complete-pyq-purchase:
  //   'user'    → upgrade to 'student'
  //   'student' → no-op (idempotent)
  //   'teacher' / 'admin' / unknown → error (cannot convert)
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
    return errorResponse('Profile not found. Cannot complete subscription purchase.', 404);
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
      'Only user and student roles are valid for subscription purchases.',
      403,
    );
  } else {
    structuredLog('ROLE_INVALID', {
      profileId,
      currentRole,
      message: `Unknown profile role '${currentRole}' — cannot complete purchase`,
    });
    return errorResponse(
      `Unknown profile role '${currentRole}'. Cannot complete subscription purchase.`,
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
    // (e.g. duplicate student_details, which returns { error: "..." }).
    const rpcData = rpcResult as Record<string, unknown> | null;
    if (!rpcData) {
      structuredLog('CREATE_STUDENT_RPC_FAILED', {
        profileId,
        message: 'RPC returned empty response',
      });
      return errorResponse('Student creation returned an empty response.', 500);
    }

    if (rpcData.error) {
      // ── Idempotency: handle concurrent webhook deliveries ──────────
      // Re-query for the student that may have been created by the first
      // webhook delivery (race condition recovery).
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

    structuredLog('STUDENT_DETAILS_CREATED', { studentId, enrollmentNo });
  } else {
    structuredLog('STUDENT_DETAILS_CREATED', {
      studentId,
      enrollmentNo,
      note: 'Already existed (idempotent)',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 8: Idempotency — if this order already created a subscription,
  // return the existing row (duplicate webhook delivery).
  // ═════════════════════════════════════════════════════════════════════
  if (body.orderId) {
    structuredLog('checking_existing_subscription_by_order', {
      orderId: body.orderId,
      studentId,
    });

    const { data: existingByOrder } = await serviceClient
      .from('student_subscriptions')
      .select('subscription_id, start_date, end_date, grace_end_date, content_access_end_date, status')
      .eq('order_id', body.orderId)
      .maybeSingle();

    if (existingByOrder) {
      structuredLog('subscription_already_exists_by_order', {
        subscriptionId: existingByOrder.subscription_id,
        status: existingByOrder.status,
      });

      // Phase 11I.2: idempotent enrollment sync — a webhook retry must still
      // guarantee the enrollment row (first delivery may have failed after
      // the subscription insert). Non-fatal; never duplicates.
      await syncEnrollmentForSubscription(serviceClient, {
        studentId,
        courseId,
        instituteId,
      });

      return jsonResponse({
        success: true,
        studentId,
        subscriptionId: existingByOrder.subscription_id,
        planId: body.planId,
        startDate: existingByOrder.start_date,
        endDate: existingByOrder.end_date,
        graceEndDate: existingByOrder.grace_end_date,
        contentAccessEndDate: existingByOrder.content_access_end_date,
        message: 'Subscription already active for this order.',
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 9: Server-derived renewal classification (Phase 11K.4)
  // ═════════════════════════════════════════════════════════════════════
  // The CURRENT subscription row (newest by created_at — Phase 11K.1
  // decision D3, never a historical row) decides whether this payment is a
  // RENEWAL (same plan) or an initial purchase. The client never declares
  // intent; the plan + existing row determine it server-side.
  //
  // Renewal architecture (finalized): there is exactly ONE current
  // student_subscriptions row per student per course. A renewal UPDATES that
  // row in place — it never inserts a new one. Payment history lives in
  // orders/order_items (immutable), audit history lives in subscription_history.
  //
  // Renewable statuses: active / grace / expired (matches the status-
  // transition trigger trg_student_subscriptions_validate_status, which
  // allows grace→active and expired→active). cancelled / refunded rows are
  // NOT renewable (SUBSCRIPTION_NOT_RENEWABLE) and never resurrected.
  structuredLog('renewal_classification_start', {
    planId: body.planId,
    studentId,
    courseId,
  });

  const { data: currentSubscription } = await serviceClient
    .from('student_subscriptions')
    .select('subscription_id, plan_id, status, order_id, end_date')
    .eq('course_id', courseId)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentSubscription) {
    // ── Defense-in-depth: billing cycle is locked (11K.1 decision D2) ──
    // create-payment-order already rejects a different plan with 409
    // PLAN_LOCKED before an order exists; this guards direct/internal calls.
    if (currentSubscription.plan_id !== body.planId) {
      structuredLog('renewal_plan_locked', {
        subscriptionId: currentSubscription.subscription_id,
        currentPlanId: currentSubscription.plan_id,
        requestedPlanId: body.planId,
        courseId,
      });
      return errorResponse(
        'Your subscription billing cycle is locked to your current plan. ' +
          'Renew the same plan or convert to full course.',
        409,
        'PLAN_LOCKED',
      );
    }

    // ── Renewable status guard (matches create-payment-order) ─────────
    if (
      currentSubscription.status !== 'active' &&
      currentSubscription.status !== 'grace' &&
      currentSubscription.status !== 'expired'
    ) {
      structuredLog('renewal_status_not_renewable', {
        subscriptionId: currentSubscription.subscription_id,
        status: currentSubscription.status,
      });
      return errorResponse(
        'Your current subscription cannot be renewed. Please contact support.',
        409,
        'SUBSCRIPTION_NOT_RENEWABLE',
      );
    }

    // ── Defense-in-depth: permanent owner cannot buy a subscription ───
    // create-payment-order blocks this (ALREADY_OWNED) before the order
    // exists; this guards stale internal/webhook calls.
    const { data: ownedEnrollment } = await serviceClient
      .from('course_enrollments')
      .select('enrollment_id')
      .eq('course_id', courseId)
      .eq('student_id', studentId)
      .eq('enrollment_type', 'purchase')
      .eq('is_active', true)
      .maybeSingle();

    if (ownedEnrollment) {
      structuredLog('renewal_permanently_owned', {
        courseId,
        studentId,
      });
      return errorResponse(
        'You already permanently own this course.',
        409,
        'ALREADY_OWNED',
      );
    }

    // ═════════════════════════════════════════════════════════════════
    // RENEWAL PATH — UPDATE the existing row in place
    // ═════════════════════════════════════════════════════════════════
    structuredLog('renewal_update_start', {
      subscriptionId: currentSubscription.subscription_id,
      status: currentSubscription.status,
      planId: body.planId,
      orderId: body.orderId ?? null,
    });

    // Defensive guard: a renewal MUST carry an orderId. Retry idempotency is
    // anchored on the renewal order_id (Step 8 + the end_date CAS guard both
    // depend on it); without it, a duplicate delivery would recompute
    // renewalStart from the already-advanced end_date+1 and extend AGAIN.
    // The razorpay-webhook always sends orderId, so this only fires for a
    // misconfigured direct/internal call.
    if (!body.orderId) {
      structuredLog('RENEWAL_ORDER_ID_MISSING', {
        subscriptionId: currentSubscription.subscription_id,
      });
      return errorResponse(
        'Renewal requires a valid order reference. Please contact support.',
        409,
        'RENEWAL_REQUIRES_ORDER',
      );
    }

    // Billing period semantics (no overlap, no lost days):
    //   • expired/grace  → the new period starts today
    //   • active (early renewal) → the new period starts the day AFTER the
    //     current end_date, so the remaining paid days are never lost.
    const today = todayUtc();
    const renewalStart =
      currentSubscription.end_date && currentSubscription.end_date >= today
        ? addDays(currentSubscription.end_date, 1)
        : today;

    const renewalGraceDays = await getInstituteIntSetting(
      serviceClient,
      instituteId,
      'grace_days',
      DEFAULT_GRACE_DAYS,
    );

    const renewalContentAccessDays = await getInstituteIntSetting(
      serviceClient,
      instituteId,
      'content_access_days',
      DEFAULT_CONTENT_ACCESS_DAYS,
    );

    const renewalEnd = addDays(renewalStart, plan.duration_days);
    const renewalGraceEnd = addDays(renewalEnd, renewalGraceDays);
    const renewalContentEnd = addDays(renewalGraceEnd, renewalContentAccessDays);

    structuredLog('RENEWAL_DATES_COMPUTED', {
      subscriptionId: currentSubscription.subscription_id,
      planId: body.planId,
      startDate: renewalStart,
      endDate: renewalEnd,
      graceEndDate: renewalGraceEnd,
      contentAccessEndDate: renewalContentEnd,
    });

    // Optimistic concurrency: the UPDATE is keyed on the exact end_date we
    // observed. If a concurrent renewal order (another webhook delivery of a
    // DIFFERENT order) already advanced end_date, 0 rows match → we detect
    // the double-application and reject instead of silently extending twice.
    const { data: renewed, error: renewError } = await serviceClient
      .from('student_subscriptions')
      .update({
        status: 'active',
        start_date: renewalStart,
        end_date: renewalEnd,
        grace_end_date: renewalGraceEnd,
        content_access_end_date: renewalContentEnd,
        order_id: body.orderId ?? currentSubscription.order_id,
        updated_at: new Date().toISOString(),
      })
      .eq('subscription_id', currentSubscription.subscription_id)
      .eq('end_date', currentSubscription.end_date)
      .select('subscription_id, start_date, end_date, grace_end_date, content_access_end_date, status')
      .maybeSingle();

    if (renewError) {
      structuredLog('RENEWAL_UPDATE_FAILED', {
        subscriptionId: currentSubscription.subscription_id,
        error: renewError.message,
        sqlState: (renewError as { code?: string })?.code ?? 'unknown',
      });
      const safeMsg = sanitizeErrorMessage(renewError.message, 'renewal update');
      return errorResponse(safeMsg, 500, renewError.message);
    }

    if (!renewed) {
      // 0 rows matched the (subscription_id, end_date) guard → either:
      //   (a) SAME order — a concurrent duplicate webhook delivery of THIS
      //       renewal order already applied. The row's order_id is now this
      //       order, so treat it as an idempotent success (Razorpay webhook
      //       retries must never surface an error).
      //   (b) DIFFERENT order — a concurrent renewal from another order
      //       already claimed the row. This is a duplicate payment that must
      //       be refunded/reviewed — never a silent double extension.
      const { data: afterRace } = await serviceClient
        .from('student_subscriptions')
        .select('subscription_id, start_date, end_date, grace_end_date, content_access_end_date, status, order_id')
        .eq('subscription_id', currentSubscription.subscription_id)
        .maybeSingle();

      if (afterRace && body.orderId && afterRace.order_id === body.orderId) {
        structuredLog('RENEWAL_IDEMPOTENT_RETRY', {
          subscriptionId: afterRace.subscription_id,
          orderId: body.orderId,
        });
        return jsonResponse({
          success: true,
          studentId,
          subscriptionId: afterRace.subscription_id,
          planId: body.planId,
          startDate: afterRace.start_date,
          endDate: afterRace.end_date,
          graceEndDate: afterRace.grace_end_date,
          contentAccessEndDate: afterRace.content_access_end_date,
          message: 'Subscription renewed successfully (duplicate webhook).',
        });
      }

      structuredLog('RENEWAL_CONFLICT_DETECTED', {
        subscriptionId: currentSubscription.subscription_id,
        orderId: body.orderId ?? null,
        expectedEndDate: currentSubscription.end_date,
        currentOrderId: afterRace?.order_id ?? null,
      });

      // Phase 11K.6: mark the LOSING order as a duplicate so it surfaces for
      // refund/admin review. Never extends the subscription (the winner
      // already claimed the end_date CAS). Non-fatal — the 409 remains the
      // deterministic response to the webhook.
      if (body.orderId && afterRace?.order_id && afterRace.order_id !== body.orderId) {
        await markOrderAsDuplicate(
          serviceClient,
          body.orderId,
          afterRace.order_id,
          'renewal',
        );
      }

      return errorResponse(
        'This subscription was already renewed by another payment. ' +
          'The duplicate payment will be refunded.',
        409,
        'RENEWAL_CONFLICT',
      );
    }

    structuredLog('RENEWAL_UPDATE_SUCCESS', {
      subscriptionId: renewed.subscription_id,
      startDate: renewed.start_date,
      endDate: renewed.end_date,
    });

    // ── subscription_history: enrich the auto row, else insert ───────
    // The AFTER-UPDATE auto-history trigger (trgfn_subscription_auto_history)
    // writes a 'system_action' row when status CHANGES (expired→active,
    // grace→active). Its own TODO instructs the backend to enrich it. For an
    // active→active early renewal the trigger is silent, so we insert the
    // 'renewal' event explicitly. Never two rows for one renewal.
    const renewalMetadata = {
      order_id: body.orderId ?? null,
      plan_id: body.planId,
      course_id: courseId,
      plan_name: plan.name,
      price: Number(plan.price),
      billing_cycle: plan.billing_cycle,
      duration_days: plan.duration_days,
      payment_gateway: 'razorpay',
      renewal_from_status: currentSubscription.status,
      previous_end_date: currentSubscription.end_date,
    };

    // IMPORTANT: the enrichment query MUST match the exact transition row
    // written by THIS renewal's status change. Filtering by status_before is
    // what makes this exact: for an active→active early renewal the trigger is
    // SILENT (no new row), and the CHECK constraint
    // ck_subscription_history_status_change (status_before is null OR
    // status_before != status_after) guarantees no row can ever have
    // status_before = status_after = 'active' — so the filter yields null
    // (→ explicit insert) instead of corrupting a STALE system_action row
    // from an earlier transition (e.g. a previous expired→active).
    const { data: autoRow } = await serviceClient
      .from('subscription_history')
      .select('history_id')
      .eq('subscription_id', currentSubscription.subscription_id)
      .eq('change_reason', 'system_action')
      .eq('status_before', currentSubscription.status)
      .eq('status_after', 'active')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (autoRow) {
      // Enrich the trigger-written transition row (per its TODO).
      const { error: enrichError } = await serviceClient
        .from('subscription_history')
        .update({
          change_reason: 'renewal',
          changed_by: profileId,
          changed_by_role: 'student',
          payment_reference: body.paymentReference ?? null,
          metadata: renewalMetadata,
        })
        .eq('history_id', autoRow.history_id);

      if (enrichError) {
        structuredLog('RENEWAL_HISTORY_ENRICH_FAILED', {
          historyId: autoRow.history_id,
          error: enrichError.message,
        });
      } else {
        structuredLog('RENEWAL_HISTORY_ENRICHED', {
          historyId: autoRow.history_id,
          changeReason: 'renewal',
        });
      }
    } else {
      // active→active early renewal — trigger silent. Insert explicitly.
      // status_before stays NULL (ck_subscription_history_status_change
      // forbids status_before = status_after); the original status is kept
      // in metadata.renewal_from_status.
      const { error: historyInsertError } = await serviceClient
        .from('subscription_history')
        .insert({
          subscription_id: renewed.subscription_id,
          student_id: studentId,
          institute_id: instituteId,
          status_before: null,
          status_after: 'active',
          change_reason: 'renewal',
          changed_by: profileId,
          changed_by_role: 'student',
          payment_reference: body.paymentReference ?? null,
          metadata: renewalMetadata,
        });

      if (historyInsertError) {
        structuredLog('RENEWAL_HISTORY_INSERT_FAILED', {
          subscriptionId: renewed.subscription_id,
          error: historyInsertError.message,
        });
      } else {
        structuredLog('RENEWAL_HISTORY_INSERT_SUCCESS', {
          subscriptionId: renewed.subscription_id,
          changeReason: 'renewal',
        });
      }
    }

    // ── Link the renewal order to the student (same as Step 13) ──────
    if (body.orderId) {
      const { error: orderUpdateError } = await serviceClient
        .from('orders')
        .update({ student_id: studentId })
        .eq('order_id', body.orderId);

      if (orderUpdateError) {
        structuredLog('RENEWAL_ORDER_LINK_FAILED', {
          orderId: body.orderId,
          error: orderUpdateError.message,
        });
      }
    }

    // ── Enrollment sync (Phase 11I.2 — idempotent, non-fatal) ────────
    // Renewal reuses the SAME enrollment row — never a second one. Expiry
    // never deactivates it; access is revoked by the entitlement helpers.
    await syncEnrollmentForSubscription(serviceClient, {
      studentId,
      courseId,
      instituteId,
    });

    structuredLog('RENEWAL_COMPLETE', {
      subscriptionId: renewed.subscription_id,
      studentId,
      planId: body.planId,
      orderId: body.orderId ?? null,
      startDate: renewed.start_date,
      endDate: renewed.end_date,
      graceEndDate: renewed.grace_end_date,
      contentAccessEndDate: renewed.content_access_end_date,
    });

    return jsonResponse({
      success: true,
      studentId,
      subscriptionId: renewed.subscription_id,
      planId: body.planId,
      startDate: renewed.start_date,
      endDate: renewed.end_date,
      graceEndDate: renewed.grace_end_date,
      contentAccessEndDate: renewed.content_access_end_date,
      message: 'Subscription renewed successfully.',
    });
  }

  // No current row → INITIAL purchase. Fall through to Steps 10–15
  // (date computation + INSERT + history + order link + enrollment sync),
  // which are unchanged for first-time purchases.
  structuredLog('initial_purchase_path', {
    planId: body.planId,
    studentId,
    courseId,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 10: Compute subscription dates (Phase 11A rules)
  // ═════════════════════════════════════════════════════════════════════
  //   start_date            = today
  //   end_date              = start_date + duration_days (plan-authoritative)
  //   grace_end_date        = end_date + grace_days      (setting, default 7)
  //   content_access_end_date = grace_end_date + content_access_days (default 30)
  //
  // The duration_days column on the plan is authoritative for the paid
  // period. The grace/content windows come from per-institute system
  // settings seeded in migration 085, with Phase 11A defaults as fallback.
  const graceDays = await getInstituteIntSetting(
    serviceClient,
    instituteId,
    'grace_days',
    DEFAULT_GRACE_DAYS,
  );

  const contentAccessDays = await getInstituteIntSetting(
    serviceClient,
    instituteId,
    'content_access_days',
    DEFAULT_CONTENT_ACCESS_DAYS,
  );

  const startDate = todayUtc();
  const endDate = addDays(startDate, plan.duration_days);
  const graceEndDate = addDays(endDate, graceDays);
  const contentAccessEndDate = addDays(graceEndDate, contentAccessDays);

  structuredLog('SUBSCRIPTION_DATES_COMPUTED', {
    planId: body.planId,
    startDate,
    endDate,
    graceEndDate,
    contentAccessEndDate,
    graceDays,
    contentAccessDays,
    durationDays: plan.duration_days,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 11: Insert the student_subscriptions row (status = 'active')
  // ═════════════════════════════════════════════════════════════════════
  // V1 decision: is_auto_renew = false — manual renewal is the only path
  // in Phase 11A. is_trial = false — a paid purchase is never a trial.
  structuredLog('SUBSCRIPTION_INSERT_START', {
    studentId,
    planId: body.planId,
    instituteId,
    orderId: body.orderId ?? null,
  });

  const { data: newSubscription, error: subscriptionError } = await serviceClient
    .from('student_subscriptions')
    .insert({
      student_id: studentId,
      plan_id: body.planId,
      course_id: courseId,
      institute_id: instituteId,
      order_id: body.orderId ?? null,
      status: 'active',
      start_date: startDate,
      end_date: endDate,
      grace_end_date: graceEndDate,
      content_access_end_date: contentAccessEndDate,
      is_trial: false,
      is_auto_renew: false, // V1: manual renewal only
      renewal_attempts: 0,
    })
    .select('subscription_id, start_date, end_date, grace_end_date, content_access_end_date')
    .single();

  if (subscriptionError || !newSubscription) {
    structuredLog('SUBSCRIPTION_INSERT_FAILED', {
      studentId,
      planId: body.planId,
      error: subscriptionError?.message ?? 'Insert returned no data',
      sqlState: (subscriptionError as { code?: string })?.code ?? 'unknown',
    });

    // A unique violation (SQLSTATE 23505) means one of two things:
    //   1. Same-order race — a concurrent webhook delivery inserted the row
    //      between our duplicate check and this insert. Recover it by
    //      order_id for idempotent success (never a misleading 500).
    //   2. Genuine duplicate — the student already holds an ACTIVE/GRACE
    //      subscription for this plan created by a DIFFERENT order. The
    //      partial unique index uq_student_subscriptions_student_plan_active_grace
    //      (migration 086) enforces this atomically at the DB level, so the
    //      pre-insert SELECT in Step 9 is now defense-in-depth only.
    //      Convert to the standard 409 ALREADY_SUBSCRIBED — never a raw DB
    //      error and never a silent success for a different order.
    const isUniqueViolation =
      (subscriptionError as { code?: string })?.code === '23505' ||
      /duplicate key/i.test(subscriptionError?.message ?? '');

    if (isUniqueViolation) {
      if (body.orderId) {
        const { data: recovered } = await serviceClient
          .from('student_subscriptions')
          .select('subscription_id, start_date, end_date, grace_end_date, content_access_end_date')
          .eq('student_id', studentId)
          .eq('plan_id', body.planId)
          .eq('order_id', body.orderId)
          .in('status', ['active', 'grace'])
          .maybeSingle();

        if (recovered) {
          structuredLog('SUBSCRIPTION_RECOVERED_AFTER_RACE', {
            subscriptionId: recovered.subscription_id,
          });

          // Phase 11I.2: idempotent enrollment sync for the concurrent
          // webhook race recovery path. Non-fatal; never duplicates.
          await syncEnrollmentForSubscription(serviceClient, {
            studentId,
            courseId,
            instituteId,
          });

          return jsonResponse({
            success: true,
            studentId,
            subscriptionId: recovered.subscription_id,
            planId: body.planId,
            startDate: recovered.start_date,
            endDate: recovered.end_date,
            graceEndDate: recovered.grace_end_date,
            contentAccessEndDate: recovered.content_access_end_date,
            message: 'Subscription already active (concurrent webhook).',
          });
        }
      }

      // No same-order row exists — the active/grace subscription belongs to
      // a different order. The webhook (the only caller, enforced by the
      // internal gate) always sends orderId, so this is the genuine-duplicate
      // path. M4 Fix B: flag THIS order for refund/admin review (mirroring
      // the renewal conflict handling) before rejecting with the standard 409.
      const { data: winnerSubscription } = await serviceClient
        .from('student_subscriptions')
        .select('order_id')
        .eq('student_id', studentId)
        .eq('plan_id', body.planId)
        .in('status', ['active', 'grace'])
        .maybeSingle();

      if (
        body.orderId &&
        winnerSubscription?.order_id &&
        winnerSubscription.order_id !== body.orderId
      ) {
        structuredLog('DUPLICATE_SUBSCRIPTION_DETECTED', {
          studentId,
          planId: body.planId,
          currentOrderId: body.orderId,
          priorOrderId: winnerSubscription.order_id,
        });

        await markOrderAsDuplicate(
          serviceClient,
          body.orderId,
          winnerSubscription.order_id,
          'subscription_purchase',
        );
      } else {
        structuredLog('duplicate_subscription_rejected_unique_index', {
          studentId,
          planId: body.planId,
          orderId: body.orderId ?? null,
        });
      }
      return errorResponse(
        'You already have an active subscription for this plan. Renew it after it expires.',
        409,
        'ALREADY_SUBSCRIBED',
      );
    }

    const safeMessage = sanitizeErrorMessage(
      subscriptionError?.message ?? 'Insert returned no data.',
      'student_subscriptions insert',
    );
    return errorResponse(safeMessage, 500, subscriptionError?.message);
  }

  structuredLog('SUBSCRIPTION_INSERT_SUCCESS', {
    subscriptionId: newSubscription.subscription_id,
    studentId,
    planId: body.planId,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 12: Insert subscription_history (change_reason = 'new_purchase')
  // ═════════════════════════════════════════════════════════════════════
  // The auto-history trigger only fires on status UPDATE, not INSERT, so we
  // explicitly record the initial 'new_purchase' event for audit. The
  // status-transition trigger (BEFORE UPDATE OF status) guards later
  // transitions (expiry job, cancellation, etc.).
  structuredLog('SUBSCRIPTION_HISTORY_INSERT_START', {
    subscriptionId: newSubscription.subscription_id,
    studentId,
    instituteId,
  });

  const { error: historyError } = await serviceClient
    .from('subscription_history')
    .insert({
      subscription_id: newSubscription.subscription_id,
      student_id: studentId,
      institute_id: instituteId,
      status_before: null,
      status_after: 'active',
      change_reason: 'new_purchase',
      changed_by: profileId,
      changed_by_role: 'student',
      payment_reference: body.paymentReference ?? null,
      metadata: {
        order_id: body.orderId ?? null,
        plan_id: body.planId,
        course_id: courseId,
        plan_name: plan.name,
        price: Number(plan.price),
        billing_cycle: plan.billing_cycle,
        duration_days: plan.duration_days,
        payment_gateway: 'razorpay',
      },
    });

  if (historyError) {
    // Non-fatal for the student (the subscription is active), but must be
    // logged loudly — audit continuity matters for refunds/cancellations.
    structuredLog('SUBSCRIPTION_HISTORY_INSERT_FAILED', {
      subscriptionId: newSubscription.subscription_id,
      studentId,
      error: historyError.message,
      sqlState: (historyError as { code?: string })?.code ?? 'unknown',
    });
  } else {
    structuredLog('SUBSCRIPTION_HISTORY_INSERT_SUCCESS', {
      subscriptionId: newSubscription.subscription_id,
      changeReason: 'new_purchase',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 13: Update orders.student_id (link order to student)
  // ═════════════════════════════════════════════════════════════════════
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
      // Non-fatal: the subscription is already created. The order can be
      // linked later via the admin panel.
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
  // Step 14: Sync course_enrollments (Phase 11I.2)
  // ═════════════════════════════════════════════════════════════════════
  // The subscription is confirmed active (insert + history + order linking
  // all done). Mirror complete-course-purchase: ensure the student has an
  // active enrollment row for this course so "My Courses", dashboards and
  // analytics behave consistently. Idempotent + non-fatal (see helper).
  structuredLog('checking_course_enrollment', {
    courseId,
    studentId,
    instituteId,
  });

  await syncEnrollmentForSubscription(serviceClient, {
    studentId,
    courseId,
    instituteId,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 14b: Create the in-app purchase notification
  // ═════════════════════════════════════════════════════════════════════
  // Mirror complete-course-purchase: after the subscription + enrollment are
  // confirmed, create an in-app 'course_purchased' notification for the
  // purchaser. Awaited, but errors are caught inside createCommerceNotification
  // and NEVER propagate — notification failure must not fail a successful
  // payment. Idempotent: the helper's idempotency check prevents duplicates
  // on webhook retries.
  structuredLog('NOTIFICATION_FLOW_START', {
    profileId,
    studentId,
    courseId,
    orderId: body.orderId ?? null,
    eventTypes: ['course_purchased'],
    context: 'subscription_purchase',
  });

  await createCommerceNotification(serviceClient, {
    eventType: 'course_purchased',
    title: 'Course Purchased Successfully',
    body: 'Your payment was successful. You now own this course.',
    profileId,
    instituteId,
    referenceType: 'course',
    referenceId: courseId,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 15: Return the structured success response
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('ONBOARDING_COMPLETE', {
    subscriptionId: newSubscription.subscription_id,
    studentId,
    planId: body.planId,
    orderId: body.orderId ?? null,
    startDate,
    endDate,
    graceEndDate,
    contentAccessEndDate,
  });

  return jsonResponse({
    success: true,
    studentId,
    subscriptionId: newSubscription.subscription_id,
    planId: body.planId,
    startDate,
    endDate,
    graceEndDate,
    contentAccessEndDate,
    message: 'Subscription activated successfully.',
  });
});
