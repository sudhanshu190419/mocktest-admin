// ============================================================================
// Edge Function: device-list
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Lists trusted devices. Supports two audiences with one endpoint:
//
//   Super Admin            → full queue: pending requests, approved devices,
//                            plus status filtering (pending | approved |
//                            rejected | revoked | expired | inactive | all).
//   Academic/Finance Admin → ONLY their own devices (privacy: never sees
//                            other admins' devices).
//
// ## Data access
//
//   This function reads through the SERVICE-ROLE client (bypasses RLS) and
//   applies its own authorization — matching the other device functions —
//   so the RLS "device owners can read their own" policy remains a defense
//   in depth rather than the only gate.
//
// ## Query params (GET)
//
//   ?scope=  all | own | pending | approved    (default: all)
//            own → the caller's own devices regardless of role
//   ?status= pending | approved | rejected | revoked | expired | inactive
//            (overrides scope when provided)
//
// @module edge-functions/device-list
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

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface DeviceRow {
  device_id: string;
  profile_id: string;
  institute_id: string;
  device_name: string;
  status: string;
  requested_at: string | null;
  approved_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  rejection_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  fingerprint_hash: string | null;
  user_agent: string | null;
  last_ip_address: string | null;
}

/**
 * Strip sensitive fields before returning device rows to any caller.
 *
 * device_token_hash is NEVER returned — the token is only ever stored as a
 * hash and the plaintext lives in the HttpOnly cookie, so a list endpoint
 * must not expose even the hash. approved_by is included for super admin
 * accountability but omitted for owners (they don't need it).
 *
 * @param rows      Raw device rows.
 * @param isSuper   Whether the caller is a super admin.
 */
function sanitizeDevices(rows: DeviceRow[], isSuper: boolean): unknown[] {
  return rows.map((d) => ({
    device_id: d.device_id,
    profile_id: isSuper ? d.profile_id : d.profile_id,
    institute_id: d.institute_id,
    device_name: d.device_name,
    status: d.status,
    requested_at: d.requested_at,
    approved_at: d.approved_at,
    last_used_at: d.last_used_at,
    expires_at: d.expires_at,
    rejection_reason: d.rejection_reason,
    created_at: d.created_at,
    updated_at: d.updated_at,
    ...(isSuper
      ? {
          // Super admin accountability fields.
          fingerprint_hash: d.fingerprint_hash,
          user_agent: d.user_agent,
          last_ip_address: d.last_ip_address,
        }
      : {}),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed. Use GET.', 405);
  }

  structuredLog('DEVICE_LIST_REQUEST_RECEIVED');

  // ── Step 1: Resolve caller identity ────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const callerProfileId = await resolveCallerProfileId(authHeader);
  if (!callerProfileId) {
    return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
  }

  const serviceClient = createAdminClient();

  // ── Step 2: Resolve the caller's admin context ─────────────────────────
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('profile_id, role, institute_id')
    .eq('profile_id', callerProfileId)
    .maybeSingle();

  if (profileError || !profile) {
    return errorResponse('Profile not found for the authenticated user.', 404);
  }

  const isSuperAdmin = await isApprovedSuperAdmin(serviceClient, callerProfileId);

  // Non-admin profiles (teacher/student) have no business listing devices.
  if (profile.role !== 'admin') {
    return errorResponse('Access denied.', 403);
  }

  // ── Step 3: Parse filters ───────────────────────────────────────────────
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status')?.trim().toLowerCase();
  const scopeParam = url.searchParams.get('scope')?.trim().toLowerCase();

  const ALLOWED_STATUSES = [
    'pending',
    'approved',
    'rejected',
    'revoked',
    'expired',
    'inactive',
  ];

  let statusFilter: string | null = null;
  let ownOnly = false;
  if (statusParam) {
    if (!ALLOWED_STATUSES.includes(statusParam)) {
      return errorResponse(
        `Invalid status filter. Allowed: ${ALLOWED_STATUSES.join(', ')}.`,
        400,
      );
    }
    statusFilter = statusParam;
  } else if (scopeParam === 'own') {
    ownOnly = true;
  } else if (scopeParam === 'pending') {
    statusFilter = 'pending';
  } else if (scopeParam === 'approved') {
    statusFilter = 'approved';
  }
  // scope=all or absent → no status filter.

  // ── Step 4: Build + run the query ───────────────────────────────────────
  let query = serviceClient
    .from('trusted_devices')
    .select(
      'device_id, profile_id, institute_id, device_name, status, requested_at, approved_at, last_used_at, expires_at, rejection_reason, created_at, updated_at, fingerprint_hash, user_agent, last_ip_address',
    )
    .order('requested_at', { ascending: false });

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  // Owners only ever see their own devices; scope=own forces the same
  // restriction for super admins ("my devices" view).
  if (!isSuperAdmin || ownOnly) {
    query = query.eq('profile_id', callerProfileId);
  }

  const { data: devices, error: listError } = await query;

  if (listError) {
    structuredLog('DEVICE_LIST_QUERY_FAILED', { error: listError.message });
    return errorResponse('Could not list devices. Please try again.', 500);
  }

  structuredLog('DEVICE_LIST_OK', {
    callerProfileId,
    isSuperAdmin,
    statusFilter,
    count: (devices ?? []).length,
  });

  return jsonResponse({
    success: true,
    devices: sanitizeDevices(devices as DeviceRow[], isSuperAdmin),
  });
});
