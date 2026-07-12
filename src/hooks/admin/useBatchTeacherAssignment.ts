/**
 * Batch Teacher Assignment Hooks
 *
 * React Query hooks for the Admin Batch Teacher Assignment module.
 * Follows the exact same pattern as hooks/admin/useBatchStudentAssignment.ts,
 * hooks/admin/useBatchManagement.ts, and hooks/admin/useTeacherLifecycle.ts.
 *
 * ## Exports
 *
 * | Hook                       | Description                                          |
 * |----------------------------|------------------------------------------------------|
 * | `useAssignedTeacher`       | Fetch the teacher assigned to a batch                |
 * | `useAvailableTeachers`     | Fetch teachers available for assignment              |
 * | `useTeacherAssignmentStats`| Fetch teacher assignment statistics                  |
 * | `useAssignTeacher`         | Assign (or replace) a teacher to a batch             |
 * | `useRemoveTeacher`         | Remove the teacher assignment from a batch           |
 *
 * @module hooks/admin/useBatchTeacherAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { batchTeacherAssignmentService } from '@/services/admin/batchTeacherAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the teacher currently assigned to a batch.
 *
 * @param batchId - The `batches.batch_id`.
 *
 * Cache key: `['admin', 'batchTeacherAssignment', 'assigned', batchId]`
 * Stale time: 1 minute
 */
export function useAssignedTeacher(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchTeacherAssignment.assignedTeacher(batchId),
    queryFn: async () => {
      const result = await batchTeacherAssignmentService.getAssignedTeacher(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned teacher.');
      }
      return result.data;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch teachers available for assignment to a batch.
 *
 * @param batchId - The `batches.batch_id` for institute scoping.
 * @param search  - Optional search term (name or faculty ID).
 *
 * Cache key: `['admin', 'batchTeacherAssignment', 'available', batchId, search]`
 * Stale time: 30 seconds
 */
export function useAvailableTeachers(batchId: string, search?: string) {
  return useQuery({
    queryKey: [...adminKeys.batchTeacherAssignment.availableTeachers(batchId), search],
    queryFn: async () => {
      const result = await batchTeacherAssignmentService.getAvailableTeachers(batchId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available teachers.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch teacher assignment statistics.
 *
 * Cache key: `['admin', 'batchTeacherAssignment', 'stats']`
 * Stale time: 2 minutes
 */
export function useTeacherAssignmentStats() {
  return useQuery({
    queryKey: adminKeys.batchTeacherAssignment.stats(),
    queryFn: async () => {
      const result = await batchTeacherAssignmentService.getAssignmentStats();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch teacher assignment statistics.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating batch teacher assignment caches.
 */
function useInvalidateBatchTeacherAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.batchTeacherAssignment.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Assign (or replace) a teacher to a batch.
 *
 * If a teacher is already assigned, the existing assignment is replaced.
 *
 * @returns A mutation that accepts `{ batchId: string; teacherId: string }`.
 */
export function useAssignTeacher() {
  const invalidate = useInvalidateBatchTeacherAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      teacherId,
    }: {
      batchId: string;
      teacherId: string;
    }) => batchTeacherAssignmentService.assignTeacher(batchId, teacherId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove the teacher assignment from a batch.
 *
 * @returns A mutation that accepts `{ batchId: string }`.
 */
export function useRemoveTeacher() {
  const invalidate = useInvalidateBatchTeacherAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
    }: {
      batchId: string;
    }) => batchTeacherAssignmentService.removeTeacher(batchId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
