/**
 * Question Explanation Hooks
 *
 * React Query hooks wrapping the questionExplanationService API calls.
 * Provides cached queries and mutations with automatic cache invalidation,
 * covering CRUD and the recommended upsert workflow.
 *
 * ## Exports
 *
 * | Hook                              | Type     | Description                                         |
 * |-----------------------------------|----------|-----------------------------------------------------|
 * | `useQuestionExplanation`          | Query    | Single explanation for a question (by questionId)   |
 * | `useCreateQuestionExplanation`    | Mutation | Create a new explanation                            |
 * | `useUpdateQuestionExplanation`    | Mutation | Update an existing explanation                      |
 * | `useDeleteQuestionExplanation`    | Mutation | Delete an explanation                               |
 * | `useUpsertQuestionExplanation`    | Mutation | Create or update an explanation (recommended)       |
 *
 * @module hooks/mockTest/useQuestionExplanations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { questionKeys } from './queryKeys';
import {
  getQuestionExplanation,
  createQuestionExplanation,
  updateQuestionExplanation,
  deleteQuestionExplanation,
  upsertQuestionExplanation,
} from '../../services/mockTest/questionExplanationService';
import type { QuestionExplanation } from '../../types/mockTest';

// ─── Mutation Parameter Types ───────────────────────────────────────────────

/** Input for creating a question explanation, matching the service's internal type. */
export interface CreateExplanationParams {
  questionId: string;
  instituteId: string;
  explanationText: string;
  videoUrl?: string | null;
  correctNumericalAnswer?: number | null;
  numericalTolerance?: number | null;
}

/** Input for updating a question explanation. */
export interface UpdateExplanationParams {
  explanationText?: string | null;
  videoUrl?: string | null;
  correctNumericalAnswer?: number | null;
  numericalTolerance?: number | null;
}

/** Input for upserting a question explanation. */
export interface UpsertExplanationParams {
  questionId: string;
  instituteId: string;
  explanationText?: string | null;
  videoUrl?: string | null;
  correctNumericalAnswer?: number | null;
  numericalTolerance?: number | null;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch the explanation for a given question (1:1 relationship).
 *
 * The query is disabled when `questionId` is falsy.
 *
 * @param questionId - The UUID of the question whose explanation to retrieve.
 *
 * @example
 * const { data: explanation, isLoading } = useQuestionExplanation(questionId);
 */
export function useQuestionExplanation(questionId: string | undefined | null) {
  return useQuery<QuestionExplanation>({
    queryKey: questionKeys.explanations.list(questionId ?? undefined),
    queryFn: async () => {
      const result = await getQuestionExplanation(questionId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question explanation.');
      }
      return result.data!;
    },
    enabled: !!questionId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new question explanation.
 *
 * A question may have at most one explanation. If one already exists, the
 * mutation will fail. Use `useUpsertQuestionExplanation()` for the Question
 * Editor flow that handles both create and update.
 *
 * On success, invalidates the explanation list for the question and the
 * question detail cache.
 *
 * @example
 * const { mutate, isPending } = useCreateQuestionExplanation();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   explanationText: 'Step-by-step solution...',
 *   videoUrl: 'https://video-url.com',
 * });
 */
export function useCreateQuestionExplanation() {
  const queryClient = useQueryClient();

  return useMutation<QuestionExplanation, Error, CreateExplanationParams>({
    mutationFn: async (input) => {
      const result = await createQuestionExplanation(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create question explanation.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.explanations.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Update an existing question explanation.
 *
 * On success, invalidates the explanation and question detail caches.
 *
 * @example
 * const { mutate, isPending } = useUpdateQuestionExplanation();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   explanationId: 'explanation-uuid',
 *   input: { explanationText: 'Updated solution...' },
 * });
 */
export function useUpdateQuestionExplanation() {
  const queryClient = useQueryClient();

  return useMutation<
    QuestionExplanation,
    Error,
    { questionId: string; explanationId: string; input: UpdateExplanationParams }
  >({
    mutationFn: async ({ explanationId, input }) => {
      const result = await updateQuestionExplanation(explanationId, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update question explanation.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.explanations.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Delete a question explanation.
 *
 * On success, invalidates the explanation and question detail caches.
 *
 * @example
 * const { mutate, isPending } = useDeleteQuestionExplanation();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   explanationId: 'explanation-uuid',
 * });
 */
export function useDeleteQuestionExplanation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { questionId: string; explanationId: string }>({
    mutationFn: async ({ explanationId }) => {
      const result = await deleteQuestionExplanation(explanationId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete question explanation.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.explanations.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Create or update the explanation for a question.
 *
 * This is the recommended API for the Question Editor. It checks whether
 * an explanation already exists for the given question and performs the
 * appropriate operation:
 * - **Explanation exists:** updates the existing row with provided fields.
 * - **No explanation exists:** creates a new row.
 *
 * On success, invalidates the explanation and question detail caches.
 *
 * @example
 * // Create new explanation
 * const { mutate, isPending } = useUpsertQuestionExplanation();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   explanationText: 'Step-by-step solution...',
 * });
 *
 * @example
 * // Update existing explanation (instituteId is only needed for creation)
 * mutate({
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   explanationText: 'Updated solution...',
 * });
 */
export function useUpsertQuestionExplanation() {
  const queryClient = useQueryClient();

  return useMutation<QuestionExplanation, Error, UpsertExplanationParams>({
    mutationFn: async ({ questionId, instituteId, ...input }) => {
      const result = await upsertQuestionExplanation(questionId, instituteId, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to upsert question explanation.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.explanations.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}
