/**
 * Mock Test Assignment Hooks
 *
 * React Query hooks for the Admin Mock Test Assignment module.
 * Follows the exact same pattern as hooks/admin/useBatchStudentAssignment.ts
 * and hooks/admin/useBatchTeacherAssignment.ts.
 *
 * ## Exports
 *
 * | Hook                          | Description                                         |
 * |-------------------------------|-----------------------------------------------------|
 * | `useAssignedMockTests`        | Fetch mock tests assigned to a batch                |
 * | `useAvailableMockTests`       | Fetch published mock tests available for assignment |
 * | `useMockTestAssignmentStats`  | Fetch assignment statistics for a batch             |
 * | `useAssignMockTests`          | Assign multiple mock tests to a batch               |
 * | `useRemoveMockTest`           | Remove a single mock test assignment                |
 * | `useRemoveMockTests`          | Bulk-remove mock test assignments                   |
 * | `useUpdateMockTestAssignment` | Update an assignment's config                       |
 *
 * @module hooks/admin/useMockTestAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { mockTestAssignmentService } from '@/services/admin/mockTestAssignmentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all mock tests assigned to a batch.
 *
 * @param batchId - The `batches.batch_id`.
 */
export function useAssignedMockTests(batchId: string) {
  return useQuery({
    queryKey: adminKeys.mockTestAssignment.assignedTests(batchId),
    queryFn: async () => {
      const result = await mockTestAssignmentService.getAssignedMockTests(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned mock tests.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch published mock tests available for assignment to a batch.
 *
 * @param batchId - The `batches.batch_id`.
 * @param search  - Optional search term (title or subject).
 */
export function useAvailableMockTests(batchId: string, search?: string) {
  return useQuery({
    queryKey: [...adminKeys.mockTestAssignment.availableTests(batchId), search],
    queryFn: async () => {
      const result = await mockTestAssignmentService.getAvailableMockTests(batchId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available mock tests.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Fetch mock test assignment statistics for a batch.
 *
 * @param batchId - The `batches.batch_id`.
 */
export function useMockTestAssignmentStats(batchId: string) {
  return useQuery({
    queryKey: adminKeys.mockTestAssignment.stats(batchId),
    queryFn: async () => {
      const result = await mockTestAssignmentService.getAssignmentStats(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test assignment statistics.');
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
 * Shared mutation options for invalidating mock test assignment caches.
 */
function useInvalidateMockTestAssignment() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.mockTestAssignment.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Assign multiple mock tests to a batch.
 *
 * @returns A mutation that accepts `{ batchId, testIds, options? }`.
 */
export function useAssignMockTests() {
  const invalidate = useInvalidateMockTestAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      testIds,
      options,
    }: {
      batchId: string;
      testIds: string[];
      options?: {
        availableFrom?: string | null;
        availableUntil?: string | null;
        attemptLimit?: number | null;
      };
    }) => mockTestAssignmentService.assignMockTests(batchId, testIds, options),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single mock test assignment from a batch.
 *
 * @returns A mutation that accepts `{ batchId, assignmentId }`.
 */
export function useRemoveMockTest() {
  const invalidate = useInvalidateMockTestAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      assignmentId,
    }: {
      batchId: string;
      assignmentId: string;
    }) => mockTestAssignmentService.removeMockTest(batchId, assignmentId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-remove multiple mock test assignments from a batch.
 *
 * @returns A mutation that accepts `{ batchId, assignmentIds }`.
 */
export function useRemoveMockTests() {
  const invalidate = useInvalidateMockTestAssignment();

  return useMutation({
    mutationFn: ({
      batchId,
      assignmentIds,
    }: {
      batchId: string;
      assignmentIds: string[];
    }) => mockTestAssignmentService.removeMockTests(batchId, assignmentIds),
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
export function useUpdateMockTestAssignment() {
  const invalidate = useInvalidateMockTestAssignment();

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
    }) => mockTestAssignmentService.updateAssignment(assignmentId, input),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
