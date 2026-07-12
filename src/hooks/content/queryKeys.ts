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
} from '../../types/content';

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
  },
};
