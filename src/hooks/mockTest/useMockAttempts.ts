/**
 * Mock Attempt Hooks
 *
 * React Query hooks wrapping the mockAttemptService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                       | Type     | Description                              |
 * |----------------------------|----------|------------------------------------------|
 * | `useMockAttempts`          | Query    | Paginated, filterable attempt list       |
 * | `useMockAttempt`           | Query    | Single attempt by ID                     |
 * | `useCreateMockAttempt`     | Mutation | Create a new attempt                     |
 * | `useUpdateMockAttempt`     | Mutation | Update an existing attempt               |
 * | `useDeleteMockAttempt`     | Mutation | Delete a draft attempt                   |
 * | `useMockAnswers`           | Query    | Answers for an attempt                   |
 * | `useMockAnswer`            | Query    | Single answer by ID                      |
 * | `useUpdateMockAnswer`      | Mutation | Update/save an answer                    |
 * | `useMockAnswerOptions`     | Query    | Selected options for an answer           |
 * | `useCreateMockAnswerOption`| Mutation | Add a selected option to an answer       |
 * | `useDeleteMockAnswerOption`| Mutation | Remove a selected option                 |
 * | `useMockResults`           | Query    | Result list by filters                   |
 * | `useMockResultByAttempt`   | Query    | Result for a specific attempt            |
 *
 * @module hooks/mockTest/useMockAttempts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockTestKeys } from './queryKeys';
import {
  getMockAttempts,
  getMockAttemptById,
  createMockAttempt,
  updateMockAttempt,
  deleteMockAttempt,
  getMockAnswers,
  getMockAnswerById,
  updateMockAnswer,
  deleteMockAnswer,
  getMockAnswerOptions,
  createMockAnswerOption,
  deleteMockAnswerOption,
  deleteMockAnswerOptionsByAnswerId,
  getMockResults,
  getMockResultByAttemptId,
} from '../../services/mockTest/mockAttemptService';
import { evaluateAttempt } from '../../services/mockTest/mockEvaluationService';
import type {
  MockAttempt,
  MockAnswer,
  MockAnswerOption,
  MockResult,
  CreateMockAttemptInput,
  UpdateMockAttemptInput,
  MockAttemptFilters,
  MockAttemptSortOptions,
  UpdateMockAnswerInput,
  CreateMockAnswerOptionInput,
  MockResultFilters,
  MockResultSortOptions,
  PaginatedResponse,
  PaginationParams,
} from '../../types/mockTest';

// ─── Attempt Queries ────────────────────────────────────────────────────────

export function useMockAttempts(
  filters?: MockAttemptFilters,
  sort?: MockAttemptSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<MockAttempt>>({
    queryKey: mockTestKeys.attempts.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getMockAttempts(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock attempts.');
      }
      return result.data!;
    },
  });
}

export function useMockAttempt(attemptId: string | undefined | null) {
  return useQuery<MockAttempt>({
    queryKey: mockTestKeys.attempts.detail(attemptId!),
    queryFn: async () => {
      const result = await getMockAttemptById(attemptId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock attempt.');
      }
      return result.data!;
    },
    enabled: !!attemptId,
  });
}

// ─── Attempt Mutations ──────────────────────────────────────────────────────

export function useCreateMockAttempt() {
  const queryClient = useQueryClient();

  return useMutation<MockAttempt, Error, CreateMockAttemptInput>({
    mutationFn: async (input) => {
      const result = await createMockAttempt(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create mock attempt.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.attempts.lists() });
    },
  });
}

export function useUpdateMockAttempt() {
  const queryClient = useQueryClient();

  return useMutation<MockAttempt, Error, { id: string; input: UpdateMockAttemptInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateMockAttempt(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update mock attempt.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.attempts.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.attempts.lists() });
    },
  });
}

// ─── Evaluation Mutation ─────────────────────────────────────────────────────

export function useEvaluateAttempt() {
  const queryClient = useQueryClient();

  return useMutation<MockResult, Error, string>({
    mutationFn: async (attemptId) => {
      const result = await evaluateAttempt(attemptId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to evaluate attempt.');
      }
      return result.data!;
    },
    onSuccess: (data) => {
      // Invalidate results and attempt detail so UI refreshes
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.detail(data.attemptId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.results.lists() });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.attempts.detail(data.attemptId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.attempts.lists() });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.answers.lists() });
    },
  });
}

export function useDeleteMockAttempt() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteMockAttempt(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete mock attempt.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: mockTestKeys.attempts.detail(id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.attempts.lists() });
    },
  });
}

// ─── Answer Queries ─────────────────────────────────────────────────────────

export function useMockAnswers(attemptId: string | undefined | null) {
  return useQuery<MockAnswer[]>({
    queryKey: mockTestKeys.answers.list(attemptId ?? undefined),
    queryFn: async () => {
      const result = await getMockAnswers({ attemptId: attemptId ?? undefined });
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock answers.');
      }
      return result.data!;
    },
    enabled: !!attemptId,
  });
}

export function useMockAnswer(answerId: string | undefined | null) {
  return useQuery<MockAnswer>({
    queryKey: mockTestKeys.answers.detail(answerId!),
    queryFn: async () => {
      const result = await getMockAnswerById(answerId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock answer.');
      }
      return result.data!;
    },
    enabled: !!answerId,
  });
}

// ─── Answer Mutations ───────────────────────────────────────────────────────

export function useUpdateMockAnswer() {
  const queryClient = useQueryClient();

  return useMutation<MockAnswer, Error, { id: string; input: UpdateMockAnswerInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateMockAnswer(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update mock answer.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.answers.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.answers.lists() });
    },
  });
}

export function useDeleteMockAnswer() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteMockAnswer(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete mock answer.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.answers.lists() });
    },
  });
}

// ─── Answer Option Queries & Mutations ──────────────────────────────────────

export function useMockAnswerOptions(answerId: string | undefined | null) {
  return useQuery<MockAnswerOption[]>({
    queryKey: mockTestKeys.answerOptions.list(answerId ?? undefined),
    queryFn: async () => {
      const result = await getMockAnswerOptions({ answerId: answerId ?? undefined });
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch answer options.');
      }
      return result.data!;
    },
    enabled: !!answerId,
  });
}

export function useCreateMockAnswerOption() {
  const queryClient = useQueryClient();

  return useMutation<MockAnswerOption, Error, CreateMockAnswerOptionInput>({
    mutationFn: async (input) => {
      const result = await createMockAnswerOption(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to add answer option.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.answerOptions.list(variables.answerId) });
    },
  });
}

export function useDeleteMockAnswerOption() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { answerOptionId: string; answerId: string }>({
    mutationFn: async ({ answerOptionId }) => {
      const result = await deleteMockAnswerOption(answerOptionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove answer option.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: mockTestKeys.answerOptions.list(variables.answerId) });
    },
  });
}

// ─── Result Queries (read-only from dev console) ────────────────────────────

export function useMockResults(
  filters?: MockResultFilters,
  sort?: MockResultSortOptions,
) {
  return useQuery<MockResult[]>({
    queryKey: mockTestKeys.results.list(filters, sort),
    queryFn: async () => {
      const result = await getMockResults(filters, sort);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock results.');
      }
      return result.data!;
    },
  });
}

export function useMockResultByAttempt(attemptId: string | undefined | null) {
  return useQuery<MockResult>({
    queryKey: mockTestKeys.results.detail(attemptId ?? ''),
    queryFn: async () => {
      const result = await getMockResultByAttemptId(attemptId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock result.');
      }
      return result.data!;
    },
    enabled: !!attemptId,
  });
}
