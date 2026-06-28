/**
 * Mock Test Question Hooks
 *
 * React Query hooks wrapping the mockTestQuestionService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                           | Type     | Description                                  |
 * |--------------------------------|----------|----------------------------------------------|
 * | `useMockTestQuestions`         | Query    | All questions assigned to a mock test        |
 * | `useMockTestQuestion`          | Query    | Single question assignment by compound ID    |
 * | `useAddQuestionToMockTest`     | Mutation | Add a single question to a mock test         |
 * | `useUpdateMockTestQuestion`    | Mutation | Update an assignment's scoring/ordering      |
 * | `useRemoveQuestionFromMockTest`| Mutation | Remove a question from a mock test           |
 * | `useAddQuestionsToMockTest`    | Mutation | Bulk add multiple questions                  |
 * | `useReplaceMockTestQuestions`  | Mutation | Replace all questions in a mock test         |
 * | `useReorderMockTestQuestions`  | Mutation | Reorder questions in a mock test             |
 *
 * @module hooks/mockTest/useMockTestQuestions
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockTestKeys } from './queryKeys';
import {
  getMockTestQuestions,
  getMockTestQuestionById,
  addQuestionToMockTest,
  updateMockTestQuestion,
  removeQuestionFromMockTest,
  addQuestionsToMockTest,
  replaceMockTestQuestions,
  reorderMockTestQuestions,
} from '../../services/mockTest/mockTestQuestionService';
import type { MockTestQuestion } from '../../types/mockTest';
import type {
  QuestionAssignment,
  ReorderItem,
} from '../../services/mockTest/mockTestQuestionService';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch all questions assigned to a mock test, ordered by their display
 * sequence.
 *
 * @param mockTestId - The UUID of the mock test.
 * @param sortBy     - Optional sort field (orderSequence, marks, addedAt).
 * @param sortDir    - Optional sort direction (asc, desc).
 *
 * @example
 * const { data, isLoading } = useMockTestQuestions('uuid-here');
 */
export function useMockTestQuestions(
  mockTestId: string | undefined | null,
  sortBy?: 'orderSequence' | 'marks' | 'addedAt',
  sortDir?: 'asc' | 'desc',
) {
  return useQuery<MockTestQuestion[]>({
    queryKey: mockTestKeys.mockTestQuestions.list(mockTestId ?? undefined),
    queryFn: async () => {
      const result = await getMockTestQuestions(mockTestId!, sortBy, sortDir);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test questions.');
      }
      return result.data!;
    },
    enabled: !!mockTestId,
  });
}

/**
 * Fetch a single mock test question assignment by test and question IDs.
 *
 * The query is disabled when either `testId` or `questionId` is falsy.
 *
 * @param testId     - The UUID of the mock test.
 * @param questionId - The UUID of the question.
 *
 * @example
 * const { data } = useMockTestQuestion('test-uuid', 'question-uuid');
 */
export function useMockTestQuestion(
  testId: string | undefined | null,
  questionId: string | undefined | null,
) {
  return useQuery<MockTestQuestion>({
    queryKey: mockTestKeys.mockTestQuestions.detail(testId!, questionId!),
    queryFn: async () => {
      const result = await getMockTestQuestionById(`${testId!}::${questionId!}`);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test question.');
      }
      return result.data!;
    },
    enabled: !!testId && !!questionId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Add a single question to a mock test.
 *
 * On success, invalidates the mock test question list and the affected
 * mock test detail cache (since totalMarks may change).
 */
export function useAddQuestionToMockTest() {
  const queryClient = useQueryClient();

  return useMutation<
    MockTestQuestion,
    Error,
    {
      testId: string;
      questionId: string;
      orderSequence: number;
      marks?: number;
      negativeMarksOverride?: number | null;
      sectionName?: string | null;
      maxQuestions?: number;
    }
  >({
    mutationFn: async (input) => {
      const result = await addQuestionToMockTest(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to add question to mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTestQuestions.list(variables.testId),
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.detail(variables.testId),
      });
    },
  });
}

/**
 * Update an existing question assignment (scoring, section, ordering).
 *
 * On success, invalidates the question list and the mock test detail
 * cache.
 */
export function useUpdateMockTestQuestion() {
  const queryClient = useQueryClient();

  return useMutation<
    MockTestQuestion,
    Error,
    {
      testId: string;
      questionId: string;
      orderSequence?: number;
      section?: string | null;
      marksOverride?: number;
      negativeMarksOverride?: number | null;
    }
  >({
    mutationFn: async ({ testId, questionId, ...input }) => {
      const id = `${testId}::${questionId}`;
      const result = await updateMockTestQuestion(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update mock test question.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTestQuestions.list(variables.testId),
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.detail(variables.testId),
      });
    },
  });
}

/**
 * Remove a question from a mock test.
 *
 * On success, invalidates the question list and the mock test detail
 * cache.
 */
export function useRemoveQuestionFromMockTest() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { testId: string; questionId: string }>({
    mutationFn: async ({ testId, questionId }) => {
      const id = `${testId}::${questionId}`;
      const result = await removeQuestionFromMockTest(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove question from mock test.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTestQuestions.list(variables.testId),
      });
      queryClient.removeQueries({
        queryKey: mockTestKeys.mockTestQuestions.detail(variables.testId, variables.questionId),
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.detail(variables.testId),
      });
    },
  });
}

/**
 * Add multiple questions to a mock test in a single batch operation.
 *
 * On success, invalidates the question list and the mock test detail
 * cache.
 */
export function useAddQuestionsToMockTest() {
  const queryClient = useQueryClient();

  return useMutation<
    MockTestQuestion[],
    Error,
    {
      testId: string;
      assignments: QuestionAssignment[];
      maxQuestions?: number;
    }
  >({
    mutationFn: async ({ testId, assignments, maxQuestions }) => {
      const result = await addQuestionsToMockTest(testId, assignments, maxQuestions);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to add questions to mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTestQuestions.list(variables.testId),
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.detail(variables.testId),
      });
    },
  });
}

/**
 * Replace all questions in a mock test with a new set.
 *
 * This is the primary editor API for composing a test's question list.
 *
 * On success, invalidates the question list and the mock test detail
 * cache.
 */
export function useReplaceMockTestQuestions() {
  const queryClient = useQueryClient();

  return useMutation<
    MockTestQuestion[],
    Error,
    {
      testId: string;
      assignments: QuestionAssignment[];
      maxQuestions?: number;
    }
  >({
    mutationFn: async ({ testId, assignments, maxQuestions }) => {
      const result = await replaceMockTestQuestions(testId, assignments, maxQuestions);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to replace mock test questions.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTestQuestions.list(variables.testId),
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.detail(variables.testId),
      });
    },
  });
}

/**
 * Reorder the questions in a mock test.
 *
 * On success, invalidates the question list (order has changed).
 */
export function useReorderMockTestQuestions() {
  const queryClient = useQueryClient();

  return useMutation<
    MockTestQuestion[],
    Error,
    {
      testId: string;
      items: ReorderItem[];
    }
  >({
    mutationFn: async ({ testId, items }) => {
      const result = await reorderMockTestQuestions(testId, items);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reorder mock test questions.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTestQuestions.list(variables.testId),
      });
      // Reorder only affects display order — mock test detail is unaffected
    },
  });
}
