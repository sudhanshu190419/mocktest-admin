/**
 * Content Query Key Factory
 *
 * Centralised, stable query key definitions for the Content Management module.
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

import type { PaginationParams } from '../../types/academic';
import type {
  ContentFilters,
  ContentSortOptions,
  ApprovalRequestSortOptions,
  ApprovalResourceType,
  TagFilters,
  TagSortOptions,
} from '../../types/content';
import type { ApprovalQueryFilters } from '../../services/content/approvalService';

export const contentKeys = {
  all: ['content'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Content
  // ═════════════════════════════════════════════════════════════════════════

  content: {
    /** Root key for all content queries. */
    all: () => [...contentKeys.all, 'items'] as const,

    /** Key for every content list query (used for broad invalidation). */
    lists: () => [...contentKeys.content.all(), 'list'] as const,

    /** Key for a specific content list query with its params. */
    list: (
      filters?: ContentFilters,
      sort?: ContentSortOptions,
      pagination?: PaginationParams,
    ) => [...contentKeys.content.lists(), filters, sort, pagination] as const,

    /** Key for every content detail query. */
    details: () => [...contentKeys.content.all(), 'detail'] as const,

    /** Key for a single content by ID. */
    detail: (id: string) => [...contentKeys.content.details(), id] as const,

    /** Key for content signed URL queries. */
    signedUrl: (id: string) => [...contentKeys.content.all(), 'signedUrl', id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Contents (alias for invalidating content queries from approval/tag hooks)
  // ═════════════════════════════════════════════════════════════════════════

  contents: {
    /** Key for every content list query. */
    lists: () => [...contentKeys.content.all(), 'list'] as const,

    /** Key for a single content by ID. */
    detail: (id: string) => [...contentKeys.content.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Approvals
  // ═════════════════════════════════════════════════════════════════════════

  approvals: {
    /** Root key for all approval queries. */
    all: () => [...contentKeys.all, 'approvals'] as const,

    /** Key for every approval list query. */
    lists: () => [...contentKeys.approvals.all(), 'list'] as const,

    /** Key for a specific approval list query. */
    list: (
      filters?: ApprovalQueryFilters,
      sort?: ApprovalRequestSortOptions,
      pagination?: PaginationParams,
    ) => [...contentKeys.approvals.lists(), filters, sort, pagination] as const,

    /** Key for pending approval list queries. */
    pending: () => [...contentKeys.approvals.all(), 'pending'] as const,

    /** Key for a specific pending approval list. */
    pendingList: (
      instituteId?: string,
      pagination?: PaginationParams,
    ) => [...contentKeys.approvals.pending(), instituteId, pagination] as const,

    /** Key for every approval detail query. */
    details: () => [...contentKeys.approvals.all(), 'detail'] as const,

    /** Key for a single approval by ID. */
    detail: (id: string) => [...contentKeys.approvals.details(), id] as const,

    /** Key for approval history queries. */
    historyList: (
      resourceId: string,
      resourceType?: ApprovalResourceType,
    ) => [...contentKeys.approvals.all(), 'history', resourceId, resourceType] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Tags
  // ═════════════════════════════════════════════════════════════════════════

  tags: {
    /** Root key for all tag queries. */
    all: () => [...contentKeys.all, 'tags'] as const,

    /** Key for every tag list query. */
    lists: () => [...contentKeys.tags.all(), 'list'] as const,

    /** Key for a specific tag list query. */
    list: (
      filters?: TagFilters,
      sort?: TagSortOptions,
      pagination?: PaginationParams,
    ) => [...contentKeys.tags.lists(), filters, sort, pagination] as const,

    /** Key for every tag detail query. */
    details: () => [...contentKeys.tags.all(), 'detail'] as const,

    /** Key for a single tag by ID. */
    detail: (id: string) => [...contentKeys.tags.details(), id] as const,
  },
};
