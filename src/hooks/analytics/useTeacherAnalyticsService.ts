/**
 * Teacher Analytics Hooks
 *
 * React Query hooks wrapping the teacherAnalyticsService API calls.
 * Provides cached queries with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                            | Type  | Description                              |
 * |----------------------------------|-------|------------------------------------------|
 * | `useTeacherAnalyticsDashboard`   | Query | Dashboard summary cards & activity       |
 * | `useStudentAggregateAnalytics`   | Query | Student-level aggregate analytics        |
 * | `useTeacherMockTestAnalytics`    | Query | Mock test analytics                      |
 * | `useTeacherSubjectAnalytics`     | Query | Subject analytics                        |
 * | `useTeacherChapterAnalytics`     | Query | Chapter analytics                        |
 * | `useTeacherQuestionAnalytics`    | Query | Question analytics                       |
 * | `useTeacherPerformanceTrends`    | Query | Performance trends                       |
 * | `useTeacherLeaderboard`          | Query | Leaderboard data                         |
 * | `useTeacherInsights`             | Query | Data-driven insights                     |
 *
 * @module hooks/analytics/useTeacherAnalyticsService
 */

import { useQuery } from '@tanstack/react-query';
import { teacherAnalyticsKeys } from './queryKeys-extended';
import {
  getAnalyticsDashboard,
  getStudentAggregateAnalytics,
  getMockTestAnalytics,
  getSubjectAnalytics,
  getChapterAnalytics,
  getQuestionAnalytics,
  getPerformanceTrends,
  getLeaderboard,
  getInsights,
  getStudentBucketDrilldown,
} from '@/services/analytics/teacherAnalyticsService';
import type { AnalyticsFilters } from '@/types/analytics-extended';
import type {
  TeacherAnalyticsDashboard,
  StudentAggregateAnalytics,
  TeacherMockTestAnalytics,
  TeacherSubjectAnalytics,
  TeacherChapterAnalytics,
  TeacherQuestionAnalytics,
  TeacherPerformanceTrends,
  TeacherLeaderboard,
  TeacherInsights,
  StudentBucketDrilldownParams,
  StudentBucketDrilldownResult,
} from '@/types/analytics-extended';

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function useTeacherAnalyticsDashboard(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherAnalyticsDashboard>({
    queryKey: teacherAnalyticsKeys.dashboard.analytics(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getAnalyticsDashboard(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch analytics dashboard.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 30_000,
  });
}

// ─── Student Aggregate ──────────────────────────────────────────────────────

export function useStudentAggregateAnalytics(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<StudentAggregateAnalytics>({
    queryKey: teacherAnalyticsKeys.students.aggregate(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getStudentAggregateAnalytics(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student aggregate analytics.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Mock Test Analytics ────────────────────────────────────────────────────

export function useTeacherMockTestAnalytics(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherMockTestAnalytics>({
    queryKey: teacherAnalyticsKeys.mockTests.analytics(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getMockTestAnalytics(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test analytics.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Subject Analytics ──────────────────────────────────────────────────────

export function useTeacherSubjectAnalytics(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherSubjectAnalytics>({
    queryKey: teacherAnalyticsKeys.subjects.analytics(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getSubjectAnalytics(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subject analytics.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Chapter Analytics ──────────────────────────────────────────────────────

export function useTeacherChapterAnalytics(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherChapterAnalytics>({
    queryKey: teacherAnalyticsKeys.chapters.analytics(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getChapterAnalytics(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch chapter analytics.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Question Analytics ─────────────────────────────────────────────────────

export function useTeacherQuestionAnalytics(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherQuestionAnalytics>({
    queryKey: teacherAnalyticsKeys.questions.analytics(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getQuestionAnalytics(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch question analytics.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Performance Trends ─────────────────────────────────────────────────────

export function useTeacherPerformanceTrends(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherPerformanceTrends>({
    queryKey: teacherAnalyticsKeys.trends.analytics(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getPerformanceTrends(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch performance trends.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export function useTeacherLeaderboard(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherLeaderboard>({
    queryKey: teacherAnalyticsKeys.leaderboard.data(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getLeaderboard(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch leaderboard.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Insights ───────────────────────────────────────────────────────────────

export function useTeacherInsights(
  instituteId: string | undefined | null,
  filters?: AnalyticsFilters,
) {
  return useQuery<TeacherInsights>({
    queryKey: teacherAnalyticsKeys.insights.data(instituteId ?? '', filters),
    queryFn: async () => {
      const result = await getInsights(instituteId!, filters);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch insights.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 120_000,
  });
}

// ─── Student Bucket Drilldown ───────────────────────────────────────────────

export function useStudentBucketDrilldown(
  instituteId: string | undefined | null,
  params: StudentBucketDrilldownParams | null,
  options?: { enabled?: boolean },
) {
  return useQuery<StudentBucketDrilldownResult>({
    queryKey: teacherAnalyticsKeys.students.drilldown(instituteId ?? '', params),
    queryFn: async () => {
      if (!instituteId || !params) {
        return { items: [], totalCount: 0, page: 1, pageSize: 10, totalPages: 1 };
      }
      const result = await getStudentBucketDrilldown(instituteId, params);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student drilldown data');
      }
      return result.data!;
    },
    enabled: (options?.enabled ?? true) && !!instituteId && !!params,
    staleTime: 60_000,
  });
}
