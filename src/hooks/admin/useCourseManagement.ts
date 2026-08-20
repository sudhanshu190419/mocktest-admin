/**
 * Course Management Hooks
 *
 * React Query hooks for the Admin Course Management module.
 * Follows the exact same pattern as hooks/admin/useBatchManagement.ts,
 * hooks/admin/useMockTestManagement.ts, hooks/admin/useTeacherLifecycle.ts,
 * and hooks/admin/useStudentLifecycle.ts.
 *
 * ## Exports
 *
 * | Hook                            | Description                              |
 * |---------------------------------|------------------------------------------|
 * | `useCourseManagementCounts`     | Dashboard counts by course status        |
 * | `useCourseList`                 | Paginated, filtered course list          |
 * | `useCourseDetail`               | Single course full detail                |
 * | `useCourseStats`                | Statistics (by stream, status, etc.)     |
 * | `useCreateCourse`               | Create a new course                      |
 * | `useUpdateCourse`               | Update an existing course                |
 * | `usePublishCourse`              | Publish a course                         |
 * | `useArchiveCourse`              | Archive a published course               |
 * | `useRestoreCourse`              | Restore an archived course               |
 * | `useDeleteCourse`               | Delete a course (soft-delete)            |
 *
 * @module hooks/admin/useCourseManagement
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { courseManagementService } from '@/services/admin/courseManagementService';
import type { CourseManagementFilters, CourseManagementSortOptions } from '@/services/admin/courseManagementService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch course management dashboard counts (draft, pendingApproval, approved, published, archived).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'courseManagement', 'counts', instituteId]`
 * Stale time: 2 minutes (counts change when admins create/publish/archive courses)
 */
export function useCourseManagementCounts(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.courseManagement.counts(), instituteId],
    queryFn: async () => {
      const result = await courseManagementService.getCounts(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch course management counts.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch a paginated, filtered, and sorted list of courses.
 *
 * @param filters    - Optional filter criteria (status, streamId, teacherId, search, featured, trending).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * Cache key: `['admin', 'courseManagement', 'list', filters, pagination]`
 * Stale time: 1 minute
 */
export function useCourseList(
  filters?: CourseManagementFilters,
  sort?: CourseManagementSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.courseManagement.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await courseManagementService.getList(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch course list.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Fetch the full details for a single course.
 *
 * @param courseId - The `courses.course_id`.
 *
 * Cache key: `['admin', 'courseManagement', 'detail', courseId]`
 * Stale time: 1 minute
 */
export function useCourseDetail(courseId: string) {
  return useQuery({
    queryKey: adminKeys.courseManagement.detail(courseId),
    queryFn: async () => {
      const result = await courseManagementService.getDetail(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch course details.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!courseId,
  });
}

/**
 * Fetch course management statistics (by stream, by status, newest, most enrolled, pricing).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'courseManagement', 'stats', instituteId]`
 * Stale time: 5 minutes (statistics change infrequently)
 */
export function useCourseStats(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.courseManagement.stats(), instituteId],
    queryFn: async () => {
      const result = await courseManagementService.getStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch course statistics.');
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
 * Shared mutation options for invalidating course management caches.
 */
function useInvalidateCourseManagement() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.courseManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Create a new course.
 */
export function useCreateCourse() {
  const invalidate = useInvalidateCourseManagement();

  return useMutation({
    mutationFn: async (input: import('@/services/admin/courseManagementService').CreateCourseInput) => {
      const result = await courseManagementService.createCourse(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create course.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Update an existing course.
 */
export function useUpdateCourse() {
  const invalidate = useInvalidateCourseManagement();

  return useMutation({
    mutationFn: async ({
      courseId,
      input,
    }: {
      courseId: string;
      input: import('@/services/admin/courseManagementService').UpdateCourseInput;
    }) => {
      const result = await courseManagementService.updateCourse(courseId, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update course.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Publish a course (draft/pending_approval/approved → published).
 */
export function usePublishCourse() {
  const invalidate = useInvalidateCourseManagement();

  return useMutation({
    mutationFn: async (courseId: string) => {
      const result = await courseManagementService.publish(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish course.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Archive a published course (published → archived).
 */
export function useArchiveCourse() {
  const invalidate = useInvalidateCourseManagement();

  return useMutation({
    mutationFn: async (courseId: string) => {
      const result = await courseManagementService.archive(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive course.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Restore an archived course (archived → published).
 */
export function useRestoreCourse() {
  const invalidate = useInvalidateCourseManagement();

  return useMutation({
    mutationFn: async (courseId: string) => {
      const result = await courseManagementService.restore(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to restore course.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Delete a course (soft-delete).
 * Only succeeds when no active enrollments or assigned content exist.
 */
export function useDeleteCourse() {
  const invalidate = useInvalidateCourseManagement();

  return useMutation({
    mutationFn: async (courseId: string) => {
      const result = await courseManagementService.delete(courseId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete course.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}
