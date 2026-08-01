// ============================================================================
// Edge Function: device-approve
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Approves a pending trusted device request. Super Admin only.
//
// ## Business rules
//
//   - Only an approved super_admin may approve devices.
//   - The target device must be in status = 'pending'.
//   - ONE approved device per Academic/Finance Admin (enforced here in the
//     business layer — NOT in migration 077, which deliberately has no
//     trigger): approving a new device automatically revokes the previously
//     approved device for that profile.
//   - Sets approved_at, approved_by, last_used_at; clears rejection_reason.
//   - Writes an audit event (device_approve) and notifies the device owner.
//
// ## Diagnostics
//
//   This function is heavily instrumented with console.log / console.error
//   (STEP markers) so the full execution path can be inspected in the
//   Supabase Edge Function logs. Every major step is wrapped in its own
//   try/catch; no step failure changes the business logic — the original
//   user-facing error messages are preserved exactly.
//
// @module edge-functions/device-approve
// ============================================================================

import {
  CORS_HEADERS,
  createAdminClient,
  errorResponse,
  isApprovedSuperAdmin,
  jsonResponse,
  resolveCallerProfileId,
  structuredLog,
} from '../_shared/adminIdentity.ts';
import {
  createDeviceNotification,
  writeDeviceAudit,
} from '../_shared/trustedDevice.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Logging Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize an unknown thrown value into a serializable error object.
 * Preserves every diagnostic field the runtime may attach (message, stack,
 * code, details, hint, cause) without ever throwing during logging.
 */
function normalizeError(err: unknown): Record<string, unknown> {
  const base = err as Record<string, unknown>;
  const cause =
    base?.cause instanceof Error
      ? {
          message: base.cause.message,
          stack: base.cause.stack,
        }
      : base?.cause;
  return {
    message: base?.message ?? String(err),
    stack: base?.stack,
    code: base?.code,
    details: base?.details,
    hint: base?.hint,
    cause,
    raw: err,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // ── Pre-flight / method guard ───────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    console.log('[PRE-FLIGHT] OPTIONS request — returning CORS headers');
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    console.error('[PRE-FLIGHT FAILED] method not allowed', { method: req.method });
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  // ── STEP 1: Request received ────────────────────────────────────────────
  console.log('[STEP 1] Request received', {
    method: req.method,
    url: req.url,
    headers: {
      authorization: req.headers.get('Authorization') ? 'present' : 'absent',
      'x-forwarded-for': req.headers.get('x-forwarded-for'),
      'user-agent': req.headers.get('user-agent'),
    },
  });
  structuredLog('DEVICE_APPROVE_REQUEST_RECEIVED');

  // ── STEP 2: Resolve caller identity ─────────────────────────────────────
  console.log('[STEP 2] Caller verification started');
  const authHeader = req.headers.get('Authorization');

  let callerProfileId: string | null = null;
  try {
    callerProfileId = await resolveCallerProfileId(authHeader);
  } catch (err) {
    // Preserve ORIGINAL behavior: the original code had no try/catch here, so
    // a thrown exception propagated → generic 500. Log everything, then
    // re-throw so the reproduction (generic 500) stays intact for inspection.
    console.error('[STEP 2 FAILED] resolveCallerProfileId threw', {
      step: 'resolveCallerProfileId',
      ...normalizeError(err),
    });
    throw err;
  }

  if (!callerProfileId) {
    console.error('[STEP 2 FAILED] no caller profile resolved from the token', {
      step: 'resolveCallerProfileId',
      authHeaderPresent: Boolean(authHeader),
    });
    return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
  }
  console.log('[STEP 2] Caller verification completed', { callerProfileId });

  const serviceClient = createAdminClient();

  // ── STEP 3: Super Admin authorization ───────────────────────────────────
  console.log('[STEP 3] Super admin authorization started', { callerProfileId });

  let isSuperAdmin: boolean;
  try {
    isSuperAdmin = await isApprovedSuperAdmin(serviceClient, callerProfileId);
  } catch (err) {
    // Preserve ORIGINAL behavior: no try/catch existed here, so a thrown
    // exception propagated → generic 500. Log, then re-throw.
    console.error('[STEP 3 FAILED] isApprovedSuperAdmin threw', {
      step: 'isApprovedSuperAdmin',
      callerProfileId,
      ...normalizeError(err),
    });
    throw err;
  }

  if (!isSuperAdmin) {
    console.error('[STEP 3 FAILED] caller is NOT an approved super admin', {
      step: 'isApprovedSuperAdmin',
      callerProfileId,
      isSuperAdmin: false,
    });
    structuredLog('DEVICE_APPROVE_FORBIDDEN', { callerProfileId });
    return errorResponse('Only an approved super admin can approve devices.', 403);
  }
  console.log('[STEP 3] Super admin authorization completed', {
    callerProfileId,
    isSuperAdmin: true,
  });

  // ── STEP 4: Validate request body ───────────────────────────────────────
  console.log('[STEP 4] Request body validation started');

  let body: { deviceId?: string };
  try {
    body = (await req.json()) as { deviceId?: string };
  } catch (err) {
    console.error('[STEP 4 FAILED] invalid request body (JSON parse failed)', {
      step: 'req.json',
      ...normalizeError(err),
    });
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }
  console.log('[STEP 4] Request body parsed', { body });

  const deviceId = body.deviceId?.trim();
  if (!deviceId) {
    console.error('[STEP 4 FAILED] deviceId is missing or empty', {
      step: 'body.deviceId',
      body,
    });
    return errorResponse('deviceId is required.', 400);
  }
  console.log('[STEP 4] Request body validation completed', { deviceId });

  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;

  // ── STEP 5: Load the target device ──────────────────────────────────────
  console.log('[STEP 5] Loading target device', { deviceId });

  let device: {
    device_id: string;
    profile_id: string;
    institute_id: string;
    device_name: string;
    status: string;
  } | null = null;
  let deviceError: { message?: string; code?: string; details?: string; hint?: string } | null = null;

  try {
    const res = await serviceClient
      .from('trusted_devices')
      .select('device_id, profile_id, institute_id, device_name, status')
      .eq('device_id', deviceId)
      .maybeSingle();
    device = res.data as typeof device;
    deviceError = res.error as typeof deviceError;
  } catch (err) {
    // Preserve ORIGINAL behavior: no try/catch existed here, so a thrown
    // exception propagated → generic 500. Log, then re-throw.
    console.error('[STEP 5 FAILED] trusted_devices SELECT threw', {
      step: 'trusted_devices.select',
      deviceId,
      ...normalizeError(err),
    });
    throw err;
  }

  if (deviceError) {
    console.error('[SUPABASE ERROR] loading trusted device', {
      step: 'trusted_devices.select',
      deviceId,
      data: device,
      error: deviceError,
    });
    console.error('[STEP 5 FAILED] trusted_devices SELECT returned an error', {
      step: 'trusted_devices.select',
      deviceId,
      ...deviceError,
    });
    return errorResponse('Device not found.', 404);
  }

  if (!device) {
    console.error('[STEP 5 FAILED] device does not exist', {
      step: 'trusted_devices.select',
      deviceId,
      data: null,
    });
    return errorResponse('Device not found.', 404);
  }
  console.log('[STEP 5] Target device loaded', {
    deviceId,
    profileId: device.profile_id,
    instituteId: device.institute_id,
    deviceName: device.device_name,
    status: device.status,
  });

  // ── STEP 5b: Idempotent approval (already approved → success, no change) ─
  // Re-approving an already-approved device must be a no-op, not an error,
  // so a stale / double-click / retried approval never disturbs the approved
  // device (Bug 2 fix).
  if (device.status === 'approved') {
    console.log('[STEP 5b] device already approved — returning idempotent success', {
      deviceId,
      profileId: device.profile_id,
    });
    structuredLog('DEVICE_APPROVE_IDEMPOTENT', { deviceId, profileId: device.profile_id });
    return jsonResponse({
      success: true,
      deviceId,
      alreadyApproved: true,
      revokedPreviousDeviceIds: [],
    });
  }

  if (device.status !== 'pending') {
    console.error('[STEP 5b FAILED] device status is not pending', {
      deviceId,
      status: device.status,
      expected: 'pending',
    });
    return errorResponse('Only pending devices can be approved.', 409);
  }

  // ── STEP 6: Atomic approve via SECURITY DEFINER RPC ─────────────────────
  // approve_trusted_device() (migration 078) performs the revoke + approve
  // inside ONE database operation: it revokes any OTHER approved device for
  // the profile (device_id <> target — the target is NEVER revoked) and
  // approves the target. A partial failure can no longer leave the profile
  // with zero approved devices (Bug 2 fix).
  console.log('[STEP 6] Approval RPC started', {
    deviceId,
    p_approved_by: callerProfileId,
    function: 'approve_trusted_device',
  });

  let rpcResult: unknown = null;
  let rpcError: { message?: string; code?: string; details?: string; hint?: string } | null = null;

  try {
    const res = await serviceClient.rpc('approve_trusted_device', {
      p_device_id: deviceId,
      p_approved_by: callerProfileId,
    });
    rpcResult = res.data;
    rpcError = res.error as typeof rpcError;
  } catch (err) {
    // Preserve ORIGINAL behavior: no try/catch existed here, so a thrown
    // exception propagated → generic 500 (the symptom being diagnosed).
    // Log, then re-throw so the reproduction stays intact.
    console.error('[STEP 6 FAILED] approve_trusted_device RPC threw', {
      step: 'rpc.approve_trusted_device',
      deviceId,
      p_approved_by: callerProfileId,
      ...normalizeError(err),
    });
    throw err;
  }

  if (rpcError) {
    console.error('[SUPABASE ERROR] approve_trusted_device RPC', {
      step: 'rpc.approve_trusted_device',
      deviceId,
      data: rpcResult,
      error: rpcError,
    });
    console.error('[STEP 6 FAILED] approve_trusted_device RPC returned an error', {
      step: 'rpc.approve_trusted_device',
      deviceId,
      ...rpcError,
    });
    return errorResponse('Could not approve the device. Please try again.', 500);
  }

  const rpcBody = (rpcResult ?? {}) as {
    success?: boolean;
    error?: string;
    errorCode?: string;
    deviceId?: string;
    revokedPreviousDeviceIds?: string[];
  };

  if (!rpcBody.success) {
    console.error('[STEP 6 FAILED] approve_trusted_device RPC returned success:false', {
      step: 'rpc.approve_trusted_device',
      deviceId,
      rpcBody,
    });
    if (rpcBody.errorCode === 'not_found') {
      return errorResponse('Device not found.', 404);
    }
    if (rpcBody.errorCode === 'not_pending') {
      return errorResponse('Only pending devices can be approved.', 409);
    }
    return errorResponse('Could not approve the device. Please try again.', 500);
  }

  const revokedPreviousDeviceIds = rpcBody.revokedPreviousDeviceIds ?? [];
  console.log('[STEP 6] Approval RPC completed', {
    deviceId,
    rpcBody,
    revokedPreviousDeviceIds,
  });

  structuredLog('DEVICE_APPROVED', {
    deviceId,
    profileId: device.profile_id,
    revokedPrevious: revokedPreviousDeviceIds,
  });

  // ── STEP 7: Audit (caller-JWT client so actor = super admin) ───────────
  console.log('[STEP 7] Audit logging started', {
    deviceId,
    action: 'device_approve',
  });

  try {
    await writeDeviceAudit(authHeader ?? '', {
      p_action: 'device_approve',
      p_resource_type: 'trusted_devices',
      p_resource_id: deviceId,
      p_new_value: { status: 'approved', profile_id: device.profile_id },
      p_metadata: {
        device_name: device.device_name,
        approved_by: callerProfileId,
        revoked_previous: revokedPreviousDeviceIds,
      },
      p_ip_address: clientIp,
      p_user_agent: userAgent,
    });
    console.log('[STEP 7] Audit logging completed', { deviceId });
  } catch (err) {
    // writeDeviceAudit is already non-fatal internally (it catches its own
    // errors and logs DEVICE_AUDIT_FAILED), so a throw here is unexpected.
    // Preserve ORIGINAL behavior: no try/catch existed around this await in
    // the original code, so a thrown exception propagated → generic 500.
    // Log everything available, then re-throw.
    console.error('[STEP 7 FAILED] audit write threw', {
      step: 'writeDeviceAudit',
      deviceId,
      ...normalizeError(err),
    });
    throw err;
  }

  // ── STEP 8: Notify the device owner ─────────────────────────────────────
  console.log('[STEP 8] Notification creation started', {
    deviceId,
    recipientIds: [device.profile_id],
    eventType: 'device_approved',
  });

  try {
    await createDeviceNotification(serviceClient, {
      instituteId: device.institute_id,
      recipientIds: [device.profile_id],
      title: 'Device approved',
      body: `Your device "${device.device_name}" is now trusted for admin access.`,
      eventType: 'device_approved',
      referenceId: deviceId,
    });
    console.log('[STEP 8] Notification creation completed', { deviceId });
  } catch (err) {
    // createDeviceNotification is already non-fatal internally (it catches its
    // own notification errors). Preserve ORIGINAL behavior: no try/catch
    // existed around this await in the original code, so a thrown exception
    // propagated → generic 500. Log everything available, then re-throw.
    console.error('[STEP 8 FAILED] notification creation threw', {
      step: 'createDeviceNotification',
      deviceId,
      ...normalizeError(err),
    });
    throw err;
  }

  // ── STEP 9: Returning success ───────────────────────────────────────────
  console.log('[STEP 9] Returning success', {
    deviceId,
    revokedPreviousDeviceIds,
  });

  return jsonResponse({
    success: true,
    deviceId,
    revokedPreviousDeviceIds,
  });
});
