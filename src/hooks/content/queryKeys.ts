/**
 * Content Module Query Key Factory
 *
 * Centralised, stable query key definitions for the Content module — content,
 * tags, and approval requests.
 *
 * Every hook in this module derives its keys from this factory so that
 * cache invalidation is always consistent — mutating one entity never
 * accidentally invalidates another's cache.
 *
 * ## Structure
 *
 * Each entity follows the same hierarchy:
 * ```
 * contentKeys.<entity>.all        → root for the entity
 * contentKeys.<entity>.lists()     → all list-type queries
 * contentKeys.<entity>.list(f,s,p) → specific list query (keyed by params)
 * contentKeys.<entity>.details()   → all detail-type queries
 * contentKeys.<entity>.detail(id)  → single item query
 * ```
 *
 * @module hooks/content/queryKeys
 */

import type {
  PaginationParams,
  SortDirection,
} from '../../types/academic';
import type {
  ContentFilters,
  ContentSortOptions,
  TagFilters,
  TagSortOptions,
  ApprovalRequestFilters,
  ApprovalRequestSortOptions,
  ApprovalResourceType,
} from '../../types/content';

// ─── Root ───────────────────────────────────────────────────────────────────

export const contentKeys = {
  all: ['content'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Content
  // ═════════════════════════════════════════════════════════════════════════

  contents: {
    /** Root key for all content queries. */
    all: () => [...contentKeys.all, 'contents'] as const,

    /** Key for every content list query (used for broad invalidation). */
    lists: () => [...contentKeys.contents.all(), 'list'] as const,

    /** Key for a specific content list query with its params. */
    list: (
      filters?: ContentFilters,
      sort?: ContentSortOptions,
      pagination?: PaginationParams,
    ) => [...contentKeys.contents.lists(), filters, sort, pagination] as const,

    /** Key for every content detail query. */
    details: () => [...contentKeys.contents.all(), 'detail'] as const,

    /** Key for a single content item by ID. */
    detail: (id: string) => [...contentKeys.contents.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Tag
  // ═════════════════════════════════════════════════════════════════════════

  tags: {
    /** Root key for all tag queries. */
    all: () => [...contentKeys.all, 'tags'] as const,

    /** Key for every tag list query. */
    lists: () => [...contentKeys.tags.all(), 'list'] as const,

    /** Key for a specific tag list query with its params. */
    list: (
      filters?: TagFilters,
      sort?: TagSortOptions,
      pagination?: PaginationParams,
    ) => [...contentKeys.tags.lists(), filters, sort, pagination] as const,

    /** Key for every tag detail query. */
    details: () => [...contentKeys.tags.all(), 'detail'] as const,

    /** Key for a single tag by ID. */
    detail: (id: string) => [...contentKeys.tags.details(), id] as const,

    /** Key for content-to-tag relation queries (attached tags per content). */
    contentTags: (contentId: string) =>
      [...contentKeys.tags.all(), 'contentTags', contentId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Approval
  // ═════════════════════════════════════════════════════════════════════════

  approvals: {
    /** Root key for all approval request queries. */
    all: () => [...contentKeys.all, 'approvals'] as const,

    /** Key for every approval request list query. */
    lists: () => [...contentKeys.approvals.all(), 'list'] as const,

    /** Key for a specific approval request list query with its params. */
    list: (
      filters?: ApprovalRequestFilters,
      sort?: ApprovalRequestSortOptions,
      pagination?: PaginationParams,
    ) => [...contentKeys.approvals.lists(), filters, sort, pagination] as const,

    /** Key for every approval request detail query. */
    details: () => [...contentKeys.approvals.all(), 'detail'] as const,

    /** Key for a single approval request by ID. */
    detail: (id: string) => [...contentKeys.approvals.details(), id] as const,

    /** Key for the pending approvals dashboard query. */
    pending: () => [...contentKeys.approvals.all(), 'pending'] as const,

    /** Key for a specific pending approvals query. */
    pendingList: (instituteId?: string, pagination?: PaginationParams) =>
      [...contentKeys.approvals.pending(), instituteId, pagination] as const,

    /** Key for all approval history queries for a resource. */
    history: () => [...contentKeys.approvals.all(), 'history'] as const,

    /** Key for the approval history of a specific resource. */
    historyList: (resourceId: string, resourceType?: ApprovalResourceType) =>
      [...contentKeys.approvals.history(), resourceId, resourceType] as const,
  },
};
