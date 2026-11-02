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
  // Step 4: Atomic Transactional Subscription Fulfillment RPC
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('FULFILLMENT_RPC_START', {
    orderId: body.orderId,
    planId: body.planId,
    profileId,
  });

  const { data: fulfillData, error: fulfillError } = await serviceClient.rpc(
    'fulfill_standard_subscription_order',
    {
      p_order_id: body.orderId,
      p_plan_id: body.planId,
      p_profile_id: profileId,
      p_guardian_name: body.guardianName ?? null,
      p_guardian_mobile: body.guardianMobile ?? null,
      p_guardian_email: body.guardianEmail ?? null,
      p_target_year: body.targetYear ?? null,
      p_dob: body.dob ?? null,
    }
  );

  if (fulfillError || !fulfillData?.success) {
    const code = fulfillData?.code || 'FULFILLMENT_FAILED';
    const msg = fulfillError?.message || fulfillData?.error || 'Subscription fulfillment failed';

    structuredLog('FULFILLMENT_RPC_FAILED', {
      orderId: body.orderId,
      planId: body.planId,
      code,
      error: msg,
    });

    if (code === 'ORDER_CANCELLED_OR_REFUNDED' || code === 'ORDER_REQUIRES_ADMIN_REVIEW' || code === 'PAYMENT_NOT_SETTLED') {
      return errorResponse(msg, 409, code);
    }
    return errorResponse(msg, 500, code);
  }

  const studentId = fulfillData.student_id;
  const subscriptionId = fulfillData.subscription_id;
  const courseId = fulfillData.course_id;
  const instituteId = fulfillData.institute_id;
  const startDate = fulfillData.start_date;
  const endDate = fulfillData.end_date;
  const graceEndDate = fulfillData.grace_end_date;
  const contentAccessEndDate = fulfillData.content_access_end_date;

  structuredLog('FULFILLMENT_RPC_SUCCESS', {
    studentId,
    subscriptionId,
    courseId,
    planId: body.planId,
    orderId: body.orderId ?? null,
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
    subscriptionId: subscriptionId,
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
    subscriptionId: subscriptionId,
    planId: body.planId,
    startDate,
    endDate,
    graceEndDate,
    contentAccessEndDate,
    message: 'Subscription activated successfully.',
  });
});
