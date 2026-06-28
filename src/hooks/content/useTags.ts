/**
 * Tag Hooks
 *
 * React Query hooks wrapping the tagService API calls.
 * Provides cached queries and mutations with automatic cache invalidation,
 * covering full CRUD and content-tag relation management.
 *
 * ## Exports
 *
 * | Hook              | Type     | Description                              |
 * |-------------------|----------|------------------------------------------|
 * | `useTags`         | Query    | Paginated, filterable tag list           |
 * | `useTag`          | Query    | Single tag by ID                         |
 * | `useCreateTag`    | Mutation | Create a new tag                         |
 * | `useUpdateTag`    | Mutation | Update an existing tag's name            |
 * | `useDeleteTag`    | Mutation | Permanently delete a tag                 |
 * | `useAttachTag`    | Mutation | Attach a tag to a content item           |
 * | `useDetachTag`    | Mutation | Remove a tag from a content item         |
 * | `useReplaceTags`  | Mutation | Synchronise all tags on a content item   |
 *
 * @module hooks/content/useTags
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contentKeys } from './queryKeys';
import {
  getTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
  attachTag,
  detachTag,
  replaceTags,
} from '../../services/content/tagService';
import type {
  ContentTag,
  CreateTagInput,
  PaginatedResponse,
  PaginationParams,
  Tag,
  TagFilters,
  TagSortOptions,
  UpdateTagInput,
} from '../../types/content';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of tags.
 *
 * Supports filtering by instituteId and search (name). Tags are always
 * active — no isActive filter is needed.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useTags(
 *   { instituteId: 'uuid', search: 'thermo' },
 *   { sortBy: 'name', sortDirection: 'asc' },
 * );
 */
export function useTags(
  filters?: TagFilters,
  sort?: TagSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Tag>>({
    queryKey: contentKeys.tags.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getTags(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch tags.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single tag by its ID.
 *
 * The query is disabled when `tagId` is falsy.
 *
 * @param tagId - The UUID of the tag to retrieve.
 */
export function useTag(tagId: string | undefined | null) {
  return useQuery<Tag>({
    queryKey: contentKeys.tags.detail(tagId!),
    queryFn: async () => {
      const result = await getTagById(tagId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch tag.');
      }
      return result.data!;
    },
    enabled: !!tagId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new tag.
 *
 * Tag names are normalised to lowercase. Duplicate names within the same
 * institute are rejected.
 *
 * On success, invalidates all tag list queries.
 *
 * @example
 * const { mutate, isPending } = useCreateTag();
 * mutate({ instituteId: 'uuid', name: 'thermodynamics' });
 */
export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation<Tag, Error, CreateTagInput>({
    mutationFn: async (input) => {
      const result = await createTag(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create tag.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentKeys.tags.lists() });
    },
  });
}

/**
 * Update an existing tag's name.
 *
 * Tags are considered immutable. This mutation exists for admin corrections
 * only — prefer delete + recreate for significant changes.
 *
 * On success, invalidates both the affected detail query and all list queries.
 *
 * @example
 * const { mutate, isPending } = useUpdateTag();
 * mutate({ id: tagId, input: { name: 'thermo' } });
 */
export function useUpdateTag() {
  const queryClient = useQueryClient();

  return useMutation<Tag, Error, { id: string; input: UpdateTagInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateTag(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update tag.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.tags.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.tags.lists() });
    },
  });
}

/**
 * Permanently delete a tag.
 *
 * The `content_tag` junction rows use ON DELETE CASCADE, so all
 * associations are automatically removed.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 *
 * @example
 * const { mutate, isPending } = useDeleteTag();
 * mutate(tagId);
 */
export function useDeleteTag() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteTag(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete tag.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: contentKeys.tags.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.tags.lists() });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Relation Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attach a tag to a content item.
 *
 * If the association already exists, an error is thrown. On success,
 * invalidates the content detail query (since tags are typically rendered
 * alongside content) and the tag list queries.
 *
 * @example
 * const { mutate, isPending } = useAttachTag();
 * mutate({ contentId: 'cont-123', tagId: 'tag-456' });
 */
export function useAttachTag() {
  const queryClient = useQueryClient();

  return useMutation<
    ContentTag,
    Error,
    { contentId: string; tagId: string; taggedBy?: string | null }
  >({
    mutationFn: async ({ contentId, tagId, taggedBy }) => {
      const result = await attachTag(contentId, tagId, taggedBy);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to attach tag.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: contentKeys.contents.detail(variables.contentId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.tags.lists() });
    },
  });
}

/**
 * Detach a tag from a content item.
 *
 * Idempotent — returns success even if the association did not exist.
 * On success, invalidates the content detail query and tag list queries.
 *
 * @example
 * const { mutate, isPending } = useDetachTag();
 * mutate({ contentId: 'cont-123', tagId: 'tag-456' });
 */
export function useDetachTag() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { contentId: string; tagId: string }>({
    mutationFn: async ({ contentId, tagId }) => {
      const result = await detachTag(contentId, tagId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to detach tag.');
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: contentKeys.contents.detail(variables.contentId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.tags.lists() });
    },
  });
}

/**
 * Synchronise all tag associations for a content item.
 *
 * Best-effort replace: removes all current tags, then inserts the new set.
 * On success, invalidates the content detail and tag list queries.
 *
 * @example
 * const { mutate, isPending } = useReplaceTags();
 * mutate({ contentId: 'cont-123', tagIds: ['tag-1', 'tag-2'], taggedBy: 'profile-abc' });
 */
export function useReplaceTags() {
  const queryClient = useQueryClient();

  return useMutation<
    ContentTag[],
    Error,
    { contentId: string; tagIds: string[]; taggedBy?: string | null }
  >({
    mutationFn: async ({ contentId, tagIds, taggedBy }) => {
      const result = await replaceTags(contentId, tagIds, taggedBy);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to replace tags.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: contentKeys.contents.detail(variables.contentId),
      });
      queryClient.invalidateQueries({ queryKey: contentKeys.tags.lists() });
    },
  });
}
