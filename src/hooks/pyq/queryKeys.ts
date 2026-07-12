/**
 * PYQ Query Key Factory
 *
 * Centralised, stable query key definitions for the PYQ (Previous Year Questions)
 * module — packages, papers, and related entities.
 *
 * Every hook in this module derives its keys from this factory so that
 * cache invalidation is always consistent — mutating one entity never
 * accidentally invalidates another's cache.
 *
 * ## Structure
 *
 * Each entity follows the same hierarchy:
 * ```
 * pyqKeys.<entity>.all        → root for the entity
 * pyqKeys.<entity>.lists()     → all list-type queries
 * pyqKeys.<entity>.list(f,s,p) → specific list query (keyed by params)
 * pyqKeys.<entity>.details()   → all detail-type queries
 * pyqKeys.<entity>.detail(id)  → single item query
 * ```
 *
 * @module hooks/pyq/queryKeys
 */

import type { PaginationParams } from '../../types/academic';
import type {
  PyqPackageFilters,
  PyqPackageSortOptions,
  PyqPaperFilters,
  PyqPaperSortOptions,
  PyqQuestionMappingFilters,
  PyqQuestionMappingSortOptions,
} from '../../types/pyq';

export const pyqKeys = {
  all: ['pyq'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Packages
  // ═════════════════════════════════════════════════════════════════════════

  packages: {
    /** Root key for all PYQ package queries. */
    all: () => [...pyqKeys.all, 'packages'] as const,

    /** Key for every package list query (used for broad invalidation). */
    lists: () => [...pyqKeys.packages.all(), 'list'] as const,

    /** Key for a specific package list query with its params. */
    list: (
      filters?: PyqPackageFilters,
      sort?: PyqPackageSortOptions,
      pagination?: PaginationParams,
    ) => [...pyqKeys.packages.lists(), filters, sort, pagination] as const,

    /** Key for every package detail query. */
    details: () => [...pyqKeys.packages.all(), 'detail'] as const,

    /** Key for a single package by ID. */
    detail: (id: string) => [...pyqKeys.packages.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Papers
  // ═════════════════════════════════════════════════════════════════════════

  papers: {
    /** Root key for all PYQ paper queries. */
    all: () => [...pyqKeys.all, 'papers'] as const,

    /** Key for every paper list query (used for broad invalidation). */
    lists: () => [...pyqKeys.papers.all(), 'list'] as const,

    /** Key for a specific paper list query with its params. */
    list: (
      filters?: PyqPaperFilters,
      sort?: PyqPaperSortOptions,
      pagination?: PaginationParams,
    ) => [...pyqKeys.papers.lists(), filters, sort, pagination] as const,

    /** Key for every paper detail query. */
    details: () => [...pyqKeys.papers.all(), 'detail'] as const,

    /** Key for a single paper by ID. */
    detail: (id: string) => [...pyqKeys.papers.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Question Mappings
  // ═════════════════════════════════════════════════════════════════════════

  questionMappings: {
    /** Root key for all PYQ question mapping queries. */
    all: () => [...pyqKeys.all, 'questionMappings'] as const,

    /** Key for every question mapping list query (used for broad invalidation). */
    lists: () => [...pyqKeys.questionMappings.all(), 'list'] as const,

    /** Key for a specific question mapping list query (keyed by paperId). */
    list: (
      paperId?: string,
      filters?: PyqQuestionMappingFilters,
      sort?: PyqQuestionMappingSortOptions,
    ) => [...pyqKeys.questionMappings.lists(), paperId, filters, sort] as const,

    /** Key for every question mapping detail query. */
    details: () => [...pyqKeys.questionMappings.all(), 'detail'] as const,

    /** Key for a single question mapping by paper ID and question ID. */
    detail: (paperId: string, questionId: string) =>
      [...pyqKeys.questionMappings.details(), paperId, questionId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Mock Mappings
  // ═════════════════════════════════════════════════════════════════════════

  mockMappings: {
    /** Root key for all PYQ mock mapping queries. */
    all: () => [...pyqKeys.all, 'mockMappings'] as const,

    /** Key for every mock mapping list query. */
    lists: () => [...pyqKeys.mockMappings.all(), 'list'] as const,

    /** Key for a specific mock mapping list query (keyed by paperId). */
    list: (paperId?: string) => [...pyqKeys.mockMappings.lists(), paperId] as const,

    /** Key for every mock mapping detail query. */
    details: () => [...pyqKeys.mockMappings.all(), 'detail'] as const,

    /** Key for a single mock mapping by paper ID. */
    detail: (paperId: string) =>
      [...pyqKeys.mockMappings.details(), paperId] as const,
  },
};
