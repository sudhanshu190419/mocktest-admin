/**
 * Mock Test Query Key Factory
 *
 * Centralised, stable query key definitions for the Mock Test / Question Bank
 * module — questions, options, explanations, images, mock tests, mock test
 * questions, and publish operations.
 *
 * Every hook in this module derives its keys from this factory so that
 * cache invalidation is always consistent — mutating one entity never
 * accidentally invalidates another's cache.
 *
 * ## Structure
 *
 * Each entity follows the same hierarchy:
 * ```
 * <keys>.<entity>.all        → root for the entity
 * <keys>.<entity>.lists()     → all list-type queries
 * <keys>.<entity>.list(f,s,p) → specific list query (keyed by params)
 * <keys>.<entity>.details()   → all detail-type queries
 * <keys>.<entity>.detail(id)  → single item query
 * ```
 *
 * @module hooks/mockTest/queryKeys
 */

import type { PaginationParams } from '../../types/academic';
import type {
  QuestionFilters,
  QuestionSortOptions,
} from '../../types/mockTest';
import type {
  MockTestServiceFilters,
  MockTestServiceSortOptions,
} from '../../services/mockTest/mockTestService';

// ═══════════════════════════════════════════════════════════════════════════
//  questionKeys — Question Bank (existing, preserved)
// ═══════════════════════════════════════════════════════════════════════════

export const questionKeys = {
  all: ['questions'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Questions
  // ═════════════════════════════════════════════════════════════════════════

  questions: {
    /** Root key for all question queries. */
    all: () => [...questionKeys.all, 'questions'] as const,

    /** Key for every question list query (used for broad invalidation). */
    lists: () => [...questionKeys.questions.all(), 'list'] as const,

    /** Key for a specific question list query with its params. */
    list: (
      filters?: QuestionFilters,
      sort?: QuestionSortOptions,
      pagination?: PaginationParams,
    ) => [...questionKeys.questions.lists(), filters, sort, pagination] as const,

    /** Key for every question detail query. */
    details: () => [...questionKeys.questions.all(), 'detail'] as const,

    /** Key for a single question by ID. */
    detail: (id: string) => [...questionKeys.questions.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Options
  // ═════════════════════════════════════════════════════════════════════════

  options: {
    /** Root key for all option queries. */
    all: () => [...questionKeys.all, 'options'] as const,

    /** Key for every option list query. */
    lists: () => [...questionKeys.options.all(), 'list'] as const,

    /** Key for a specific option list query (keyed by questionId). */
    list: (questionId?: string) => [...questionKeys.options.lists(), questionId] as const,

    /** Key for every option detail query. */
    details: () => [...questionKeys.options.all(), 'detail'] as const,

    /** Key for a single option by ID. */
    detail: (id: string) => [...questionKeys.options.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Explanations
  // ═════════════════════════════════════════════════════════════════════════

  explanations: {
    /** Root key for all explanation queries. */
    all: () => [...questionKeys.all, 'explanations'] as const,

    /** Key for every explanation list query. */
    lists: () => [...questionKeys.explanations.all(), 'list'] as const,

    /** Key for a specific explanation list query (keyed by questionId). */
    list: (questionId?: string) => [...questionKeys.explanations.lists(), questionId] as const,

    /** Key for every explanation detail query. */
    details: () => [...questionKeys.explanations.all(), 'detail'] as const,

    /** Key for a single explanation by ID. */
    detail: (id: string) => [...questionKeys.explanations.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Images
  // ═════════════════════════════════════════════════════════════════════════

  images: {
    /** Root key for all image queries. */
    all: () => [...questionKeys.all, 'images'] as const,

    /** Key for every image list query. */
    lists: () => [...questionKeys.images.all(), 'list'] as const,

    /** Key for a specific image list query (keyed by questionId). */
    list: (questionId?: string) => [...questionKeys.images.lists(), questionId] as const,

    /** Key for every image detail query. */
    details: () => [...questionKeys.images.all(), 'detail'] as const,

    /** Key for a single image by ID. */
    detail: (id: string) => [...questionKeys.images.details(), id] as const,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  mockTestKeys — Mock Test Engine (new)
// ═══════════════════════════════════════════════════════════════════════════

export const mockTestKeys = {
  all: ['mockTests'] as const,

  // ═════════════════════════════════════════════════════════════════════════
  //  Mock Tests
  // ═════════════════════════════════════════════════════════════════════════

  mockTests: {
    /** Root key for all mock test queries. */
    all: () => [...mockTestKeys.all, 'mockTests'] as const,

    /** Key for every mock test list query (used for broad invalidation). */
    lists: () => [...mockTestKeys.mockTests.all(), 'list'] as const,

    /** Key for a specific mock test list query with its params. */
    list: (
      filters?: MockTestServiceFilters,
      sort?: MockTestServiceSortOptions,
      pagination?: PaginationParams,
    ) => [...mockTestKeys.mockTests.lists(), filters, sort, pagination] as const,

    /** Key for every mock test detail query. */
    details: () => [...mockTestKeys.mockTests.all(), 'detail'] as const,

    /** Key for a single mock test by ID. */
    detail: (id: string) => [...mockTestKeys.mockTests.details(), id] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Mock Test Questions
  // ═════════════════════════════════════════════════════════════════════════

  mockTestQuestions: {
    /** Root key for all mock test question queries. */
    all: () => [...mockTestKeys.all, 'mockTestQuestions'] as const,

    /** Key for every question list query (used for broad invalidation). */
    lists: () => [...mockTestKeys.mockTestQuestions.all(), 'list'] as const,

    /** Key for a specific question list query (keyed by mockTestId). */
    list: (mockTestId?: string) => [...mockTestKeys.mockTestQuestions.lists(), mockTestId] as const,

    /** Key for every question detail query. */
    details: () => [...mockTestKeys.mockTestQuestions.all(), 'detail'] as const,

    /** Key for a single question assignment by test ID and question ID. */
    detail: (testId: string, questionId: string) =>
      [...mockTestKeys.mockTestQuestions.details(), testId, questionId] as const,
  },

  // ═════════════════════════════════════════════════════════════════════════
  //  Publish
  // ═════════════════════════════════════════════════════════════════════════

  publish: {
    /** Root key for all publish-related queries. */
    all: () => [...mockTestKeys.all, 'publish'] as const,

    /** Key for every publish validation query. */
    validations: () => [...mockTestKeys.publish.all(), 'validation'] as const,

    /** Key for a specific publish validation query (keyed by testId). */
    validation: (testId?: string) => [...mockTestKeys.publish.validations(), testId] as const,

    /** Key for every publish summary query. */
    summaries: () => [...mockTestKeys.publish.all(), 'summary'] as const,

    /** Key for a specific publish summary query (keyed by testId). */
    summary: (testId?: string) => [...mockTestKeys.publish.summaries(), testId] as const,
  },
};
