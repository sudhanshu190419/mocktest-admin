/**
 * Mock Result Hooks
 *
 * React Query hooks wrapping the mockResultService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                       | Type     | Description                              |
 * |----------------------------|----------|------------------------------------------|
 * | `useMockResult`            | Query    | Single result by result ID               |
 * | `useMockResultByAttempt`   | Query    | Result for a specific attempt            |
 * | `useStudentResults`        | Query    | Paginated results for a student          |
 * | `useMockTestResults`       | Query    | Paginated results for a mock test        |
 * | `useInstituteResults`      | Query    | Paginated results for an institute       |
 * | `useResults`               | Query    | Paginated, filterable results list       |
 * | `useReleaseResult`         | Mutation | Release a single result                  |
 * | `useHideResult`            | Mutation | Hide a single result                     |
 * | `useReleaseMockResults`    | Mutation | Release ALL unreleased results for a test|
 * | `useUnreleaseMockResults`  | Mutation | Unrelease ALL released results for a test|
 * | `useMockTestReleaseStatus` | Query    | Release status summary for a test        |
 * | `useDeleteResult`          | Mutation | Delete a result (dev console only)       |
 *
 * @module hooks/mockTest/useMockResults
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockTestKeys } from './queryKeys';
import {
  getResult,
  getResultByAttemptId,
  getStudentResults,
  getMockTestResults,
  getInstituteResults,
  getResults,
  getAccessibleResultTests,
  releaseResult,
  hideResult,
  deleteResult,
  releaseMockResults,
  unreleaseMockResults,
  getReleaseStatus,
} from '../../services/mockTest/mockResultService';
import type {
  MockResult,
  MockResultFilters,
  MockResultSortOptions,
  PaginatedResponse,
  PaginationParams,
} from '../../types/mockTest';
import type {
  BatchReleaseResult,
  MockTestReleaseStatus,
  AccessibleResultTest,
} from '../../services/mockTest/mockResultService';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a single result by its result ID.
 *
 * The query is disabled when `resultId` is falsy.
 *
 * @param resultId - The UUID of the result to retrieve.
 */
export function useMockResult(resultId: string | undefined | null) {
  return useQuery<MockResult>({
    queryKey: mockTestKeys.results.detail(resultId ?? ''),
    queryFn: async () => {
      const result = await getResult(resultId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock result.');
      }
      return result.data!;
    },
    enabled: !!resultId,
  });
}

/**
 * Fetch a single result by attempt ID.
 *
 * The query is disabled when `attemptId` is falsy.
 *
 * @param attemptId - The UUID of the attempt whose result to retrieve.
 */
export function useMockResultByAttempt(attemptId: string | undefined | null) {
  return useQuery<MockResult>({
    queryKey: mockTestKeys.results.detail(attemptId ?? ''),
    queryFn: async () => {
      const result = await getResultByAttemptId(attemptId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch result for attempt.');
      }
      return result.data!;
    },
    enabled: !!attemptId,
  });
}

/**
 * Fetch paginated results for a specific student.
 *
 * The query is disabled when `studentId` is falsy.
 *
 * @param studentId - The UUID of the student.
 * @param filters   - Optional additional filters.
 * @param sort      - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 */
export function useStudentResults(
  studentId: string | undefined | null,
  filters?: Omit<MockResultFilters, 'studentId'>,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<MockResult>>({
    queryKey: mockTestKeys.results.list(
      { ...filters, studentId: studentId ?? undefined } as MockResultFilters,
      sort,
      pagination,
    ),
    queryFn: async () => {
      const result = await getStudentResults(studentId!, filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student results.');
      }
      return result.data!;
    },
    enabled: !!studentId,
  });
}

/**
 * Fetch paginated results for a specific mock test (leaderboard).
 *
 * The query is disabled when `testId` is falsy.
 *
 * @param testId     - The UUID of the mock test.
 * @param filters    - Optional additional filters.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 */
export function useMockTestResults(
  testId: string | undefined | null,
  filters?: Omit<MockResultFilters, 'testId'>,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<MockResult>>({
    queryKey: mockTestKeys.results.list(
      { ...filters, testId: testId ?? undefined } as MockResultFilters,
      sort,
      pagination,
    ),
    queryFn: async () => {
      const result = await getMockTestResults(testId!, filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test results.');
      }
      return result.data!;
    },
    enabled: !!testId,
  });
}

/**
 * Fetch paginated results for an institute.
 *
 * The query is disabled when `instituteId` is falsy.
 *
 * @param instituteId - The UUID of the institute.
 * @param filters     - Optional additional filters.
 * @param sort        - Optional sort configuration.
 * @param pagination  - Optional pagination parameters.
 */
export function useInstituteResults(
  instituteId: string | undefined | null,
  filters?: Omit<MockResultFilters, 'instituteId'>,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<MockResult>>({
    queryKey: mockTestKeys.results.list(
      { ...filters, instituteId: instituteId ?? undefined } as MockResultFilters,
      sort,
      pagination,
    ),
    queryFn: async () => {
      const result = await getInstituteResults(instituteId!, filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch institute results.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
  });
}

/**
 * Fetch a paginated, filtered, and sorted list of mock results.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 * @param enabled    - Whether the query is enabled (defaults to true).
 */
export function useResults(
  filters?: MockResultFilters,
  sort?: MockResultSortOptions,
  pagination?: PaginationParams,
  enabled?: boolean,
) {
  return useQuery<PaginatedResponse<MockResult>>({
    queryKey: mockTestKeys.results.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getResults(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch results.');
      }
      return result.data!;
    },
    enabled: enabled !== false,
  });
}

/**
 * Fetch the aggregate release status for all results belonging to a mock test.
 *
 * Returns counts, all_released flag, and date ranges (earliest/latest
 * generated_at and released_at).
 *
 * The query is disabled when `testId` is falsy.
 *
 * @param testId - The UUID of the mock test.
 */
export function useMockTestReleaseStatus(testId: string | undefined | null) {
  return useQuery<MockTestReleaseStatus>({
    queryKey: [...mockTestKeys.all, 'releaseStatus', testId] as const,
    queryFn: async () => {
      const result = await getReleaseStatus(testId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch release status.');
      }
      return result.data!;
    },
    enabled: !!testId,
    // Refetch periodically so release status stays current if another
    // admin releases results while this page is open.
    refetchInterval: 30_000,
  });
}

/**
 * Fetch all unique mock tests that have accessible results for the current user.
 */
export function useAccessibleResultTests() {
  return useQuery<AccessibleResultTest[]>({
    queryKey: [...mockTestKeys.all, 'accessibleResultTests'] as const,
    queryFn: async () => {
      const result = await getAccessibleResultTests();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch accessible result tests.');
      }
      return result.data!;
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Release a single result (set is_released=true, released_at=NOW()).
 *
 * On success, invalidates all result list and detail queries.
 */
export function useReleaseResult() {
  const queryClient = useQueryClient();

  return useMutation<MockResult, Error, string>({
    mutationFn: async (resultId) => {
      const result = await releaseResult(resultId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to release result.');
      }
      return result.data!;
    },
    onSuccess: (_data, resultId) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.detail(resultId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.lists() });
    },
  });
}

/**
 * Hide a single result (set is_released=false, released_at=null).
 *
 * On success, invalidates all result list and detail queries.
 */
export function useHideResult() {
  const queryClient = useQueryClient();

  return useMutation<MockResult, Error, string>({
    mutationFn: async (resultId) => {
      const result = await hideResult(resultId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to hide result.');
      }
      return result.data!;
    },
    onSuccess: (_data, resultId) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.detail(resultId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.lists() });
    },
  });
}

/**
 * Delete a result (Developer Console only).
 *
 * On success, removes the detail cache entry and invalidates all
 * result list queries.
 */
export function useDeleteResult() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (resultId) => {
      const result = await deleteResult(resultId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete result.');
      }
    },
    onSuccess: (_data, resultId) => {
      queryClient.removeQueries({ queryKey: mockTestKeys.results.detail(resultId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.lists() });
    },
  });
}

/**
 * Release ALL unreleased results for a mock test.
 *
 * Calls the PostgreSQL RPC function `release_test_results` so that
 * `released_at` is set to `now()` on the database server.
 *
 * On success, invalidates all result list queries and the release
 * status query for the given testId.
 */
export function useReleaseMockResults() {
  const queryClient = useQueryClient();

  return useMutation<BatchReleaseResult, Error, string>({
    mutationFn: async (testId) => {
      const result = await releaseMockResults(testId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to release mock test results.');
      }
      return result.data!;
    },
    onSuccess: (_data, testId) => {
      // Invalidate result lists (student results, leaderboard, etc.)
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.lists() });
      // Invalidate the release status for this specific test
      queryClient.invalidateQueries({
        queryKey: [...mockTestKeys.all, 'releaseStatus', testId],
      });
      // Also invalidate admin mock test management caches (detail page etc.)
      queryClient.invalidateQueries({ queryKey: ['admin', 'mockTestManagement', 'detail', testId] });
    },
  });
}

/**
 * Unrelease (hide) ALL released results for a mock test.
 *
 * Calls the PostgreSQL RPC function `unrelease_test_results` which sets
 * `is_released = FALSE` and `released_at = NULL` for all released results.
 *
 * On success, invalidates all result list queries and the release
 * status query for the given testId.
 */
export function useUnreleaseMockResults() {
  const queryClient = useQueryClient();

  return useMutation<BatchReleaseResult, Error, string>({
    mutationFn: async (testId) => {
      const result = await unreleaseMockResults(testId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to unrelease mock test results.');
      }
      return result.data!;
    },
    onSuccess: (_data, testId) => {
      // Invalidate result lists (student results, leaderboard, etc.)
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.lists() });
      // Invalidate the release status for this specific test
      queryClient.invalidateQueries({
        queryKey: [...mockTestKeys.all, 'releaseStatus', testId],
      });
      // Also invalidate admin mock test management caches (detail page etc.)
      queryClient.invalidateQueries({ queryKey: ['admin', 'mockTestManagement', 'detail', testId] });
    },
  });
}
