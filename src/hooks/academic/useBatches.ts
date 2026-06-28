/**
 * Batch Hooks
 *
 * React Query hooks wrapping the batchService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook              | Type     | Description                             |
 * |-------------------|----------|-----------------------------------------|
 * | `useBatches`      | Query    | Paginated, filterable batch list        |
 * | `useBatch`        | Query    | Single batch by ID                      |
 * | `useCreateBatch`  | Mutation | Create a new batch                      |
 * | `useUpdateBatch`  | Mutation | Update an existing batch                |
 * | `useDeleteBatch`  | Mutation | Soft-delete a batch                     |
 *
 * @module hooks/academic/useBatches
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { academicKeys } from './queryKeys';
import {
  getBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
} from '../../services/academic/batchService';
import type {
  Batch,
  BatchFilters,
  BatchSortOptions,
  CreateBatchInput,
  PaginatedResponse,
  PaginationParams,
  UpdateBatchInput,
} from '../../types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of batches.
 *
 * Soft-deleted batches are excluded by default. Pass `includeDeleted: true`
 * in filters to include them.
 *
 * @param filters   - Optional filter criteria.
 * @param sort      - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useBatches(
 *   { streamId: 'uuid', status: 'active' },
 *   { sortBy: 'startDate', sortDirection: 'desc' },
 *   { page: 1, pageSize: 10 },
 * );
 */
export function useBatches(
  filters?: BatchFilters,
  sort?: BatchSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Batch>>({
    queryKey: academicKeys.batches.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getBatches(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batches.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single batch by its ID.
 *
 * Soft-deleted batches can still be retrieved by ID.
 * The query is disabled when `batchId` is falsy.
 *
 * @param batchId - The UUID of the batch to retrieve.
 */
export function useBatch(batchId: string | undefined | null) {
  return useQuery<Batch>({
    queryKey: academicKeys.batches.detail(batchId!),
    queryFn: async () => {
      const result = await getBatchById(batchId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch.');
      }
      return result.data!;
    },
    enabled: !!batchId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new batch.
 *
 * On success, invalidates all batch list queries.
 */
export function useCreateBatch() {
  const queryClient = useQueryClient();

  return useMutation<Batch, Error, CreateBatchInput>({
    mutationFn: async (input) => {
      const result = await createBatch(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create batch.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: academicKeys.batches.lists() });
    },
  });
}

/**
 * Update an existing batch.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdateBatch() {
  const queryClient = useQueryClient();

  return useMutation<Batch, Error, { id: string; input: UpdateBatchInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateBatch(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update batch.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: academicKeys.batches.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.batches.lists() });
    },
  });
}

/**
 * Soft-delete a batch.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 */
export function useDeleteBatch() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteBatch(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete batch.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: academicKeys.batches.detail(id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.batches.lists() });
    },
  });
}
