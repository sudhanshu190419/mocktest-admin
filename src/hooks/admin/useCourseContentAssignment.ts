/**
 * Course Content Assignment Hooks
 *
 * React Query hooks for the Admin Course Content Assignment module.
 * Follows the exact same pattern as hooks/admin/useCourseBatchAssignment.ts,
 * hooks/admin/useCourseTeacherAssignment.ts, and hooks/admin/useMockTestAssignment.ts.
 *
 * ## Exports
 *
 * | Hook                            | Description                                          |
 * |---------------------------------|------------------------------------------------------|
 * | `useAssignedContent`            | Fetch content items assigned to a course             |
 * | `useAvailableContent`           | Fetch content items available for assignment         |
 * | `useCourseContentAssignmentStats`| Fetch content assignment statistics for a course    |
 * | `useAssignContent`              | Assign one or more content items to a course         |
 * | `useRemoveContent`              | Remove a single content item from a course           |
 * | `useRemoveContents`             | Remove multiple content items from a course          |
 *
 * @module hooks/admin/useCourseContentAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { courseContentAssignmentService } from '@/services/admin/courseContentAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all content items currently assigned to a course.
 *
 * @param courseId - The `courses.course_id`.
 *
 * Cache key: `['admin', 'courseContentAssignment', 'assigned', courseId]`
 * Stale time: 1 minute
 */
export function useAssignedContent(courseId: string) {
  return useQuery({
    queryKey: adminKeys.courseContentAssignment.assignedContent(courseId),
    queryFn: async () => {
      const result = await courseContentAssignmentService.getAssignedContent(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned content.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!courseId,
  });
}

/**
 * Fetch content items available for assignment to a course.
 *
 * @param courseId - The `courses.course_id` for institute scoping.
 * @param search   - Optional search term (title, description, or content type).
 *
 * Cache key: `['admin', 'courseContentAssignment', 'available', courseId, search]`
 * Stale time: 30 seconds
 */
export function useAvailableContent(courseId: string, search?: string) {
  return useQuery({
    queryKey: [...adminKeys.courseContentAssignment.availableContent(courseId), search],
    queryFn: async () => {
      const result = await courseContentAssignmentService.getAvailableContent(courseId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available content.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!courseId,
  });
}

/**
 * Fetch content assignment statistics for a course.
 *
 * @param courseId - The `courses.course_id`.
 *
 * Cache key: `['admin', 'courseContentAssignment', 'stats', courseId]`
 * Stale time: 2 minutes
 */
export function useCourseContentAssignmentStats(courseId: string) {
  return useQuery({
    queryKey: adminKeys.courseContentAssignment.stats(courseId),
    queryFn: async () => {
      const result = await courseContentAssignmentService.getAssignmentStats(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch content assignment statistics.');
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
 * Shared mutation options for invalidating course content assignment caches.
 */
function useInvalidateCourseContentAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.courseContentAssignment.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.courseManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Assign one or more content items to a course.
 *
 * Accepts `{ courseId: string; contentIds: string[] }`.
 */
export function useAssignContent() {
  const invalidate = useInvalidateCourseContentAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      contentIds,
    }: {
      courseId: string;
      contentIds: string[];
    }) => courseContentAssignmentService.assignContent(courseId, contentIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single content item from a course.
 *
 * Accepts `{ courseId: string; contentId: string }`.
 */
export function useRemoveContent() {
  const invalidate = useInvalidateCourseContentAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      contentId,
    }: {
      courseId: string;
      contentId: string;
    }) => courseContentAssignmentService.removeContent(courseId, contentId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove multiple content items from a course.
 *
 * Accepts `{ courseId: string; contentIds: string[] }`.
 */
export function useRemoveContents() {
  const invalidate = useInvalidateCourseContentAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      contentIds,
    }: {
      courseId: string;
      contentIds: string[];
    }) => courseContentAssignmentService.removeContents(courseId, contentIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
