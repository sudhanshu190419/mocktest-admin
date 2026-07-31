/**
 * Batch Subject Teacher Assignment Hooks
 *
 * React Query hooks for the Admin Batch Subject Teacher Assignment module.
 * Uses the new `batchSubjectTeacherAssignmentService` which manages
 * `batch_subject_teachers` (not the deprecated `batch_teachers`).
 *
 * ## Exports
 *
 * | Hook                                    | Description                                          |
 * |-----------------------------------------|------------------------------------------------------|
 * | `useBatchSubjectTeacherSummary`         | Fetch all batch subjects with their teachers         |
 * | `useBSTAvailableTeachers`               | Fetch teachers available for assignment               |
 * | `useBSTAssignTeacher`                   | Assign a teacher to a batch subject                   |
 * | `useBSTRemoveTeacher`                   | Remove a teacher from a batch subject                 |
 *
 * @module hooks/admin/useBatchSubjectTeacherAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { batchSubjectTeacherAssignmentService } from '@/services/admin/batchSubjectTeacherAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all batch subjects within a batch, with their assigned teachers.
 *
 * @param batchId  - The `batches.batch_id`.
 * @param instituteId - The `institutes.institute_id` for scoping.
 *
 * Cache key: `['admin', 'batchSubjectTeacherAssignment', 'summary', batchId]`
 * Stale time: 30 seconds (teachers change frequently during assignment flow)
 */
export function useBatchSubjectTeacherSummary(batchId: string, instituteId?: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectTeacherAssignment.batchSummary(batchId),
    queryFn: async () => {
      const result = await batchSubjectTeacherAssignmentService.getBatchTeacherSummary(
        batchId,
        instituteId ?? '',
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch subject teacher summary.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!batchId && !!instituteId,
  });
}

/**
 * Fetch teachers available for assignment.
 *
 * @param instituteId - The institute to scope the search.
 * @param search      - Optional search term (name or faculty ID).
 *
 * Cache key: `['admin', 'batchSubjectTeacherAssignment', 'available', instituteId, search]`
 * Stale time: 30 seconds
 */
export function useBSTAvailableTeachers(instituteId: string, search?: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectTeacherAssignment.availableTeachers(instituteId, search),
    queryFn: async () => {
      const result = await batchSubjectTeacherAssignmentService.getAvailableTeachers(
        instituteId,
        search,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available teachers.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!instituteId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating batch subject teacher caches.
 */
function useInvalidateBSTAssignment(batchId?: string) {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminKeys.batchSubjectTeacherAssignment.all(),
      }),
      ...(batchId
        ? [
            queryClient.invalidateQueries({
              queryKey: adminKeys.batchSubjectTeacherAssignment.batchSummary(batchId),
            }),
          ]
        : []),
      queryClient.invalidateQueries({
        queryKey: adminKeys.batchManagement.all(),
      }),
    ]);
  };
}

/**
 * Assign a teacher to a batch subject.
 *
 * A Batch Subject can have multiple teachers — this adds one.
 *
 * @returns A mutation that accepts `{ batchSubjectId: string; teacherId: string; batchId?: string }`.
 */
export function useBSTAssignTeacher(batchId?: string) {
  const invalidate = useInvalidateBSTAssignment(batchId);

  return useMutation({
    mutationFn: ({
      batchSubjectId,
      teacherId,
    }: {
      batchSubjectId: string;
      teacherId: string;
    }) =>
      batchSubjectTeacherAssignmentService.assignTeacher(batchSubjectId, teacherId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a teacher from a batch subject.
 *
 * Only this specific assignment is removed.
 *
 * @returns A mutation that accepts `{ batchSubjectId: string; teacherId: string; batchId?: string }`.
 */
export function useBSTRemoveTeacher(batchId?: string) {
  const invalidate = useInvalidateBSTAssignment(batchId);

  return useMutation({
    mutationFn: ({
      batchSubjectId,
      teacherId,
    }: {
      batchSubjectId: string;
      teacherId: string;
    }) =>
      batchSubjectTeacherAssignmentService.removeTeacher(batchSubjectId, teacherId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
