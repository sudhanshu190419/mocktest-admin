/**
 * Teacher Evaluation Hooks
 *
 * React Query hooks for the manual subjective evaluation workflow.
 * Wraps manualEvaluationService methods with cache management.
 *
 * @module hooks/teacher/useEvaluation
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as manualEvaluationService from '@/services/evaluation/manualEvaluationService';
import type { PendingEvaluationItem, EvaluationInput, FinalizeInput } from '@/services/evaluation/manualEvaluationService';
import type { PaginatedResponse, PaginationParams } from '@/types/academic';

// ─── Query Keys ────────────────────────────────────────────────────────────

export const evaluationKeys = {
  all: () => ['teacher-evaluation'] as const,
  lists: () => [...evaluationKeys.all(), 'list'] as const,
  list: (page: number) => [...evaluationKeys.lists(), { page }] as const,
  details: () => [...evaluationKeys.all(), 'detail'] as const,
  detail: (attemptId: string) => [...evaluationKeys.details(), attemptId] as const,
};

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * Fetch all subjective answers for a specific attempt.
 * Returns both pending and already-evaluated items.
 */
export function useAttemptSubjectiveAnswers(attemptId: string | undefined | null) {
  return useQuery<PendingEvaluationItem[]>({
    queryKey: evaluationKeys.detail(attemptId ?? ''),
    queryFn: async () => {
      const result = await manualEvaluationService.getAttemptSubjectiveAnswers(attemptId as string);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch attempt answers.');
      }
      return result.data!;
    },
    enabled: !!attemptId,
  });
}

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * Fetch pending subjective evaluations with pagination.
 */
export function usePendingEvaluations(pagination?: PaginationParams) {
  return useQuery<PaginatedResponse<PendingEvaluationItem>>({
    queryKey: evaluationKeys.list(pagination?.page ?? 1),
    queryFn: async () => {
      const result = await manualEvaluationService.getPendingEvaluations(pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch pending evaluations.');
      }
      return result.data!;
    },
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────

/**
 * Save evaluation for one subjective answer.
 */
export function useSaveEvaluation(attemptId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EvaluationInput) =>
      manualEvaluationService.evaluateSubjectiveAnswer(input),
    onSuccess: () => {
      // Invalidate attempt detail so UI refreshes with updated marks
      queryClient.invalidateQueries({ queryKey: evaluationKeys.detail(attemptId) });
      // Also invalidate the pending list
      queryClient.invalidateQueries({ queryKey: evaluationKeys.lists() });
    },
  });
}

/**
 * Finalize subjective evaluation for an attempt.
 */
export function useFinalizeEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: FinalizeInput) => {
      console.error('[FINALIZE_TRACE] useFinalizeEvaluation mutationFn', {
        attemptId: input.attemptId,
      });
      return manualEvaluationService.finalizeSubjectiveEvaluation(input);
    },
    onSuccess: () => {
      // Invalidate all evaluation queries
      queryClient.invalidateQueries({ queryKey: evaluationKeys.all() });
    },
  });
}

/**
 * Fetch the pending subjective evaluation count for a given test.
 */
export function useTestPendingEvaluationCount(testId: string | undefined | null) {
  return useQuery<{ pendingEvaluationCount: number }>({
    queryKey: ['teacher-evaluation', 'testPendingCount', testId] as const,
    queryFn: async () => {
      const result = await manualEvaluationService.getTestPendingEvaluationCount(testId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch pending evaluation count.');
      }
      return result.data!;
    },
    enabled: !!testId,
    refetchInterval: 30_000,
  });
}
