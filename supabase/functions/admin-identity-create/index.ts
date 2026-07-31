// ============================================================================
// Edge Function: admin-identity-create
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Secure admin account creation. The browser NEVER calls
// supabase.auth.signUp() for admin creation — it invokes this function,
// which uses the Supabase Admin API (service role) to:
//
//   1. Verify the caller is an APPROVED super admin (from admin_roles,
//      never trusting any client-supplied role value).
//   2. Validate the request (name, phone, email, role). Only
//      academic_admin and finance_admin are creatable — super_admin is
//      rejected outright.
//   3. Create the Auth user via the Admin API (NOT the browser signUp):
//        - phone + password
//        - email
//        - user_metadata { role: 'admin', institute_id }
//      Phone and email are confirmed during creation (phone_confirm /
//      email_confirm) so the account is immediately usable with
//      phone-first authentication — no OTP handshake required.
//   4. Wait for the handle_new_user trigger to create the profile
//      (poll, never duplicate creation).
//   5. Insert the approved admin_roles row (granted_by, granted_at).
//   6. Return { success, adminId, profileId }.
//
// The service role key lives ONLY in this function's runtime — it never
// reaches the browser.
//
// Architecture: Admin Identity foundation — future operations (reset
// password, force password reset, trusted-device approval, finance login
// approval, suspend/unlock) reuse the shared helpers in _shared/
// adminIdentity.ts.
//
// @module edge-functions/admin-identity-create
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

/** Roles a super admin is allowed to create. super_admin is deliberately absent. */
const ALLOWED_ROLES = ['academic_admin', 'finance_admin'] as const;

/** E.164 phone validation — mirrors the frontend + existing services. */
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

const PROFILE_POLL_ATTEMPTS = 12;
const PROFILE_POLL_DELAY_MS = 250;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface CreateAdminRequestBody {
  name: string;
  email?: string;
  phone: string;
  password: string;
  adminRole: 'academic_admin' | 'finance_admin';
}

interface CreateAdminSuccess {
  success: true;
  adminId: string;
  profileId: string;
  adminRole: 'academic_admin' | 'finance_admin';
  accessStatus: 'approved';
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation (Step 2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate the request body. Returns the normalized body on success or a
 * human-readable error message on failure.
 */
function validateRequestBody(raw: Record<string, unknown>):
  | { ok: true; body: CreateAdminRequestBody }
  | { ok: false; error: string } {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';
  const adminRole = raw.adminRole as string;
  const email =
    typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : undefined;

  if (!name) {
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

  // Reject super_admin explicitly — never allow privilege escalation.
  if (adminRole === 'super_admin') {
    return { ok: false, error: 'Super admin accounts cannot be created through this flow.' };
  }
  if (!(ALLOWED_ROLES as readonly string[]).includes(adminRole)) {
    return {
      ok: false,
      error: 'Only academic_admin and finance_admin roles can be created here.',
    };
  }

  return {
    ok: true,
    body: {
      name,
      email,
      phone,
      password,
      adminRole: adminRole as 'academic_admin' | 'finance_admin',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Auth User Creation (Step 3 — with email-confirm fallback)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create the Auth user via the Admin API (service role).
 *
 * Phone is ALWAYS confirmed at creation (`phone_confirm: true`) so the
 * account is immediately usable with phone-first password login.
 *
 * Email confirmation is attempted when an email is supplied, but some
 * phone-first projects disable email confirmation. GoTrue rejects
 * `email_confirm: true` in that configuration, so we retry without it —
 * the `handle_new_user` trigger still copies `new.email` into
 * `profiles.email`, and the phone remains the login identity.
 *
 * @param serviceClient  Service-role client.
 * @param params         Phone, password, optional email, name, institute.
 * @returns The raw createUser result (data + error).
 */
async function createAdminAuthUser(
  serviceClient: ReturnType<typeof createClient>,
  params: {
    phone: string;
    password: string;
    email?: string;
    name: string;
    instituteId: string;
  },
) {
  const baseAttributes = {
    phone: params.phone,
    password: params.password,
    ...(params.email ? { email: params.email } : {}),
    phone_confirm: true,
    user_metadata: {
      full_name: params.name,
      role: 'admin',
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

  structuredLog('REQUEST_RECEIVED', { method: req.method });

  // ═══════════════════════════════════════════════════════════════════
  // Step 1: Verify the caller is an approved super admin
  // ═══════════════════════════════════════════════════════════════════
  // The JWT resolves the caller's identity; authorization is read from
  // admin_roles (service-role client, so RLS can never mask the check).
  const authHeader = req.headers.get('Authorization');

  const callerProfileId = await resolveCallerProfileId(authHeader);
  if (!callerProfileId) {
    return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
  }

  structuredLog('CALLER_RESOLVED', { callerProfileId });

  const serviceClient = createAdminClient();

  const isSuperAdmin = await isApprovedSuperAdmin(serviceClient, callerProfileId);
  if (!isSuperAdmin) {
    structuredLog('CALLER_NOT_SUPER_ADMIN', { callerProfileId });
    return errorResponse('Only an approved super admin can create admin accounts.', 403);
  }

  structuredLog('CALLER_AUTHORIZED', { callerProfileId });

  // ═══════════════════════════════════════════════════════════════════
  // Step 2: Validate the request
  // ═══════════════════════════════════════════════════════════════════
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json() as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }

  const validation = validateRequestBody(rawBody);
  if (!validation.ok) {
    return errorResponse(validation.error, 400);
  }

  const { name, email, phone, password, adminRole } = validation.body;

  structuredLog('REQUEST_VALIDATED', {
    name,
    phone,
    hasEmail: !!email,
    adminRole,
  });

  // ═══════════════════════════════════════════════════════════════════
  // Step 3: Resolve the super admin's institute (never trust the client)
  // ═══════════════════════════════════════════════════════════════════
  const { data: callerProfile, error: callerProfileError } = await serviceClient
    .from('profiles')
    .select('institute_id')
    .eq('profile_id', callerProfileId)
    .maybeSingle();

  if (callerProfileError || !callerProfile?.institute_id) {
    structuredLog('CALLER_INSTITUTE_RESOLVE_FAILED', {
      callerProfileId,
      error: callerProfileError?.message ?? 'profile not found',
    });
    return errorResponse('Could not resolve your institute.', 500);
  }

  const instituteId: string = callerProfile.institute_id;

  structuredLog('INSTITUTE_RESOLVED', { instituteId });

  // ═══════════════════════════════════════════════════════════════════
  // Step 4: Duplicate checks (friendly errors before hitting Auth)
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

  // ═══════════════════════════════════════════════════════════════════
  // Step 5: Create the Auth user via the Admin API (service role)
  // ═══════════════════════════════════════════════════════════════════
  // NOT supabase.auth.signUp(). Phone is confirmed at creation so the
  // account is immediately usable with phone-first password login.
  structuredLog('ADMIN_CREATE_USER_START', {
    phone,
    hasEmail: !!email,
    instituteId,
    adminRole,
  });

  const { data: createdUser, error: createUserError } = await createAdminAuthUser(
    serviceClient,
    { phone, password, email, name, instituteId },
  );

  if (createUserError) {
    // Raw error details are logged server-side only — never returned to
    // the browser. The public message is sanitized for the client.
    structuredLog('ADMIN_CREATE_USER_FAILED', {
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

  const adminId = createdUser.user.id;
  const profileId = adminId; // profiles.profile_id == auth.users.id by design

  structuredLog('ADMIN_CREATE_USER_SUCCESS', { adminId, phone });

  // ═══════════════════════════════════════════════════════════════════
  // Step 6: Ensure the profile exists (handle_new_user trigger)
  // ═══════════════════════════════════════════════════════════════════
  // The trigger runs synchronously on user creation, but poll briefly to
  // guarantee the row is visible before we insert admin_roles.
  let profileReady = false;
  for (let attempt = 0; attempt < PROFILE_POLL_ATTEMPTS; attempt += 1) {
    const { data: p } = await serviceClient
      .from('profiles')
      .select('profile_id')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (p) {
      profileReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, PROFILE_POLL_DELAY_MS));
  }

  if (!profileReady) {
    structuredLog('PROFILE_POLL_TIMEOUT', { adminId });
    // Best-effort cleanup: remove the orphan auth user so no half-created
    // account is left behind.
    await serviceClient.auth.admin.deleteUser(adminId).catch((err: unknown) => {
      structuredLog('CLEANUP_DELETE_USER_FAILED', {
        adminId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
    return errorResponse(
      'Account created but the profile could not be confirmed. Please retry.',
      500,
    );
  }

  structuredLog('PROFILE_READY', { profileId });

  // ═══════════════════════════════════════════════════════════════════
  // Step 7: Insert the approved admin_roles row
  // ═══════════════════════════════════════════════════════════════════
  structuredLog('ADMIN_ROLES_INSERT_START', {
    profileId,
    instituteId,
    adminRole,
    grantedBy: callerProfileId,
  });

  const { data: roleRow, error: roleError } = await serviceClient
    .from('admin_roles')
    .insert({
      profile_id: profileId,
      institute_id: instituteId,
      admin_role: adminRole,
      access_status: 'approved',
      granted_by: callerProfileId,
      access_granted_at: new Date().toISOString(),
    })
    .select('admin_role_id, admin_role, access_status')
    .single();

  if (roleError) {
    structuredLog('ADMIN_ROLES_INSERT_FAILED', {
      profileId,
      error: roleError.message,
      code: (roleError as { code?: string }).code ?? null,
    });

    // 23505 = unique violation on (profile_id, admin_role). This only
    // happens on a retry where the role was already created — the account
    // is fully valid, so treat it as success instead of deleting the user.
    if ((roleError as { code?: string }).code === '23505') {
      const { data: existingRole } = await serviceClient
        .from('admin_roles')
        .select('admin_role_id, admin_role, access_status')
        .eq('profile_id', profileId)
        .eq('admin_role', adminRole)
        .maybeSingle();

      if (existingRole) {
        structuredLog('ADMIN_ROLES_EXISTING_ON_RETRY', {
          adminRoleId: existingRole.admin_role_id,
        });
        return jsonResponse({
          success: true,
          adminId,
          profileId,
          adminRole: existingRole.admin_role,
          accessStatus: existingRole.access_status,
        } as CreateAdminSuccess, 201);
      }
    }

    // Best-effort cleanup: the role assignment failed — remove the account
    // so the super admin can retry cleanly (no orphan/duplicate).
    await serviceClient.auth.admin.deleteUser(adminId).catch((err: unknown) => {
      structuredLog('CLEANUP_DELETE_USER_FAILED', {
        adminId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
    return errorResponse(
      sanitizeErrorMessage(roleError.message, 'admin_roles insert'),
      500,
    );
  }

  structuredLog('ADMIN_ROLES_INSERT_SUCCESS', {
    adminRoleId: roleRow.admin_role_id,
    adminRole: roleRow.admin_role,
  });

  // ═══════════════════════════════════════════════════════════════════
  // Step 8: Success
  // ═══════════════════════════════════════════════════════════════════
  const responseBody: CreateAdminSuccess = {
    success: true,
    adminId,
    profileId,
    adminRole: roleRow.admin_role as 'academic_admin' | 'finance_admin',
    accessStatus: 'approved',
  };

  structuredLog('ADMIN_CREATED', {
    adminId,
    profileId,
    adminRole: roleRow.admin_role,
    instituteId,
    grantedBy: callerProfileId,
  });

  return jsonResponse(responseBody, 201);
});
