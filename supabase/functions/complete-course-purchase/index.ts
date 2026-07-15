// ============================================================================
// Edge Function: complete-course-purchase
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Orchestrates student onboarding after a successful course purchase.
// This is the single backend entry point that:
//   1. Verifies authentication (profile_id from JWT)
//   2. Validates the request body
//   3. Confirms the course exists
//   4. Checks for existing student_details + course_enrollment (idempotent)
//   5. Calls create_student_after_purchase() RPC (Phase 1)
//   6. Creates the course_enrollment record
//   7. Returns a structured success response
//
// Architecture: Orchestration only — all business rules live in PostgreSQL RPCs.
//
// Flow:
//   razorpay-webhook (internal call)  OR  Mobile App (direct call)
//       ↓
//   complete-course-purchase  ← YOU ARE HERE
//       ↓
//   create_student_after_purchase()  (Phase 1 RPC)
//       ↓
//   Create course_enrollment
//       ↓
//   Success
//
// When called internally (by razorpay-webhook), authentication is skipped
// and the caller provides the profileId directly. Guardian fields become
// optional since they may not be available at webhook time.
//
// @module edge-functions/complete-course-purchase
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

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
  // Step 5: Check whether the user already has a student_details row
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
  // Step 6: Create student_details if not already present
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
  // Step 7: Check for existing course_enrollment (idempotent)
  // ═════════════════════════════════════════════════════════════════════
  structuredLog('checking_existing_enrollment', {
    courseId: body.courseId,
    studentId,
  });

  const { data: existingEnrollment } = await serviceClient
    .from('course_enrollments')
    .select('enrollment_id')
    .eq('course_id', body.courseId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (existingEnrollment) {
    structuredLog('enrollment_already_exists', {
      enrollmentId: existingEnrollment.enrollment_id,
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
  // Step 8: Create the course_enrollment record
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

  // ═════════════════════════════════════════════════════════════════════
  // Step 9: Update orders.student_id
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
  // Step 10: Return the structured success response
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
