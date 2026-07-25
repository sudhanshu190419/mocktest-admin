/**
 * Shared Supabase Utilities
 *
 * Generic, reusable helpers extracted from the Academic service layer
 * to eliminate duplication across service files.
 *
 * These utilities have zero entity-specific logic and can be used by
 * any service that interacts with Supabase.
 *
 * @module utils/supabase
 */

import { PostgrestError } from '@supabase/supabase-js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Regular expression for validating UUID v4 strings.
 *
 * Format: 8-4-4-4-12 hexadecimal digits with the version-4 markers.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── [LiveKit Debug] JWT Payload Decoder ────────────────────────────────────

/**
 * Safely decodes the payload (claims) of a JWT without verifying the
 * signature.  This is safe for debug logging only — the decoded data
 * is never trusted for authorization decisions.
 *
 * Returns `null` if the token is malformed or cannot be decoded.
 *
 * @example
 *   const claims = decodeJwtPayload(token);
 *   console.log('[LiveKit Debug] Token expires at:', new Date(claims.exp * 1000).toISOString());
 */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token || typeof token !== 'string') return null;

  try {
    // JWT = header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Base64url-decode the payload (part index 1)
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // Pad the base64 string to be a multiple of 4
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * [LiveKit Debug] Extracts human-readable token expiry info from a JWT.
 * Returns a summary string safe for logging (never prints the full token).
 */
export function getTokenExpirySummary(token: string | null | undefined): string {
  if (!token) return 'NO_TOKEN';

  const claims = decodeJwtPayload(token);
  if (!claims) return 'MALFORMED_TOKEN';

  const exp = claims.exp as number | undefined;
  if (!exp) return 'NO_EXP_CLAIM';

  const expiryDate = new Date(exp * 1000);
  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const isExpired = diffMs <= 0;

  return `expires_at=${expiryDate.toISOString()} (${isExpired ? 'EXPIRED' : 'valid'} — ${diffSec}s from now)`;
}

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validates that `value` is a well-formed UUID v4.
 *
 * @throws An `Error` with a descriptive message when validation fails.
 */
export function validateUUID(value: string, fieldName: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`Invalid ${fieldName}: "${value}" is not a valid UUID.`);
  }
}

// ─── Pagination Helpers ─────────────────────────────────────────────────────

/**
 * Computes pagination offsets from optional user-provided values.
 *
 * Applies sensible defaults (page=1, pageSize=20) when values are omitted.
 *
 * @returns An object containing the resolved page, pageSize, and the
 *          `from`/`to` range values suitable for Supabase `.range()`.
 */
export function buildPagination(pagination?: {
  page?: number;
  pageSize?: number;
}): { page: number; pageSize: number; from: number; to: number } {
  const page = pagination?.page ?? DEFAULT_PAGE;
  const pageSize = pagination?.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return { page, pageSize, from, to };
}

// ─── Error Helpers ──────────────────────────────────────────────────────────

/**
 * Safely extracts a human-readable error message from any error value.
 *
 * Normalises `PostgrestError`, and plain `Error` instances into a
 * single string so that callers never need to inspect error types.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof PostgrestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  // Plain object with a message property (e.g. Supabase HTTP error body)
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.length > 0) {
      return msg;
    }
    if (typeof msg === 'string') {
      // Fall back to stringifying details or the full error
      const details = (error as Record<string, unknown>).details;
      if (typeof details === 'string' && details.length > 0) {
        return details;
      }
      const code = (error as Record<string, unknown>).code;
      return `Error code: ${String(code ?? 'unknown')}`;
    }
  }

  // Stringifiable object with no message property
  if (error && typeof error === 'object') {
    try {
      const serialised = JSON.stringify(error);
      if (serialised && serialised !== '{}') {
        return serialised;
      }
    } catch {
      // ignore serialisation failures
    }
  }

  return 'An unexpected error occurred.';
}
