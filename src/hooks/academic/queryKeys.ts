/**
 * Academic Query Key Factory
 *
 * Centralised, stable query key definitions for the Academic module.
 *
 * Every hook in this module derives its keys from this factory so that
 * cache invalidation is always consistent — mutating one entity never
 * accidentally invalidates another's cache.
 *
 * ## Structure
 *
 * Each entity follows the same hierarchy:
 * ```
 * academicKeys.<entity>.all        → root for the entity
 * academicKeys.<entity>.lists()     → all list-type queries
 * academicKeys.<entity>.list(f,s,p) → specific list query (keyed by params)
 * academicKeys.<entity>.details()   → all detail-type queries
 * academicKeys.<entity>.detail(id)  → single item query
 * ```
 *
 * @module hooks/academic/queryKeys
 */

import type {
  BatchFilters,
  BatchSortOptions,
  ChapterFilters,
  ChapterSortOptions,
  PaginationParams,
  StreamFilters,
  StreamSortOptions,
  SubjectFilters,
  SubjectSortOptions,
  TopicFilters,
  TopicSortOptions,
} from '../../types/academic';

// ─── Root ───────────────────────────────────────────────────────────────────

export const academicKeys = {
  all: ['academic'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Stream
  // ═════════════════════════════════════════════════════════════════════════

  streams: {
    /** Root key for all stream queries. */
    all: () => [...academicKeys.all, 'streams'] as const,

    /** Key for every stream list query (used for broad invalidation). */
    lists: () => [...academicKeys.streams.all(), 'list'] as const,

    /** Key for a specific stream list query with its params. */
    list: (
      filters?: StreamFilters,
      sort?: StreamSortOptions,
      pagination?: PaginationParams,
    ) => [...academicKeys.streams.lists(), filters, sort, pagination] as const,

    /** Key for every stream detail query. */
    details: () => [...academicKeys.streams.all(), 'detail'] as const,

    /** Key for a single stream by ID. */
    detail: (id: string) => [...academicKeys.streams.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Subject
  // ═════════════════════════════════════════════════════════════════════════

  subjects: {
    all: () => [...academicKeys.all, 'subjects'] as const,

    lists: () => [...academicKeys.subjects.all(), 'list'] as const,

    list: (
      filters?: SubjectFilters,
      sort?: SubjectSortOptions,
      pagination?: PaginationParams,
    ) => [...academicKeys.subjects.lists(), filters, sort, pagination] as const,

    details: () => [...academicKeys.subjects.all(), 'detail'] as const,

    detail: (id: string) => [...academicKeys.subjects.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Chapter
  // ═════════════════════════════════════════════════════════════════════════

  chapters: {
    all: () => [...academicKeys.all, 'chapters'] as const,

    lists: () => [...academicKeys.chapters.all(), 'list'] as const,

    list: (
      filters?: ChapterFilters,
      sort?: ChapterSortOptions,
      pagination?: PaginationParams,
    ) => [...academicKeys.chapters.lists(), filters, sort, pagination] as const,

    details: () => [...academicKeys.chapters.all(), 'detail'] as const,

    detail: (id: string) => [...academicKeys.chapters.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Topic
  // ═════════════════════════════════════════════════════════════════════════

  topics: {
    all: () => [...academicKeys.all, 'topics'] as const,

    lists: () => [...academicKeys.topics.all(), 'list'] as const,

    list: (
      filters?: TopicFilters,
      sort?: TopicSortOptions,
      pagination?: PaginationParams,
    ) => [...academicKeys.topics.lists(), filters, sort, pagination] as const,

    details: () => [...academicKeys.topics.all(), 'detail'] as const,

    detail: (id: string) => [...academicKeys.topics.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Batch
  // ═════════════════════════════════════════════════════════════════════════

  batches: {
    all: () => [...academicKeys.all, 'batches'] as const,

    lists: () => [...academicKeys.batches.all(), 'list'] as const,

    list: (
      filters?: BatchFilters,
      sort?: BatchSortOptions,
      pagination?: PaginationParams,
    ) => [...academicKeys.batches.lists(), filters, sort, pagination] as const,

    details: () => [...academicKeys.batches.all(), 'detail'] as const,

    detail: (id: string) => [...academicKeys.batches.details(), id] as const,
  },
};
