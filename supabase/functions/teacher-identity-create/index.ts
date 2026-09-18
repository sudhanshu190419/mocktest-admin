// ============================================================================
// Edge Function: teacher-identity-create
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Secure teacher account creation by Super Admin.
// The browser NEVER calls supabase.auth.signUp() or directly inserts into
// teacher_details. Instead, an authorized Super Admin invokes this function,
// which uses the Supabase Admin API (service role) to:
//
//   1. Verify the caller is an APPROVED super admin (from admin_roles,
//      never trusting any client-supplied role value).
//      Finance admin and academic admin callers are rejected (403 Forbidden).
//   2. Validate the request (fullName, phone, password, optional email,
//      facultyId, department, optional designation).
//   3. Resolve caller's institute_id server-side from profiles.
//   4. Pre-check for duplicate phone, duplicate email, and duplicate
//      faculty_id (within the institute) with friendly error responses.
//   5. Create the Auth user via the Supabase Admin API (service role):
//        - phone + password
//        - optional email
//        - phone_confirm: true (and email_confirm: true with fallback)
//        - user_metadata { full_name, role: 'teacher', institute_id }
//   6. Wait for handle_new_user trigger to create the profile, then ensure
//      public.profiles has account_status = 'approved', role = 'teacher',
//      and correct institute_id.
//   7. Create public.teacher_details row with faculty_id, department,
//      designation, and profile_id.
//   8. Complete atomic cleanup (deleteUser rollback) if any step fails.
//   9. Return { success: true, teacherId, profileId, ... }.
//
// The service role key lives ONLY in this function's runtime — it is never
// exposed to the client.
//
// @module edge-functions/teacher-identity-create
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  CORS_HEADERS,
  createAdminClient,
  errorResponse,
  isApprovedSuperAdmin,
  jsonResponse,
  resolveCallerProfileId,
  sanitizeErrorMessage,
  structuredLog,
} from '../_shared/adminIdentity.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** E.164 phone validation — mirrors frontend and existing services. */
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

/** RFC 5322 compatible email validation. */
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

const PROFILE_POLL_ATTEMPTS = 12;
const PROFILE_POLL_DELAY_MS = 250;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateTeacherRequestBody {
  fullName: string;
  phone: string;
  password: string;
  email?: string;
  facultyId: string;
  department: string;
  designation?: string;
}

export interface CreateTeacherSuccess {
  success: true;
  teacherId: string;
  profileId: string;
  fullName: string;
  phone: string;
  email: string | null;
  facultyId: string;
  department: string;
  designation: string;
  role: 'teacher';
  accountStatus: 'approved';
  instituteId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation (Step 2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate the request body. Returns the normalized body on success or a
 * human-readable error message on failure.
 */
export function validateRequestBody(raw: Record<string, unknown>):
  | { ok: true; body: CreateTeacherRequestBody }
  | { ok: false; error: string } {
  const fullName =
    typeof raw.fullName === 'string' && raw.fullName.trim()
      ? raw.fullName.trim()
      : typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : '';
  const phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';
  const email =
    typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : undefined;
  const facultyId =
    typeof raw.facultyId === 'string' && raw.facultyId.trim()
      ? raw.facultyId.trim()
      : typeof raw.faculty_id === 'string' && raw.faculty_id.trim()
      ? raw.faculty_id.trim()
      : '';
  const department = typeof raw.department === 'string' ? raw.department.trim() : '';
  const designation =
    typeof raw.designation === 'string' && raw.designation.trim()
      ? raw.designation.trim()
      : undefined;

  if (!fullName) {
    return { ok: false, error: 'Full name is required.' };
  }
  if (!phone) {
    return { ok: false, error: 'Phone number is required.' };
  }
  if (!PHONE_REGEX.test(phone)) {
    return {
      ok: false,
      error: 'Please enter a valid phone number with country code (e.g. +919876543210).',
    };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (email && !EMAIL_REGEX.test(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (!facultyId) {
    return { ok: false, error: 'Faculty ID is required.' };
  }
  if (!department) {
    return { ok: false, error: 'Department is required.' };
  }

  return {
    ok: true,
    body: {
      fullName,
      phone,
      password,
      email,
      facultyId,
      department,
      designation: designation || 'Faculty',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Auth User Creation (Step 5 — with email-confirm fallback)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create the Auth user via the Admin API (service role).
 *
 * Phone is confirmed at creation (`phone_confirm: true`) so the account is
 * immediately usable with phone-first password authentication.
 */
async function createTeacherAuthUser(
  serviceClient: ReturnType<typeof createClient>,
  params: {
    phone: string;
    password: string;
    email?: string;
    fullName: string;
    instituteId: string;
  },
) {
  const baseAttributes = {
    phone: params.phone,
    password: params.password,
    ...(params.email ? { email: params.email } : {}),
    phone_confirm: true,
    user_metadata: {
      full_name: params.fullName,
      role: 'teacher',
      institute_id: params.instituteId,
    },
  };

  // Attempt 1 — confirm the email too, when provided.
  const first = await serviceClient.auth.admin.createUser({
    ...baseAttributes,
    ...(params.email ? { email_confirm: true } : {}),
  });

  // GoTrue rejects email_confirm: true when email confirmation is disabled
  // in the project. Retry without it — non-fatal for phone-first login.
  if (
    first.error &&
    params.email &&
    /email_confirm|confirmation.{0,40}not.{0,40}enabled/i.test(first.error.message)
  ) {
    structuredLog('EMAIL_CONFIRM_FALLBACK', {
      reason: first.error.message,
    });
    return serviceClient.auth.admin.createUser(baseAttributes);
  }

  return first;
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

  structuredLog('TEACHER_IDENTITY_CREATE_REQUEST', { method: req.method });

  // ═══════════════════════════════════════════════════════════════════
  // Step 1: Verify the caller is an approved super admin
  // ═══════════════════════════════════════════════════════════════════
  const authHeader = req.headers.get('Authorization');

  const callerProfileId = await resolveCallerProfileId(authHeader);
  if (!callerProfileId) {
    return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
  }

  structuredLog('CALLER_RESOLVED', { callerProfileId });

  const serviceClient = createAdminClient();

  const isSuper = await isApprovedSuperAdmin(serviceClient, callerProfileId);
  if (!isSuper) {
    structuredLog('UNAUTHORIZED_CALLER', { callerProfileId });
    return errorResponse(
      'Super admin access required. Only approved super admins can create teacher accounts.',
      403,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Step 2: Parse and validate request body
  // ═══════════════════════════════════════════════════════════════════
  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body.', 400);
  }

  const validation = validateRequestBody(rawBody);
  if (!validation.ok) {
    return errorResponse(validation.error, 400);
  }

  const {
    fullName,
    phone,
    password,
    email,
    facultyId,
    department,
    designation,
  } = validation.body;

  // ═══════════════════════════════════════════════════════════════════
  // Step 3: Resolve caller\'s institute server-side
  // ═══════════════════════════════════════════════════════════════════
  const { data: callerProfile, error: callerProfileError } = await serviceClient
    .from('profiles')
    .select('institute_id')
    .eq('profile_id', callerProfileId)
    .maybeSingle();

  if (!callerProfile?.institute_id) {
    structuredLog('CALLER_INSTITUTE_RESOLVE_FAILED', {
      callerProfileId,
      error: callerProfileError?.message ?? 'profile not found',
    });
    return errorResponse('Could not resolve your institute.', 500);
  }

  const instituteId: string = callerProfile.institute_id;
  structuredLog('INSTITUTE_RESOLVED', { instituteId });

  // ═══════════════════════════════════════════════════════════════════
  // Step 4: Duplicate checks (phone, email, facultyId within institute)
  // ═══════════════════════════════════════════════════════════════════
  const { data: dupPhone } = await serviceClient
    .from('profiles')
    .select('profile_id')
    .eq('phone', phone)
    .maybeSingle();

  if (dupPhone) {
    return errorResponse('An account with this phone number already exists.', 409);
  }

  if (email) {
    const { data: dupEmail } = await serviceClient
      .from('profiles')
      .select('profile_id')
      .eq('email', email)
      .maybeSingle();

    if (dupEmail) {
      return errorResponse('An account with this email already exists.', 409);
    }
  }

  // Duplicate faculty_id check within the caller\'s institute
  const { data: dupFaculty } = await serviceClient
    .from('teacher_details')
    .select('teacher_id, profiles!inner(institute_id)')
    .eq('faculty_id', facultyId)
    .eq('profiles.institute_id', instituteId)
    .maybeSingle();

  if (dupFaculty) {
    return errorResponse('A teacher with this Faculty ID already exists in your institute.', 409);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Step 5: Create the Auth user via the Admin API (service role)
  // ═══════════════════════════════════════════════════════════════════
  structuredLog('TEACHER_CREATE_USER_START', {
    phone,
    hasEmail: !!email,
    instituteId,
    facultyId,
    department,
  });

  const { data: createdUser, error: createUserError } = await createTeacherAuthUser(
    serviceClient,
    { phone, password, email, fullName, instituteId },
  );

  if (createUserError) {
    structuredLog('TEACHER_CREATE_USER_FAILED', {
      error: createUserError.message,
      code: (createUserError as { code?: string }).code ?? null,
    });
    return errorResponse(
      sanitizeErrorMessage(createUserError.message, 'auth.admin.createUser'),
      409,
    );
  }

  if (!createdUser?.user) {
    return errorResponse('Account created but user details could not be retrieved.', 500);
  }

  const teacherUserId = createdUser.user.id;
  const profileId = teacherUserId;

  structuredLog('TEACHER_CREATE_USER_SUCCESS', { teacherUserId, phone });

  // ═══════════════════════════════════════════════════════════════════
  // Step 6: Ensure the profile exists and is approved
  // ═══════════════════════════════════════════════════════════════════
  let profileReady = false;
  for (let attempt = 0; attempt < PROFILE_POLL_ATTEMPTS; attempt += 1) {
    const { data: p } = await serviceClient
      .from('profiles')
      .select('profile_id, account_status')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (p) {
      profileReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, PROFILE_POLL_DELAY_MS));
  }

  if (!profileReady) {
    structuredLog('PROFILE_POLL_TIMEOUT', { teacherUserId });
    await serviceClient.auth.admin.deleteUser(teacherUserId).catch((err: unknown) => {
      structuredLog('CLEANUP_DELETE_USER_FAILED', {
        teacherUserId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
    return errorResponse(
      'Account created but the profile could not be confirmed. Please retry.',
      500,
    );
  }

  // Update profile to ensure account_status is 'approved' and institute_id & name are set
  const { error: profileUpdateError } = await serviceClient
    .from('profiles')
    .update({
      account_status: 'approved',
      name: fullName,
      role: 'teacher',
      institute_id: instituteId,
    })
    .eq('profile_id', profileId);

  if (profileUpdateError) {
    structuredLog('PROFILE_UPDATE_FAILED', {
      profileId,
      error: profileUpdateError.message,
    });
    await serviceClient.auth.admin.deleteUser(teacherUserId).catch((err: unknown) => {
      structuredLog('CLEANUP_DELETE_USER_FAILED', {
        teacherUserId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
    return errorResponse('Failed to approve teacher profile. Please retry.', 500);
  }

  structuredLog('PROFILE_READY_AND_APPROVED', { profileId });

  // ═══════════════════════════════════════════════════════════════════
  // Step 7: Insert public.teacher_details row
  // ═══════════════════════════════════════════════════════════════════
  structuredLog('TEACHER_DETAILS_INSERT_START', {
    profileId,
    facultyId,
    department,
    designation,
  });

  const { data: teacherDetailRow, error: teacherDetailError } = await serviceClient
    .from('teacher_details')
    .insert({
      profile_id: profileId,
      faculty_id: facultyId,
      department: department,
      designation: designation || 'Faculty',
      qualification: 'Not specified',
    })
    .select('teacher_id, profile_id, faculty_id, department, designation')
    .single();

  if (teacherDetailError) {
    structuredLog('TEACHER_DETAILS_INSERT_FAILED', {
      profileId,
      error: teacherDetailError.message,
      code: (teacherDetailError as { code?: string }).code ?? null,
    });

    // Idempotent retry check on unique constraint violation (23505)
    if ((teacherDetailError as { code?: string }).code === '23505') {
      const { data: existingDetail } = await serviceClient
        .from('teacher_details')
        .select('teacher_id, profile_id, faculty_id, department, designation')
        .eq('profile_id', profileId)
        .maybeSingle();

      if (existingDetail) {
        structuredLog('TEACHER_DETAILS_EXISTING_ON_RETRY', {
          teacherId: existingDetail.teacher_id,
        });
        return jsonResponse({
          success: true,
          teacherId: existingDetail.teacher_id,
          profileId,
          fullName,
          phone,
          email: email ?? null,
          facultyId: existingDetail.faculty_id,
          department: existingDetail.department,
          designation: existingDetail.designation,
          role: 'teacher',
          accountStatus: 'approved',
          instituteId,
        } as CreateTeacherSuccess, 201);
      }
    }

    // Cleanup rollback: remove auth user so no orphan/half-created record remains
    await serviceClient.auth.admin.deleteUser(teacherUserId).catch((err: unknown) => {
      structuredLog('CLEANUP_DELETE_USER_FAILED', {
        teacherUserId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });

    return errorResponse(
      sanitizeErrorMessage(teacherDetailError.message, 'teacher_details insert'),
      500,
    );
  }

  structuredLog('TEACHER_DETAILS_INSERT_SUCCESS', {
    teacherId: teacherDetailRow.teacher_id,
    facultyId: teacherDetailRow.faculty_id,
  });

  // ═══════════════════════════════════════════════════════════════════
  // Step 8: Success Response
  // ═══════════════════════════════════════════════════════════════════
  const responseBody: CreateTeacherSuccess = {
    success: true,
    teacherId: teacherDetailRow.teacher_id,
    profileId,
    fullName,
    phone,
    email: email ?? null,
    facultyId: teacherDetailRow.faculty_id,
    department: teacherDetailRow.department,
    designation: teacherDetailRow.designation,
    role: 'teacher',
    accountStatus: 'approved',
    instituteId,
  };

  structuredLog('TEACHER_CREATED', {
    teacherId: teacherDetailRow.teacher_id,
    profileId,
    facultyId: teacherDetailRow.faculty_id,
    instituteId,
    createdByUser: callerProfileId,
  });

  return jsonResponse(responseBody, 201);
});
