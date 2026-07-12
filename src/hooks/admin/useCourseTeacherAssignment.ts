/**
 * Course Teacher Assignment Hooks
 *
 * React Query hooks for the Admin Course Teacher Assignment module.
 * Follows the exact same pattern as hooks/admin/useBatchTeacherAssignment.ts,
 * hooks/admin/useBatchStudentAssignment.ts, and hooks/admin/useMockTestAssignment.ts.
 *
 * ## Exports
 *
 * | Hook                           | Description                                          |
 * |--------------------------------|------------------------------------------------------|
 * | `useAssignedTeachers`          | Fetch teachers assigned to a course                  |
 * | `useAvailableTeachers`         | Fetch teachers available for assignment               |
 * | `useCourseTeacherAssignmentStats`| Fetch teacher assignment statistics for a course    |
 * | `useAssignTeachers`            | Assign one or more teachers to a course              |
 * | `useRemoveTeacher`             | Remove a single teacher from a course                |
 * | `useRemoveTeachers`            | Remove multiple teachers from a course               |
 *
 * @module hooks/admin/useCourseTeacherAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { courseTeacherAssignmentService } from '@/services/admin/courseTeacherAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all teachers currently assigned to a course.
 *
 * @param courseId - The `courses.course_id`.
 *
 * Cache key: `['admin', 'courseTeacherAssignment', 'assigned', courseId]`
 * Stale time: 1 minute
 */
export function useAssignedTeachers(courseId: string) {
  return useQuery({
    queryKey: adminKeys.courseTeacherAssignment.assignedTeachers(courseId),
    queryFn: async () => {
      const result = await courseTeacherAssignmentService.getAssignedTeachers(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned teachers.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!courseId,
  });
}

/**
 * Fetch teachers available for assignment to a course.
 *
 * @param courseId - The `courses.course_id` for institute scoping.
 * @param search   - Optional search term (name or faculty ID).
 *
 * Cache key: `['admin', 'courseTeacherAssignment', 'available', courseId, search]`
 * Stale time: 30 seconds
 */
export function useAvailableTeachers(courseId: string, search?: string) {
  return useQuery({
    queryKey: [...adminKeys.courseTeacherAssignment.availableTeachers(courseId), search],
    queryFn: async () => {
      const result = await courseTeacherAssignmentService.getAvailableTeachers(courseId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available teachers.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!courseId,
  });
}

/**
 * Fetch teacher assignment statistics for a course.
 *
 * @param courseId - The `courses.course_id`.
 *
 * Cache key: `['admin', 'courseTeacherAssignment', 'stats', courseId]`
 * Stale time: 2 minutes
 */
export function useCourseTeacherAssignmentStats(courseId: string) {
  return useQuery({
    queryKey: adminKeys.courseTeacherAssignment.stats(courseId),
    queryFn: async () => {
      const result = await courseTeacherAssignmentService.getAssignmentStats(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch teacher assignment statistics.');
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
 * Shared mutation options for invalidating course teacher assignment caches.
 */
function useInvalidateCourseTeacherAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.courseTeacherAssignment.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.courseManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Assign one or more teachers to a course.
 *
 * Accepts `{ courseId: string; teacherIds: string[] }`.
 */
export function useAssignTeachers() {
  const invalidate = useInvalidateCourseTeacherAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      teacherIds,
    }: {
      courseId: string;
      teacherIds: string[];
    }) => courseTeacherAssignmentService.assignTeachers(courseId, teacherIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single teacher from a course.
 *
 * Accepts `{ courseId: string; teacherId: string }`.
 */
export function useRemoveTeacher() {
  const invalidate = useInvalidateCourseTeacherAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      teacherId,
    }: {
      courseId: string;
      teacherId: string;
    }) => courseTeacherAssignmentService.removeTeacher(courseId, teacherId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove multiple teachers from a course.
 *
 * Accepts `{ courseId: string; teacherIds: string[] }`.
 */
export function useRemoveTeachers() {
  const invalidate = useInvalidateCourseTeacherAssignment();

  return useMutation({
    mutationFn: ({
      courseId,
      teacherIds,
    }: {
      courseId: string;
      teacherIds: string[];
    }) => courseTeacherAssignmentService.removeTeachers(courseId, teacherIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
