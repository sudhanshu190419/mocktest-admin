/**
 * Admin Subscription Management Hooks
 *
 * React Query hooks for the Admin Commerce → Subscriptions module
 * (Phase 11K.8). Follows the exact conventions of `useCommerce.ts`.
 *
 * ## Exports
 *
 * | Hook                          | Description                               |
 * |-------------------------------|-------------------------------------------|
 * | `useSubscriptionMetrics`      | Aggregate subscription metrics            |
 * | `useSubscriptionList`         | Paginated subscriptions list              |
 * | `usePermanentOwnerList`       | Paginated permanent owners list           |
 * | `useFlaggedOrderList`         | Paginated duplicate / refund-flag orders  |
 * | `useSubscriptionDetail`       | Single subscription with joins            |
 * | `useSubscriptionPayments`     | Payment history for a subscription        |
 * | `useSubscriptionHistory`      | Audit history for a subscription          |
 * | `useSubscriptionCourses`      | Courses for the filter dropdown           |
 *
 * @module hooks/admin/useSubscriptionAdmin
 */

import { useQuery } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { subscriptionAdminService } from '@/services/admin/subscriptionAdminService';
import type {
  SubscriptionFilters,
  SubscriptionSortOptions,
  PermanentOwnerFilters,
  FlaggedOrderFilters,
} from '@/services/admin/subscriptionAdminService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  useSubscriptionMetrics
// ═══════════════════════════════════════════════════════════════════════════

export function useSubscriptionMetrics(instituteId?: string | null) {
  return useQuery({
    queryKey: adminKeys.commerce.subscriptionMetricsList(instituteId),
    queryFn: async () => {
      const result = await subscriptionAdminService.getSubscriptionMetrics(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subscription metrics.');
      }
      return result.data!;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useSubscriptionList
// ═══════════════════════════════════════════════════════════════════════════

export function useSubscriptionList(
  filters?: SubscriptionFilters,
  sort?: SubscriptionSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.subscriptionsList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await subscriptionAdminService.getSubscriptions(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subscriptions.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  usePermanentOwnerList
// ═══════════════════════════════════════════════════════════════════════════

export function usePermanentOwnerList(
  filters?: PermanentOwnerFilters,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.permanentOwnersList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await subscriptionAdminService.getPermanentOwners(filters, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch permanent owners.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useFlaggedOrderList
// ═══════════════════════════════════════════════════════════════════════════

export function useFlaggedOrderList(
  filters?: FlaggedOrderFilters,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.flaggedOrdersList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await subscriptionAdminService.getFlaggedOrders(filters, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch flagged orders.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useSubscriptionDetail
// ═══════════════════════════════════════════════════════════════════════════

export function useSubscriptionDetail(subscriptionId: string) {
  return useQuery({
    queryKey: adminKeys.commerce.subscriptionDetailItem(subscriptionId),
    queryFn: async () => {
      const result = await subscriptionAdminService.getSubscriptionDetail(subscriptionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subscription detail.');
      }
      return result.data ?? null;
    },
    enabled: !!subscriptionId,
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useSubscriptionPayments
// ═══════════════════════════════════════════════════════════════════════════

export function useSubscriptionPayments(subscriptionId: string) {
  return useQuery({
    queryKey: adminKeys.commerce.subscriptionPayments(subscriptionId),
    queryFn: async () => {
      const result = await subscriptionAdminService.getSubscriptionPayments(subscriptionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subscription payments.');
      }
      return result.data!;
    },
    enabled: !!subscriptionId,
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useSubscriptionHistory
// ═══════════════════════════════════════════════════════════════════════════

export function useSubscriptionHistory(subscriptionId: string) {
  return useQuery({
    queryKey: adminKeys.commerce.subscriptionHistory(subscriptionId),
    queryFn: async () => {
      const result = await subscriptionAdminService.getSubscriptionHistory(subscriptionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subscription history.');
      }
      return result.data!;
    },
    enabled: !!subscriptionId,
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useSubscriptionCourses
// ═══════════════════════════════════════════════════════════════════════════

export function useSubscriptionCourses(instituteId?: string | null) {
  return useQuery({
    queryKey: adminKeys.commerce.subscriptionCourses(instituteId),
    queryFn: async () => {
      const result = await subscriptionAdminService.getSubscriptionCourses(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch courses.');
      }
      return result.data!;
    },
    staleTime: 10 * 60 * 1000,
  });
}
