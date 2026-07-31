// ============================================================================
// Shared Helper: Admin Identity Foundation
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Reusable building blocks for the Admin Identity backend — the secure,
// service-role-driven layer that manages administrator accounts.
//
// ## Security principles
//
//   1. The service role key NEVER leaves this module. It is read from
//      Deno.env at runtime — never hardcoded, never echoed to callers.
//   2. Caller authorization is ALWAYS verified from the database
//      (admin_roles), NEVER from client-supplied values. The browser may
//      only send its JWT; identity is resolved server-side.
//   3. Raw PostgreSQL / GoTrue error strings are NEVER surfaced to clients.
//      They are mapped to safe, user-friendly messages by
//      sanitizeErrorMessage().
//   4. Every response is JSON with standard CORS headers.
//
// ## Future Admin Identity operations
//
// Reset password, force password reset, approve/revoke trusted device,
// finance login approval, suspend account, unlock account. Each future
// edge function should import these helpers instead of re-implementing
// them, keeping the authorization model consistent across the whole
// Admin Identity backend.
//
// @module _shared/adminIdentity
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════════════════════════
// Environment & Constants
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════════════════
// Client Factories
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Anon client bound to the caller's JWT.
 *
 * Used ONLY to resolve the caller's identity (auth.getUser()). Every write
 * in an Admin Identity edge function goes through the service-role client.
 *
 * @param authHeader  The raw Authorization header ("Bearer <jwt>").
 */
export function createCallerClient(authHeader: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { Authorization: authHeader },
    },
  });
}

/**
 * Service-role client — bypasses RLS.
 *
 * Used ONLY inside edge functions for administrative operations. The
 * service role key is injected by the Supabase runtime and must never be
 * returned to or invoked from the browser.
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Caller Verification (Step 1 of every Admin Identity operation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the caller's profile_id from the Authorization header.
 *
 * Verifies the JWT against Supabase Auth and returns the authenticated
 * user id (== profiles.profile_id). Returns null when the header is
 * missing, malformed, expired or otherwise invalid.
 *
 * @param authHeader  The raw Authorization header.
 * @returns The caller's profile_id, or null when unauthenticated.
 */
export async function resolveCallerProfileId(
  authHeader: string | null,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const caller = createCallerClient(authHeader);
    const { data, error } = await caller.auth.getUser();
    if (error || !data?.user) {
      return null;
    }
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * True when the given profile holds an APPROVED super_admin role.
 *
 * The check reads `admin_roles` directly with the service-role client so it
 * never depends on RLS or on client-supplied role claims.
 *
 * @param client     A service-role (or admin) Supabase client.
 * @param profileId  The caller's profile_id.
 */
export async function isApprovedSuperAdmin(
  client: ReturnType<typeof createClient>,
  profileId: string | null,
): Promise<boolean> {
  if (!profileId) return false;

  const { data, error } = await client
    .from('admin_roles')
    .select('admin_role_id')
    .eq('profile_id', profileId)
    .eq('admin_role', 'super_admin')
    .eq('access_status', 'approved')
    .maybeSingle();

  return !error && !!data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Response Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Structured log entry — single-line JSON, same convention as other functions. */
export function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'admin-identity',
      event,
      ...data,
    }),
  );
}

/** JSON response with standard CORS headers. */
export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

/** Error response — never leaks raw database/auth error strings. */
export function errorResponse(
  message: string,
  status: number,
  details?: string,
): Response {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      service: 'admin-identity',
      event: 'ERROR_RESPONSE',
      message,
      details,
      statusCode: status,
    }),
  );

  return jsonResponse(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    status,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Sanitization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map known raw error patterns to safe, user-friendly messages.
 *
 * Raw GoTrue / PostgreSQL messages are never returned verbatim to the
 * browser. Unrecognized patterns fall back to a generic message plus the
 * raw detail in the `details` field (server logs only).
 *
 * @param raw      The raw error message from GoTrue / PostgREST.
 * @param context  A short label describing where the error occurred.
 */
export function sanitizeErrorMessage(raw: string, context: string): string {
  const lower = raw.toLowerCase();

  if (
    lower.includes('already registered') ||
    lower.includes('user already exists') ||
    lower.includes('duplicate key value violates unique constraint') ||
    lower.includes('already exists')
  ) {
    return 'An account with this phone number or email already exists.';
  }
  if (
    lower.includes('invalid phone') ||
    (lower.includes('phone number') && lower.includes('valid'))
  ) {
    return 'Please enter a valid phone number with country code (e.g. +919876543210).';
  }
  if (lower.includes('password')) {
    return 'The password does not meet the required policy. Please choose a stronger password.';
  }
  if (lower.includes('email')) {
    return 'Please enter a valid email address.';
  }

  structuredLog('SANITIZED_ERROR', {
    context,
    raw,
    mapped: 'generic',
  });

  return 'The operation could not be completed. Please try again or contact support.';
}
