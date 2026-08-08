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
  // Step 4: Verify the PYQ package exists and is purchasable
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('checking_pyq_package', { packageId: body.packageId });

  const { data: pkg, error: pkgError } = await serviceClient
    .from('pyq_packages')
    .select('package_id, institute_id, name, is_active, published_at')
    .eq('package_id', body.packageId)
    .single();

  if (pkgError || !pkg) {
    structuredLog('PACKAGE_LOOKUP_FAILED', {
      packageId: body.packageId,
      error: pkgError?.message ?? 'Package not found',
    });
    return errorResponse(
      `PYQ Package not found: ${body.packageId}`,
      404,
      pkgError?.message,
    );
  }

  if (!pkg.is_active) {
    structuredLog('PACKAGE_INACTIVE', {
      packageId: body.packageId,
      name: pkg.name,
    });
    return errorResponse(
      `PYQ Package "${pkg.name}" is no longer available.`,
      410,
    );
  }

  structuredLog('PACKAGE_LOOKUP_SUCCESS', {
    packageId: pkg.package_id,
    name: pkg.name,
    instituteId: pkg.institute_id,
    isActive: pkg.is_active,
  });

  const instituteId: string = pkg.institute_id;

  // ═════════════════════════════════════════════════════════════════════
  // Step 5: Upgrade profile role from 'user' to 'student'
  // ═════════════════════════════════════════════════════════════════════
  // Business Rule: Purchasing ANY educational product upgrades user → student.
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
    return errorResponse('Profile not found. Cannot complete PYQ purchase.', 404);
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
      'Only user and student roles are valid for PYQ purchases.',
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
      `Unknown profile role '${currentRole}'. Cannot complete PYQ purchase.`,
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
      instituteId: (rpcData?.institute_id as string) ?? instituteId,
    });

    structuredLog('STUDENT_DETAILS_READY', { studentId, enrollmentNo });
  } else {
    structuredLog('STUDENT_DETAILS_READY', {
      studentId,
      enrollmentNo,
      note: 'Already existed (idempotent)',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 8: Check for existing student_pyq_purchases (idempotent)
  // ═════════════════════════════════════════════════════════════════════
  // The student_pyq_purchases table has a UNIQUE constraint on
  // (student_id, package_id), so we check before inserting.
  structuredLog('checking_existing_pyq_purchase', {
    packageId: body.packageId,
    studentId,
  });

  const { data: existingPurchase } = await serviceClient
    .from('student_pyq_purchases')
    .select('purchase_id')
    .eq('package_id', body.packageId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (existingPurchase) {
    structuredLog('PYQ_ALREADY_PURCHASED', {
      purchaseId: existingPurchase.purchase_id,
      packageId: body.packageId,
      studentId,
    });

    // ── Ensure notifications exist (idempotent) ────────────────────────
    // If a previous webhook delivery succeeded for purchase but failed
    // before creating notifications, this call creates them now.
    structuredLog('NOTIFICATION_FLOW_START', {
      profileId,
      studentId,
      packageId: body.packageId,
      orderId: body.orderId ?? null,
      eventTypes: ['pyq_purchased'],
      context: 'existing_purchase',
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
      context: 'existing_purchase',
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

    // Idempotent: already purchased, return success.
    return jsonResponse({
      success: true,
      studentId,
      purchaseId: existingPurchase.purchase_id,
      packageId: body.packageId,
      message: 'Student already has access to this PYQ Package.',
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 9: Resolve the order_item_id for the purchase record
  // ═════════════════════════════════════════════════════════════════════
  // The student_pyq_purchases.order_item_id FK links the purchase to the
  // commerce order_items record. We look up the order_item that matches
  // this order and package.
  let orderItemId: string | null = null;

  if (body.orderId) {
    const { data: orderItem } = await serviceClient
      .from('order_items')
      .select('item_id')
      .eq('order_id', body.orderId)
      .eq('item_type', 'pyq_package')
      .eq('package_id', body.packageId)
      .maybeSingle();

    if (orderItem) {
      orderItemId = orderItem.item_id;
      structuredLog('ORDER_ITEM_RESOLVED', {
        orderItemId,
        orderId: body.orderId,
        packageId: body.packageId,
      });
    } else {
      structuredLog('ORDER_ITEM_NOT_FOUND', {
        orderId: body.orderId,
        packageId: body.packageId,
        note: 'Order item not found — purchase will be created without order_item_id link',
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Step 10: Insert the student_pyq_purchases record
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('PYQ_PURCHASE_INSERT_START', {
    packageId: body.packageId,
    studentId,
    instituteId,
    orderItemId,
  });

  const { data: newPurchase, error: purchaseError } = await serviceClient
    .from('student_pyq_purchases')
    .insert({
      student_id: studentId,
      package_id: body.packageId,
      institute_id: instituteId,
      order_item_id: orderItemId,
      access_type: 'purchase',
      is_active: true,
    })
    .select('purchase_id')
    .single();

  if (purchaseError || !newPurchase) {
    structuredLog('PYQ_PURCHASE_INSERT_FAILED', {
      packageId: body.packageId,
      studentId,
      error: purchaseError?.message ?? 'Insert returned no data',
      sqlState: (purchaseError as { code?: string })?.code ?? 'unknown',
    });

    // ── Idempotency: handle PK/unique constraint violation ──────────
    // If a concurrent request inserted the record between our check and
    // insert, this will fail with a duplicate key error. Re-query instead
    // of returning an error.
    if (purchaseError && /duplicate key value violates unique constraint/i.test(purchaseError.message)) {
      structuredLog('PYQ_PURCHASE_RACE', {
        packageId: body.packageId,
        studentId,
        error: purchaseError.message,
      });

      const { data: recoveredPurchase } = await serviceClient
        .from('student_pyq_purchases')
        .select('purchase_id')
        .eq('package_id', body.packageId)
        .eq('student_id', studentId)
        .maybeSingle();

      if (recoveredPurchase) {
        structuredLog('PYQ_PURCHASE_INSERT_SUCCESS', {
          purchaseId: recoveredPurchase.purchase_id,
          packageId: body.packageId,
          studentId,
          note: 'Recovered from concurrent insert race condition',
        });

        // Continue to order linking with recovered purchase ID
        const purchaseId = recoveredPurchase.purchase_id;

        // ═══════════════════════════════════════════════════════════════
        // Step 11: Update orders.student_id (concurrent recovery path)
        // ═══════════════════════════════════════════════════════════════
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
            note: 'No orderId provided',
          });
        }

        // ── Create notifications (concurrent recovery path) ────────────
        structuredLog('NOTIFICATION_FLOW_START', {
          profileId,
          studentId,
          packageId: body.packageId,
          orderId: body.orderId ?? null,
          eventTypes: ['pyq_purchased'],
          context: 'concurrent_recovery',
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
          context: 'concurrent_recovery',
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
          message: 'PYQ package access granted successfully (concurrent recovery).',
        });
      }
    }

    const safeMessage = sanitizeErrorMessage(
      purchaseError?.message ?? 'Insert returned no data.',
      'student_pyq_purchases insert',
    );
    return errorResponse(safeMessage, 500, purchaseError?.message);
  }

  const purchaseId = newPurchase.purchase_id;

  structuredLog('PYQ_PURCHASE_INSERT_SUCCESS', {
    purchaseId,
    packageId: body.packageId,
    studentId,
  });

  // ═════════════════════════════════════════════════════════════════════
  // Step 11: Update orders.student_id
  // ═════════════════════════════════════════════════════════════════════
  // After creating the student_details and PYQ purchase, link the
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
