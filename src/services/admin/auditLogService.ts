/**
 * Audit Log Service (read-only)
 *
 * Read-side service for the Audit Log Management module (Super Admin only).
 * This is a READ-ONLY surface — audit logs are immutable and written
 * exclusively through `auditService.log()` → `write_audit_log()`.
 *
 * ## Scope
 *
 * - `getLogs()`     — lightweight, server-side paginated list with filters
 * - `getSummary()`  — dashboard counts (total / today / this week / failed)
 * - `getLogById()`  — full detail row (old/new snapshots, metadata, reason)
 *
 * ## Security
 *
 * RLS ("Super admins can read audit_logs", migration 076) already restricts
 * reads to approved super admins, scoped to their institute. This service
 * also scopes queries to the institute when provided and never exposes
 * write operations.
 *
 * ## Design notes
 *
 * - List queries are deliberately LIGHT: they select only the columns the
 *   table needs and resolve actor/institute display names via left joins.
 * - Details are loaded on demand (only when a row is opened).
 * - No hardcoded action/resource names in the query layer — filters are
 *   passed through, so future audit events appear automatically.
 *
 * @module services/admin/auditLogService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, buildPagination } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** A single audit log row as returned by the service (camelCase). */
export interface AuditLogEntry {
  logId: string;
  instituteId: string;
  /** Actor profile id. NULL for system-initiated actions. */
  profileId: string | null;
  /**
   * Resolved raw actor role. For admin actors this is the RBAC role
   * resolved from `admin_roles` (super_admin / academic_admin /
   * finance_admin); otherwise it mirrors `audit_logs.actor_role`
   * (admin / teacher / student). NULL for system actions.
   */
  actorRole: string | null;
  /**
   * UI-friendly display label for `actorRole` (e.g. "Academic Admin").
   * Centralized in the service — components must render this directly
   * and never format roles themselves.
   */
  actorRoleDisplay: string | null;
  /** Enum action (e.g. approve, reject, grant, suspend…). */
  action: string;
  /** Entity type acted upon (e.g. questions, admin_roles). */
  resourceType: string;
  /** UUID of the entity. NULL for bulk/system events. */
  resourceId: string | null;
  /** Snapshot BEFORE the action (NULL for create/login actions). */
  oldValue: Record<string, unknown> | null;
  /** Snapshot AFTER the action (NULL for delete/logout actions). */
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
  /** Freeform extra context (action-dependent schema). */
  metadata: Record<string, unknown> | null;
  performedAt: string;
  createdAt: string;
  /** 'success' | 'failure' (migration 076). */
  outcome: string;
  /** Optional review/decision note (migration 076). */
  reason: string | null;
  // ── Resolved display fields ───────────────────────────────────────────
  actorName: string | null;
  actorEmail: string | null;
  instituteName: string | null;
}

/** Filters for the audit log list query. */
export interface AuditLogFilters {
  /** Free-text search across entity name, resource id and metadata. */
  search?: string;
  /** Exact enum action filter (e.g. approve, reject). */
  action?: string;
  /** Exact resource_type filter (e.g. questions). */
  resourceType?: string;
  /** Exact outcome filter: success | failure. */
  outcome?: string;
  /** Actor profile id (performed by). */
  profileId?: string;
  /** Performed-at range start (ISO). */
  fromDate?: string;
  /** Performed-at range end (ISO). */
  toDate?: string;
}

/** Sort options for the audit log list query. */
export interface AuditLogSortOptions {
  sortDirection?: SortDirection;
}

/** Dashboard summary counts for the audit logs page. */
export interface AuditLogSummary {
  total: number;
  today: number;
  thisWeek: number;
  failed: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Priority order used when a profile holds MULTIPLE approved admin roles
 * (future-proofing). The highest-priority approved role wins for display.
 */
const ADMIN_ROLE_PRIORITY = ['super_admin', 'academic_admin', 'finance_admin'] as const;

/**
 * UI-friendly role labels. Centralized HERE so every screen (Audit Logs,
 * Activity Timeline, Admin Management, notifications…) renders the same
 * strings without duplicating them in components.
 */
export const ACTOR_ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  academic_admin: 'Academic Admin',
  finance_admin: 'Finance Admin',
  admin: 'Admin',
  teacher: 'Teacher',
  student: 'Student',
};

/** Shape of the nested `admin_roles` rows returned via the profiles join. */
interface AdminRoleRow {
  admin_role?: string | null;
  access_status?: string | null;
}

/**
 * Resolve the actor's raw role and its display label.
 *
 * - Admin actors (`profiles.role = 'admin'`): resolve the real RBAC role
 *   from the approved `admin_roles` rows. Falls back to `admin` when no
 *   approved role is found (e.g. actor was revoked/suspended afterwards).
 * - Teacher / Student / System: use the stored `actor_role` as-is.
 *
 * @param storedRole    - `audit_logs.actor_role` (denormalized at write time).
 * @param adminRoleRows - Nested `admin_roles` rows for the actor profile.
 */
export function resolveActorRole(
  storedRole: string | null,
  adminRoleRows: AdminRoleRow[] | null | undefined,
): { actorRole: string | null; actorRoleDisplay: string | null } {
  if (!storedRole) {
    return { actorRole: null, actorRoleDisplay: null };
  }

  // Admin profiles: resolve the real role from admin_roles (RBAC).
  if (storedRole === 'admin') {
    const approved = (adminRoleRows ?? []).filter(
      (r) => r.access_status === 'approved',
    );
    const picked = ADMIN_ROLE_PRIORITY.find((p) =>
      approved.some((r) => r.admin_role === p),
    );
    const raw = picked ?? 'admin';
    return {
      actorRole: raw,
      actorRoleDisplay: ACTOR_ROLE_LABELS[raw] ?? raw,
    };
  }

  return {
    actorRole: storedRole,
    actorRoleDisplay: ACTOR_ROLE_LABELS[storedRole] ?? storedRole,
  };
}

/** ISO timestamp for the start of the current day (local time). */
function startOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** ISO timestamp for the start of the current week (Monday, local time). */
function startOfWeek(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString();
}

/** Maps a raw snake_case Supabase row to AuditLogEntry. */
function mapLogEntry(row: any): AuditLogEntry {
  const storedRole = row.actor_role ?? null;
  const adminRoleRows: AdminRoleRow[] | null = Array.isArray(
    row.profiles?.admin_roles,
  )
    ? row.profiles.admin_roles
    : null;
  const { actorRole, actorRoleDisplay } = resolveActorRole(
    storedRole,
    adminRoleRows,
  );

  return {
    logId: row.log_id,
    instituteId: row.institute_id,
    profileId: row.profile_id ?? null,
    actorRole,
    actorRoleDisplay,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id ?? null,
    oldValue: row.old_value ?? null,
    newValue: row.new_value ?? null,
    ipAddress: row.ip_address ?? null,
    userAgent: row.user_agent ?? null,
    sessionId: row.session_id ?? null,
    metadata: row.metadata ?? null,
    performedAt: row.performed_at,
    createdAt: row.created_at,
    outcome: row.outcome ?? 'success',
    reason: row.reason ?? null,
    actorName: row.profiles?.name ?? null,
    actorEmail: row.profiles?.email ?? null,
    instituteName: row.institutes?.name ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════════════════════════════

export const auditLogService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. List (server-side paginated + filtered)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch a paginated, filtered, sorted list of audit logs (newest first by
   * default). Lightweight query — only list columns + actor/institute names.
   *
   * @param instituteId - Institute scope (RLS-aligned).
   * @param filters     - Optional filter criteria.
   * @param sort        - Optional sort (newest/oldest).
   * @param pagination  - Optional pagination (defaults page 1, pageSize 20).
   */
  async getLogs(
    instituteId: string | null,
    filters?: AuditLogFilters,
    sort?: AuditLogSortOptions,
    pagination?: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<AuditLogEntry>>> {
    try {
      const { page, pageSize, from, to } = buildPagination(pagination);

      let query = supabase
        .from('audit_logs')
        .select(
          `
          log_id,
          institute_id,
          profile_id,
          actor_role,
          action,
          resource_type,
          resource_id,
          old_value,
          new_value,
          ip_address,
          user_agent,
          session_id,
          metadata,
          performed_at,
          created_at,
          outcome,
          reason,
          profiles!left (
            name,
            email,
            admin_roles!fk_admin_roles_profile (
              admin_role,
              access_status
            )
          ),
          institutes!left (
            name
          )
        `,
          { count: 'exact' },
        );

      // ── Filters ─────────────────────────────────────────────────────
      if (instituteId) {
        query = query.eq('institute_id', instituteId);
      }

      if (filters?.search?.trim()) {
        const term = `%${filters.search.trim()}%`;
        // Search across entity name, resource id and metadata (all text).
        query = query.or(
          `resource_type.ilike.${term},resource_id::text.ilike.${term},metadata::text.ilike.${term}`,
        );
      }

      if (filters?.action) {
        query = query.eq('action', filters.action);
      }

      if (filters?.resourceType) {
        query = query.eq('resource_type', filters.resourceType);
      }

      if (filters?.outcome) {
        query = query.eq('outcome', filters.outcome);
      }

      if (filters?.profileId) {
        query = query.eq('profile_id', filters.profileId);
      }

      if (filters?.fromDate) {
        query = query.gte('performed_at', filters.fromDate);
      }

      if (filters?.toDate) {
        query = query.lte('performed_at', filters.toDate);
      }

      // ── Sorting (newest first by default) ───────────────────────────
      const ascending = (sort?.sortDirection ?? 'desc') === 'asc';
      query = query.order('performed_at', { ascending });

      // ── Pagination ──────────────────────────────────────────────────
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const items = (data ?? []).map(mapLogEntry);

      return {
        success: true,
        data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Dashboard Summary
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch lightweight summary counts for the audit logs dashboard.
   *
   * All counts run in parallel as head-only exact counts.
   *
   * @param instituteId - Institute scope (RLS-aligned).
   */
  async getSummary(
    instituteId: string | null,
  ): Promise<ApiResponse<AuditLogSummary>> {
    try {
      const today = startOfDay();
      const week = startOfWeek();

      const countQuery = (status: (q: any) => any) => {
        let q = supabase
          .from('audit_logs')
          .select('log_id', { count: 'exact', head: true });
        q = status(q);
        return q;
      };

      const scope = (q: any) =>
        instituteId ? q.eq('institute_id', instituteId) : q;

      const [totalRes, todayRes, weekRes, failedRes] = await Promise.all([
        countQuery(scope),
        countQuery((q) => scope(q).gte('performed_at', today)),
        countQuery((q) => scope(q).gte('performed_at', week)),
        countQuery((q) => scope(q).eq('outcome', 'failure')),
      ]);

      return {
        success: true,
        data: {
          total: totalRes.count ?? 0,
          today: todayRes.count ?? 0,
          thisWeek: weekRes.count ?? 0,
          failed: failedRes.count ?? 0,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Detail (on demand)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch the full audit log row by id — including old/new snapshots,
   * metadata and reason. Loaded ONLY when a row is opened in the detail
   * view (never preloaded into list queries).
   *
   * @param logId - The `audit_logs.log_id`.
   */
  async getLogById(logId: string): Promise<ApiResponse<AuditLogEntry>> {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          `
          *,
          profiles!left (
            name,
            email,
            phone,
            avatar_url,
            admin_roles!fk_admin_roles_profile (
              admin_role,
              access_status
            )
          ),
          institutes!left (
            name
          )
        `,
        )
        .eq('log_id', logId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: `Audit log not found: ${logId}` };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapLogEntry(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
