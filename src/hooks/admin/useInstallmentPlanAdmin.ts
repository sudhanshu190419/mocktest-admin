/**
 * Admin Course Installment Plan Management Hooks
 *
 * React Query hooks for the Admin Commerce → Installment Plans module.
 * Follows the established conventions of `useSubscriptionPlanAdmin.ts`.
 *
 * @module hooks/admin/useInstallmentPlanAdmin
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import {
  installmentPlanAdminService,
  type InstallmentPlanFilters,
  type InstallmentPlanSortOptions,
  type CreateInstallmentPlanInput,
  type UpdateInstallmentPlanInput,
} from '@/services/admin/installmentPlanAdminService';
import type { PaginationParams } from '@/types/academic';

/**
 * Paginated, filtered installment plan list query.
 */
export function useInstallmentPlanList(
  filters?: InstallmentPlanFilters,
  sort?: InstallmentPlanSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.installmentPlansList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await installmentPlanAdminService.getInstallmentPlans(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch installment plans.');
      }
      return result.data!;
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Single installment plan detail query.
 */
export function useInstallmentPlan(planId?: string | null) {
  return useQuery({
    queryKey: adminKeys.commerce.installmentPlanDetail(planId ?? ''),
    queryFn: async () => {
      if (!planId) return null;
      const result = await installmentPlanAdminService.getInstallmentPlan(planId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch installment plan detail.');
      }
      return result.data!;
    },
    enabled: Boolean(planId),
  });
}

/**
 * Create a new installment plan mutation.
 */
export function useCreateInstallmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateInstallmentPlanInput) =>
      installmentPlanAdminService.createInstallmentPlan(input),
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: adminKeys.commerce.installmentPlans(),
        });
      }
    },
  });
}

/**
 * Update an installment plan mutation.
 */
export function useUpdateInstallmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      planId,
      input,
    }: {
      planId: string;
      input: UpdateInstallmentPlanInput;
    }) => installmentPlanAdminService.updateInstallmentPlan(planId, input),
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: adminKeys.commerce.installmentPlans(),
        });
      }
    },
  });
}

/**
 * Toggle plan active status mutation.
 */
export function useSetInstallmentPlanActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      planId,
      isActive,
    }: {
      planId: string;
      isActive: boolean;
    }) => installmentPlanAdminService.setInstallmentPlanActive(planId, isActive),
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: adminKeys.commerce.installmentPlans(),
        });
      }
    },
  });
}
