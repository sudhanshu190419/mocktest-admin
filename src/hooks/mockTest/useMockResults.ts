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
 * | `useReleaseResult`         | Mutation | Release a result (set is_released=true)  |
 * | `useHideResult`            | Mutation | Hide a result (set is_released=false)    |
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
  releaseResult,
  hideResult,
  deleteResult,
} from '../../services/mockTest/mockResultService';
import type {
  MockResult,
  MockResultFilters,
  MockResultSortOptions,
  PaginatedResponse,
  PaginationParams,
} from '../../types/mockTest';

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
    queryKey: mockTestKeys.results.list(filters, sort),
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

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Release a result (set is_released=true, released_at=NOW()).
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
 * Hide a result (set is_released=false, released_at=null).
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
