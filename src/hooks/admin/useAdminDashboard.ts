/**
 * Admin Dashboard Hooks
 *
 * React Query hooks for the Admin Dashboard home page.
 * Follows the same pattern as hooks/mockTest/*.ts and hooks/analytics/*.ts.
 *
 * ## Exports
 *
 * | Hook                      | Description                                |
 * |---------------------------|--------------------------------------------|
 * | `useAdminDashboardStats`  | Aggregate dashboard widget data            |
 * | `useAdminPendingApprovals`| Pending approval items for dashboard panel |
 *
 * @module hooks/admin/useAdminDashboard
 */

import { useQuery } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { adminDashboardService } from '@/services/admin/dashboardService';
import type {
  DashboardStats,
  RecentRegistration,
  UpcomingLiveClass,
} from '@/services/admin/dashboardService';

// ═══════════════════════════════════════════════════════════════════════════
//  useAdminDashboardStats
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all dashboard widget data for the admin home page.
 *
 * Aggregates counts from profiles, batches, mock_tests, questions,
 * approval_requests, and live_classes in parallel.
 *
 * @param instituteId - Institute scope (null = platform-level for super admin).
 * @param options     - Optional React Query overrides.
 *
 * @returns { data: { stats, recentRegistrations, upcomingClasses, pendingApprovals } }
 *
 * Cache key: `['admin', 'dashboard', 'list', instituteId]`
 * Stale time: 5 minutes (dashboard data changes infrequently)
 */
export function useAdminDashboardStats(
  instituteId?: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminKeys.dashboard.list(instituteId),
    queryFn: async () => {
      const result = await adminDashboardService.getDashboardData(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch dashboard data.');
      }
      return result.data!;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: options?.enabled ?? true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Re-export types for consumer convenience
// ═══════════════════════════════════════════════════════════════════════════

export type {
  DashboardStats,
  RecentRegistration,
  UpcomingLiveClass,
};
