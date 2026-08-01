// ============================================================================
// Edge Function: device-challenge
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Validates whether the current admin's device is trusted for the admin
// workspace. Called AFTER phone/password sign-in (Phase 7E will wire this
// into AuthContext; this phase exposes it as a standalone backend API).
//
// ## Behavior by role
//
//   Super Admin   → always { trusted: true, status: 'bypass' }
//   Teacher       → bypass (Trusted Device system does not apply)
//   Student       → bypass (Trusted Device system does not apply)
//   Academic/Finance Admin:
//     - approved device (hash match, not expired)
//         → touch last_used_at + last_ip_address → { trusted: true }
//     - pending      → { trusted: false, status: 'pending' }
//     - rejected     → { trusted: false, status: 'rejected' }
//     - revoked      → { trusted: false, status: 'revoked' }
//     - expired      → { trusted: false, status: 'expired' }
//     - no device    → create a NEW pending request → { trusted: false, status: 'pending' }
//
// ## Security
//
//   - Never automatically approves anything.
//   - Only the SHA-256 hash of the device token is ever stored.
//   - Writes (trusted_devices insert/update, notifications) use the
//     service-role client; audit writes use the caller-JWT client so the
//     actor resolves correctly.
//
// @module edge-functions/device-challenge
// ============================================================================

import {
  CORS_HEADERS,
  createAdminClient,
  errorResponse,
  jsonResponse,
  resolveCallerProfileId,
  structuredLog,
} from '../_shared/adminIdentity.ts';
import {
  createDeviceNotification,
  hashDeviceToken,
  writeDeviceAudit,
} from '../_shared/trustedDevice.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface ChallengeBody {
  deviceToken?: string;
  fingerprint?: string;
  deviceName?: string;
  userAgent?: string;
}

interface DeviceRow {
  device_id: string;
  profile_id: string;
  institute_id: string;
  device_token_hash: string;
  device_name: string;
  status: string;
  expires_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('DEVICE_CHALLENGE_REQUEST_RECEIVED');

  // ── Step 1: Resolve caller identity from the JWT ──────────────────────
  const authHeader = req.headers.get('Authorization');
  const callerProfileId = await resolveCallerProfileId(authHeader);
  if (!callerProfileId) {
    return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
  }

  // ── Step 2: Parse body (lenient — challenge is a read-mostly check) ────
  let body: ChallengeBody = {};
  try {
    body = (await req.json()) as ChallengeBody;
  } catch {
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }

  const serviceClient = createAdminClient();
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = body.userAgent?.trim() || req.headers.get('user-agent') || null;

  // ── Step 3: Load profile + admin roles ────────────────────────────────
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('profile_id, role, institute_id')
    .eq('profile_id', callerProfileId)
    .maybeSingle();

  if (profileError || !profile) {
    return errorResponse('Profile not found for the authenticated user.', 404);
  }

  // ── Step 4: Role-based routing ─────────────────────────────────────────
  // Teachers and Students bypass the Trusted Device system entirely.
  if (profile.role === 'teacher' || profile.role === 'student') {
    return jsonResponse({ trusted: true, status: 'bypass' });
  }

  if (profile.role !== 'admin') {
    return jsonResponse({ trusted: true, status: 'bypass' });
  }

  // Admin — resolve approved roles from admin_roles.
  const { data: roleRows } = await serviceClient
    .from('admin_roles')
    .select('admin_role, access_status')
    .eq('profile_id', callerProfileId);

  const approvedRoles = (roleRows ?? [])
    .filter((r) => r.access_status === 'approved')
    .map((r) => r.admin_role);

  // Super Admin always bypasses the approval workflow.
  if (approvedRoles.includes('super_admin')) {
    return jsonResponse({ trusted: true, status: 'bypass' });
  }

  // Only Academic / Finance Admins go through device trust.
  const isSubjectAdmin =
    approvedRoles.includes('academic_admin') ||
    approvedRoles.includes('finance_admin');
  if (!isSubjectAdmin) {
    // Admin profile with no approved academic/finance role (e.g. only a
    // revoked/suspended role) — do not auto-trust, do not auto-approve.
    return errorResponse(
      'No approved academic or finance admin role found for this account.',
      403,
    );
  }

  // ── Step 5: Validate device token presence ─────────────────────────────
  const deviceToken = body.deviceToken?.trim();
  if (!deviceToken) {
    return errorResponse('Device token is required.', 400);
  }
  const tokenHash = await hashDeviceToken(deviceToken);

  // ── Step 6: Look up the device by (profile_id, hash) ───────────────────
  const { data: device, error: deviceError } = await serviceClient
    .from('trusted_devices')
    .select('device_id, profile_id, institute_id, device_token_hash, device_name, status, expires_at')
    .eq('profile_id', callerProfileId)
    .eq('device_token_hash', tokenHash)
    .maybeSingle();

  if (deviceError) {
    structuredLog('DEVICE_LOOKUP_FAILED', { error: deviceError.message });
    return errorResponse('Could not validate the device. Please try again.', 500);
  }

  const nowIso = new Date().toISOString();

  // ── Step 7: No device → create a NEW pending request ───────────────────
  // IDEMPOTENT (Bug 1 fix): if a pending request already exists for this
  // profile, return it instead of inserting another row. This stops a single
  // login (which can fire multiple challenges from signIn + onAuthStateChange
  // + Strict Mode) from generating duplicate pending rows. The partial unique
  // index uq_trusted_devices_one_pending_per_profile (migration 078) is the
  // race-safe backstop: a concurrent double-insert is rejected and we fall
  // back to reusing the existing pending row.
  if (!device) {
    const deviceName =
      body.deviceName?.trim() || 'Unknown device';

    // 7a. Reuse an existing pending request for this profile.
    const { data: existingPending } = await serviceClient
      .from('trusted_devices')
      .select('device_id')
      .eq('profile_id', callerProfileId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingPending) {
      structuredLog('DEVICE_PENDING_REUSED', {
        deviceId: existingPending.device_id,
        profileId: callerProfileId,
      });
      return jsonResponse({
        trusted: false,
        status: 'pending',
        deviceId: existingPending.device_id,
      });
    }

    // 7b. No pending request exists — insert a new one.
    const { data: newDevice, error: insertError } = await serviceClient
      .from('trusted_devices')
      .insert({
        profile_id: callerProfileId,
        institute_id: profile.institute_id,
        device_token_hash: tokenHash,
        device_name: deviceName,
        fingerprint_hash: body.fingerprint?.trim() || null,
        user_agent: userAgent,
        last_ip_address: clientIp,
        status: 'pending',
        requested_at: nowIso,
      })
      .select('device_id')
      .maybeSingle();

    if (insertError || !newDevice) {
      // 7c. Race guard: a concurrent challenge may have inserted the pending
      // row between our check and this insert (unique index rejected ours).
      // Reuse the winner's row instead of failing.
      const { data: racedPending } = await serviceClient
        .from('trusted_devices')
        .select('device_id')
        .eq('profile_id', callerProfileId)
        .eq('status', 'pending')
        .maybeSingle();

      if (racedPending) {
        structuredLog('DEVICE_PENDING_RACE_REUSED', {
          deviceId: racedPending.device_id,
          profileId: callerProfileId,
        });
        return jsonResponse({
          trusted: false,
          status: 'pending',
          deviceId: racedPending.device_id,
        });
      }

      structuredLog('DEVICE_CREATE_FAILED', {
        error: insertError?.message ?? 'no device_id returned',
      });
      return errorResponse('Could not register the device. Please try again.', 500);
    }

    // Notify all approved super admins of the institute.
    const { data: superAdmins } = await serviceClient
      .from('admin_roles')
      .select('profile_id')
      .eq('institute_id', profile.institute_id)
      .eq('admin_role', 'super_admin')
      .eq('access_status', 'approved');

    await createDeviceNotification(serviceClient, {
      instituteId: profile.institute_id,
      recipientIds: (superAdmins ?? []).map((s) => s.profile_id),
      title: 'New device approval requested',
      body: `${deviceName} requested trusted access for an admin account.`,
      eventType: 'device_approval_requested',
      referenceId: newDevice.device_id,
    });

    // Audit: device requested (actor = the admin, via caller-JWT client).
    await writeDeviceAudit(authHeader ?? '', {
      p_action: 'create',
      p_resource_type: 'trusted_devices',
      p_resource_id: newDevice.device_id,
      p_new_value: { status: 'pending', profile_id: callerProfileId },
      p_metadata: { device_name: deviceName, ip_address: clientIp },
      p_ip_address: clientIp,
      p_user_agent: userAgent,
    });

    structuredLog('DEVICE_CREATED_PENDING', {
      deviceId: newDevice.device_id,
      profileId: callerProfileId,
    });

    return jsonResponse({
      trusted: false,
      status: 'pending',
      deviceId: newDevice.device_id,
    });
  }

  // ── Step 8: Evaluate the existing device's status ──────────────────────
  switch (device.status) {
    case 'approved': {
      // Check expiry first — an expired approved device is treated as expired.
      if (device.expires_at && new Date(device.expires_at) < new Date()) {
        await serviceClient
          .from('trusted_devices')
          .update({ status: 'expired', approved_at: null })
          .eq('device_id', device.device_id);
        return jsonResponse({ trusted: false, status: 'expired' });
      }

      // Touch last_used_at + last_ip_address.
      await serviceClient
        .from('trusted_devices')
        .update({ last_used_at: nowIso, last_ip_address: clientIp })
        .eq('device_id', device.device_id);

      return jsonResponse({
        trusted: true,
        status: 'approved',
        deviceId: device.device_id,
      });
    }
    case 'pending':
      return jsonResponse({
        trusted: false,
        status: 'pending',
        deviceId: device.device_id,
      });
    case 'rejected':
      return jsonResponse({
        trusted: false,
        status: 'rejected',
        deviceId: device.device_id,
      });
    case 'revoked':
      return jsonResponse({
        trusted: false,
        status: 'revoked',
        deviceId: device.device_id,
      });
    case 'expired':
      return jsonResponse({
        trusted: false,
        status: 'expired',
        deviceId: device.device_id,
      });
    case 'inactive':
      return jsonResponse({
        trusted: false,
        status: 'inactive',
        deviceId: device.device_id,
      });
    default:
      return errorResponse('Unknown device status.', 500);
  }
});
