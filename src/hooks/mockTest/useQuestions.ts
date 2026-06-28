/**
 * Question Hooks
 *
 * React Query hooks wrapping the questionService API calls.
 * Provides cached queries and mutations with automatic cache invalidation,
 * covering full CRUD and lifecycle status transitions.
 *
 * ## Exports
 *
 * | Hook                  | Type     | Description                                |
 * |-----------------------|----------|--------------------------------------------|
 * | `useQuestions`        | Query    | Paginated, filterable question list        |
 * | `useQuestion`         | Query    | Single question by ID                      |
 * | `useCreateQuestion`   | Mutation | Create a new question                      |
 * | `useUpdateQuestion`   | Mutation | Update an existing question                |
 * | `useDeleteQuestion`   | Mutation | Permanently delete a question              |
 * | `usePublishQuestion`  | Mutation | Publish a question (pending_approval→pub)  |
 * | `useArchiveQuestion`  | Mutation | Archive a question (published→archived)    |
 * | `useRestoreQuestion`  | Mutation | Restore from archive (archived→draft)      |
 *
 * @module hooks/mockTest/useQuestions
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { questionKeys } from './queryKeys';
import {
  getQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  publishQuestion,
  archiveQuestion,
  restoreQuestion,
} from '../../services/mockTest/questionService';
import type {
  CreateQuestionInput,
  PaginatedResponse,
  PaginationParams,
  Question,
  QuestionFilters,
  QuestionSortOptions,
  UpdateQuestionInput,
} from '../../types/mockTest';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of questions.
 *
 * @param filters    - Optional filter criteria (instituteId, subjectId, chapterId,
 *                      difficulty, questionType, status, search, etc.).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useQuestions(
 *   { instituteId: 'uuid', status: 'published' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 *
 * if (data) {
 *   console.log(data.data);   // Question[]
 *   console.log(data.count);  // total rows
 * }
 */
export function useQuestions(
  filters?: QuestionFilters,
  sort?: QuestionSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Question>>({
    queryKey: questionKeys.questions.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getQuestions(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch questions.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single question by its ID.
 *
 * The query is disabled when `questionId` is falsy, making it safe to pass
 * an optional value from navigation params or parent state.
 *
 * @param questionId - The UUID of the question to retrieve.
 *
 * @example
 * const { data: question, isLoading } = useQuestion(questionId);
 */
export function useQuestion(questionId: string | undefined | null) {
  return useQuery<Question>({
    queryKey: questionKeys.questions.detail(questionId!),
    queryFn: async () => {
      const result = await getQuestionById(questionId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question.');
      }
      return result.data!;
    },
    enabled: !!questionId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new question in the question bank.
 *
 * On success, invalidates all question list queries so the new question
 * appears in list views.
 *
 * @example
 * const { mutate, isPending } = useCreateQuestion();
 *
 * const handleCreate = () => {
 *   mutate({
 *     instituteId: 'uuid',
 *     subjectId: 'uuid',
 *     chapterId: 'uuid',
 *     createdBy: 'teacher-uuid',
 *     questionType: 'mcq',
 *     difficulty: 'medium',
 *     questionText: 'What is Newton's First Law?',
 *     marks: 4,
 *     negativeMarks: 1,
 *   });
 * };
 */
export function useCreateQuestion() {
  const queryClient = useQueryClient();

  return useMutation<Question, Error, CreateQuestionInput>({
    mutationFn: async (input) => {
      const result = await createQuestion(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create question.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.lists() });
    },
  });
}

/**
 * Update an existing question.
 *
 * On success, invalidates both the affected detail query and all list
 * queries to ensure consistency.
 *
 * @example
 * const { mutate, isPending } = useUpdateQuestion();
 *
 * const handleUpdate = () => {
 *   mutate(
 *     { id: questionId, input: { questionText: 'Updated stem...', marks: 5 } },
 *   );
 * };
 */
export function useUpdateQuestion() {
  const queryClient = useQueryClient();

  return useMutation<Question, Error, { id: string; input: UpdateQuestionInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateQuestion(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update question.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.lists() });
    },
  });
}

/**
 * Permanently delete a question.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 * For standard retirement, prefer `useArchiveQuestion()`.
 *
 * @example
 * const { mutate, isPending } = useDeleteQuestion();
 * mutate(questionId);
 */
export function useDeleteQuestion() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteQuestion(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete question.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: questionKeys.questions.detail(id) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.lists() });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Lifecycle Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publish a question, making it available for use in mock tests.
 *
 * Status transition: `pending_approval` → `published`
 *
 * On success, invalidates both the detail and list caches so the UI
 * reflects the new status immediately.
 *
 * @example
 * const { mutate, isPending } = usePublishQuestion();
 * mutate(questionId);
 */
export function usePublishQuestion() {
  const queryClient = useQueryClient();

  return useMutation<Question, Error, string>({
    mutationFn: async (questionId) => {
      const result = await publishQuestion(questionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish question.');
      }
      return result.data!;
    },
    onSuccess: (_data, questionId) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.lists() });
    },
  });
}

/**
 * Archive (retire) a question.
 *
 * Status transition: `published` → `archived`
 *
 * On success, invalidates the detail and list caches.
 *
 * @example
 * const { mutate, isPending } = useArchiveQuestion();
 * mutate(questionId);
 */
export function useArchiveQuestion() {
  const queryClient = useQueryClient();

  return useMutation<Question, Error, string>({
    mutationFn: async (questionId) => {
      const result = await archiveQuestion(questionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive question.');
      }
      return result.data!;
    },
    onSuccess: (_data, questionId) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.lists() });
    },
  });
}

/**
 * Restore an archived question back to draft for revision.
 *
 * Status transition: `archived` → `draft`
 *
 * On success, invalidates the detail and list caches.
 *
 * @example
 * const { mutate, isPending } = useRestoreQuestion();
 * mutate(questionId);
 */
export function useRestoreQuestion() {
  const queryClient = useQueryClient();

  return useMutation<Question, Error, string>({
    mutationFn: async (questionId) => {
      const result = await restoreQuestion(questionId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to restore question.');
      }
      return result.data!;
    },
    onSuccess: (_data, questionId) => {
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.detail(questionId) });
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.lists() });
    },
  });
}
