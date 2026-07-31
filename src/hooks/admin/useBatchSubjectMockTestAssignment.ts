/**
 * Batch Subject Mock Test Assignment Hooks
 *
 * React Query hooks for the Admin Batch Subject Mock Test Assignment module.
 * Follows the exact same pattern as hooks/admin/useMockTestAssignment.ts
 * and hooks/admin/useBatchSubjectContentAssignment.ts.
 *
 * ## Exports
 *
 * | Hook                                   | Description                                              |
 * |----------------------------------------|----------------------------------------------------------|
 * | `useBSAssignedMockTests`               | Fetch mock tests assigned to a batch subject             |
 * | `useBSAvailableMockTests`              | Fetch published mock tests available for assignment      |
 * | `useBSMockTestAssignmentStats`         | Fetch assignment statistics for a batch subject          |
 * | `useBSAssignMockTests`                 | Assign multiple mock tests to a batch subject            |
 * | `useBSRemoveMockTest`                  | Remove a single mock test assignment                     |
 * | `useBSRemoveMockTests`                 | Bulk-remove mock test assignments                        |
 * | `useBSUpdateMockTestAssignment`        | Update an assignment's config                            |
 *
 * @module hooks/admin/useBatchSubjectMockTestAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { batchSubjectMockTestService } from '@/services/admin/batchSubjectMockTestService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all mock tests assigned to a Batch Subject.
 *
 * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
 */
export function useBSAssignedMockTests(batchSubjectId: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectMockTestAssignment.assignedTests(batchSubjectId),
    queryFn: async () => {
      const result = await batchSubjectMockTestService.getAssignedMockTests(batchSubjectId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned mock tests.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchSubjectId,
  });
}

/**
 * Fetch published mock tests available for assignment to a Batch Subject.
 *
 * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
 * @param subjectId      - The subject_id to scope available tests.
 * @param search         - Optional search term (title or subject).
 */
export function useBSAvailableMockTests(
  batchSubjectId: string,
  subjectId: string,
  search?: string,
) {
  return useQuery({
    queryKey: [...adminKeys.batchSubjectMockTestAssignment.availableTests(batchSubjectId), subjectId, search],
    queryFn: async () => {
      const result = await batchSubjectMockTestService.getAvailableMockTests(
        batchSubjectId,
        subjectId,
        search,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available mock tests.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!batchSubjectId && !!subjectId,
  });
}

/**
 * Fetch mock test assignment statistics for a Batch Subject.
 *
 * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
 */
export function useBSMockTestAssignmentStats(batchSubjectId: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectMockTestAssignment.stats(batchSubjectId),
    queryFn: async () => {
      const result = await batchSubjectMockTestService.getAssignmentStats(batchSubjectId);
      if (!result.success) {
        throw new Error(
          result.error ?? 'Failed to fetch mock test assignment statistics.',
        );
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchSubjectId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating batch subject mock test caches.
 */
function useInvalidateBSMockTestAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminKeys.batchSubjectMockTestAssignment.all(),
      }),
      queryClient.invalidateQueries({
        queryKey: adminKeys.batchManagement.all(),
      }),
      queryClient.invalidateQueries({
        queryKey: adminKeys.dashboard.all(),
      }),
    ]);
  };
}

/**
 * Assign multiple mock tests to a Batch Subject.
 *
 * @returns A mutation that accepts `{ batchSubjectId, testIds, options? }`.
 */
export function useBSAssignMockTests() {
  const invalidate = useInvalidateBSMockTestAssignment();

  return useMutation({
    mutationFn: ({
      batchSubjectId,
      testIds,
      options,
    }: {
      batchSubjectId: string;
      testIds: string[];
      options?: {
        availableFrom?: string | null;
        availableUntil?: string | null;
        attemptLimit?: number | null;
      };
    }) =>
      batchSubjectMockTestService.assignMockTests(batchSubjectId, testIds, options),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single mock test assignment from a Batch Subject.
 *
 * @returns A mutation that accepts `{ batchSubjectId, assignmentId }`.
 */
export function useBSRemoveMockTest() {
  const invalidate = useInvalidateBSMockTestAssignment();

  return useMutation({
    mutationFn: ({
      batchSubjectId,
      assignmentId,
    }: {
      batchSubjectId: string;
      assignmentId: string;
    }) => batchSubjectMockTestService.removeMockTest(batchSubjectId, assignmentId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-remove multiple mock test assignments from a Batch Subject.
 *
 * @returns A mutation that accepts `{ batchSubjectId, assignmentIds }`.
 */
export function useBSRemoveMockTests() {
  const invalidate = useInvalidateBSMockTestAssignment();

  return useMutation({
    mutationFn: ({
      batchSubjectId,
      assignmentIds,
    }: {
      batchSubjectId: string;
      assignmentIds: string[];
    }) => batchSubjectMockTestService.removeMockTests(batchSubjectId, assignmentIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Update an existing assignment's configuration.
 *
 * @returns A mutation that accepts `{ assignmentId, input }`.
 */
export function useBSUpdateMockTestAssignment() {
  const invalidate = useInvalidateBSMockTestAssignment();

  return useMutation({
    mutationFn: ({
      assignmentId,
      input,
    }: {
      assignmentId: string;
      input: {
        availableFrom?: string | null;
        availableUntil?: string | null;
        attemptLimit?: number | null;
      };
    }) => batchSubjectMockTestService.updateAssignment(assignmentId, input),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
