/**
 * Audit Service
 *
 * The centralized, reusable backend interface for writing audit events
 * (Phase 6B — backend audit layer).
 *
 * ## Contract
 *
 * No business module ever calls `supabase.rpc('write_audit_log')` directly.
 * Every module calls `auditService.log(...)` (or a convenience helper), which
 * internally invokes the RPC created in Migration 076.
 *
 * ## Design principles
 *
 * 1. **Records only.** This service performs NO permission checks, NO business
 *    rule validation, and NO admin-role lookups. Migration 076 already handles
 *    structural validation (authentication, snapshot consistency, required
 *    fields, outcome); business services already handle authorization.
 * 2. **Never breaks the primary operation.** Audit logging is a side effect.
 *    By default (`strict: false`), any failure is logged to the console and a
 *    `{ success: false, error }` result is returned — the caller's business
 *    logic continues unaffected. Pass `strict: true` only when the audit
 *    record is as important as the operation itself.
 * 3. **Never exposes raw PostgreSQL errors.** Database / RPC errors are
 *    converted into friendly application messages before they reach callers.
 * 4. **No duplicated logic.** Every convenience helper (logCreate, logUpdate,
 *    logApprove, …) is a thin wrapper over the single `log()` core method.
 * 5. **Strong types.** `AuditAction` is a union type (not raw string
 *    literals) so the full set of valid actions is enforced at compile time.
 *
 * ## Future compatibility
 *
 * The public API is intentionally stable so later phases (teacher lifecycle,
 * student lifecycle, admin lifecycle, approvals, soft delete, restore,
 * finance, commerce, trusted devices) can write audit events WITHOUT changing
 * this file or its API — they simply call `auditService.log(...)` or the
 * matching helper.
 *
 * @module services/audit/auditService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import type {
  AuditAction,
  AuditLogOptions,
  AuditOutcome,
  AuditPayload,
  AuditResult,
} from '@/types/audit';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Name of the RPC created in Migration 076. */
const WRITE_AUDIT_LOG_RPC = 'write_audit_log';

/** Friendly, non-leaky error messages (raw Postgres errors are never shown). */
const ERROR_MESSAGES = {
  invalidPayload: 'Invalid audit payload.',
  unavailable: 'Audit service unavailable.',
  failed: 'Failed to write audit log.',
} as const;

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Raw shape returned by the write_audit_log RPC (jsonb → object). */
interface DbAuditResult {
  success?: boolean;
  log_id?: string | null;
  error?: string | null;
}

/**
 * Builds the snake_case RPC argument object from a camelCase payload.
 *
 * Only fields that are explicitly provided are included; `undefined` values
 * are dropped so the RPC's own defaults (e.g. `p_outcome = 'success'`,
 * `p_performed_at = now()`) apply — matching Migration 076 defaults exactly.
 */
function buildRpcArgs(payload: AuditPayload): Record<string, unknown> {
  const args: Record<string, unknown> = {
    p_action: payload.action,
    p_resource_type: payload.resourceType,
  };

  if (payload.resourceId !== undefined) args.p_resource_id = payload.resourceId;
  if (payload.oldValue !== undefined) args.p_old_value = payload.oldValue;
  if (payload.newValue !== undefined) args.p_new_value = payload.newValue;
  if (payload.metadata !== undefined) args.p_metadata = payload.metadata;
  if (payload.ipAddress !== undefined) args.p_ip_address = payload.ipAddress;
  if (payload.userAgent !== undefined) args.p_user_agent = payload.userAgent;
  if (payload.sessionId !== undefined) args.p_session_id = payload.sessionId;
  if (payload.outcome !== undefined) args.p_outcome = payload.outcome;
  if (payload.reason !== undefined) args.p_reason = payload.reason;
  if (payload.performedAt !== undefined) args.p_performed_at = payload.performedAt;

  return args;
}

/**
 * Structural validation that mirrors the RPC's checks.
 *
 * This is NOT authorization — it only rejects malformed payloads (missing
 * action, missing/oversized resourceType, bad outcome) so callers get a
 * friendly error before a round-trip. Returns null when the payload is valid.
 */
function validatePayload(payload: AuditPayload): string | null {
  // Optional chaining also guards against untyped JS callers passing null/undefined.
  if (!payload?.action) return ERROR_MESSAGES.invalidPayload;

  const type = payload.resourceType;
  if (typeof type !== 'string' || type.length < 1 || type.length > 100) {
    return ERROR_MESSAGES.invalidPayload;
  }

  if (
    payload.outcome !== undefined &&
    payload.outcome !== 'success' &&
    payload.outcome !== 'failure'
  ) {
    return ERROR_MESSAGES.invalidPayload;
  }

  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * The single core method every audit write flows through.
 *
 * Validates the payload, invokes `write_audit_log`, normalizes the RPC
 * response into an `AuditResult`, and converts any database error into a
 * friendly application error.
 *
 * @param payload - The audit event to record (action + resourceType required).
 * @param options - Optional behavior flags (`strict` — default false).
 *
 * @example
 * ```ts
 * await auditService.log({
 *   action: 'approve',
 *   resourceType: 'questions',
 *   resourceId: questionId,
 *   metadata: { entityName: 'Physics — Laws of Motion' },
 *   reason: 'Meets syllabus requirements',
 * });
 * ```
 */
export async function log(
  payload: AuditPayload,
  options: AuditLogOptions = {},
): Promise<AuditResult> {
  const { strict = false } = options;

  // ── Validate required fields (friendly error, never a raw exception) ──
  const validationError = validatePayload(payload);
  if (validationError) {
    console.warn(`[AuditService] ${validationError}`, payload?.action);
    if (strict) throw new Error(validationError);
    return { success: false, error: validationError };
  }

  try {
    // NOTE: `rpc` is called untyped and the result cast — matching the
    // existing codebase convention (mockResultService / analyticsService).
    // The write_audit_log RPC returns a scalar jsonb: { success, log_id }
    // or { success: false, error }, which PostgREST surfaces as `data`.
    const { data, error } = await supabase.rpc(
      WRITE_AUDIT_LOG_RPC,
      buildRpcArgs(payload),
    );
    const result = data as DbAuditResult | null;

    // ── Normalize RPC response ─────────────────────────────────────────
    if (error) {
      console.error('[AuditService] RPC error:', error);
      if (strict) throw new Error(ERROR_MESSAGES.failed);
      return { success: false, error: ERROR_MESSAGES.failed };
    }

    // The RPC returns { success: true, log_id } or { success: false, error }.
    if (result?.success && result.log_id) {
      return { success: true, logId: result.log_id };
    }

    // RPC executed but rejected the event (e.g. structural validation).
    // The RPC returns controlled application messages (not raw Postgres
    // errors), so surfacing rpcError is both safe and informative.
    const rpcError = result?.error
      ? String(result.error)
      : ERROR_MESSAGES.failed;
    console.warn('[AuditService] Event rejected by RPC:', rpcError);
    if (strict) throw new Error(rpcError);
    return { success: false, error: rpcError };
  } catch (err) {
    // Network / runtime failures — never expose raw Postgres errors.
    console.error('[AuditService] Unexpected error:', err);
    if (strict) throw new Error(ERROR_MESSAGES.unavailable);
    return { success: false, error: ERROR_MESSAGES.unavailable };
  }
}

// ─── Convenience helpers (thin wrappers over log(), no duplicated logic) ────

type HelperPayload = Omit<AuditPayload, 'action'>;

/** Records a `create` event. */
export async function logCreate(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'create' }, options);
}

/** Records an `update` event. */
export async function logUpdate(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'update' }, options);
}

/** Records a hard `delete` event. */
export async function logDelete(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'delete' }, options);
}

/** Records a `soft_delete` event. */
export async function logSoftDelete(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'soft_delete' }, options);
}

/** Records a `restore` event. */
export async function logRestore(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'restore' }, options);
}

/** Records an `approve` event. */
export async function logApprove(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'approve' }, options);
}

/** Records a `reject` event. */
export async function logReject(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'reject' }, options);
}

/** Records a `publish` event. */
export async function logPublish(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'publish' }, options);
}

/** Records an `archive` event. */
export async function logArchive(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'archive' }, options);
}

/** Records a `login` event. */
export async function logLogin(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'login' }, options);
}

/** Records a `logout` event. */
export async function logLogout(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'logout' }, options);
}

/** Records an `assign` event. */
export async function logAssign(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'assign' }, options);
}

/** Records an `unassign` event. */
export async function logUnassign(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'unassign' }, options);
}

/** Records a `grant` event. */
export async function logGrant(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'grant' }, options);
}

/** Records a `revoke` event. */
export async function logRevoke(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'revoke' }, options);
}

/** Records a `suspend` event. */
export async function logSuspend(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'suspend' }, options);
}

/** Records a `reactivate` event. */
export async function logReactivate(
  payload: HelperPayload,
  options?: AuditLogOptions,
): Promise<AuditResult> {
  return log({ ...payload, action: 'reactivate' }, options);
}

// ─── Namespaced object (matches existing service conventions) ──────────────

/**
 * Namespaced audit service object.
 *
 * Consumers can import the object form:
 * ```ts
 * import { auditService } from '@/services/audit/auditService';
 * await auditService.log({ action: 'login', resourceType: 'profiles' });
 * await auditService.logApprove({ resourceType: 'questions', resourceId });
 * ```
 */
export const auditService = {
  log,
  logCreate,
  logUpdate,
  logDelete,
  logSoftDelete,
  logRestore,
  logApprove,
  logReject,
  logPublish,
  logArchive,
  logLogin,
  logLogout,
  logAssign,
  logUnassign,
  logGrant,
  logRevoke,
  logSuspend,
  logReactivate,
};

// Re-export types so consumers can import from one place.
export type { AuditAction, AuditLogOptions, AuditOutcome, AuditPayload, AuditResult };
