/**
 * PYQ Paper Hooks
 *
 * React Query hooks wrapping the pyqPaperService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                    | Type     | Description                              |
 * |-------------------------|----------|------------------------------------------|
 * | `usePyqPapers`          | Query    | Paginated, filterable paper list         |
 * | `usePyqPaper`           | Query    | Single paper by ID                       |
 * | `useCreatePyqPaper`     | Mutation | Create a new PYQ paper                   |
 * | `useUpdatePyqPaper`     | Mutation | Update an existing PYQ paper             |
 * | `usePublishPyqPaper`    | Mutation | Publish a paper                          |
 * | `useUnpublishPyqPaper`  | Mutation | Unpublish a paper                        |
 * | `useDeletePyqPaper`     | Mutation | Delete a PYQ paper                       |
 *
 * @module hooks/pyq/usePyqPapers
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pyqKeys } from './queryKeys';
import { pyqPaperService } from '@/services/pyq/pyqPaperService';
import type {
  PyqPaper,
  CreatePyqPaperInput,
  UpdatePyqPaperInput,
  PyqPaperFilters,
  PyqPaperSortOptions,
} from '@/types/pyq';
import type { PaginatedResponse, PaginationParams } from '@/types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of PYQ papers for a package.
 *
 * @param packageId  - The parent package ID (required).
 * @param filters    - Optional filter criteria (examYear, isPublished, search).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = usePyqPapers(
 *   'package-uuid',
 *   { isPublished: true },
 *   { sortBy: 'examYear', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 */
export function usePyqPapers(
  packageId: string | undefined | null,
  filters?: Omit<PyqPaperFilters, 'packageId'>,
  sort?: PyqPaperSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<PyqPaper>>({
    queryKey: pyqKeys.papers.list(
      { ...filters, packageId: packageId ?? undefined } as PyqPaperFilters,
      sort,
      pagination,
    ),
    queryFn: async () => {
      const result = await pyqPaperService.getPapers(packageId!, filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch PYQ papers.');
      }
      return result.data!;
    },
    enabled: !!packageId,
  });
}

/**
 * Fetch a single PYQ paper by its ID.
 *
 * The query is disabled when `paperId` is falsy, making it safe to pass
 * an optional value from navigation params or parent state.
 *
 * @param paperId - The UUID of the paper to retrieve.
 */
export function usePyqPaper(paperId: string | undefined | null) {
  return useQuery<PyqPaper>({
    queryKey: pyqKeys.papers.detail(paperId!),
    queryFn: async () => {
      const result = await pyqPaperService.getPaper(paperId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch PYQ paper.');
      }
      return result.data!;
    },
    enabled: !!paperId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new PYQ paper.
 *
 * On success, invalidates all paper list queries AND the parent package
 * detail query (to refresh total_papers count).
 */
export function useCreatePyqPaper() {
  const queryClient = useQueryClient();

  return useMutation<PyqPaper, Error, CreatePyqPaperInput>({
    mutationFn: async (input) => {
      const result = await pyqPaperService.createPaper(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create PYQ paper.');
      }
      return result.data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.lists() });
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.detail(data.packageId) });
    },
  });
}

/**
 * Update an existing PYQ paper.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdatePyqPaper() {
  const queryClient = useQueryClient();

  return useMutation<PyqPaper, Error, { id: string; input: UpdatePyqPaperInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await pyqPaperService.updatePaper(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update PYQ paper.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.lists() });
    },
  });
}

/**
 * Publish a PYQ paper (set is_published = true).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function usePublishPyqPaper() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await pyqPaperService.publishPaper(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish PYQ paper.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.detail(id) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.lists() });
    },
  });
}

/**
 * Unpublish a PYQ paper (set is_published = false).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useUnpublishPyqPaper() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await pyqPaperService.unpublishPaper(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to unpublish PYQ paper.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.detail(id) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.lists() });
    },
  });
}

/**
 * Delete a PYQ paper (only if it has no mapped questions).
 *
 * On success, removes the detail cache entry, invalidates all paper list
 * queries, and invalidates the parent package detail (to refresh total_papers).
 */
export function useDeletePyqPaper() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { paperId: string; packageId: string }>({
    mutationFn: async ({ paperId }) => {
      const result = await pyqPaperService.deletePaper(paperId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete PYQ paper.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.removeQueries({ queryKey: pyqKeys.papers.detail(variables.paperId) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.papers.lists() });
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.detail(variables.packageId) });
    },
  });
}
