/**
 * Question Approval Hooks
 *
 * React Query hooks for the Admin Question Approval module.
 * Follows the exact same pattern as hooks/admin/useTeacherLifecycle.ts
 * and hooks/admin/useStudentLifecycle.ts.
 *
 * ## Exports
 *
 * | Hook                              | Description                                |
 * |-----------------------------------|--------------------------------------------|
 * | `useQuestionApprovalCounts`       | Dashboard counts by question status        |
 * | `useQuestionApprovalList`         | Paginated, filtered question list          |
 * | `useQuestionApprovalDetail`       | Single question full detail                |
 * | `useQuestionApprovalStats`        | Statistics (by subject, pending, recent)   |
 * | `useApproveQuestion`              | Approve a pending question                 |
 * | `useRejectQuestion`               | Reject a pending question                  |
 * | `usePublishQuestion`              | Publish a pending question (alias approve) |
 * | `useArchiveQuestion`              | Archive a published question               |
 * | `useBulkApproveQuestions`         | Bulk-approve selected questions            |
 * | `useBulkRejectQuestions`          | Bulk-reject selected questions             |
 * | `useBulkPublishQuestions`         | Bulk-publish selected questions            |
 * | `useBulkArchiveQuestions`         | Bulk-archive selected questions            |
 *
 * @module hooks/admin/useQuestionApproval
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { questionApprovalService } from '@/services/admin/questionApprovalService';
import type { QuestionApprovalListFilters, QuestionApprovalListSortOptions } from '@/services/admin/questionApprovalService';
import type { PaginationParams } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch question approval dashboard counts (pendingApproval, approved, etc.).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'questionApproval', 'counts', instituteId]`
 * Stale time: 2 minutes (counts change when admins approve/reject)
 */
export function useQuestionApprovalCounts(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.questionApproval.counts(), instituteId],
    queryFn: async () => {
      const result = await questionApprovalService.getCounts(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question approval counts.');
      }
      return result.data!;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch a paginated, filtered, and sorted list of questions for approval.
 *
 * @param filters    - Optional filter criteria (status, subjectId, chapterId, search).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * Cache key: `['admin', 'questionApproval', 'list', filters, pagination]`
 * Stale time: 1 minute
 */
export function useQuestionApprovalList(
  filters?: QuestionApprovalListFilters,
  sort?: QuestionApprovalListSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery({
    queryKey: adminKeys.questionApproval.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await questionApprovalService.getList(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question approval list.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
  });
}

/**
 * Fetch the full question detail for a single question in the approval review view.
 *
 * @param questionId - The `questions.question_id` of the question.
 *
 * Cache key: `['admin', 'questionApproval', 'detail', questionId]`
 * Stale time: 1 minute
 */
export function useQuestionApprovalDetail(questionId: string) {
  return useQuery({
    queryKey: adminKeys.questionApproval.detail(questionId),
    queryFn: async () => {
      const result = await questionApprovalService.getDetail(questionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question approval details.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!questionId,
  });
}

/**
 * Fetch question approval statistics (by subject, pending by subject, recent).
 *
 * @param instituteId - Optional institute scope.
 *
 * Cache key: `['admin', 'questionApproval', 'stats', instituteId]`
 * Stale time: 5 minutes (statistics change infrequently)
 */
export function useQuestionApprovalStats(instituteId?: string | null) {
  return useQuery({
    queryKey: [...adminKeys.questionApproval.stats(), instituteId],
    queryFn: async () => {
      const result = await questionApprovalService.getStats(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question approval statistics.');
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
 * Shared mutation options for invalidating question approval caches.
 */
function useInvalidateQuestionApproval() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.questionApproval.all() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
    ]);
  };
}

/**
 * Approve a pending question (pending_approval → published).
 *
 * @param approvedBy - Optional admin profile ID to record as the approver.
 */
export function useApproveQuestion() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: ({ questionId, approvedBy }: { questionId: string; approvedBy?: string | null }) =>
      questionApprovalService.approve(questionId, approvedBy),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Reject a pending question (pending_approval → draft).
 */
export function useRejectQuestion() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: (questionId: string) => questionApprovalService.reject(questionId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Publish a pending question (pending_approval → published).
 *
 * Alias for useApproveQuestion with a separate mutation for semantic clarity.
 *
 * @param approvedBy - Optional admin profile ID to record as the approver.
 */
export function usePublishQuestion() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: ({ questionId, approvedBy }: { questionId: string; approvedBy?: string | null }) =>
      questionApprovalService.publish(questionId, approvedBy),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Archive a published question (published → archived).
 */
export function useArchiveQuestion() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: (questionId: string) => questionApprovalService.archive(questionId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-approve selected questions (pending_approval → published).
 */
export function useBulkApproveQuestions() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: ({ questionIds, approvedBy }: { questionIds: string[]; approvedBy?: string | null }) =>
      questionApprovalService.bulkApprove(questionIds, approvedBy),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-reject selected questions (pending_approval → draft).
 */
export function useBulkRejectQuestions() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: (questionIds: string[]) => questionApprovalService.bulkReject(questionIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-publish selected questions (pending_approval → published).
 */
export function useBulkPublishQuestions() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: ({ questionIds, approvedBy }: { questionIds: string[]; approvedBy?: string | null }) =>
      questionApprovalService.bulkPublish(questionIds, approvedBy),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Bulk-archive selected questions (published → archived).
 */
export function useBulkArchiveQuestions() {
  const invalidate = useInvalidateQuestionApproval();

  return useMutation({
    mutationFn: (questionIds: string[]) => questionApprovalService.bulkArchive(questionIds),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
