/**
 * Attendance Analytics Hooks
 *
 * React Query hooks for the Admin Attendance Management module.
 * Provides caching, background revalidation, and request deduplication.
 *
 * ## Exports
 *
 * | Hook                           | Description                                     |
 * |--------------------------------|-------------------------------------------------|
 * | `useAdminAttendanceSummary`    | Summary KPI cards (RPC consolidated)            |
 * | `useAdminAttendanceBatches`    | Batch dropdown options                          |
 * | `useAdminAttendanceTeachers`   | Teacher dropdown options                        |
 * | `useAdminBatchAttendance`      | Tab 1: Batch attendance table                   |
 * | `useAdminTeacherAttendance`    | Tab 2: Teacher attendance table                 |
 * | `useAdminLiveClassAttendance`  | Tab 4: Live class attendance table              |
 *
 * @module hooks/admin/useAttendanceAnalytics
 */

import { useQuery } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { attendanceAnalyticsService } from '@/services/attendanceAnalyticsService';
import { liveClassAttendanceService } from '@/services/liveClassAttendanceService';
import type { AttendanceRecord } from '@/services/liveClassAttendanceService';
import type {
  AdminAttendanceSummary,
  BatchAttendanceSummary,
  AdminTeacherAttendanceRow,
  AdminTeacherBatchItem,
  AdminTeacherBatchClassesResult,
  LiveClassAttendanceSummary,
  LiveClassAttendanceFilter,
  PaginatedAdminLiveClassAttendanceResult,
} from '@/services/attendanceAnalyticsService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch attendance summary KPI cards for the admin dashboard.
 *
 * @param instituteId - Scope to institute.
 *
 * Cache key: `['admin', 'attendance', 'summary', instituteId]`
 * Stale time: 2 minutes
 */
export function useAdminAttendanceSummary(instituteId?: string | null) {
  return useQuery<AdminAttendanceSummary>({
    queryKey: adminKeys.attendance.summary(instituteId),
    queryFn: async () => {
      if (!instituteId) {
        return {
          totalStudents: 0,
          totalLiveClasses: 0,
          overallAttendancePercent: 0,
          studentsBelowThreshold: 0,
        };
      }
      return await attendanceAnalyticsService.getAdminSummary(instituteId);
    },
    enabled: Boolean(instituteId),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch batch dropdown options for attendance filtering.
 *
 * @param instituteId - Scope to institute.
 *
 * Cache key: `['admin', 'attendance', 'batches', instituteId]`
 * Stale time: 5 minutes (batch names change rarely)
 */
export function useAdminAttendanceBatches(instituteId?: string | null) {
  return useQuery<{ batchId: string; name: string }[]>({
    queryKey: adminKeys.attendance.batches(instituteId),
    queryFn: async () => {
      if (!instituteId) return [];
      return await attendanceAnalyticsService.getAdminBatches(instituteId);
    },
    enabled: Boolean(instituteId),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch teacher dropdown options for attendance filtering.
 *
 * @param instituteId - Scope to institute.
 *
 * Cache key: `['admin', 'attendance', 'teachers', instituteId]`
 * Stale time: 5 minutes (teacher list changes rarely)
 */
export function useAdminAttendanceTeachers(instituteId?: string | null) {
  return useQuery<{ teacherId: string; name: string }[]>({
    queryKey: adminKeys.attendance.teachers(instituteId),
    queryFn: async () => {
      if (!instituteId) return [];
      return await attendanceAnalyticsService.getAdminTeachers(instituteId);
    },
    enabled: Boolean(instituteId),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch batch-level attendance summary (Tab 1).
 *
 * @param instituteId - Scope to institute.
 * @param filters - Optional date range and teacher filter.
 * @param options - Optional query configuration (e.g. enabled flag when active tab).
 *
 * Cache key: `['admin', 'attendance', 'batch', instituteId, filters]`
 * Stale time: 2 minutes
 */
export function useAdminBatchAttendance(
  instituteId?: string | null,
  filters?: { dateFrom?: string; dateTo?: string; teacherId?: string; batchId?: string },
  options?: { enabled?: boolean },
) {
  return useQuery<BatchAttendanceSummary[]>({
    queryKey: adminKeys.attendance.batch(instituteId, filters),
    queryFn: async () => {
      if (!instituteId) return [];
      return await attendanceAnalyticsService.getAdminBatchAttendance(instituteId, filters);
    },
    enabled: Boolean(instituteId) && (options?.enabled ?? true),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch teacher-level attendance summary (Tab 2).
 *
 * @param instituteId - Scope to institute.
 * @param filters - Optional date range filter.
 * @param options - Optional query configuration (e.g. enabled flag when active tab).
 *
 * Cache key: `['admin', 'attendance', 'teacher', instituteId, filters]`
 * Stale time: 2 minutes
 */
export function useAdminTeacherAttendance(
  instituteId?: string | null,
  filters?: { dateFrom?: string; dateTo?: string },
  options?: { enabled?: boolean },
) {
  return useQuery<AdminTeacherAttendanceRow[]>({
    queryKey: adminKeys.attendance.teacher(instituteId, filters),
    queryFn: async () => {
      if (!instituteId) return [];
      return await attendanceAnalyticsService.getAdminTeacherAttendance(instituteId, filters);
    },
    enabled: Boolean(instituteId) && (options?.enabled ?? true),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch batches associated with a teacher and class counts (Level 2 drill-down).
 */
export function useAdminTeacherBatches(
  instituteId?: string | null,
  teacherId?: string | null,
  filters?: { dateFrom?: string; dateTo?: string },
  options?: { enabled?: boolean },
) {
  return useQuery<AdminTeacherBatchItem[]>({
    queryKey: adminKeys.attendance.teacherBatches(instituteId, teacherId, filters),
    queryFn: async () => {
      if (!instituteId || !teacherId) return [];
      return await attendanceAnalyticsService.getAdminTeacherBatches(instituteId, teacherId, filters);
    },
    enabled: Boolean(instituteId && teacherId) && (options?.enabled ?? true),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch paginated classes for a teacher and batch (Level 3 drill-down).
 */
export function useAdminTeacherBatchClasses(
  instituteId?: string | null,
  teacherId?: string | null,
  batchId?: string | null,
  filters?: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number },
  options?: { enabled?: boolean },
) {
  return useQuery<AdminTeacherBatchClassesResult>({
    queryKey: adminKeys.attendance.teacherBatchClasses(instituteId, teacherId, batchId, filters),
    queryFn: async () => {
      if (!instituteId || !teacherId || !batchId) {
        return { classes: [], total: 0, page: 1, pageSize: 10, totalPages: 0 };
      }
      return await attendanceAnalyticsService.getAdminTeacherBatchClasses(
        instituteId,
        teacherId,
        batchId,
        filters,
      );
    },
    enabled: Boolean(instituteId && teacherId && batchId) && (options?.enabled ?? true),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch live class attendance summary (Tab 4).
 *
 * @param instituteId - Scope to institute.
 * @param filters - Optional date range, teacher, and batch filters.
 * @param options - Optional query configuration (e.g. enabled flag when active tab).
 *
 * Cache key: `['admin', 'attendance', 'liveClass', instituteId, filters]`
 * Stale time: 2 minutes
 */
export function useAdminLiveClassAttendance(
  instituteId?: string | null,
  filters?: LiveClassAttendanceFilter,
  options?: { enabled?: boolean },
) {
  return useQuery<PaginatedAdminLiveClassAttendanceResult>({
    queryKey: adminKeys.attendance.liveClass(instituteId, filters),
    queryFn: async () => {
      if (!instituteId) return { classes: [], total: 0, page: 1, pageSize: 10, totalPages: 0 };
      return await attendanceAnalyticsService.getAdminLiveClassAttendance(instituteId, filters);
    },
    enabled: Boolean(instituteId) && (options?.enabled ?? true),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch attendance sheet records for a specific live class.
 * Cached with 2 minutes stale time so repeated clicks on the same class
 * load instantly without database refetch.
 *
 * @param classId - The UUID of the live_classes row.
 * @param options - Optional query configuration.
 */
export function useClassAttendance(
  classId?: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery<(AttendanceRecord & { studentName?: string })[]>({
    queryKey: adminKeys.attendance.classDetail(classId),
    queryFn: async () => {
      if (!classId) return [];
      return await liveClassAttendanceService.getClassAttendance(classId);
    },
    enabled: Boolean(classId) && (options?.enabled ?? true),
    staleTime: 2 * 60 * 1000,
  });
}
