/**
 * Mock Test Hooks
 *
 * React Query hooks wrapping the mockTestService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                  | Type     | Description                             |
 * |-----------------------|----------|-----------------------------------------|
 * | `useMockTests`        | Query    | Paginated, filterable mock test list    |
 * | `useMockTest`         | Query    | Single mock test by ID                  |
 * | `useCreateMockTest`   | Mutation | Create a new mock test                  |
 * | `useUpdateMockTest`   | Mutation | Update an existing mock test            |
 * | `useDeleteMockTest`   | Mutation | Delete a mock test                      |
 * | `usePublishMockTest`  | Mutation | Publish a mock test (status transition) |
 * | `useArchiveMockTest`  | Mutation | Archive a mock test                     |
 * | `useRestoreMockTest`  | Mutation | Restore an archived mock test           |
 *
 * @module hooks/mockTest/useMockTests
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockTestKeys } from './queryKeys';
import {
  getMockTests,
  getMockTestById,
  createMockTest,
  updateMockTest,
  deleteMockTest,
  publishMockTest,
  archiveMockTest,
  restoreMockTest,
} from '../../services/mockTest/mockTestService';
import type {
  MockTest,
  CreateMockTestInput,
  UpdateMockTestInput,
  PaginatedResponse,
  PaginationParams,
} from '../../types/mockTest';
import type {
  MockTestServiceFilters,
  MockTestServiceSortOptions,
} from '../../services/mockTest/mockTestService';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of mock tests.
 *
 * @param filters   - Optional filter criteria.
 * @param sort      - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useMockTests(
 *   { instituteId: 'uuid', status: 'published' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 10 },
 * );
 */
export function useMockTests(
  filters?: MockTestServiceFilters,
  sort?: MockTestServiceSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<MockTest>>({
    queryKey: mockTestKeys.mockTests.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getMockTests(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock tests.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single mock test by its ID.
 *
 * The query is disabled when `testId` is falsy, making it safe to pass
 * an optional value from navigation params or parent state.
 *
 * @param testId - The UUID of the mock test to retrieve.
 */
export function useMockTest(testId: string | undefined | null) {
  return useQuery<MockTest>({
    queryKey: mockTestKeys.mockTests.detail(testId!),
    queryFn: async () => {
      const result = await getMockTestById(testId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test.');
      }
      return result.data!;
    },
    enabled: !!testId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new mock test.
 *
 * On success, invalidates all mock test list queries.
 */
export function useCreateMockTest() {
  const queryClient = useQueryClient();

  return useMutation<MockTest, Error, CreateMockTestInput>({
    mutationFn: async (input) => {
      const result = await createMockTest(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create mock test.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });
    },
  });
}

/**
 * Update an existing mock test.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdateMockTest() {
  const queryClient = useQueryClient();

  return useMutation<MockTest, Error, { id: string; input: UpdateMockTestInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateMockTest(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });
    },
  });
}

/**
 * Delete a mock test.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 */
export function useDeleteMockTest() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteMockTest(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete mock test.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: mockTestKeys.mockTests.detail(id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });
    },
  });
}

/**
 * Publish a mock test (status transition: pending_approval → published).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function usePublishMockTest() {
  const queryClient = useQueryClient();

  return useMutation<MockTest, Error, string>({
    mutationFn: async (id) => {
      const result = await publishMockTest(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.detail(id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });
    },
  });
}

/**
 * Archive a mock test (status transition: published → archived).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useArchiveMockTest() {
  const queryClient = useQueryClient();

  return useMutation<MockTest, Error, string>({
    mutationFn: async (id) => {
      const result = await archiveMockTest(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.detail(id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });
    },
  });
}

/**
 * Restore an archived mock test (status transition: archived → draft).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useRestoreMockTest() {
  const queryClient = useQueryClient();

  return useMutation<MockTest, Error, string>({
    mutationFn: async (id) => {
      const result = await restoreMockTest(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to restore mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.detail(id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });
    },
  });
}
