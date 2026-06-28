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

  return 'An unexpected error occurred.';
}
