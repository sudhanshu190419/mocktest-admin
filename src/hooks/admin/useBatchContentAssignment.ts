/**
 * Batch Content Assignment Hooks
 *
 * React Query hooks for the Admin Batch Content Assignment module.
 * Follows the exact same pattern as hooks/admin/useMockTestAssignment.ts,
 * hooks/admin/useBatchStudentAssignment.ts, and
 * hooks/admin/useBatchTeacherAssignment.ts.
 *
 * ## Exports
 *
 * | Hook                            | Description                                           |
 * |---------------------------------|-------------------------------------------------------|
 * | `useAssignedBatchContent`       | Fetch content items assigned to a batch               |
 * | `useAvailableBatchContent`      | Fetch content items available for assignment          |
 * | `useBatchContentAssignmentStats`| Fetch content assignment statistics for a batch       |
 * | `useAssignBatchContent`         | Assign one or more content items to a batch           |
 * | `useRemoveBatchContent`         | Remove a single content item from a batch             |
 * | `useRemoveBatchContents`        | Remove multiple content items from a batch            |
 *
 * @module hooks/admin/useBatchContentAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { batchContentAssignmentService } from '@/services/admin/batchContentAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all content items currently assigned to a batch.
 *
 * @param batchId - The `batches.batch_id`.
 *
 * Cache key: `['admin', 'batchContentAssignment', 'assigned', batchId]`
 * Stale time: 1 minute
 */
export function useAssignedBatchContent(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchContentAssignment.assignedContent(batchId),
    queryFn: async () => {
      const result = await batchContentAssignmentService.getAssignedContent(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned content.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch content items available for assignment to a batch.
 *
 * @param batchId - The `batches.batch_id` for institute scoping.
 * @param search  - Optional search term (title, description, or content type).
 *
 * Cache key: `['admin', 'batchContentAssignment', 'available', batchId, search]`
 * Stale time: 30 seconds
 */
export function useAvailableBatchContent(batchId: string, search?: string) {
  return useQuery({
    queryKey: [...adminKeys.batchContentAssignment.availableContent(batchId), search],
    queryFn: async () => {
      const result = await batchContentAssignmentService.getAvailableContent(batchId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available content.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch content assignment statistics for a batch.
 *
 * @param batchId - The `batches.batch_id`.
 *
 * Cache key: `['admin', 'batchContentAssignment', 'stats', batchId]`
 * Stale time: 2 minutes
 */
export function useBatchContentAssignmentStats(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchContentAssignment.stats(batchId),
    queryFn: async () => {
      const result = await batchContentAssignmentService.getAssignmentStats(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch content assignment statistics.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!batchId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating batch content assignment caches.
 */
function useInvalidateBatchContentAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.batchContentAssignment.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Assign one or more content items to a batch.
 *
 * Accepts `{ batchId: string; contentIds: string[] }`.
 */
export function useAssignBatchContent() {
  const invalidate = useInvalidateBatchContentAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      contentIds,
    }: {
      batchId: string;
      contentIds: string[];
    }) => batchContentAssignmentService.assignContent(batchId, contentIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single content item from a batch.
 *
 * Accepts `{ batchId: string; contentId: string }`.
 */
export function useRemoveBatchContent() {
  const invalidate = useInvalidateBatchContentAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      contentId,
    }: {
      batchId: string;
      contentId: string;
    }) => batchContentAssignmentService.removeContent(batchId, contentId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove multiple content items from a batch.
 *
 * Accepts `{ batchId: string; contentIds: string[] }`.
 */
export function useRemoveBatchContents() {
  const invalidate = useInvalidateBatchContentAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      contentIds,
    }: {
      batchId: string;
      contentIds: string[];
    }) => batchContentAssignmentService.removeContents(batchId, contentIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
