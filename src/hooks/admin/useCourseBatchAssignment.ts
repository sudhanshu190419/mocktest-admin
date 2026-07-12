/**
 * Course Batch Assignment Hooks
 *
 * React Query hooks for the Admin Course Batch Assignment module.
 * Follows the exact same pattern as hooks/admin/useCourseTeacherAssignment.ts,
 * hooks/admin/useBatchTeacherAssignment.ts, and hooks/admin/useMockTestAssignment.ts.
 *
 * ## Exports
 *
 * | Hook                           | Description                                          |
 * |--------------------------------|------------------------------------------------------|
 * | `useAssignedBatches`           | Fetch batches assigned to a course                   |
 * | `useAvailableBatches`          | Fetch batches available for assignment               |
 * | `useCourseBatchAssignmentStats`| Fetch batch assignment statistics for a course       |
 * | `useAssignBatches`             | Assign one or more batches to a course               |
 * | `useRemoveBatch`               | Remove a single batch from a course                  |
 * | `useRemoveBatches`             | Remove multiple batches from a course                |
 *
 * @module hooks/admin/useCourseBatchAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { courseBatchAssignmentService } from '@/services/admin/courseBatchAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all batches currently assigned to a course.
 *
 * @param courseId - The `courses.course_id`.
 *
 * Cache key: `['admin', 'courseBatchAssignment', 'assigned', courseId]`
 * Stale time: 1 minute
 */
export function useAssignedBatches(courseId: string) {
  return useQuery({
    queryKey: adminKeys.courseBatchAssignment.assignedBatches(courseId),
    queryFn: async () => {
      const result = await courseBatchAssignmentService.getAssignedBatches(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned batches.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!courseId,
  });
}

/**
 * Fetch batches available for assignment to a course.
 *
 * @param courseId - The `courses.course_id` for institute scoping.
 * @param search   - Optional search term (batch name, code, or academic year).
 *
 * Cache key: `['admin', 'courseBatchAssignment', 'available', courseId, search]`
 * Stale time: 30 seconds
 */
export function useAvailableBatches(courseId: string, search?: string) {
  return useQuery({
    queryKey: [...adminKeys.courseBatchAssignment.availableBatches(courseId), search],
    queryFn: async () => {
      const result = await courseBatchAssignmentService.getAvailableBatches(courseId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available batches.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!courseId,
  });
}

/**
 * Fetch batch assignment statistics for a course.
 *
 * @param courseId - The `courses.course_id`.
 *
 * Cache key: `['admin', 'courseBatchAssignment', 'stats', courseId]`
 * Stale time: 2 minutes
 */
export function useCourseBatchAssignmentStats(courseId: string) {
  return useQuery({
    queryKey: adminKeys.courseBatchAssignment.stats(courseId),
    queryFn: async () => {
      const result = await courseBatchAssignmentService.getAssignmentStats(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch assignment statistics.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!courseId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating course batch assignment caches.
 */
function useInvalidateCourseBatchAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.courseBatchAssignment.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.courseManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Assign one or more batches to a course.
 *
 * Accepts `{ courseId: string; batchIds: string[] }`.
 */
export function useAssignBatches() {
  const invalidate = useInvalidateCourseBatchAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      batchIds,
    }: {
      courseId: string;
      batchIds: string[];
    }) => courseBatchAssignmentService.assignBatches(courseId, batchIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single batch from a course.
 *
 * Accepts `{ courseId: string; batchId: string }`.
 */
export function useRemoveBatch() {
  const invalidate = useInvalidateCourseBatchAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      batchId,
    }: {
      courseId: string;
      batchId: string;
    }) => courseBatchAssignmentService.removeBatch(courseId, batchId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove multiple batches from a course.
 *
 * Accepts `{ courseId: string; batchIds: string[] }`.
 */
export function useRemoveBatches() {
  const invalidate = useInvalidateCourseBatchAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      batchIds,
    }: {
      courseId: string;
      batchIds: string[];
    }) => courseBatchAssignmentService.removeBatches(courseId, batchIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
