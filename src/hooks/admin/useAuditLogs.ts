/**
 * Audit Log Hooks
 *
 * React Query hooks for the Audit Log Management module (super admin only).
 *
 * Follows the same pattern as hooks/admin/useAdminManagement.ts.
 *
 * ## Exports
 *
 * | Hook                | Description                                   |
 * |---------------------|-----------------------------------------------|
 * | `useAuditLogs`      | Paginated + filtered audit log list           |
 * | `useAuditLogSummary`| Dashboard summary counts (total/today/week/failed) |
 * | `useAuditLogDetail` | Full audit log row (loaded on demand)         |
 *
 * @module hooks/admin/useAuditLogs
 */

import { useQuery } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { auditLogService } from '@/services/admin/auditLogService';
import type {
  AuditLogFilters,
  AuditLogSortOptions,
} from '@/services/admin/auditLogService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a paginated, filtered, sorted list of audit logs.
 *
 * Cache key: `['admin', 'auditLogs', 'list', instituteId, filters, sort, pagination]`
 *
 * @param instituteId - Institute scope (RLS-aligned).
 * @param filters     - Optional filter criteria.
 * @param sort        - Optional sort options.
 * @param pagination  - Optional pagination.
 */
export function useAuditLogs(
  instituteId: string | null,
  filters?: AuditLogFilters,
  sort?: AuditLogSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    // NOTE: filters/sort/pagination are spread into a plain object so the
    // interface types (which lack implicit index signatures) stay assignable
    // to the Record<string, unknown> query-key params.
    queryKey: adminKeys.auditLogs.list(
      instituteId,
      { ...(filters ?? {}) } as Record<string, unknown> | undefined,
      { ...(sort ?? {}) } as Record<string, unknown> | undefined,
      { ...(pagination ?? {}) } as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await auditLogService.getLogs(
        instituteId,
        filters,
        sort,
        pagination,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch audit logs.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!instituteId,
    placeholderData: (prev) => prev, // Keep previous page while switching
  });
}

/**
 * Fetch dashboard summary counts for the audit logs page.
 *
 * @param instituteId - Institute scope (RLS-aligned).
 */
export function useAuditLogSummary(instituteId: string | null) {
  return useQuery({
    queryKey: adminKeys.auditLogs.summaryList(instituteId),
    queryFn: async () => {
      const result = await auditLogService.getSummary(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch audit summary.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!instituteId,
  });
}

/**
 * Fetch the full audit log row by id.
 *
 * Loaded ONLY when a row is opened in the detail view (never preloaded).
 *
 * @param logId - The `audit_logs.log_id` (null disables the query).
 */
export function useAuditLogDetail(logId: string | null) {
  return useQuery({
    queryKey: adminKeys.auditLogs.detail(logId ?? ''),
    queryFn: async () => {
      if (!logId) return null;
      const result = await auditLogService.getLogById(logId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch audit log.');
      }
      return result.data!;
    },
    enabled: !!logId,
    staleTime: 60 * 1000,
  });
}
