/**
 * Chapter Hooks
 *
 * React Query hooks wrapping the chapterService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook               | Type     | Description                              |
 * |--------------------|----------|------------------------------------------|
 * | `useChapters`      | Query    | Paginated, filterable chapter list       |
 * | `useChapter`       | Query    | Single chapter by ID                     |
 * | `useCreateChapter` | Mutation | Create a new chapter                     |
 * | `useUpdateChapter` | Mutation | Update an existing chapter               |
 * | `useDeleteChapter` | Mutation | Delete a chapter                         |
 *
 * @module hooks/academic/useChapters
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { academicKeys } from './queryKeys';
import {
  getChapters,
  getChapterById,
  createChapter,
  updateChapter,
  deleteChapter,
} from '../../services/academic/chapterService';
import type {
  Chapter,
  ChapterFilters,
  ChapterSortOptions,
  CreateChapterInput,
  PaginatedResponse,
  PaginationParams,
  UpdateChapterInput,
} from '../../types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of chapters.
 *
 * @param filters   - Optional filter criteria.
 * @param sort      - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useChapters(
 *   { subjectId: 'uuid', search: 'laws' },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 * );
 */
export function useChapters(
  filters?: ChapterFilters,
  sort?: ChapterSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Chapter>>({
    queryKey: academicKeys.chapters.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getChapters(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch chapters.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single chapter by its ID.
 *
 * The query is disabled when `chapterId` is falsy.
 *
 * @param chapterId - The UUID of the chapter to retrieve.
 */
export function useChapter(chapterId: string | undefined | null) {
  return useQuery<Chapter>({
    queryKey: academicKeys.chapters.detail(chapterId!),
    queryFn: async () => {
      const result = await getChapterById(chapterId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch chapter.');
      }
      return result.data!;
    },
    enabled: !!chapterId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new chapter.
 *
 * On success, invalidates all chapter list queries.
 */
export function useCreateChapter() {
  const queryClient = useQueryClient();

  return useMutation<Chapter, Error, CreateChapterInput>({
    mutationFn: async (input) => {
      const result = await createChapter(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create chapter.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: academicKeys.chapters.lists() });
    },
  });
}

/**
 * Update an existing chapter.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdateChapter() {
  const queryClient = useQueryClient();

  return useMutation<Chapter, Error, { id: string; input: UpdateChapterInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateChapter(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update chapter.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: academicKeys.chapters.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.chapters.lists() });
    },
  });
}

/**
 * Delete a chapter.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 */
export function useDeleteChapter() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteChapter(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete chapter.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: academicKeys.chapters.detail(id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.chapters.lists() });
    },
  });
}
