/**
 * PYQ Package Hooks
 *
 * React Query hooks wrapping the pyqPackageService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                    | Type     | Description                              |
 * |-------------------------|----------|------------------------------------------|
 * | `usePyqPackages`        | Query    | Paginated, filterable package list       |
 * | `usePyqPackage`         | Query    | Single package by ID                     |
 * | `useCreatePyqPackage`   | Mutation | Create a new PYQ package                 |
 * | `useUpdatePyqPackage`   | Mutation | Update an existing PYQ package           |
 * | `usePublishPyqPackage`  | Mutation | Publish a package (make active)          |
 * | `useUnpublishPyqPackage`| Mutation | Unpublish a package (make inactive)      |
 * | `useDeletePyqPackage`   | Mutation | Delete a PYQ package                     |
 *
 * @module hooks/pyq/usePyqPackages
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pyqKeys } from './queryKeys';
import { pyqPackageService } from '@/services/pyq/pyqPackageService';
import type {
  PyqPackage,
  CreatePyqPackageInput,
  UpdatePyqPackageInput,
  PyqPackageFilters,
  PyqPackageSortOptions,
} from '@/types/pyq';
import type { PaginatedResponse, PaginationParams } from '@/types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of PYQ packages.
 *
 * @param filters    - Optional filter criteria (instituteId, streamId, isActive, search).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = usePyqPackages(
 *   { instituteId: 'uuid' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 */
export function usePyqPackages(
  filters?: PyqPackageFilters,
  sort?: PyqPackageSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<PyqPackage>>({
    queryKey: pyqKeys.packages.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await pyqPackageService.getPackages(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch PYQ packages.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single PYQ package by its ID.
 *
 * The query is disabled when `packageId` is falsy, making it safe to pass
 * an optional value from navigation params or parent state.
 *
 * @param packageId - The UUID of the package to retrieve.
 */
export function usePyqPackage(packageId: string | undefined | null) {
  return useQuery<PyqPackage>({
    queryKey: pyqKeys.packages.detail(packageId!),
    queryFn: async () => {
      const result = await pyqPackageService.getPackage(packageId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch PYQ package.');
      }
      return result.data!;
    },
    enabled: !!packageId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new PYQ package.
 *
 * On success, invalidates all PYQ package list queries.
 */
export function useCreatePyqPackage() {
  const queryClient = useQueryClient();

  return useMutation<PyqPackage, Error, CreatePyqPackageInput>({
    mutationFn: async (input) => {
      const result = await pyqPackageService.createPackage(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create PYQ package.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.lists() });
    },
  });
}

/**
 * Update an existing PYQ package.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdatePyqPackage() {
  const queryClient = useQueryClient();

  return useMutation<PyqPackage, Error, { id: string; input: UpdatePyqPackageInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await pyqPackageService.updatePackage(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update PYQ package.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.lists() });
    },
  });
}

/**
 * Publish a PYQ package (make active and set published_at).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function usePublishPyqPackage() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await pyqPackageService.publishPackage(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish PYQ package.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.detail(id) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.lists() });
    },
  });
}

/**
 * Unpublish a PYQ package (make inactive).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useUnpublishPyqPackage() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await pyqPackageService.unpublishPackage(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to unpublish PYQ package.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.detail(id) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.lists() });
    },
  });
}

/**
 * Delete a PYQ package (only if it has no papers).
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 */
export function useDeletePyqPackage() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await pyqPackageService.deletePackage(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete PYQ package.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: pyqKeys.packages.detail(id) });
      queryClient.invalidateQueries({ queryKey: pyqKeys.packages.lists() });
    },
  });
}
