// ============================================================================
// Edge Function: device-revoke
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Revokes a trusted (approved) device. Super Admin only.
//
// ## Business rules
//
//   - Only an approved super_admin may revoke devices.
//   - The target device must be in status = 'approved'.
//   - Clears approved_at (revoked devices must not carry an approval
//     timestamp — enforced by ck_trusted_devices_approved).
//   - Writes an audit event (device_revoke) and notifies the device owner.
//
// @module edge-functions/device-revoke
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
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('DEVICE_REVOKE_REQUEST_RECEIVED');

  // ── Step 1: Resolve caller identity ────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const callerProfileId = await resolveCallerProfileId(authHeader);
  if (!callerProfileId) {
    return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
  }

  const serviceClient = createAdminClient();

  // ── Step 2: Super Admin only ───────────────────────────────────────────
  const isSuperAdmin = await isApprovedSuperAdmin(serviceClient, callerProfileId);
  if (!isSuperAdmin) {
    structuredLog('DEVICE_REVOKE_FORBIDDEN', { callerProfileId });
    return errorResponse('Only an approved super admin can revoke devices.', 403);
  }

  // ── Step 3: Validate request ───────────────────────────────────────────
  let body: { deviceId?: string };
  try {
    body = (await req.json()) as { deviceId?: string };
  } catch {
    return errorResponse('Invalid request body. Expected valid JSON.', 400);
  }

  const deviceId = body.deviceId?.trim();
  if (!deviceId) {
    return errorResponse('deviceId is required.', 400);
  }

  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;

  // ── Step 4: Load the approved device ───────────────────────────────────
  const { data: device, error: deviceError } = await serviceClient
    .from('trusted_devices')
    .select('device_id, profile_id, institute_id, device_name, status')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (deviceError || !device) {
    return errorResponse('Device not found.', 404);
  }
  if (device.status !== 'approved') {
    return errorResponse('Only approved devices can be revoked.', 409);
  }

  // ── Step 5: Revoke (clear approved_at per ck_trusted_devices_approved) ──
  const { error: revokeError } = await serviceClient
    .from('trusted_devices')
    .update({ status: 'revoked', approved_at: null })
    .eq('device_id', deviceId);

  if (revokeError) {
    structuredLog('DEVICE_REVOKE_UPDATE_FAILED', {
      deviceId,
      error: revokeError.message,
    });
    return errorResponse('Could not revoke the device. Please try again.', 500);
  }

  structuredLog('DEVICE_REVOKED', { deviceId, profileId: device.profile_id });

  // ── Step 6: Audit (caller-JWT client so actor = super admin) ───────────
  await writeDeviceAudit(authHeader ?? '', {
    p_action: 'device_revoke',
    p_resource_type: 'trusted_devices',
    p_resource_id: deviceId,
    p_old_value: { status: 'approved', profile_id: device.profile_id },
    p_metadata: { device_name: device.device_name, revoked_by: callerProfileId },
    p_ip_address: clientIp,
    p_user_agent: userAgent,
  });

  // ── Step 7: Notify the device owner ────────────────────────────────────
  await createDeviceNotification(serviceClient, {
    instituteId: device.institute_id,
    recipientIds: [device.profile_id],
    title: 'Device access revoked',
    body: `Trusted access for "${device.device_name}" has been revoked by an administrator.`,
    eventType: 'device_rejected',
    referenceId: deviceId,
  });

  return jsonResponse({ success: true, deviceId });
});
