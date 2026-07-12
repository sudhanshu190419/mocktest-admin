/**
 * Batch Student Assignment Hooks
 *
 * React Query hooks for the Admin Batch Student Assignment module.
 * Follows the exact same pattern as hooks/admin/useBatchManagement.ts,
 * hooks/admin/useTeacherLifecycle.ts, and hooks/admin/useMockTestManagement.ts.
 *
 * ## Exports
 *
 * | Hook                          | Description                                  |
 * |-------------------------------|----------------------------------------------|
 * | `useAssignedStudents`         | Fetch students assigned to a batch           |
 * | `useAvailableStudents`        | Fetch students available for assignment      |
 * | `useBatchAssignmentStats`     | Fetch assignment statistics for a batch      |
 * | `useAssignStudents`           | Assign multiple students to a batch          |
 * | `useRemoveStudent`            | Remove a single student from a batch         |
 * | `useRemoveStudents`           | Bulk-remove students from a batch            |
 *
 * @module hooks/admin/useBatchStudentAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { batchStudentAssignmentService } from '@/services/admin/batchStudentAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all students assigned to a batch.
 *
 * @param batchId - The `batches.batch_id`.
 *
 * Cache key: `['admin', 'batchStudentAssignment', 'assigned', batchId]`
 * Stale time: 1 minute
 */
export function useAssignedStudents(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchStudentAssignment.assignedList(batchId),
    queryFn: async () => {
      const result = await batchStudentAssignmentService.getAssignedStudents(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned students.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch students available for assignment to a batch.
 *
 * @param batchId - The `batches.batch_id`.
 * @param search  - Optional search term (name or enrollment number).
 *
 * Cache key: `['admin', 'batchStudentAssignment', 'available', batchId, search]`
 * Stale time: 30 seconds (available list changes when assignments are made)
 */
export function useAvailableStudents(batchId: string, search?: string) {
  return useQuery({
    queryKey: [...adminKeys.batchStudentAssignment.availableList(batchId), search],
    queryFn: async () => {
      const result = await batchStudentAssignmentService.getAvailableStudents(batchId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available students.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch assignment statistics for a batch.
 *
 * @param batchId - The `batches.batch_id`.
 *
 * Cache key: `['admin', 'batchStudentAssignment', 'stats', batchId]`
 * Stale time: 1 minute
 */
export function useBatchAssignmentStats(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchStudentAssignment.statsList(batchId),
    queryFn: async () => {
      const result = await batchStudentAssignmentService.getAssignmentStats(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch assignment statistics.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating batch student assignment caches.
 */
function useInvalidateBatchStudentAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.batchStudentAssignment.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Assign multiple students to a batch.
 *
 * @returns A mutation that accepts `{ batchId: string; studentIds: string[] }`.
 */
export function useAssignStudents() {
  const invalidate = useInvalidateBatchStudentAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      studentIds,
    }: {
      batchId: string;
      studentIds: string[];
    }) => batchStudentAssignmentService.assignStudents(batchId, studentIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single student from a batch.
 *
 * @returns A mutation that accepts `{ batchId: string; studentId: string }`.
 */
export function useRemoveStudent() {
  const invalidate = useInvalidateBatchStudentAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      studentId,
    }: {
      batchId: string;
      studentId: string;
    }) => batchStudentAssignmentService.removeStudent(batchId, studentId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-remove multiple students from a batch.
 *
 * @returns A mutation that accepts `{ batchId: string; studentIds: string[] }`.
 */
export function useRemoveStudents() {
  const invalidate = useInvalidateBatchStudentAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      studentIds,
    }: {
      batchId: string;
      studentIds: string[];
    }) => batchStudentAssignmentService.removeStudents(batchId, studentIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
