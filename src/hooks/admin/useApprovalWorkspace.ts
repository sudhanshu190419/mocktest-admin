/**
 * Approval Workspace Hooks
 *
 * React Query hooks for the centralized Approval Workspace dashboard.
 *
 * The workspace is a single shared review hub for Super Admins and Academic
 * Admins (permission: canApproveAcademicResources). This module only exposes
 * the aggregated statistics — approval decisions stay in the existing
 * per-module hooks (useQuestionApproval, useMockTestManagement, useContent).
 *
 * ## Exports
 *
 * | Hook                          | Type  | Description                                 |
 * |-------------------------------|-------|---------------------------------------------|
 * | `useApprovalWorkspaceStats`   | Query | Pending + today/week approved/rejected stats |
 *
 * @module hooks/admin/useApprovalWorkspace
 */

import { useQuery } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { approvalWorkspaceService } from '@/services/admin/approvalWorkspaceService';
import type { ApprovalWorkspaceStats } from '@/services/admin/approvalWorkspaceService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch aggregated Approval Workspace statistics.
 *
 * Returns pending counts per resource type plus approved/rejected counts for
 * today and this week. All counts are computed in parallel server-side in a
 * single lightweight aggregation call.
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'approvalWorkspace', 'stats', instituteId]`
 * Stale time: 2 minutes (counts change when admins approve/reject)
 */
export function useApprovalWorkspaceStats(instituteId?: string | null) {
  return useQuery<ApprovalWorkspaceStats>({
    queryKey: adminKeys.approvalWorkspace.stats(instituteId),
    queryFn: async () => {
      const result = await approvalWorkspaceService.getStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch approval workspace statistics.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}
