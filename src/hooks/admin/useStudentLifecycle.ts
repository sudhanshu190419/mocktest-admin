/**
 * Student Lifecycle Hooks
 *
 * React Query hooks for the Admin Student Lifecycle Management module.
 * Follows the exact same pattern as hooks/admin/useTeacherLifecycle.ts.
 *
 * ## Exports
 *
 * | Hook                             | Description                              |
 * |----------------------------------|------------------------------------------|
 * | `useStudentLifecycleCounts`      | Dashboard counts by account_status       |
 * | `useStudentList`                 | Paginated, filtered student list         |
 * | `useStudentDetail`               | Single student full profile              |
 * | `useStudentStats`                | Statistics (by status, target year, new) |
 * | `useApproveStudent`              | Approve a pending student                |
 * | `useRejectStudent`               | Reject a pending student                 |
 * | `useSuspendStudent`              | Suspend an active student                |
 * | `useActivateStudent`             | Activate a suspended/inactive student    |
 * | `useDeactivateStudent`           | Deactivate an active student             |
 * | `useBulkApproveStudents`         | Bulk-approve selected students           |
 * | `useBulkRejectStudents`          | Bulk-reject selected students            |
 * | `useBulkSuspendStudents`         | Bulk-suspend selected students           |
 * | `useBulkActivateStudents`        | Bulk-activate selected students          |
 *
 * @module hooks/admin/useStudentLifecycle
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { studentLifecycleService } from '@/services/admin/studentLifecycleService';
import type { StudentListFilters, StudentListSortOptions } from '@/services/admin/studentLifecycleService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch student lifecycle dashboard counts (pending, approved, etc.).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'studentLifecycle', 'counts', instituteId]`
 * Stale time: 2 minutes (counts change when admins approve/reject)
 */
export function useStudentLifecycleCounts(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.studentLifecycle.counts(), instituteId],
    queryFn: async () => {
      const result = await studentLifecycleService.getCounts(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student lifecycle counts.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch a paginated, filtered, and sorted list of students.
 *
 * @param filters    - Optional filter criteria (status, batchId, search).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * Cache key: `['admin', 'studentLifecycle', 'list', filters, pagination]`
 * Stale time: 1 minute
 */
export function useStudentList(
  filters?: StudentListFilters,
  sort?: StudentListSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.studentLifecycle.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await studentLifecycleService.getList(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student list.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Fetch the full profile details for a single student.
 *
 * @param profileId - The `profiles.profile_id` of the student.
 *
 * Cache key: `['admin', 'studentLifecycle', 'detail', profileId]`
 * Stale time: 1 minute
 */
export function useStudentDetail(profileId: string) {
  return useQuery({
    queryKey: adminKeys.studentLifecycle.detail(profileId),
    queryFn: async () => {
      const result = await studentLifecycleService.getDetail(profileId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student details.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!profileId,
  });
}

/**
 * Fetch student management statistics (by status, by target year, newest).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'studentLifecycle', 'stats', instituteId]`
 * Stale time: 5 minutes
 */
export function useStudentStats(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.studentLifecycle.stats(), instituteId],
    queryFn: async () => {
      const result = await studentLifecycleService.getStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student statistics.');
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
 * Shared mutation options for invalidating student lifecycle caches.
 */
function useInvalidateStudentLifecycle() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.studentLifecycle.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Approve a pending student (pending → approved).
 */
export function useApproveStudent() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => studentLifecycleService.approve(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Reject a pending student (pending → rejected).
 */
export function useRejectStudent() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => studentLifecycleService.reject(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Suspend an active student (approved → suspended).
 */
export function useSuspendStudent() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => studentLifecycleService.suspend(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Activate a suspended or inactive student → approved.
 */
export function useActivateStudent() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => studentLifecycleService.activate(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Deactivate an active student (approved → inactive).
 */
export function useDeactivateStudent() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileId: string) => studentLifecycleService.deactivate(profileId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-approve selected students.
 */
export function useBulkApproveStudents() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => studentLifecycleService.bulkApprove(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-reject selected students.
 */
export function useBulkRejectStudents() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => studentLifecycleService.bulkReject(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-suspend selected students.
 */
export function useBulkSuspendStudents() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => studentLifecycleService.bulkSuspend(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-activate (set to approved) selected students.
 */
export function useBulkActivateStudents() {
  const invalidate = useInvalidateStudentLifecycle();

  return useMutation({
    mutationFn: (profileIds: string[]) => studentLifecycleService.bulkActivate(profileIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
