/**
 * Teacher Lifecycle Hooks
 *
 * React Query hooks for the Admin Teacher Lifecycle Management module.
 * Follows the same pattern as hooks/admin/useAdminDashboard.ts and
 * hooks/mockTest/useMockTests.ts.
 *
 * ## Exports
 *
 * | Hook                             | Description                              |
 * |----------------------------------|------------------------------------------|
 * | `useTeacherLifecycleCounts`      | Dashboard counts by account_status       |
 * | `useTeacherList`                 | Paginated, filtered teacher list         |
 * | `useTeacherDetail`               | Single teacher full profile              |
 * | `useTeacherStats`                | Statistics (by department, status, new)  |
 * | `useApproveTeacher`              | Approve a pending teacher                |
 * | `useRejectTeacher`               | Reject a pending teacher                 |
 * | `useSuspendTeacher`              | Suspend an active teacher                |
 * | `useActivateTeacher`             | Activate a suspended/inactive teacher    |
 * | `useDeactivateTeacher`           | Deactivate an active teacher             |
 * | `useBulkApproveTeachers`         | Bulk-approve selected teachers           |
 * | `useBulkRejectTeachers`          | Bulk-reject selected teachers            |
 * | `useBulkSuspendTeachers`         | Bulk-suspend selected teachers           |
 * | `useBulkActivateTeachers`        | Bulk-activate selected teachers          |
 *
 * @module hooks/admin/useTeacherLifecycle
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { teacherLifecycleService } from '@/services/admin/teacherLifecycleService';
import type { TeacherListFilters, TeacherListSortOptions } from '@/services/admin/teacherLifecycleService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch teacher lifecycle dashboard counts (pending, approved, etc.).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'teacherLifecycle', 'counts', instituteId]`
 * Stale time: 2 minutes (counts change when admins approve/reject)
 */
export function useTeacherLifecycleCounts(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.teacherLifecycle.counts(), instituteId],
    queryFn: async () => {
      const result = await teacherLifecycleService.getCounts(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch teacher lifecycle counts.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch a paginated, filtered, and sorted list of teachers.
 *
 * @param filters    - Optional filter criteria (status, department, search).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * Cache key: `['admin', 'teacherLifecycle', 'list', filters, pagination]`
 * Stale time: 1 minute (teacher list changes frequently during approval sessions)
 */
export function useTeacherList(
  filters?: TeacherListFilters,
  sort?: TeacherListSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.teacherLifecycle.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await teacherLifecycleService.getList(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch teacher list.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Fetch the full profile details for a single teacher.
 *
 * @param profileId - The `profiles.profile_id` of the teacher.
 *
 * Cache key: `['admin', 'teacherLifecycle', 'detail', profileId]`
 * Stale time: 1 minute
 */
export function useTeacherDetail(profileId: string) {
  return useQuery({
    queryKey: adminKeys.teacherLifecycle.detail(profileId),
    queryFn: async () => {
      const result = await teacherLifecycleService.getDetail(profileId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch teacher details.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!profileId,
  });
}

/**
 * Fetch teacher management statistics (by department, by status, newest).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'teacherLifecycle', 'stats', instituteId]`
 * Stale time: 5 minutes (statistics change infrequently)
 */
export function useTeacherStats(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.teacherLifecycle.stats(), instituteId],
    queryFn: async () => {
      const result = await teacherLifecycleService.getStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch teacher statistics.');
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
 * Shared mutation options for invalidating teacher lifecycle caches.
 */
function useInvalidateTeacherLifecycle() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.teacherLifecycle.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Approve a pending teacher (pending → approved).
 */
export function useApproveTeacher() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => teacherLifecycleService.approve(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Reject a pending teacher (pending → rejected).
 */
export function useRejectTeacher() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => teacherLifecycleService.reject(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Suspend an active teacher (approved → suspended).
 */
export function useSuspendTeacher() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => teacherLifecycleService.suspend(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Activate a suspended or inactive teacher → approved.
 */
export function useActivateTeacher() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => teacherLifecycleService.activate(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Deactivate an active teacher (approved → inactive).
 */
export function useDeactivateTeacher() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => teacherLifecycleService.deactivate(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-approve selected teachers.
 */
export function useBulkApproveTeachers() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => teacherLifecycleService.bulkApprove(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-reject selected teachers.
 */
export function useBulkRejectTeachers() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => teacherLifecycleService.bulkReject(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-suspend selected teachers.
 */
export function useBulkSuspendTeachers() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => teacherLifecycleService.bulkSuspend(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-activate (set to approved) selected teachers.
 */
export function useBulkActivateTeachers() {
  const invalidate = useInvalidateTeacherLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => teacherLifecycleService.bulkActivate(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
