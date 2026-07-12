/**
 * PYQ Question Mapping Hooks
 *
 * React Query hooks wrapping the pyqQuestionMappingService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                           | Type     | Description                                   |
 * |--------------------------------|----------|-----------------------------------------------|
 * | `usePyqMappings`               | Query    | All questions mapped to a PYQ paper           |
 * | `usePyqMapping`                | Query    | Single mapping by paperId + questionId        |
 * | `useAddPyqMapping`             | Mutation | Add a single question to a PYQ paper          |
 * | `useRemovePyqMapping`          | Mutation | Remove a question from a PYQ paper            |
 * | `useAddPyqMappings`            | Mutation | Bulk add multiple questions                   |
 * | `useReorderPyqMappings`        | Mutation | Reorder questions in a PYQ paper              |
 *
 * @module hooks/pyq/usePyqQuestionMappings
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pyqKeys } from './queryKeys';
import { pyqQuestionMappingService } from '@/services/pyq/pyqQuestionMappingService';
import type { PyqQuestionMapping } from '@/types/pyq';
import type { PyqQuestionAssignment, PyqReorderItem } from '@/types/pyq';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch all questions mapped to a PYQ paper, ordered by their display sequence.
 *
 * @param paperId - The UUID of the PYQ paper.
 * @param sortBy  - Optional sort field.
 * @param sortDir - Optional sort direction.
 *
 * @example
 * const { data, isLoading } = usePyqMappings('paper-uuid');
 */
export function usePyqMappings(
  paperId: string | undefined | null,
  sortBy?: 'orderSequence' | 'officialMarks' | 'addedAt',
  sortDir?: 'asc' | 'desc',
) {
  return useQuery<PyqQuestionMapping[]>({
    queryKey: pyqKeys.questionMappings.list(paperId ?? undefined),
    queryFn: async () => {
      const result = await pyqQuestionMappingService.getMappings(paperId!, sortBy, sortDir);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch PYQ question mappings.');
      }
      return result.data!;
    },
    enabled: !!paperId,
  });
}

/**
 * Fetch a single mapping by paper ID and question ID.
 *
 * @param paperId    - The UUID of the PYQ paper.
 * @param questionId - The UUID of the question.
 *
 * @example
 * const { data } = usePyqMapping('paper-uuid', 'question-uuid');
 */
export function usePyqMapping(
  paperId: string | undefined | null,
  questionId: string | undefined | null,
) {
  return useQuery<PyqQuestionMapping>({
    queryKey: pyqKeys.questionMappings.detail(paperId!, questionId!),
    queryFn: async () => {
      const result = await pyqQuestionMappingService.getMapping(paperId!, questionId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch PYQ question mapping.');
      }
      return result.data!;
    },
    enabled: !!paperId && !!questionId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Add a single question to a PYQ paper.
 *
 * On success, invalidates the mapping list and the paper detail cache.
 */
export function useAddPyqMapping() {
  const queryClient = useQueryClient();

  return useMutation<
    PyqQuestionMapping,
    Error,
    {
      paperId: string;
      questionId: string;
      orderSequence: number;
      sectionName?: string | null;
      officialMarks?: number | null;
      officialNegativeMarks?: number | null;
    }
  >({
    mutationFn: async (input) => {
      const result = await pyqQuestionMappingService.addMapping(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to add question to PYQ paper.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: pyqKeys.questionMappings.list(variables.paperId),
      });
      queryClient.invalidateQueries({
        queryKey: pyqKeys.papers.detail(variables.paperId),
      });
    },
  });
}

/**
 * Remove a question from a PYQ paper.
 *
 * On success, invalidates the mapping list, removes the detail cache,
 * and invalidates the paper detail cache (total_questions changed).
 */
export function useRemovePyqMapping() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { paperId: string; questionId: string }>({
    mutationFn: async ({ paperId, questionId }) => {
      const result = await pyqQuestionMappingService.removeMapping(paperId, questionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove question from PYQ paper.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: pyqKeys.questionMappings.list(variables.paperId),
      });
      queryClient.removeQueries({
        queryKey: pyqKeys.questionMappings.detail(variables.paperId, variables.questionId),
      });
      queryClient.invalidateQueries({
        queryKey: pyqKeys.papers.detail(variables.paperId),
      });
    },
  });
}

/**
 * Add multiple questions to a PYQ paper in a single batch operation.
 *
 * On success, invalidates the mapping list and the paper detail cache.
 */
export function useAddPyqMappings() {
  const queryClient = useQueryClient();

  return useMutation<
    PyqQuestionMapping[],
    Error,
    {
      paperId: string;
      assignments: PyqQuestionAssignment[];
    }
  >({
    mutationFn: async ({ paperId, assignments }) => {
      const result = await pyqQuestionMappingService.addMappings(paperId, assignments);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to add questions to PYQ paper.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: pyqKeys.questionMappings.list(variables.paperId),
      });
      queryClient.invalidateQueries({
        queryKey: pyqKeys.papers.detail(variables.paperId),
      });
    },
  });
}

/**
 * Reorder the questions in a PYQ paper.
 *
 * On success, invalidates the mapping list (order has changed).
 */
export function useReorderPyqMappings() {
  const queryClient = useQueryClient();

  return useMutation<
    PyqQuestionMapping[],
    Error,
    {
      paperId: string;
      items: PyqReorderItem[];
    }
  >({
    mutationFn: async ({ paperId, items }) => {
      const result = await pyqQuestionMappingService.reorderMappings(paperId, items);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reorder PYQ question mappings.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: pyqKeys.questionMappings.list(variables.paperId),
      });
    },
  });
}
