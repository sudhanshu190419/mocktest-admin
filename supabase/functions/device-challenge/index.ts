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
//     - token miss + fingerprint matches an APPROVED machine (Phase 7E)
//         → re-issue a fresh token onto the SAME row (rotate device_token_hash,
//           update device_name/user_agent/ip) → { trusted: true, status: 'approved', deviceToken }
//     - token miss + fingerprint matches a NON-approved row
//         → surface that existing status (never reissue, never duplicate)
//     - token miss + no fingerprint match → create a NEW pending request
//         → { trusted: false, status: 'pending' }
//     - token match on an approved legacy row with NULL fingerprint (Phase 7E)
//         → auto-bind fingerprint_hash on this successful token lookup
//   forceNewRequest (Phase 7F): skip the fingerprint fallback entirely and
//     create (or reuse) a fresh pending request — used by the revoked /
//     expired screens' "request approval again" action, so the old row's
//     stored fingerprint_hash cannot surface the old blocking status.
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
  /**
   * Phase 7F: when true, bypass the fingerprint auto-match and create (or
   * reuse) a fresh pending request. Used by the revoked/expired screens'
   * "request approval again" action — the machine's previous row (revoked /
   * expired) keeps its fingerprint_hash and would otherwise surface the old
   * blocking status (Step 7b) instead of minting a new request.
   */
  forceNewRequest?: boolean;
}

interface DeviceRow {
  device_id: string;
  profile_id: string;
  institute_id: string;
  device_token_hash: string;
  device_name: string;
  status: string;
  fingerprint_hash: string | null;
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
    .select('device_id, profile_id, institute_id, device_token_hash, device_name, status, fingerprint_hash, expires_at')
    .eq('profile_id', callerProfileId)
    .eq('device_token_hash', tokenHash)
    .maybeSingle();

  if (deviceError) {
    structuredLog('DEVICE_LOOKUP_FAILED', { error: deviceError.message });
    return errorResponse('Could not validate the device. Please try again.', 500);
  }

  const nowIso = new Date().toISOString();

  // ── Step 7: No token match → fingerprint fallback (Phase 7E) ───────────
  // Same PHYSICAL MACHINE, different browser → the token is new but the
  // machine may already be trusted. Look the machine up by fingerprint before
  // creating a pending request.
  //
  // SECURITY RULE: token reissue happens ONLY when the fingerprint matches an
  // APPROVED row. pending / rejected / revoked / expired / inactive rows keep
  // their exact current behavior — we surface that status instead of minting a
  // duplicate pending row for the same machine.
  //
  // Phase 7F: `forceNewRequest` skips this entire block so a revoked / expired
  // device can request approval AGAIN. Its old row (same machine fingerprint)
  // must NOT surface the old blocking status — the user explicitly chose to
  // mint a new request, which Step 8 handles (reusing any existing pending).
  const fingerprintHash = body.fingerprint?.trim() || null;
  console.log('[STEP 7] Incoming fingerprint:', fingerprintHash);
  if (!device && fingerprintHash && !body.forceNewRequest) {
    // ── DIAGNOSTIC LOGGING (temporary — fingerprint lookup tracing) ────────
    // Logs the exact query + inputs + raw result + approved match so the
    // same-laptop fingerprint matching can be verified. No logic changed.
    console.log('[STEP 7] Query', {
      table: 'trusted_devices',
      select: 'device_id, profile_id, institute_id, device_token_hash, device_name, status, fingerprint_hash, expires_at',
      filter: { profile_id: callerProfileId, fingerprint_hash: fingerprintHash },
    });
    console.log('[STEP 7] Lookup input', {
      profileId: callerProfileId,
      fingerprintHash,
    });

    const { data: fingerprintDevices, error: fingerprintError } =
      await serviceClient
        .from('trusted_devices')
        .select('device_id, profile_id, institute_id, device_token_hash, device_name, status, fingerprint_hash, expires_at')
        .eq('profile_id', callerProfileId)
        .eq('fingerprint_hash', fingerprintHash);
        // NOTE: no ORDER BY — an approved match is found via .find() below,
        // which is order-independent and unambiguous (one approved row max).

    console.log('[STEP 7] Raw query result', {
      count: fingerprintDevices?.length ?? 0,
      rows: (fingerprintDevices ?? []).map((d) => ({
        deviceId: d.device_id,
        profileId: d.profile_id,
        status: d.status,
        fingerprintHash: d.fingerprint_hash,
        deviceName: d.device_name,
      })),
    });

    console.log('[STEP 7] Fingerprint rows:', fingerprintDevices);

    if (fingerprintError) {
      structuredLog('DEVICE_FINGERPRINT_LOOKUP_FAILED', {
        error: fingerprintError.message,
      });
      return errorResponse('Could not validate the device. Please try again.', 500);
    }

    if (fingerprintDevices && fingerprintDevices.length > 0) {
      const approvedMatch = fingerprintDevices.find(
        (d) => d.status === 'approved',
      );
      console.log('[STEP 7] Approved match', approvedMatch ?? null);

      if (approvedMatch) {
        // 7a. APPROVED machine → re-issue a fresh token onto the SAME row.
        // Do NOT create another row; do NOT touch status/approved_at. The
        // one-approved-device rule is preserved (still one approved row).
        const { error: reissueError } = await serviceClient
          .from('trusted_devices')
          .update({
            device_token_hash: tokenHash, // bind the new browser's token
            device_name: body.deviceName?.trim() || approvedMatch.device_name || 'Unknown device',
            user_agent: userAgent,
            last_ip_address: clientIp,
            last_used_at: nowIso,
            // Keep fingerprint_hash — the machine identity is unchanged.
          })
          .eq('device_id', approvedMatch.device_id);

        if (reissueError) {
          structuredLog('DEVICE_FINGERPRINT_REISSUE_FAILED', {
            deviceId: approvedMatch.device_id,
            error: reissueError.message,
          });
          return errorResponse('Could not validate the device. Please try again.', 500);
        }

        // Audit: token reissued for the approved machine (actor = the admin,
        // via caller-JWT client). Non-fatal by design.
        await writeDeviceAudit(authHeader ?? '', {
          p_action: 'update',
          p_resource_type: 'trusted_devices',
          p_resource_id: approvedMatch.device_id,
          p_old_value: { device_token_hash: '[rotated]' },
          p_new_value: { status: 'approved', device_name: body.deviceName?.trim() || approvedMatch.device_name || 'Unknown device' },
          p_metadata: {
            fingerprint_reissue: true,
            device_name: body.deviceName?.trim() || approvedMatch.device_name || 'Unknown device',
            ip_address: clientIp,
          },
          p_ip_address: clientIp,
          p_user_agent: userAgent,
        });

        structuredLog('DEVICE_FINGERPRINT_REISSUED', {
          deviceId: approvedMatch.device_id,
          profileId: callerProfileId,
        });

        return jsonResponse({
          trusted: true,
          status: 'approved',
          deviceId: approvedMatch.device_id,
          deviceToken,
        });
      }

      // 7b. Fingerprint matches a NON-approved row (pending / rejected /
      // revoked / expired / inactive) → surface that exact status exactly as
      // today. Never reissue; never create a duplicate pending for the same
      // machine.
      const matched = fingerprintDevices[0];
      structuredLog('DEVICE_FINGERPRINT_STATUS_SURFACED', {
        deviceId: matched.device_id,
        status: matched.status,
        profileId: callerProfileId,
      });
      return jsonResponse({
        trusted: false,
        status: matched.status,
        deviceId: matched.device_id,
      });
    }
  }

  // ── Step 8: No token match, no fingerprint match → create a NEW pending ──
  // request. IDEMPOTENT (Bug 1 fix): if a pending request already exists for
  // this profile, return it instead of inserting another row. This stops a
  // single login (which can fire multiple challenges from signIn +
  // onAuthStateChange + Strict Mode) from generating duplicate pending rows.
  // The partial unique index uq_trusted_devices_one_pending_per_profile
  // (migration 078) is the race-safe backstop: a concurrent double-insert is
  // rejected and we fall back to reusing the existing pending row.
  if (!device) {
    const deviceName =
      body.deviceName?.trim() || 'Unknown device';

    // 8a. Reuse an existing pending request for this profile.
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

    // 8b. No pending request exists — insert a new one (stores the
    // fingerprint so a later login from another browser on the same machine
    // can re-issue instead of creating another request).
    const { data: newDevice, error: insertError } = await serviceClient
      .from('trusted_devices')
      .insert({
        profile_id: callerProfileId,
        institute_id: profile.institute_id,
        device_token_hash: tokenHash,
        device_name: deviceName,
        fingerprint_hash: fingerprintHash,
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

  // ── Step 9: Evaluate the existing device's status ──────────────────────
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

      // Phase 7E LEGACY BINDING: if this approved row has no fingerprint yet
      // (pre-7E enrollment), bind it NOW on this successful token lookup. This
      // lets old approved devices migrate automatically so future logins from
      // other browsers on the same machine can re-issue via fingerprint.
      // SECURITY: this binding ONLY happens when the token lookup SUCCEEDED —
      // never on a failed token lookup (a new browser must not claim an
      // approved row merely by presenting a fingerprint).
      const update: Record<string, unknown> = {
        last_used_at: nowIso,
        last_ip_address: clientIp,
      };
      if (!device.fingerprint_hash && fingerprintHash) {
        update.fingerprint_hash = fingerprintHash;
        structuredLog('DEVICE_FINGERPRINT_LEGACY_BOUND', {
          deviceId: device.device_id,
          profileId: callerProfileId,
        });
      }

      // Touch last_used_at + last_ip_address (+ bind fingerprint if legacy).
      await serviceClient
        .from('trusted_devices')
        .update(update)
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
