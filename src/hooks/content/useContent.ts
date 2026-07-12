/**
 * Content Management Hooks
 *
 * React Query hooks wrapping the contentService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                   | Type     | Description                              |
 * |------------------------|----------|------------------------------------------|
 * | `useContentList`       | Query    | Paginated, filterable content list       |
 * | `useContent`           | Query    | Single content by ID                     |
 * | `useCreateContent`     | Mutation | Create new content with file upload      |
 * | `useUpdateContent`     | Mutation | Update content metadata/file             |
 * | `useDeleteContent`     | Mutation | Delete content                           |
 * | `usePublishContent`    | Mutation | Submit for review (draft → pending_review) |
 * | `useApproveContent`    | Mutation | Approve content (pending_review → approved) |
 * | `useRejectContent`     | Mutation | Reject content (pending_review → rejected) |
 * | `useArchiveContent`    | Mutation | Archive content (approved → archived)    |
 * | `useRestoreContent`    | Mutation | Restore content (archived → draft)       |
 *
 * @module hooks/content/useContent
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contentKeys } from './queryKeys';
import {
  getContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent,
  publishContent,
  approveContent,
  rejectContent,
  archiveContent,
  restoreContent,
} from '../../services/content/contentService';
import type { Content, ContentFilters, ContentSortOptions } from '../../types/content';
import type { PaginatedResponse, PaginationParams } from '../../types/academic';
import type { CreateContentParams, UpdateContentParams } from '../../services/content/contentService';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of content items.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useContentList(
 *   { instituteId: 'uuid', status: 'approved' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 20 },
 * );
 */
export function useContentList(
  filters?: ContentFilters,
  sort?: ContentSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Content>>({
    queryKey: contentKeys.content.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getContents(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch content.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single content item by its ID.
 *
 * The query is disabled when `contentId` is falsy, making it safe to pass
 * an optional value from navigation params or parent state.
 *
 * @param contentId - The UUID of the content to retrieve.
 */
export function useContent(contentId: string | undefined | null) {
  return useQuery<Content>({
    queryKey: contentKeys.content.detail(contentId!),
    queryFn: async () => {
      const result = await getContentById(contentId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch content.');
      }
      return result.data!;
    },
    enabled: !!contentId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create new content with file upload.
 *
 * On success, invalidates all content list queries.
 */
export function useCreateContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, CreateContentParams>({
    mutationFn: async (params) => {
      const result = await createContent(params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create content.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}

/**
 * Update content metadata and optionally replace the file/thumbnail.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdateContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, { id: string; params: UpdateContentParams }>({
    mutationFn: async ({ id, params }) => {
      const result = await updateContent(id, params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update content.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.content.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}

/**
 * Delete content (hard delete — use archive for safe retirement).
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 */
export function useDeleteContent() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteContent(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete content.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: contentKeys.content.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}

/**
 * Submit content for admin review (draft → pending_review).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function usePublishContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (id) => {
      const result = await publishContent(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to submit content for review.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.content.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}

/**
 * Approve content (pending_review → approved).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useApproveContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (id) => {
      const result = await approveContent(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to approve content.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.content.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}

/**
 * Reject content (pending_review → rejected).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useRejectContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (id) => {
      const result = await rejectContent(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reject content.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.content.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}

/**
 * Archive content (approved → archived).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useArchiveContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (id) => {
      const result = await archiveContent(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive content.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.content.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}

/**
 * Restore archived content (archived → draft).
 *
 * On success, invalidates the affected detail and all list queries.
 */
export function useRestoreContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (id) => {
      const result = await restoreContent(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to restore content.');
      }
      return result.data!;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.content.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.content.lists() });
    },
  });
}
