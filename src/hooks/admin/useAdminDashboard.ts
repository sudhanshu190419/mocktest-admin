/**
 * Admin Dashboard Hooks
 *
 * React Query hooks for the Admin Dashboard home page.
 * Follows the same pattern as hooks/mockTest/*.ts and hooks/analytics/*.ts.
 *
 * Supports decoupled progressive loading (Phase 4):
 * - KPIs (counts, revenue)
 * - Recent user registrations
 * - Upcoming live classes
 *
 * ## Exports
 *
 * | Hook                          | Description                                      |
 * |-------------------------------|--------------------------------------------------|
 * | `useAdminDashboardKPIs`       | Top-level KPI counts & revenue                   |
 * | `useAdminRecentRegistrations` | Recent user registrations (limit 10)             |
 * | `useAdminUpcomingClasses`     | Upcoming scheduled live classes (limit 5)        |
 * | `useAdminDashboardStats`      | Composite hook providing decoupled loading states|
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
  DashboardData,
} from '@/services/admin/dashboardService';

const DASHBOARD_STALE_TIME = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════════════════════════
//  Granular Decoupled Hooks (Progressive Loading)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch top-level KPI metric counts & revenue.
 */
export function useAdminDashboardKPIs(
  instituteId?: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminKeys.dashboard.kpis(instituteId),
    queryFn: async () => {
      const result = await adminDashboardService.getDashboardStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch dashboard stats.');
      }
      return result.data!;
    },
    staleTime: DASHBOARD_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Fetch recent user registrations (last 10).
 */
export function useAdminRecentRegistrations(
  instituteId?: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminKeys.dashboard.recentRegistrations(instituteId),
    queryFn: async () => {
      const result = await adminDashboardService.getRecentRegistrations(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch recent registrations.');
      }
      return result.data!;
    },
    staleTime: DASHBOARD_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Fetch upcoming scheduled live classes (next 5).
 */
export function useAdminUpcomingClasses(
  instituteId?: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminKeys.dashboard.upcomingClasses(instituteId),
    queryFn: async () => {
      const result = await adminDashboardService.getUpcomingClasses(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch upcoming classes.');
      }
      return result.data!;
    },
    staleTime: DASHBOARD_STALE_TIME,
    enabled: options?.enabled ?? true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useAdminDashboardStats (Composite hook with decoupled progressive states)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Composite dashboard hook that orchestrates granular queries with progressive loading.
 * Fast queries (e.g. upcoming classes, registrations) populate their UI sections
 * without waiting for slower aggregate queries.
 *
 * @param instituteId - Institute scope (null = platform-level for super admin).
 * @param options     - Optional React Query overrides.
 */
export function useAdminDashboardStats(
  instituteId?: string | null,
  options?: { enabled?: boolean },
) {
  const kpisQuery = useAdminDashboardKPIs(instituteId, options);
  const registrationsQuery = useAdminRecentRegistrations(instituteId, options);
  const upcomingQuery = useAdminUpcomingClasses(instituteId, options);

  const stats = kpisQuery.data;
  const recentRegistrations = registrationsQuery.data ?? [];
  const upcomingClasses = upcomingQuery.data ?? [];

  const dashboardData: DashboardData = {
    stats: stats ?? {
      totalStudents: 0,
      totalTeachers: 0,
      activeBatches: 0,
      publishedMockTests: 0,
      pendingQuestionApprovals: 0,
      pendingContentApprovals: 0,
      pendingMockTestApprovals: 0,
      monthlyRevenue: null,
    },
    recentRegistrations,
    upcomingClasses,
  };

  const isKPIsLoading = kpisQuery.isLoading;
  const isRegistrationsLoading = registrationsQuery.isLoading;
  const isUpcomingLoading = upcomingQuery.isLoading;

  const isAnyLoading = isKPIsLoading || isRegistrationsLoading || isUpcomingLoading;
  const isLoading = isKPIsLoading && isRegistrationsLoading && isUpcomingLoading;

  const isError = kpisQuery.isError || registrationsQuery.isError || upcomingQuery.isError;
  const error = kpisQuery.error ?? registrationsQuery.error ?? upcomingQuery.error;

  const refetch = async () => {
    await Promise.all([
      kpisQuery.refetch(),
      registrationsQuery.refetch(),
      upcomingQuery.refetch(),
    ]);
  };

  return {
    data: dashboardData,
    stats,
    recentRegistrations,
    upcomingClasses,
    isKPIsLoading,
    isRegistrationsLoading,
    isUpcomingLoading,
    isAnyLoading,
    isLoading,
    isError,
    error,
    refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Re-export types for consumer convenience
// ═══════════════════════════════════════════════════════════════════════════

export type {
  DashboardStats,
  RecentRegistration,
  UpcomingLiveClass,
  DashboardData,
};
