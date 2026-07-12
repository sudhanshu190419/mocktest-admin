/**
 * Mock Test Management Hooks
 *
 * React Query hooks for the Admin Mock Test Management module.
 * Follows the exact same pattern as hooks/admin/useTeacherLifecycle.ts,
 * hooks/admin/useStudentLifecycle.ts, and hooks/admin/useQuestionApproval.ts.
 *
 * ## Exports
 *
 * | Hook                              | Description                                |
 * |-----------------------------------|--------------------------------------------|
 * | `useMockTestManagementCounts`     | Dashboard counts by status                 |
 * | `useMockTestList`                 | Paginated, filtered mock test list         |
 * | `useMockTestDetail`               | Single mock test full detail               |
 * | `useMockTestStats`                | Statistics (by type, status, new, attempts)|
 * | `usePublishMockTest`              | Publish a mock test                        |
 * | `useUnpublishMockTest`            | Unpublish a mock test                      |
 * | `useArchiveMockTest`              | Archive a published mock test              |
 * | `useRestoreMockTest`              | Restore an archived mock test              |
 * | `useDuplicateMockTest`            | Duplicate a mock test                      |
 * | `useDeleteMockTest`               | Delete a mock test                         |
 *
 * @module hooks/admin/useMockTestManagement
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { mockTestManagementService } from '@/services/admin/mockTestManagementService';
import type { MockTestManagementFilters, MockTestManagementSortOptions, MockTestQuestionItem } from '@/services/admin/mockTestManagementService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch mock test management dashboard counts (draft, pendingApproval, published, archived).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'mockTestManagement', 'counts', instituteId]`
 * Stale time: 2 minutes (counts change when admins publish/archive)
 */
export function useMockTestManagementCounts(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.mockTestManagement.counts(), instituteId],
    queryFn: async () => {
      const result = await mockTestManagementService.getCounts(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test management counts.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch a paginated, filtered, and sorted list of mock tests.
 *
 * @param filters    - Optional filter criteria (status, streamId, subjectId, teacherId, search).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * Cache key: `['admin', 'mockTestManagement', 'list', filters, pagination]`
 * Stale time: 1 minute
 */
export function useMockTestList(
  filters?: MockTestManagementFilters,
  sort?: MockTestManagementSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.mockTestManagement.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await mockTestManagementService.getList(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test list.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Fetch the full details for a single mock test.
 *
 * @param testId - The `mock_tests.test_id`.
 *
 * Cache key: `['admin', 'mockTestManagement', 'detail', testId]`
 * Stale time: 1 minute
 */
export function useMockTestDetail(testId: string) {
  return useQuery({
    queryKey: adminKeys.mockTestManagement.detail(testId),
    queryFn: async () => {
      const result = await mockTestManagementService.getDetail(testId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test details.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!testId,
  });
}

/**
 * Fetch mock test management statistics (by type, by status, newest, most attempted).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'mockTestManagement', 'stats', instituteId]`
 * Stale time: 5 minutes (statistics change infrequently)
 */
/**
 * Fetch all questions belonging to a mock test.
 *
 * Joins `mock_test_questions` → `questions` with `subjects` and `chapters`.
 * Ordered by `order_sequence ASC`.
 *
 * @param testId - The `mock_tests.test_id`.
 *
 * Cache key: `['admin', 'mockTestManagement', 'detail', testId, 'questions']`
 * Stale time: 1 minute
 */
export function useMockTestQuestions(testId: string) {
  return useQuery({
    queryKey: adminKeys.mockTestManagement.questions(testId),
    queryFn: async () => {
      const result = await mockTestManagementService.getTestQuestions(testId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test questions.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!testId,
  });
}

/**
 * Fetch mock test management statistics (by type, by status, newest, most attempted).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'mockTestManagement', 'stats', instituteId]`
 * Stale time: 5 minutes (statistics change infrequently)
 */
export function useMockTestStats(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.mockTestManagement.stats(), instituteId],
    queryFn: async () => {
      const result = await mockTestManagementService.getStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test statistics.');
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
 * Shared mutation options for invalidating mock test management caches.
 */
function useInvalidateMockTestManagement() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.mockTestManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Publish a mock test (pending_approval → published).
 */
export function usePublishMockTest() {
  const invalidate = useInvalidateMockTestManagement();

  return useMutation({
    mutationFn: (testId: string) => mockTestManagementService.publish(testId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Unpublish a mock test (published → draft).
 */
export function useUnpublishMockTest() {
  const invalidate = useInvalidateMockTestManagement();

  return useMutation({
    mutationFn: (testId: string) => mockTestManagementService.unpublish(testId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Archive a published mock test (published → archived).
 * Preserves published_at for audit trail.
 */
export function useArchiveMockTest() {
  const invalidate = useInvalidateMockTestManagement();

  return useMutation({
    mutationFn: (testId: string) => mockTestManagementService.archive(testId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Restore an archived mock test (archived → published).
 */
export function useRestoreMockTest() {
  const invalidate = useInvalidateMockTestManagement();

  return useMutation({
    mutationFn: (testId: string) => mockTestManagementService.restore(testId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Duplicate a mock test. Creates a new draft copy with "(Copy)" suffix.
 */
export function useDuplicateMockTest() {
  const invalidate = useInvalidateMockTestManagement();

  return useMutation({
    mutationFn: (testId: string) => mockTestManagementService.duplicate(testId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Delete a mock test permanently.
 * Dependent rows (questions, attempts, results) may prevent deletion.
 * Use archive() for safe retirement.
 */
export function useDeleteMockTest() {
  const invalidate = useInvalidateMockTestManagement();

  return useMutation({
    mutationFn: (testId: string) => mockTestManagementService.delete(testId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
