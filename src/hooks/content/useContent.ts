/**
 * Content Hooks
 *
 * React Query hooks wrapping the contentService API calls.
 * Provides cached queries and mutations with automatic cache invalidation,
 * covering full CRUD, lifecycle transitions, and file upload operations.
 *
 * ## Exports
 *
 * | Hook                    | Type     | Description                              |
 * |-------------------------|----------|------------------------------------------|
 * | `useContents`           | Query    | Paginated, filterable content list       |
 * | `useContent`            | Query    | Single content item by ID                |
 * | `useCreateContent`      | Mutation | Create content with file upload          |
 * | `useUpdateContent`      | Mutation | Update content metadata / replace file   |
 * | `useDeleteContent`      | Mutation | Hard-delete content and storage files    |
 * | `usePublishContent`     | Mutation | Submit content for review (draft→pending)|
 * | `useApproveContent`     | Mutation | Approve content (pending→approved)       |
 * | `useRejectContent`      | Mutation | Reject content (pending→rejected)        |
 * | `useArchiveContent`     | Mutation | Archive content (approved→archived)      |
 * | `useRestoreContent`     | Mutation | Restore from archive (archived→draft)    |
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
import type {
  Content,
  ContentFilters,
  ContentSortOptions,
  PaginatedResponse,
  PaginationParams,
} from '../../types/content';
import type {
  CreateContentParams,
  ContentQueryFilters,
  UpdateContentParams,
} from '../../services/content/contentService';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of content items.
 *
 * Supports filtering by institute, chapter, subject, content type, status,
 * and search (title/description). Pagination defaults to page 1, pageSize 20.
 *
 * @param filters    - Optional filter criteria.
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useContents(
 *   { instituteId: 'uuid', contentType: 'pdf', status: 'approved' },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 * );
 */
export function useContents(
  filters?: ContentQueryFilters,
  sort?: ContentSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Content>>({
    queryKey: contentKeys.contents.list(filters, sort, pagination),
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
    queryKey: contentKeys.contents.detail(contentId!),
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
 * Create new content with a file upload.
 *
 * On success, invalidates all content list queries so the new item
 * appears in list views.
 *
 * @example
 * const { mutate, isPending } = useCreateContent();
 *
 * const handleCreate = () => {
 *   mutate({
 *     instituteId: 'uuid',
 *     teacherId: 'uuid',
 *     chapterId: 'uuid',
 *     title: 'Thermodynamics Notes',
 *     contentType: 'pdf',
 *     file: selectedFile,
 *   });
 * };
 */
export function useCreateContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, CreateContentParams>({
    mutationFn: async (input) => {
      const result = await createContent(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create content.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Update an existing content item's metadata and/or replace its file.
 *
 * On success, invalidates both the affected detail query and all list
 * queries to ensure consistency.
 *
 * @example
 * const { mutate, isPending } = useUpdateContent();
 *
 * const handleUpdate = () => {
 *   mutate(
 *     { id: contentId, input: { title: 'Updated Title' } },
 *   );
 * };
 */
export function useUpdateContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, { id: string; input: UpdateContentParams }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateContent(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update content.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Permanently delete content and its associated storage files.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 *
 * @example
 * const { mutate, isPending } = useDeleteContent();
 * mutate(contentId);
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
      queryClient.removeQueries({ queryKey: contentKeys.contents.detail(id) });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Lifecycle Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit content for admin review.
 *
 * Status transition: `draft` → `pending_review`
 *
 * On success, invalidates both the detail and list caches so the UI
 * reflects the new status immediately.
 */
export function usePublishContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (contentId) => {
      const result = await publishContent(contentId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish content.');
      }
      return result.data!;
    },
    onSuccess: (_data, contentId) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.detail(contentId) });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Approve content during review, making it visible to students.
 *
 * Status transition: `pending_review` → `approved`
 * Sets `published_at` to the current timestamp.
 *
 * On success, invalidates the detail and list caches. Also invalidates
 * related approval queries since approval decisions affect the approval
 * request state.
 */
export function useApproveContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (contentId) => {
      const result = await approveContent(contentId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to approve content.');
      }
      return result.data!;
    },
    onSuccess: (_data, contentId) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.detail(contentId) });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });
    },
  });
}

/**
 * Reject content during review.
 *
 * Status transition: `pending_review` → `rejected`
 *
 * Full review remarks should be stored via the approval service.
 * This mutation only updates the content table status.
 *
 * On success, invalidates the detail, list, and approval caches.
 */
export function useRejectContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (contentId) => {
      const result = await rejectContent(contentId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to reject content.');
      }
      return result.data!;
    },
    onSuccess: (_data, contentId) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.detail(contentId) });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.lists() });
      queryClient.invalidateQueries({ queryKey: contentKeys.approvals.pending() });
    },
  });
}

/**
 * Archive (retire) approved content.
 *
 * Status transition: `approved` → `archived`
 *
 * Storage files are NOT deleted. Archived content is excluded from all
 * student-facing queries via RLS.
 *
 * On success, invalidates the detail and list caches.
 */
export function useArchiveContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (contentId) => {
      const result = await archiveContent(contentId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive content.');
      }
      return result.data!;
    },
    onSuccess: (_data, contentId) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.detail(contentId) });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}

/**
 * Restore archived content back to draft for revision.
 *
 * Status transition: `archived` → `draft`
 *
 * On success, invalidates the detail and list caches.
 */
export function useRestoreContent() {
  const queryClient = useQueryClient();

  return useMutation<Content, Error, string>({
    mutationFn: async (contentId) => {
      const result = await restoreContent(contentId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to restore content.');
      }
      return result.data!;
    },
    onSuccess: (_data, contentId) => {
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.detail(contentId) });
      queryClient.invalidateQueries({ queryKey: contentKeys.contents.lists() });
    },
  });
}
