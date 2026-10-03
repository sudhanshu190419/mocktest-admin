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
import type { BatchManagementFilters, BatchManagementSortOptions, BatchLookupItem } from '@/services/admin/batchManagementService';
export type { BatchLookupItem };
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
/**
 * Fetch a lightweight list of active batches for filter dropdowns.
 *
 * Avoids heavy relational joins (streams, batch_students) and sequential
 * teacher resolution, returning only batchId and batchName.
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'batchManagement', 'lookup', instituteId]`
 * Stale time: 5 minutes (batch names change rarely)
 */
export function useBatchLookup(instituteId?: string | null) {
  return useQuery<BatchLookupItem[]>({
    queryKey: adminKeys.batchManagement.lookup(instituteId),
    queryFn: async () => {
      const result = await batchManagementService.getBatchLookup(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch options.');
      }
      return result.data!;
    },
    staleTime: 5 * 60 * 1000,
  });
}

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
 * Create a new batch.
 * Invalidates lists, counts, and dropdown lookups without clearing other batch details.
 */
export function useCreateBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: import('@/services/admin/batchManagementService').CreateBatchInput) => {
      const result = await batchManagementService.createBatch(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lists() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.counts() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lookup() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Update an existing batch.
 * Invalidates the specific batch detail, lists, counts, and lookups.
 */
export function useUpdateBatch() {
  const queryClient = useQueryClient();

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
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.detail(variables.batchId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lists() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.counts() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lookup() }),
      ]);
    },
  });
}

/**
 * Archive an active batch (active ──► archived).
 * Targets the specific batch detail, lists, counts, and dashboard.
 */
export function useArchiveBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.archive(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive batch.');
      }
      return result;
    },
    onSuccess: async (_data, batchId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.detail(batchId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lists() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.counts() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Restore an archived batch (archived ──► active).
 */
export function useRestoreBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.restore(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to restore batch.');
      }
      return result;
    },
    onSuccess: async (_data, batchId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.detail(batchId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lists() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.counts() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Activate an inactive (upcoming/completed) batch (──► active).
 */
export function useActivateBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.activate(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to activate batch.');
      }
      return result;
    },
    onSuccess: async (_data, batchId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.detail(batchId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lists() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.counts() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Deactivate an active batch (active ──► completed).
 */
export function useDeactivateBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.deactivate(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to deactivate batch.');
      }
      return result;
    },
    onSuccess: async (_data, batchId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.detail(batchId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lists() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.counts() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Delete a batch (soft-delete).
 */
export function useDeleteBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const result = await batchManagementService.delete(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete batch.');
      }
      return result;
    },
    onSuccess: async (_data, batchId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.detail(batchId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lists() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.counts() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.lookup() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}
