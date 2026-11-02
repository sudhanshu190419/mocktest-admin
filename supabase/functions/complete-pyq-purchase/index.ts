// ============================================================================
// Edge Function: complete-pyq-purchase
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Orchestrates student onboarding after a successful PYQ package purchase.
// This is the PYQ-specific counterpart to complete-course-purchase.
//
// Architecture:
//   razorpay-webhook (internal call)  OR  Mobile App (direct call)
//       ↓
//   complete-pyq-purchase  ← YOU ARE HERE
//       ↓
//   Role upgrade (user → student, if needed)
//       ↓
//   create_student_after_purchase()  (Phase 1 RPC, if needed)
//       ↓
//   Insert student_pyq_purchases
//       ↓
//   Link order.student_id
//       ↓
//   Success
//
// When called internally (by razorpay-webhook), authentication is skipped
// and the caller provides the profileId directly.
//
// Business Rule: Purchasing ANY educational product (course, PYQ package,
// future test series) upgrades the profile role from 'user' to 'student'.
//
// @module edge-functions/complete-pyq-purchase
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
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
  /** The PYQ package the student purchased. */
  packageId: string;
  /** Local order ID (from create-payment-order). Used for order_item FK. */
  orderId?: string;
  // Pre-onboarding fields (optional for internal calls).
  guardianName: string | null;
  guardianMobile: string | null;
  guardianEmail?: string | null;
  targetYear: string | null;
  dob?: string | null;

  // Internal call support (razorpay-webhook):
  internal?: boolean;
  profileId?: string;
}

interface SuccessResponse {
  success: true;
  studentId: string;
  purchaseId: string;
  packageId: string;
  message: string;
  /**
   * M4 Fix B — set to true when this payment was detected as a duplicate
   * (a prior confirmed PYQ order already exists for this student + package).
   * Access is NOT granted twice; the current order is flagged for
   * refund/admin review.
   */
  duplicate?: boolean;
  /** M4 Fix B — the order_id of the earlier confirmed PYQ order. */
  duplicateOfOrderId?: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
}

type FunctionResponse = SuccessResponse | ErrorResponse;

/** Raw row from pyq_packages table. */
interface PyqPackageRow {
  package_id: string;
  institute_id: string;
  name: string;
  is_active: boolean;
  published_at: string | null;
}

/** Raw row from order_items table. */
interface OrderItemRow {
  item_id: string;
}

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
 * When internal=true, only packageId and profileId are required.
 * Returns an array of missing field names.
 */
function validateRequestBody(
  body: Record<string, unknown>,
  isInternal: boolean,
): string[] {
  const missing: string[] = [];

  if (!body.packageId || typeof body.packageId !== 'string') {
    missing.push('packageId');
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
    return 'Only student accounts can complete a purchase. Your account role does not permit this action.';
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
// M4 Fix B — duplicate confirmed order helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Append a duplicate-payment marker to an order's notes (JSON text).
 * Used to flag a second confirmed PYQ order for refund/admin review.
 * Idempotent: re-marking the same order only overwrites the marker.
 * Never DESTROYS existing notes — unparseable notes are left untouched.
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
 * Find a CONFIRMED PYQ order for the same student + package that is NOT the
 * current order. Used to detect a duplicate PYQ payment (M4 Fix B): only ONE
 * PYQ purchase may ever succeed per student/package.
 *
 * Order.notes is JSON text; we parse and compare exactly.
 */
async function findPriorConfirmedPyqOrder(
  serviceClient: any,
  profileId: string,
  packageId: string,
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
    structuredLog('PRIOR_CONFIRMED_PYQ_ORDER_LOOKUP_FAILED', {
      profileId,
      packageId,
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
    if (notes.packageId === packageId) {
      return { order_id: order.order_id };
    }
  }
  return null;
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
      packageId: raw.packageId as string,
      orderId: (raw.orderId as string | undefined) ?? undefined,
      guardianName: (raw.guardianName as string) ?? null,
      guardianMobile: (raw.guardianMobile as string) ?? null,
      guardianEmail: (raw.guardianEmail as string | undefined) ?? null,
      targetYear: (raw.targetYear as string) ?? null,
      dob: (raw.dob as string | undefined) ?? null,
      internal: isInternal,
      profileId: isInternal ? (raw.profileId as string) : undefined,
    };

    structuredLog('request_validated', {
      packageId: body.packageId,
      isInternal,
      hasGuardianName: !!body.guardianName,
      hasTargetYear: !!body.targetYear,
    });
  } catch (err) {
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }

  // Step 1b: INTERNAL-ONLY gate
  // ─────────────────────────────────────────────────────────────
  // Reject every non-internal call. Only razorpay-webhook (which has
  // already verified the Razorpay signature and captured the payment) may
  // complete a PYQ package purchase. This closes the 'grant yourself a
  // free PYQ package' vector that a direct-call path would open.
  if (!isInternal) {
    structuredLog('DIRECT_CALL_REJECTED', {
      message: 'complete-pyq-purchase is internal-only. Direct calls are rejected.',
      packageId: body.packageId,
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
        packageId: body.packageId,
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
  // Step 2: Resolve profileId
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
  // Step 4: Atomic Transactional PYQ Fulfillment RPC
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('FULFILLMENT_RPC_START', {
    orderId: body.orderId,
    packageId: body.packageId,
    profileId,
  });

  const { data: fulfillData, error: fulfillError } = await serviceClient.rpc(
    'fulfill_standard_pyq_order',
    {
      p_order_id: body.orderId,
      p_package_id: body.packageId,
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
    const msg = fulfillError?.message || fulfillData?.error || 'PYQ fulfillment failed';

    structuredLog('FULFILLMENT_RPC_FAILED', {
      orderId: body.orderId,
      packageId: body.packageId,
      code,
      error: msg,
    });

    if (code === 'ORDER_CANCELLED_OR_REFUNDED' || code === 'ORDER_REQUIRES_ADMIN_REVIEW' || code === 'PAYMENT_NOT_SETTLED') {
      return errorResponse(msg, 409, code);
    }
    return errorResponse(msg, 500, code);
  }

  const studentId = fulfillData.student_id;
  const purchaseId = fulfillData.purchase_id;
  const instituteId = fulfillData.institute_id;

  structuredLog('FULFILLMENT_RPC_SUCCESS', {
    studentId,
    purchaseId,
    packageId: body.packageId,
    orderId: body.orderId ?? null,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 12: Create purchase notifications
  // ═════════════════════════════════════════════════════════════════════
  // Create TWO notifications after the entire purchase flow succeeds:
  //   1. pyq_purchased — payment confirmation
  //   2. pyq_access_granted — access grant confirmation
  //  // These are fire-and-forget: notification failure does NOT block the
  // success response because the purchase is already complete.
  structuredLog('NOTIFICATION_FLOW_START', {
      profileId,
      studentId,
      packageId: body.packageId,
      orderId: body.orderId ?? null,
      eventTypes: ['pyq_purchased'],
      context: 'main_flow',
    });

  await createCommerceNotification(serviceClient, {
      eventType: 'pyq_purchased',
      title: 'PYQ Package Purchased',
      body: 'Your payment was successful. Your PYQ package is ready.',
      profileId,
      instituteId,
      referenceType: 'pyq_package',
      referenceId: body.packageId,
    });

  structuredLog('NOTIFICATION_FLOW_START', {
      profileId,
      studentId,
      packageId: body.packageId,
      orderId: body.orderId ?? null,
      eventTypes: ['pyq_access_granted'],
      context: 'main_flow',
    });

  await createCommerceNotification(serviceClient, {
      eventType: 'pyq_access_granted',
      title: 'PYQ Access Granted',
      body: 'You can now start practicing your purchased PYQ package.',
      profileId,
      instituteId,
      referenceType: 'pyq_package',
      referenceId: body.packageId,
    });

  // ═════════════════════════════════════════════════════════════════════
  // Step 13: Return the structured success response
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('ONBOARDING_COMPLETE', {
    studentId,
    purchaseId,
    packageId: body.packageId,
    orderId: body.orderId ?? null,
  });

  return jsonResponse({
    success: true,
    studentId,
    purchaseId,
    packageId: body.packageId,
    message: 'PYQ package access granted successfully.',
  });
});
