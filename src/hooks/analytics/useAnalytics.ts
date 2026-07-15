/**
 * Analytics Hooks
 *
 * React Query hooks wrapping the analyticsService API calls.
 * Provides cached queries with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook                     | Type  | Description                             |
 * |--------------------------|-------|-----------------------------------------|
 * | `useStudentAnalytics`    | Query | Comprehensive student analytics         |
 * | `useTeacherAnalytics`    | Query | Teacher analytics                       |
 * | `useInstituteAnalytics`  | Query | Institute analytics                     |
 * | `useMockTestAnalytics`   | Query | Analytics for a single mock test        |
 * | `useDashboardAnalytics`  | Query | Dashboard overview                      |
 * | `useSubjectAnalytics`    | Query | Subject-level analytics for a student   |
 * | `useChapterAnalytics`    | Query | Chapter-level analytics for a student   |
 * | `usePerformanceTrend`    | Query | Student performance trend               |
 * | `useStudentDashboardSummary` | Query | Lightweight student dashboard summary |
 * | `useStudentScoreTrend`   | Query | Student score trend (line chart data)  |
 * | `useRecentActivity`      | Query | Recent activity for a student           |
 *
 * @module hooks/analytics/useAnalytics
 */

import { useQuery } from '@tanstack/react-query';
import { analyticsKeys } from './queryKeys';
import {
  getStudentAnalytics,
  getTeacherAnalytics,
  getInstituteAnalytics,
  getMockTestAnalytics,
  getDashboardAnalytics,
  getSubjectAnalytics,
  getChapterAnalytics,
  getPerformanceTrend,
  getRecentActivity,
  getStudentDashboardSummary,
  getStudentWeakChapters,
  getStudentStrongChapters,
  getStudentScoreTrend,
} from '../../services/analytics/analyticsService';
import type {
  StudentAnalytics,
  TeacherAnalytics,
  InstituteAnalytics,
  MockTestAnalytics,
  DashboardAnalytics,
  SubjectAnalytics,
  ChapterAnalytics,
  PerformanceTrendPoint,
  RecentActivity,
  StudentDashboardSummary,
  ChapterPerformanceSummary,
  ScoreTrendPoint,
} from '../../types/analytics';

// ─── Student Analytics ──────────────────────────────────────────────────────

/**
 * Fetch comprehensive analytics for a student.
 *
 * The query is disabled when `studentId` is falsy.
 *
 * @param studentId - UUID of the student.
 */
export function useStudentAnalytics(studentId: string | undefined | null) {
  return useQuery<StudentAnalytics>({
    queryKey: analyticsKeys.student.analytics(studentId ?? ''),
    queryFn: async () => {
      const result = await getStudentAnalytics(studentId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student analytics.');
      }
      return result.data!;
    },
    enabled: !!studentId,
    staleTime: 60_000, // 1 minute — analytics can be slightly stale
  });
}

// ─── Teacher Analytics ──────────────────────────────────────────────────────

/**
 * Fetch analytics for a teacher.
 *
 * The query is disabled when `teacherId` is falsy.
 *
 * @param teacherId - UUID of the teacher.
 */
export function useTeacherAnalytics(teacherId: string | undefined | null) {
  return useQuery<TeacherAnalytics>({
    queryKey: analyticsKeys.teacher.analytics(teacherId ?? ''),
    queryFn: async () => {
      const result = await getTeacherAnalytics(teacherId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch teacher analytics.');
      }
      return result.data!;
    },
    enabled: !!teacherId,
    staleTime: 60_000,
  });
}

// ─── Institute Analytics ────────────────────────────────────────────────────

/**
 * Fetch analytics for an institute.
 *
 * The query is disabled when `instituteId` is falsy.
 *
 * @param instituteId - UUID of the institute.
 */
export function useInstituteAnalytics(instituteId: string | undefined | null) {
  return useQuery<InstituteAnalytics>({
    queryKey: analyticsKeys.institute.analytics(instituteId ?? ''),
    queryFn: async () => {
      const result = await getInstituteAnalytics(instituteId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch institute analytics.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 60_000,
  });
}

// ─── Mock Test Analytics ────────────────────────────────────────────────────

/**
 * Fetch analytics for a specific mock test.
 *
 * The query is disabled when `testId` is falsy.
 *
 * @param testId - UUID of the mock test.
 */
export function useMockTestAnalytics(testId: string | undefined | null) {
  return useQuery<MockTestAnalytics>({
    queryKey: analyticsKeys.mockTest.analytics(testId ?? ''),
    queryFn: async () => {
      const result = await getMockTestAnalytics(testId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock test analytics.');
      }
      return result.data!;
    },
    enabled: !!testId,
    staleTime: 60_000,
  });
}

// ─── Dashboard Analytics ────────────────────────────────────────────────────

/**
 * Fetch dashboard overview combining student analytics, recent activity,
 * and mock test summary.
 */
export function useDashboardAnalytics() {
  return useQuery<DashboardAnalytics>({
    queryKey: analyticsKeys.dashboard.analytics(),
    queryFn: async () => {
      const result = await getDashboardAnalytics();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch dashboard analytics.');
      }
      return result.data!;
    },
    staleTime: 30_000,
  });
}

// ─── Subject Analytics ──────────────────────────────────────────────────────

/**
 * Fetch subject-level analytics for a student.
 *
 * The query is disabled when `studentId` is falsy.
 *
 * @note This hook accepts `studentId` for backward compatibility, but the
 *       underlying PostgreSQL RPC (`get_student_subject_analytics`) resolves
 *       the student from the authenticated session via `get_my_student_id()`.
 *       This means the hook only works correctly when the caller is viewing
 *       their own analytics. Teacher/admin views of other students' subject
 *       analytics should use a different pathway.
 *
 * @param studentId - UUID of the student (kept for API compatibility; RPC
 *                    ignores this and resolves from auth session).
 */
export function useSubjectAnalytics(studentId: string | undefined | null) {
  return useQuery<SubjectAnalytics>({
    queryKey: analyticsKeys.student.subject(studentId ?? ''),
    queryFn: async () => {
      const result = await getSubjectAnalytics(studentId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch subject analytics.');
      }
      return result.data!;
    },
    enabled: !!studentId,
    staleTime: 60_000,
  });
}

// ─── Chapter Analytics ──────────────────────────────────────────────────────

/**
 * Fetch chapter-level analytics for a student.
 *
 * The query is disabled when `studentId` is falsy.
 *
 * @note This hook accepts `studentId` for backward compatibility, but the
 *       underlying PostgreSQL RPC (`get_student_chapter_analytics`) resolves
 *       the student from the authenticated session via `get_my_student_id()`.
 *       This means the hook only works correctly when the caller is viewing
 *       their own analytics. Teacher/admin views of other students' chapter
 *       analytics should use a different pathway.
 *
 * @param studentId - UUID of the student (kept for API compatibility; RPC
 *                    ignores this and resolves from auth session).
 */
export function useChapterAnalytics(studentId: string | undefined | null) {
  return useQuery<ChapterAnalytics>({
    queryKey: analyticsKeys.student.chapter(studentId ?? ''),
    queryFn: async () => {
      const result = await getChapterAnalytics(studentId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch chapter analytics.');
      }
      return result.data!;
    },
    enabled: !!studentId,
    staleTime: 60_000,
  });
}

// ─── Performance Trend ──────────────────────────────────────────────────────

/**
 * Fetch the performance trend for a student.
 *
 * The query is disabled when `studentId` is falsy.
 *
 * @param studentId - UUID of the student.
 */
export function usePerformanceTrend(studentId: string | undefined | null) {
  return useQuery<PerformanceTrendPoint[]>({
    queryKey: analyticsKeys.student.trend(studentId ?? ''),
    queryFn: async () => {
      const result = await getPerformanceTrend(studentId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch performance trend.');
      }
      return result.data!;
    },
    enabled: !!studentId,
    staleTime: 60_000,
  });
}

// ─── Student Dashboard Summary ──────────────────────────────────────────────

/**
 * Fetch a lightweight student dashboard summary via the
 * get_student_dashboard_summary() PostgreSQL RPC.
 *
 * The RPC internally resolves the student_id from the authenticated
 * session via get_my_student_id(), so this hook takes no parameters.
 * The query runs automatically when the React Query client is mounted.
 */
export function useStudentDashboardSummary() {
  return useQuery<StudentDashboardSummary>({
    queryKey: analyticsKeys.summary.dashboard(),
    queryFn: async () => {
      const result = await getStudentDashboardSummary();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student dashboard summary.');
      }
      return result.data!;
    },
    staleTime: 30_000,
  });
}

// ─── Weak Chapters ──────────────────────────────────────────────────────────

/**
 * Fetch weak chapters for the authenticated student, ordered weakest → strongest.
 *
 * Backed by the `get_student_weak_chapters()` PostgreSQL RPC.
 * The RPC internally resolves the student_id from the authenticated
 * session via get_my_student_id(), so this hook takes no parameters.
 */
export function useStudentWeakChapters() {
  return useQuery<ChapterPerformanceSummary[]>({
    queryKey: analyticsKeys.weakChapters.list(),
    queryFn: async () => {
      const result = await getStudentWeakChapters();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch weak chapters.');
      }
      return result.data!;
    },
    staleTime: 30_000,
  });
}

// ─── Strong Chapters ────────────────────────────────────────────────────────

/**
 * Fetch strong chapters for the authenticated student, ordered strongest → weakest.
 *
 * Backed by the `get_student_strong_chapters()` PostgreSQL RPC.
 * The RPC internally resolves the student_id from the authenticated
 * session via get_my_student_id(), so this hook takes no parameters.
 */
export function useStudentStrongChapters() {
  return useQuery<ChapterPerformanceSummary[]>({
    queryKey: analyticsKeys.strongChapters.list(),
    queryFn: async () => {
      const result = await getStudentStrongChapters();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch strong chapters.');
      }
      return result.data!;
    },
    staleTime: 30_000,
  });
}

// ─── Score Trend ────────────────────────────────────────────────────────────

/**
 * Fetch the student's score trend — one record per released mock test result
 * in chronological order, suitable for line chart plotting.
 *
 * Backed by the `get_student_score_trend()` PostgreSQL RPC.
 * The RPC internally resolves the student_id from the authenticated session
 * via get_my_student_id(), so this hook takes no parameters.
 *
 * Data is ordered by attemptedOn ASC (server-side) so no client-side sorting
 * is required. Both the Website and Mobile App consume the same RPC.
 */
export function useStudentScoreTrend() {
  return useQuery<ScoreTrendPoint[]>({
    queryKey: analyticsKeys.scoreTrend.list(),
    queryFn: async () => {
      const result = await getStudentScoreTrend();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch student score trend.');
      }
      return result.data!;
    },
    staleTime: 30_000,
  });
}

// ─── Recent Activity ────────────────────────────────────────────────────────

/**
 * Fetch recent activity for a student.
 *
 * The query is disabled when `studentId` is falsy.
 *
 * @param studentId - UUID of the student.
 * @param limit     - Maximum number of entries (default 10).
 */
export function useRecentActivity(
  studentId: string | undefined | null,
  limit: number = 10,
) {
  return useQuery<RecentActivity[]>({
    queryKey: [...analyticsKeys.student.activity(studentId ?? ''), limit] as const,
    queryFn: async () => {
      const result = await getRecentActivity(studentId!, limit);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch recent activity.');
      }
      return result.data!;
    },
    enabled: !!studentId,
    staleTime: 30_000,
  });
}
