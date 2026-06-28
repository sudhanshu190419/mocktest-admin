/**
 * Subject Hooks
 *
 * React Query hooks wrapping the subjectService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook              | Type     | Description                              |
 * |-------------------|----------|------------------------------------------|
 * | `useSubjects`     | Query    | Paginated, filterable subject list       |
 * | `useSubject`      | Query    | Single subject by ID                     |
 * | `useCreateSubject`| Mutation | Create a new subject                     |
 * | `useUpdateSubject`| Mutation | Update an existing subject               |
 * | `useDeleteSubject`| Mutation | Delete a subject                         |
 *
 * @module hooks/academic/useSubjects
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { academicKeys } from './queryKeys';
import {
  getSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject,
} from '../../services/academic/subjectService';
import type {
  CreateSubjectInput,
  PaginatedResponse,
  PaginationParams,
  Subject,
  SubjectFilters,
  SubjectSortOptions,
  UpdateSubjectInput,
} from '../../types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of subjects.
 *
 * @param filters   - Optional filter criteria.
 * @param sort      - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useSubjects(
 *   { streamId: 'uuid', search: 'phy' },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 *   { page: 1, pageSize: 10 },
 * );
 */
export function useSubjects(
  filters?: SubjectFilters,
  sort?: SubjectSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Subject>>({
    queryKey: academicKeys.subjects.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getSubjects(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subjects.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single subject by its ID.
 *
 * The query is disabled when `subjectId` is falsy.
 *
 * @param subjectId - The UUID of the subject to retrieve.
 */
export function useSubject(subjectId: string | undefined | null) {
  return useQuery<Subject>({
    queryKey: academicKeys.subjects.detail(subjectId!),
    queryFn: async () => {
      const result = await getSubjectById(subjectId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subject.');
      }
      return result.data!;
    },
    enabled: !!subjectId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new subject.
 *
 * On success, invalidates all subject list queries.
 */
export function useCreateSubject() {
  const queryClient = useQueryClient();

  return useMutation<Subject, Error, CreateSubjectInput>({
    mutationFn: async (input) => {
      const result = await createSubject(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create subject.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: academicKeys.subjects.lists() });
    },
  });
}

/**
 * Update an existing subject.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdateSubject() {
  const queryClient = useQueryClient();

  return useMutation<Subject, Error, { id: string; input: UpdateSubjectInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateSubject(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update subject.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: academicKeys.subjects.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.subjects.lists() });
    },
  });
}

/**
 * Delete a subject.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 */
export function useDeleteSubject() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteSubject(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete subject.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: academicKeys.subjects.detail(id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.subjects.lists() });
    },
  });
}
