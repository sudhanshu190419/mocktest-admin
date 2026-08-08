// ============================================================================
// Shared Helper: Service-Role credential verification (audit C2)
//
// The commerce completion functions (complete-course-purchase,
// complete-subscription-purchase, complete-pyq-purchase) accept an
// `internal: true` body flag that is set by the razorpay-webhook. That flag
// is CLIENT-SETTABLE, so the internal path must additionally prove the
// caller holds the project's SERVICE_ROLE_KEY before any profileId supplied
// in the body is trusted.
//
// The credential is verified by CONSTANT-TIME comparison of the Bearer token
// received in the Authorization header against the reserved env var
// SUPABASE_SERVICE_ROLE_KEY (the same value every Edge Function in the
// project is injected with, and the same credential the razorpay-webhook
// sends).
//
// This check is deliberately FORMAT-AGNOSTIC: the service-role key is NOT
// guaranteed to be a JWT (new Supabase projects issue opaque secret keys),
// so the token is never decoded or inspected. JWT payload parsing is not
// performed anywhere in this module.
//
// SECURITY NOTES:
//   - Only the holder of the service-role credential can pass; a user / anon
//     JWT is never equal to the key, so the spoofable `internal: true` flag
//     remains harmless.
//   - Fails CLOSED when the env var is missing (env_key_missing) — a mis-set
//     environment can never open access.
//   - verify_jwt = true (see supabase/config.toml) remains REQUIRED so the
//     platform still validates incoming JWTs at the gateway as an
//     independent layer. Do NOT deploy these functions with verify_jwt = false.
//
// @module _shared/serviceRoleAuth
// ============================================================================

const BEARER_PREFIX = 'Bearer ';

export interface ServiceRoleCheck {
  /** Whether the caller presented the project's service-role credential. */
  ok: boolean;
  /** Machine-readable rejection reason, or null when ok is true. */
  reason: string | null;
  /** DIAG: true when a non-empty Authorization header value arrived. */
  hasAuthorizationHeader: boolean;
  /** DIAG: true when the header starts with the 'Bearer ' prefix. */
  bearerPrefixPresent: boolean;
  /** DIAG: true when the Bearer token equals SUPABASE_SERVICE_ROLE_KEY. */
  credentialMatches: boolean;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if both strings are identical.
 * Mirrors the implementation used by razorpay-webhook for signature checks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify that the request's Authorization header carries the project's
 * service-role credential.
 *
 * The Bearer token is compared in constant time against the reserved env var
 * SUPABASE_SERVICE_ROLE_KEY. The token is never decoded or parsed. Fails
 * closed on a missing env var. Never throws.
 */
export function isServiceRoleCall(
  authHeader: string | null | undefined,
): ServiceRoleCheck {
  // DIAG fields are computed alongside the decision; they are ADDITIONAL
  // return fields only. Never log the JWT itself or any secret value.
  // Note: a whitespace-only header counts as 'present' even though the
  // decision below rejects it as missing_bearer — that divergence is
  // intentional and more informative.
  const hasAuthorizationHeader = !!authHeader && authHeader.length > 0;
  const bearerPrefixPresent = !!authHeader && authHeader.startsWith(BEARER_PREFIX);

  // Reserved env var — identical value in every Edge Function of the project.
  // Read per call; null means mis-configuration (fail closed).
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null;

  // Fail closed: no env var configured => nobody passes.
  if (serviceRoleKey === null) {
    return {
      ok: false,
      reason: 'env_key_missing',
      hasAuthorizationHeader,
      bearerPrefixPresent,
      credentialMatches: false,
    };
  }

  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return {
      ok: false,
      reason: 'missing_bearer',
      hasAuthorizationHeader,
      bearerPrefixPresent,
      credentialMatches: false,
    };
  }

  const token = authHeader.slice(BEARER_PREFIX.length).trim();
  const credentialMatches = token.length > 0 && constantTimeEqual(token, serviceRoleKey);

  return {
    ok: credentialMatches,
    reason: credentialMatches ? null : 'credential_mismatch',
    hasAuthorizationHeader,
    bearerPrefixPresent,
    credentialMatches,
  };
}
