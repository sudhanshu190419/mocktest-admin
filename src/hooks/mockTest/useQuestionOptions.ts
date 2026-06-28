/**
 * Question Option Hooks
 *
 * React Query hooks wrapping the questionOptionService API calls.
 * Provides cached queries and mutations with automatic cache invalidation,
 * covering CRUD, bulk replace, and reorder operations.
 *
 * ## Exports
 *
 * | Hook                          | Type     | Description                                   |
 * |-------------------------------|----------|-----------------------------------------------|
 * | `useQuestionOptions`          | Query    | All options for a question (ordered)          |
 * | `useCreateQuestionOption`     | Mutation | Create a single option                        |
 * | `useUpdateQuestionOption`     | Mutation | Update an existing option                     |
 * | `useDeleteQuestionOption`     | Mutation | Delete a single option                        |
 * | `useReplaceQuestionOptions`   | Mutation | Atomically replace all options for a question |
 * | `useReorderQuestionOptions`   | Mutation | Update display order of options               |
 *
 * @module hooks/mockTest/useQuestionOptions
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { questionKeys } from './queryKeys';
import {
  getQuestionOptions,
  createQuestionOption,
  updateQuestionOption,
  deleteQuestionOption,
  replaceQuestionOptions,
  reorderQuestionOptions,
} from '../../services/mockTest/questionOptionService';
import type { QuestionOption, QuestionType } from '../../types/mockTest';

// ─── Mutation Parameter Types ───────────────────────────────────────────────

/** Input for creating a question option, matching the service's internal type. */
export interface CreateOptionParams {
  questionId: string;
  instituteId: string;
  optionText: string;
  isCorrect?: boolean;
  orderSequence: number;
}

/** Input for updating a question option, matching the service's internal type. */
export interface UpdateOptionParams {
  optionText?: string;
  isCorrect?: boolean;
  displayOrder?: number;
}

/** Entry for the bulk replace workflow. */
export interface ReplaceOptionEntry {
  optionText: string;
  isCorrect: boolean;
  orderSequence: number;
}

/** Item for reordering a single option. */
export interface ReorderOptionItem {
  optionId: string;
  displayOrder: number;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch all options for a given question, ordered by display order ascending.
 *
 * The query is disabled when `questionId` is falsy.
 *
 * @param questionId - The UUID of the parent question.
 *
 * @example
 * const { data: options, isLoading } = useQuestionOptions(questionId);
 */
export function useQuestionOptions(questionId: string | undefined | null) {
  return useQuery<QuestionOption[]>({
    queryKey: questionKeys.options.list(questionId ?? undefined),
    queryFn: async () => {
      const result = await getQuestionOptions(questionId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question options.');
      }
      return result.data!;
    },
    enabled: !!questionId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a single question option.
 *
 * On success, invalidates the option list for the parent question.
 *
 * @example
 * const { mutate, isPending } = useCreateQuestionOption();
 *
 * mutate({
 *   questionId: 'uuid',
 *   instituteId: 'uuid',
 *   optionText: 'Newton's First Law',
 *   isCorrect: true,
 *   orderSequence: 1,
 * });
 */
export function useCreateQuestionOption() {
  const queryClient = useQueryClient();

  return useMutation<QuestionOption, Error, CreateOptionParams>({
    mutationFn: async (input) => {
      const result = await createQuestionOption(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create question option.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.options.list(variables.questionId) });
    },
  });
}

/**
 * Update an existing question option.
 *
 * On success, invalidates the option list for the option's parent question.
 * The questionId is passed alongside the optionId so the hook can
 * invalidate the correct cache key.
 *
 * @example
 * const { mutate, isPending } = useUpdateQuestionOption();
 *
 * mutate({
 *   questionId: 'parent-uuid',
 *   optionId: 'option-uuid',
 *   input: { optionText: 'Updated text', isCorrect: false },
 * });
 */
export function useUpdateQuestionOption() {
  const queryClient = useQueryClient();

  return useMutation<
    QuestionOption,
    Error,
    { questionId: string; optionId: string; input: UpdateOptionParams }
  >({
    mutationFn: async ({ optionId, input }) => {
      const result = await updateQuestionOption(optionId, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update question option.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.options.list(variables.questionId) });
    },
  });
}

/**
 * Delete a single question option.
 *
 * On success, invalidates the option list for the parent question.
 *
 * @example
 * const { mutate, isPending } = useDeleteQuestionOption();
 *
 * mutate({ questionId: 'parent-uuid', optionId: 'option-uuid' });
 */
export function useDeleteQuestionOption() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { questionId: string; optionId: string }>({
    mutationFn: async ({ optionId }) => {
      const result = await deleteQuestionOption(optionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete question option.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.options.list(variables.questionId) });
    },
  });
}

/**
 * Atomically replace all options for a question.
 *
 * This is the primary entry point for the Question Editor. It deletes all
 * existing options and inserts a new set with full validation (MCQ/MSQ
 * cardinality, min/max count, duplicate order checks).
 *
 * On success, invalidates the option list for the question and the
 * question detail cache (since option data is often included in
 * question detail views).
 *
 * @example
 * const { mutate, isPending } = useReplaceQuestionOptions();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   instituteId: 'institute-uuid',
 *   options: [
 *     { optionText: 'Option A', isCorrect: true, orderSequence: 1 },
 *     { optionText: 'Option B', isCorrect: false, orderSequence: 2 },
 *   ],
 *   questionType: 'mcq',
 * });
 */
export function useReplaceQuestionOptions() {
  const queryClient = useQueryClient();

  return useMutation<
    QuestionOption[],
    Error,
    {
      questionId: string;
      instituteId: string;
      options: ReplaceOptionEntry[];
      questionType: QuestionType;
    }
  >({
    mutationFn: async ({ questionId, instituteId, options, questionType }) => {
      const result = await replaceQuestionOptions(
        questionId,
        instituteId,
        options,
        questionType,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to replace question options.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.options.list(variables.questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.questionId) });
    },
  });
}

/**
 * Update the display order of options in a single operation.
 *
 * Accepts an array of `{ optionId, displayOrder }` pairs and updates only
 * the `order_sequence` column for each specified option.
 *
 * On success, invalidates the option list for the parent question.
 *
 * @example
 * const { mutate, isPending } = useReorderQuestionOptions();
 *
 * mutate({
 *   questionId: 'question-uuid',
 *   items: [
 *     { optionId: 'uuid-a', displayOrder: 2 },
 *     { optionId: 'uuid-b', displayOrder: 1 },
 *   ],
 * });
 */
export function useReorderQuestionOptions() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { questionId: string; items: ReorderOptionItem[] }
  >({
    mutationFn: async ({ items }) => {
      const result = await reorderQuestionOptions(items);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reorder question options.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.options.list(variables.questionId) });
    },
  });
}
