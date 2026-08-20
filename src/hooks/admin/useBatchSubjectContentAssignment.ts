/**
 * Batch Subject Content Assignment Hooks
 *
 * React Query hooks for the Admin/Teacher Batch Subject Content module.
 * Follows the exact same pattern as hooks/admin/useBatchContentAssignment.ts
 * but operates on `batch_subject_contents` (Migration 068) instead of
 * `batch_contents`.
 *
 * ## Exports
 *
 * | Hook                                    | Description                                           |
 * |-----------------------------------------|-------------------------------------------------------|
 * | `useBatchSubjectContent`                | Fetch content items assigned to a batch subject       |
 * | `useAvailableBatchSubjectContent`       | Fetch content items available for assignment          |
 * | `useBatchSubjectContentStats`           | Fetch content assignment statistics                   |
 * | `useAssignBatchSubjectContent`          | Assign one or more content items to a batch subject   |
 * | `useRemoveBatchSubjectContent`          | Remove a single content item from a batch subject     |
 * | `useRemoveBatchSubjectContents`         | Remove multiple content items from a batch subject    |
 * | `useReorderBatchSubjectContent`         | Reorder content within a batch subject                |
 * | `useUpdateBatchSubjectContentAssignment`| Update assignment metadata (section, optional flag)   |
 * | `useBatchSubjectDetail`                 | Fetch batch subject details with subject info         |
 * | `useBatchSubjects`                      | Fetch all batch subjects for a batch                  |
 *
 * @module hooks/admin/useBatchSubjectContentAssignment
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { batchSubjectContentService } from '@/services/admin/batchSubjectContentService';
import type { AvailableSubject, BatchSubjectWithCounts } from '@/services/admin/batchSubjectContentService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all content items currently assigned to a Batch Subject.
 *
 * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
 */
export function useBatchSubjectContent(batchSubjectId: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectContentAssignment.assignedContent(batchSubjectId),
    queryFn: async () => {
      const result = await batchSubjectContentService.getAssignedContent(batchSubjectId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch assigned content.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchSubjectId,
  });
}

/**
 * Fetch content items available for assignment to a Batch Subject.
 *
 * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
 * @param subjectId      - The subject_id to scope available content.
 * @param search         - Optional search term.
 */
export function useAvailableBatchSubjectContent(
  batchSubjectId: string,
  subjectId: string,
  search?: string,
) {
  return useQuery({
    queryKey: [
      ...adminKeys.batchSubjectContentAssignment.availableContent(batchSubjectId),
      subjectId,
      search,
    ],
    queryFn: async () => {
      const result = await batchSubjectContentService.getAvailableContent(
        batchSubjectId,
        subjectId,
        search,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available content.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!batchSubjectId && !!subjectId,
  });
}

/**
 * Fetch content assignment statistics for a Batch Subject.
 *
 * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
 * @param subjectId      - The subject_id to count available content.
 */
export function useBatchSubjectContentStats(batchSubjectId: string, subjectId: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectContentAssignment.stats(batchSubjectId),
    queryFn: async () => {
      const result = await batchSubjectContentService.getAssignmentStats(
        batchSubjectId,
        subjectId,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch content stats.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!batchSubjectId && !!subjectId,
  });
}

/**
 * Fetch Batch Subject detail with joined subject and batch info.
 *
 * @param batchSubjectId - The `batch_subjects.batch_subject_id`.
 */
export function useBatchSubjectDetail(batchSubjectId: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectContentAssignment.detail(batchSubjectId),
    queryFn: async () => {
      const result = await batchSubjectContentService.getBatchSubjectDetail(batchSubjectId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch subject detail.');
      }
      return result.data!;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!batchSubjectId,
  });
}

/**
 * Fetch all Batch Subjects for a batch.
 *
 * @param batchId - The `batches.batch_id`.
 */
export function useBatchSubjects(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectContentAssignment.subjectsList(batchId),
    queryFn: async () => {
      const result = await batchSubjectContentService.getBatchSubjects(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch batch subjects.');
      }
      return result.data!;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!batchId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating batch subject content caches.
 */
function useInvalidateBatchSubjectContent() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: adminKeys.batchSubjectContentAssignment.all(),
      }),
      queryClient.invalidateQueries({
        queryKey: adminKeys.batchContentAssignment.all(),
      }),
      queryClient.invalidateQueries({ queryKey: adminKeys.batchManagement.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Batch-Level Subject Management Hooks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch subjects available for assignment to a batch (from the batch's stream,
 * excluding subjects already assigned).
 *
 * @param batchId - The `batches.batch_id`.
 */
export function useAvailableSubjects(batchId: string) {
  return useQuery({
    queryKey: adminKeys.batchSubjectAssignment.availableSubjects(batchId),
    queryFn: async () => {
      const result = await batchSubjectContentService.getAvailableSubjects(batchId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available subjects.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!batchId,
  });
}

/**
 * Assign one or more subjects from the stream to a batch.
 *
 * Accepts `{ batchId: string; subjectIds: string[] }`.
 */
export function useAssignSubjectsToBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      batchId,
      subjectIds,
    }: {
      batchId: string;
      subjectIds: string[];
    }) => {
      const result = await batchSubjectContentService.assignSubjectsToBatch(batchId, subjectIds);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to assign subjects to batch.');
      }
      return result;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminKeys.batchSubjectAssignment.all(),
        }),
        queryClient.invalidateQueries({
          queryKey: adminKeys.batchSubjectContentAssignment.all(),
        }),
        queryClient.invalidateQueries({
          queryKey: adminKeys.batchManagement.all(),
        }),
      ]);
    },
  });
}

/**
 * Remove a subject from a batch (with dependency check).
 */
export function useRemoveBatchSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      batchSubjectId,
      force,
    }: {
      batchSubjectId: string;
      force?: boolean;
    }) => {
      const result = await batchSubjectContentService.removeBatchSubject(batchSubjectId, force);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove batch subject.');
      }
      return result;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminKeys.batchSubjectAssignment.all(),
        }),
        queryClient.invalidateQueries({
          queryKey: adminKeys.batchSubjectContentAssignment.all(),
        }),
        queryClient.invalidateQueries({
          queryKey: adminKeys.batchManagement.all(),
        }),
      ]);
    },
  });
}

/**
 * Assign one or more content items to a Batch Subject.
 *
 * Accepts `{ batchSubjectId: string; contentIds: string[]; sectionName?: string }`.
 */
export function useAssignBatchSubjectContent() {
  const invalidate = useInvalidateBatchSubjectContent();

  return useMutation({
    mutationFn: async ({
      batchSubjectId,
      contentIds,
      sectionName,
    }: {
      batchSubjectId: string;
      contentIds: string[];
      sectionName?: string | null;
    }) => {
      const result = await batchSubjectContentService.assignContent(batchSubjectId, contentIds, sectionName);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to assign content.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove a single content item from a Batch Subject.
 *
 * Accepts `{ batchSubjectId: string; contentId: string }`.
 */
export function useRemoveBatchSubjectContent() {
  const invalidate = useInvalidateBatchSubjectContent();

  return useMutation({
    mutationFn: async ({
      batchSubjectId,
      contentId,
    }: {
      batchSubjectId: string;
      contentId: string;
    }) => {
      const result = await batchSubjectContentService.removeContent(batchSubjectId, contentId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove content.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Remove multiple content items from a Batch Subject.
 *
 * Accepts `{ batchSubjectId: string; contentIds: string[] }`.
 */
export function useRemoveBatchSubjectContents() {
  const invalidate = useInvalidateBatchSubjectContent();

  return useMutation({
    mutationFn: async ({
      batchSubjectId,
      contentIds,
    }: {
      batchSubjectId: string;
      contentIds: string[];
    }) => {
      const result = await batchSubjectContentService.removeContents(batchSubjectId, contentIds);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove contents.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Reorder content items within a Batch Subject.
 *
 * Accepts `{ reorderList: ReorderInput[] }`.
 */
export function useReorderBatchSubjectContent() {
  const invalidate = useInvalidateBatchSubjectContent();

  return useMutation({
    mutationFn: async ({
      reorderList,
    }: {
      reorderList: { batchSubjectContentId: string; orderSequence: number }[];
    }) => {
      const result = await batchSubjectContentService.reorderContent(reorderList);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reorder content.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Update a single content assignment's metadata.
 *
 * Accepts `{ batchSubjectContentId: string; updates: { sectionName?, isOptional?, orderSequence? } }`.
 */
export function useUpdateBatchSubjectContentAssignment() {
  const invalidate = useInvalidateBatchSubjectContent();

  return useMutation({
    mutationFn: async ({
      batchSubjectContentId,
      updates,
    }: {
      batchSubjectContentId: string;
      updates: {
        sectionName?: string | null;
        isOptional?: boolean;
        orderSequence?: number;
      };
    }) => {
      const result = await batchSubjectContentService.updateAssignment(batchSubjectContentId, updates);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update content assignment.');
      }
      return result;
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

