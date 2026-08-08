/**
 * Admin Subscription Plan Management Hooks
 *
 * React Query hooks for the Admin Commerce → Subscription Plans module
 * (Phase 11K.9). Follows the conventions of `useCourseManagement.ts`.
 *
 * @module hooks/admin/useSubscriptionPlanAdmin
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { subscriptionPlanAdminService } from '@/services/admin/subscriptionPlanAdminService';
import type {
  SubscriptionPlanFilters,
  SubscriptionPlanSortOptions,
  CreateSubscriptionPlanInput,
  UpdateSubscriptionPlanInput,
  DuplicateSubscriptionPlanInput,
} from '@/services/admin/subscriptionPlanAdminService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Query
// ═══════════════════════════════════════════════════════════════════════════

/** Paginated, filtered subscription plan list. */
export function useSubscriptionPlanList(
  filters?: SubscriptionPlanFilters,
  sort?: SubscriptionPlanSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.commerce.subscriptionPlansList(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await subscriptionPlanAdminService.getSubscriptionPlans(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subscription plans.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/** Shared invalidation for plan list + dashboard caches. */
function useInvalidateSubscriptionPlans() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.commerce.subscriptionPlans() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/** Create a new course-scoped plan. */
export function useCreateSubscriptionPlan() {
  const invalidate = useInvalidateSubscriptionPlans();

  return useMutation({
    mutationFn: (input: CreateSubscriptionPlanInput) =>
      subscriptionPlanAdminService.createPlan(input),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/** Update an existing plan. */
export function useUpdateSubscriptionPlan() {
  const invalidate = useInvalidateSubscriptionPlans();

  return useMutation({
    mutationFn: ({ planId, input }: { planId: string; input: UpdateSubscriptionPlanInput }) =>
      subscriptionPlanAdminService.updatePlan(planId, input),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/** Duplicate an existing plan into a chosen course + cycle (created inactive). */
export function useDuplicateSubscriptionPlan() {
  const invalidate = useInvalidateSubscriptionPlans();

  return useMutation({
    mutationFn: ({ planId, input }: { planId: string; input: DuplicateSubscriptionPlanInput }) =>
      subscriptionPlanAdminService.duplicatePlan(planId, input),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/** Activate / deactivate a plan. */
export function useSetSubscriptionPlanActive() {
  const invalidate = useInvalidateSubscriptionPlans();

  return useMutation({
    mutationFn: ({ planId, isActive, updatedBy }: { planId: string; isActive: boolean; updatedBy: string }) =>
      subscriptionPlanAdminService.setPlanActive(planId, isActive, updatedBy),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
