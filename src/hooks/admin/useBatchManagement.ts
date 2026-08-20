/**
 * Batch Management Hooks
 *
 * React Query hooks for the Admin Batch Management module.
 * Follows the exact same pattern as hooks/admin/useMockTestManagement.ts,
 * hooks/admin/useTeacherLifecycle.ts, and hooks/admin/useStudentLifecycle.ts.
 *
 * ## Exports
 *
 * | Hook                          | Description                              |
 * |-------------------------------|------------------------------------------|
 * | `useBatchManagementCounts`    | Dashboard counts by batch status         |
 * | `useBatchList`                | Paginated, filtered batch list           |
 * | `useBatchDetail`              | Single batch full detail                 |
 * | `useBatchStats`               | Statistics (by stream, teacher, etc.)    |
 * | `useCreateBatch`              | Create a new batch                       |
 * | `useUpdateBatch`              | Update an existing batch                 |
 * | `useArchiveBatch`             | Archive an active batch                  |
 * | `useRestoreBatch`             | Restore an archived batch                |
 * | `useActivateBatch`            | Activate an inactive batch               |
 * | `useDeactivateBatch`          | Deactivate an active batch               |
 * | `useDeleteBatch`              | Delete a batch (soft-delete)             |
 *
 * @module hooks/admin/useBatchManagement
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { batchManagementService } from '@/services/admin/batchManagementService';
import type { BatchManagementFilters, BatchManagementSortOptions } from '@/services/admin/batchManagementService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch batch management dashboard counts (total, active, inactive, archived, full, availableSeats).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'batchManagement', 'counts', instituteId]`
 * Stale time: 2 minutes (counts change when admins add/archive batches)
 */
export function useBatchManagementCounts(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.batchManagement.counts(), instituteId],
    queryFn: async () => {
      const result = await batchManagementService.getCounts(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch management counts.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch a paginated, filtered, and sorted list of batches.
 *
 * @param filters    - Optional filter criteria (status, streamId, teacherId, search).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * Cache key: `['admin', 'batchManagement', 'list', filters, pagination]`
 * Stale time: 1 minute
 */
export function useBatchList(
  filters?: BatchManagementFilters,
  sort?: BatchManagementSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.batchManagement.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await batchManagementService.getList(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch list.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Fetch the full details for a single batch.
 *
 * @param batchId - The `batches.batch_id`.
 *
 * Cache key: `['admin', 'batchManagement', 'detail', batchId]`
 * Stale time: 1 minute
 */
export function useBatchDetail(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchManagement.detail(batchId),
    queryFn: async () => {
      const result = await batchManagementService.getDetail(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch details.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch batch management statistics (by stream, by teacher, newest, largest, utilization).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'batchManagement', 'stats', instituteId]`
 * Stale time: 5 minutes (statistics change infrequently)
 */
export function useBatchStats(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.batchManagement.stats(), instituteId],
    queryFn: async () => {
      const result = await batchManagementService.getStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch statistics.');
      }
      return result.data!;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating batch management caches.
 */
function useInvalidateBatchManagement() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Create a new batch.
 */
export function useCreateBatch() {
  const invalidate = useInvalidateBatchManagement();

  return useMutation({
    mutationFn: async (input: import('@/services/admin/batchManagementService').CreateBatchInput) => {
      const result = await batchManagementService.createBatch(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Update an existing batch.
 */
export function useUpdateBatch() {
  const invalidate = useInvalidateBatchManagement();

  return useMutation({
    mutationFn: async ({
      batchId,
      input,
    }: {
      batchId: string;
      input: import('@/services/admin/batchManagementService').UpdateBatchInput;
    }) => {
      const result = await batchManagementService.updateBatch(batchId, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Archive an active batch (active → archived).
 */
export function useArchiveBatch() {
  const invalidate = useInvalidateBatchManagement();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.archive(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Restore an archived batch (archived → active).
 */
export function useRestoreBatch() {
  const invalidate = useInvalidateBatchManagement();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.restore(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to restore batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Activate an inactive (upcoming/completed) batch (→ active).
 */
export function useActivateBatch() {
  const invalidate = useInvalidateBatchManagement();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.activate(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to activate batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Deactivate an active batch (active → completed).
 */
export function useDeactivateBatch() {
  const invalidate = useInvalidateBatchManagement();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.deactivate(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to deactivate batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Delete a batch (soft-delete).
 * Only succeeds when no students or scheduled mock tests exist.
 */
export function useDeleteBatch() {
  const invalidate = useInvalidateBatchManagement();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.delete(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

