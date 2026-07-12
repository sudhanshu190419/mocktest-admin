/**
 * Extended Analytics Query Key Factory
 *
 * Query key definitions for teacher-level analytics hooks.
 * Extends the existing analyticsKeys from queryKeys.ts.
 *
 * @module hooks/analytics/queryKeys-extended
 */

import type { AnalyticsFilters } from '@/types/analytics-extended';

export const teacherAnalyticsKeys = {
  all: ['analytics', 'teacher'] as const,

  dashboard: {
    all: () => [...teacherAnalyticsKeys.all, 'dashboard'] as const,
    analytics: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.dashboard.all(), instituteId, filters] as const,
  },

  students: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'students', instituteId] as const,
    aggregate: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.students.all(instituteId), 'aggregate', filters] as const,
  },

  mockTests: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'mockTests', instituteId] as const,
    analytics: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.mockTests.all(instituteId), 'analytics', filters] as const,
  },

  subjects: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'subjects', instituteId] as const,
    analytics: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.subjects.all(instituteId), 'analytics', filters] as const,
  },

  chapters: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'chapters', instituteId] as const,
    analytics: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.chapters.all(instituteId), 'analytics', filters] as const,
  },

  questions: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'questions', instituteId] as const,
    analytics: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.questions.all(instituteId), 'analytics', filters] as const,
  },

  trends: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'trends', instituteId] as const,
    analytics: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.trends.all(instituteId), 'analytics', filters] as const,
  },

  leaderboard: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'leaderboard', instituteId] as const,
    data: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.leaderboard.all(instituteId), 'data', filters] as const,
  },

  insights: {
    all: (instituteId: string) => [...teacherAnalyticsKeys.all, 'insights', instituteId] as const,
    data: (instituteId: string, filters?: AnalyticsFilters) =>
      [...teacherAnalyticsKeys.insights.all(instituteId), 'data', filters] as const,
  },
};
