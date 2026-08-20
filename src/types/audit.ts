/**
 * Audit Module Types
 *
 * Type definitions for the centralized audit logging layer (Phase 6B).
 *
 * These types mirror the `audit_action_type` PostgreSQL enum and the
 * `write_audit_log()` RPC signature introduced in Migration 076, mapping the
 * snake_case RPC parameters to camelCase TypeScript properties.
 *
 * The audit layer is intentionally generic: it ONLY records events. It never
 * performs permission checks, validates business rules, or queries
 * admin_roles — authorization lives exclusively in business services and RLS.
 *
 * @module types/audit
 */

// ─── AuditAction ────────────────────────────────────────────────────────────

/**
 * Every action that can be recorded in `audit_logs`.
 *
 * Mirrors the `audit_action_type` PostgreSQL enum (Migration 011 base values
 * + Migration 076 additions). Using a union type — not a runtime enum — keeps
 * the payload JSON-serializable for `supabase.rpc()` and prevents string
 * literals from being scattered throughout business services.
 */
export type AuditAction =
  // ── Migration 011 — base actions ───────────────────────────────────────
  | 'create'
  | 'update'
  | 'delete'
  | 'soft_delete'
  | 'permanent_delete'
  | 'restore'
  | 'publish'
  | 'unpublish'
  | 'approve'
  | 'reject'
  | 'login'
  | 'logout'
  | 'enroll'
  | 'unenroll'
  | 'purchase'
  | 'refund'
  | 'export'
  | 'import'
  | 'view_sensitive'
  // ── Migration 076 — extended actions ───────────────────────────────────
  | 'suspend'
  | 'reactivate'
  | 'revoke'
  | 'grant'
  | 'assign'
  | 'unassign'
  | 'transfer'
  | 'submit'
  | 'archive'
  | 'failed_login'
  | 'reset_password'
  | 'device_approve'
  | 'device_revoke'
  // ── Migration 129 — subjective evaluation actions ───────────────────
  | 'subjective_evaluation_saved'
  | 'subjective_evaluation_finalized'
  // ── Migration 133 — result release actions ─────────────────────────
  | 'result_released'
  | 'result_unreleased';

// ─── AuditPayload ──────────────────────────────────────────────────────────

/**
 * The outcome of the audited operation.
 *
 * Mirrors the `audit_logs.outcome` column (Migration 076): `'success'` for
 * operations that completed, `'failure'` for operations that failed.
 */
export type AuditOutcome = 'success' | 'failure';

/**
 * Payload accepted by `auditService.log()`.
 *
 * Every optional field defaults exactly as Migration 076's
 * `write_audit_log()` RPC defaults them, so omitting a field is safe.
 *
 * `resourceType` is the ONLY required field besides `action` — it maps to the
 * `resource_type` column and must be 1–100 characters (enforced by the RPC
 * and the `ck_audit_logs_resource_type_length` constraint).
 */
export interface AuditPayload {
  /** The audited action (enum value). Required. */
  action: AuditAction;
  /**
   * The entity type acted upon (e.g. 'questions', 'admin_roles',
   * 'mock_tests', 'profiles'). Matches the table name by convention.
   * Required — must be 1–100 characters.
   */
  resourceType: string;
  /** UUID of the specific entity acted upon. NULL for bulk/login events. */
  resourceId?: string | null;
  /** JSON snapshot of relevant fields BEFORE the action. */
  oldValue?: Record<string, unknown> | unknown[] | null;
  /** JSON snapshot of relevant fields AFTER the action. */
  newValue?: Record<string, unknown> | unknown[] | null;
  /** Freeform extra context (entity name, bulk counts, export format…). */
  metadata?: Record<string, unknown> | null;
  /** Client IP address (e.g. '203.0.113.9'). NULL for background jobs. */
  ipAddress?: string | null;
  /** HTTP User-Agent header of the client. NULL for background jobs. */
  userAgent?: string | null;
  /** Supabase auth session ID — groups all actions of one login session. */
  sessionId?: string | null;
  /** 'success' (default) or 'failure'. */
  outcome?: AuditOutcome;
  /** Optional free-text note (rejection remark, suspension cause…). */
  reason?: string | null;
  /**
   * UTC timestamp when the action was performed. Defaults to the database
   * server's `now()` when omitted — prefer omitting unless the action time
   * differs from the write time (e.g. async logging).
   */
  performedAt?: string | null;
}

// ─── AuditResult ───────────────────────────────────────────────────────────

/**
 * Normalised result of an audit write.
 *
 * A discriminated union so consumers can safely narrow:
 *   - `{ success: true; logId }` — the event was persisted.
 *   - `{ success: false; error }` — the event was NOT persisted (friendly
 *     message only; raw PostgreSQL errors are never exposed).
 */
export type AuditResult =
  | { success: true; logId: string }
  | { success: false; error: string };

// ─── AuditLogOptions ───────────────────────────────────────────────────────

/**
 * Options controlling audit write behavior.
 *
 * `strict` — when `true`, a failed audit write THROWS a friendly error
 * (use when the audit record is as important as the business operation).
 * When `false` (default), failures are logged to the console and a
 * `{ success: false }` result is returned so the primary business operation
 * always succeeds. Reliability: audit logging must never break business.
 */
export interface AuditLogOptions {
  strict?: boolean;
}
