/**
 * Admin Commerce Verification Hooks
 *
 * React Query hooks for the Admin Commerce Verification module.
 * Follows the same pattern as hooks/admin/*.ts.
 *
 * ## Exports
 *
 * | Hook                        | Description                             |
 * |-----------------------------|-----------------------------------------|
 * | `useCommerceMetrics`        | Aggregate commerce dashboard metrics    |
 * | `useOrderList`              | Paginated orders list                   |
 * | `usePaymentList`            | Paginated payments list                 |
 * | `useCoursePurchaseList`     | Paginated course purchases list         |
 * | `usePyqPurchaseList`        | Paginated PYQ purchases list            |
 * | `useStudentCommerce`        | Commerce data for a single student      |
 * | `useGlobalSearch`           | Global search across commerce entities  |
 * | `useOrderDetail`            | Single order with items and payments   |
 *
 * @module hooks/admin/useCommerce
 */

import { useQuery } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { commerceService } from '@/services/admin/commerceService';
import type {
  OrderListItem,
  OrderFilters,
  OrderSortOptions,
  PaymentListItem,
  PaymentFilters,
  PaymentSortOptions,
  CoursePurchaseListItem,
  CoursePurchaseFilters,
  PyqPurchaseListItem,
  PyqPurchaseFilters,
  CommerceDashboardMetrics,
  GlobalSearchResult,
  StudentCommerceData,
} from '@/services/admin/commerceService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  useCommerceMetrics
// ═══════════════════════════════════════════════════════════════════════════

export function useCommerceMetrics(instituteId?: string | null) {
  return useQuery({
    queryKey: adminKeys.commerce.metricsList(instituteId),
    queryFn: async () => {
      const result = await commerceService.getDashboardMetrics(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch commerce metrics.');
      }
      return result.data!;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useOrderList
// ═══════════════════════════════════════════════════════════════════════════

export function useOrderList(
  filters?: OrderFilters,
  sort?: OrderSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.ordersList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await commerceService.getOrders(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch orders.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  usePaymentList
// ═══════════════════════════════════════════════════════════════════════════

export function usePaymentList(
  filters?: PaymentFilters,
  sort?: PaymentSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.paymentsList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await commerceService.getPayments(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch payments.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useCoursePurchaseList
// ═══════════════════════════════════════════════════════════════════════════

export function useCoursePurchaseList(
  filters?: CoursePurchaseFilters,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.coursePurchasesList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await commerceService.getCoursePurchases(filters, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch course purchases.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  usePyqPurchaseList
// ═══════════════════════════════════════════════════════════════════════════

export function usePyqPurchaseList(
  filters?: PyqPurchaseFilters,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.pyqPurchasesList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await commerceService.getPyqPurchases(filters, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch PYQ purchases.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useStudentCommerce
// ═══════════════════════════════════════════════════════════════════════════

export function useStudentCommerce(profileId: string) {
  return useQuery({
    queryKey: adminKeys.commerce.studentDetail(profileId),
    queryFn: async () => {
      const result = await commerceService.getStudentCommerce(profileId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student commerce data.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!profileId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useGlobalSearch
// ═══════════════════════════════════════════════════════════════════════════

export function useGlobalSearch(query: string, instituteId?: string | null) {
  return useQuery({
    queryKey: adminKeys.commerce.searchQuery(query),
    queryFn: async () => {
      const result = await commerceService.globalSearch(query, instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Search failed.');
      }
      return result.data!;
    },
    staleTime: 0, // Always fetch fresh
    enabled: query.trim().length >= 2,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  useOrderDetail
// ═══════════════════════════════════════════════════════════════════════════

export function useOrderDetail(orderId: string) {
  return useQuery({
    queryKey: adminKeys.commerce.orderDetailItem(orderId),
    queryFn: async () => {
      const result = await commerceService.getOrderDetail(orderId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch order details.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!orderId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Re-export types for consumer convenience
// ═══════════════════════════════════════════════════════════════════════════

export type {
  OrderListItem,
  OrderFilters,
  OrderSortOptions,
  PaymentListItem,
  PaymentFilters,
  PaymentSortOptions,
  CoursePurchaseListItem,
  CoursePurchaseFilters,
  PyqPurchaseListItem,
  PyqPurchaseFilters,
  CommerceDashboardMetrics,
  GlobalSearchResult,
  StudentCommerceData,
};
