'use client';

/**
 * useStudentTimetable
 *
 * Authoritative React Query hooks for the Student Timetable web application.
 * Direct port of the optimized mobile architecture.
 *
 * Provides:
 * - Tab-scoped query activation (default: week; month/today/year enabled only when active)
 * - In-memory covering cache (extracts Today's schedule from cached Week with 0 requests)
 * - Stable query keys based on date range and sorted batch IDs
 * - 5-minute stale-time caching eliminating redundant refetches
 * - Seamless integration with StudentTimetableView
 *
 * @module hooks/student/useStudentTimetable
 */

import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';
import {
  fetchTodayTimetable,
  fetchWeekTimetable,
  fetchMonthTimetable,
  fetchAnnualTimetable,
} from '@/services/student/studentTimetableWebService';
import {
  formatDateToIsoDate,
  getWeekDaysForDate,
  getAcademicYearInfo,
  getAcademicYearMonths,
  buildAcademicYearFromStartYear,
  groupSessionsByDate,
  type TimetableSessionItem,
  type DynamicDayItem,
  type AcademicYearInfo,
} from '@/utils/studentTimetableProjector';

export const TIMETABLE_STALE_TIME = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════════════════════════
//  Query Keys
// ═══════════════════════════════════════════════════════════════════════════

export const studentTimetableKeys = {
  all: ['student', 'timetable'] as const,
  ranges: () => [...studentTimetableKeys.all, 'range'] as const,
  range: (startDate: string, endDate: string, batchIds?: string[]) =>
    [
      ...studentTimetableKeys.ranges(),
      {
        startDate,
        endDate,
        batchIds: batchIds && batchIds.length > 0 ? [...batchIds].sort() : undefined,
      },
    ] as const,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Cache Inspection Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Searches the React Query cache for any active or cached schedule range query
 * that fully encompasses the requested [startDate, endDate] window.
 *
 * E.g., if a 7-day Week query (2026-09-21 to 2026-09-27) is cached,
 * a request for Today (2026-09-24 to 2026-09-24) can be extracted directly
 * in memory without making a duplicate network request.
 */
export function findCoveringCachedSchedule(
  queryClient: QueryClient,
  startDate: string,
  endDate: string,
  batchIds?: string[],
): { sessions: TimetableSessionItem[]; grouped: Record<string, TimetableSessionItem[]> } | null {
  const queries = queryClient.getQueriesData<{
    sessions: TimetableSessionItem[];
    grouped?: Record<string, TimetableSessionItem[]>;
  }>({
    queryKey: studentTimetableKeys.ranges(),
  });

  const sortedBatchKey = batchIds && batchIds.length > 0 ? [...batchIds].sort().join(',') : undefined;

  for (const [key, data] of queries) {
    if (!data || !Array.isArray(data.sessions)) continue;
    const filterObj = (key as any[])[3];
    if (filterObj && typeof filterObj === 'object') {
      const cachedStart = filterObj.startDate;
      const cachedEnd = filterObj.endDate;
      const cachedBatchKey = filterObj.batchIds && Array.isArray(filterObj.batchIds)
        ? filterObj.batchIds.join(',')
        : undefined;

      if (
        sortedBatchKey === cachedBatchKey &&
        typeof cachedStart === 'string' &&
        typeof cachedEnd === 'string' &&
        cachedStart <= startDate &&
        cachedEnd >= endDate
      ) {
        const filteredSessions = data.sessions.filter(
          (s) => s.date >= startDate && s.date <= endDate,
        );
        return {
          sessions: filteredSessions,
          grouped: groupSessionsByDate(filteredSessions),
        };
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Individual Query Hooks
// ═══════════════════════════════════════════════════════════════════════════

export function useStudentTimetableWeek(
  weekReferenceDate?: Date,
  options: { batchIds?: string[]; enabled?: boolean } = {},
) {
  const { batchIds, enabled = true } = options;
  const refTime = weekReferenceDate ? weekReferenceDate.getTime() : null;
  const days = useMemo(() => getWeekDaysForDate(weekReferenceDate ?? new Date()), [refTime]);
  const startDate = days[0].dateString;
  const endDate = days[6].dateString;

  return useQuery({
    queryKey: studentTimetableKeys.range(startDate, endDate, batchIds),
    queryFn: () => fetchWeekTimetable(weekReferenceDate ?? new Date()),
    staleTime: TIMETABLE_STALE_TIME,
    enabled,
  });
}

export function useStudentTimetableToday(
  options: { batchIds?: string[]; enabled?: boolean } = {},
) {
  const { batchIds, enabled = true } = options;
  const queryClient = useQueryClient();
  const todayStr = useMemo(() => formatDateToIsoDate(new Date()), []);

  return useQuery({
    queryKey: studentTimetableKeys.range(todayStr, todayStr, batchIds),
    queryFn: async () => {
      // Check if covering week/month query is in React Query cache
      const cached = findCoveringCachedSchedule(queryClient, todayStr, todayStr, batchIds);
      if (cached) {
        return {
          sessions: cached.sessions,
          todayStr,
          grouped: cached.grouped,
        };
      }
      return await fetchTodayTimetable(new Date(), batchIds);
    },
    staleTime: TIMETABLE_STALE_TIME,
    enabled,
    placeholderData: () => {
      const cached = findCoveringCachedSchedule(queryClient, todayStr, todayStr, batchIds);
      if (cached) {
        return {
          sessions: cached.sessions,
          todayStr,
          grouped: cached.grouped,
        };
      }
      return undefined;
    },
  });
}

export function useStudentTimetableMonth(
  year?: number,
  month?: number,
  options: { batchIds?: string[]; enabled?: boolean } = {},
) {
  const { batchIds, enabled = true } = options;
  const queryClient = useQueryClient();
  const resolvedYear = year ?? new Date().getFullYear();
  const resolvedMonth = month ?? new Date().getMonth() + 1;
  const lastDay = useMemo(() => new Date(resolvedYear, resolvedMonth, 0).getDate(), [resolvedYear, resolvedMonth]);
  const mStr = String(resolvedMonth).padStart(2, '0');
  const startDate = `${resolvedYear}-${mStr}-01`;
  const endDate = `${resolvedYear}-${mStr}-${String(lastDay).padStart(2, '0')}`;

  return useQuery({
    queryKey: studentTimetableKeys.range(startDate, endDate, batchIds),
    queryFn: async () => {
      const cached = findCoveringCachedSchedule(queryClient, startDate, endDate, batchIds);
      if (cached) {
        return {
          year: resolvedYear,
          month: resolvedMonth,
          startDate,
          endDate,
          sessions: cached.sessions,
          grouped: cached.grouped,
        };
      }
      return await fetchMonthTimetable(resolvedYear, resolvedMonth);
    },
    staleTime: TIMETABLE_STALE_TIME,
    enabled,
    placeholderData: () => {
      const cached = findCoveringCachedSchedule(queryClient, startDate, endDate, batchIds);
      if (cached) {
        return {
          year: resolvedYear,
          month: resolvedMonth,
          startDate,
          endDate,
          sessions: cached.sessions,
          grouped: cached.grouped,
        };
      }
      return undefined;
    },
  });
}

export function useStudentTimetableAnnual(
  startYear?: number,
  options: { batchIds?: string[]; enabled?: boolean } = {},
) {
  const { batchIds, enabled = true } = options;
  const academicYear = useMemo(() => {
    return startYear ? buildAcademicYearFromStartYear(startYear) : getAcademicYearInfo();
  }, [startYear]);

  return useQuery({
    queryKey: studentTimetableKeys.range(academicYear.startDate, academicYear.endDate, batchIds),
    queryFn: () => fetchAnnualTimetable(startYear),
    staleTime: TIMETABLE_STALE_TIME,
    enabled,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Composite Hook
// ═══════════════════════════════════════════════════════════════════════════

export interface UseStudentTimetableOptions {
  activeTab?: 'today' | 'week' | 'month' | 'year';
  weekReferenceDate?: Date;
  monthYear?: number;
  monthNumber?: number;
  selectedStartYear?: number;
  batchIds?: string[];
  enabled?: boolean;
}

export function useStudentTimetable(options: UseStudentTimetableOptions = {}) {
  const {
    activeTab = 'week',
    weekReferenceDate,
    monthYear,
    monthNumber,
    selectedStartYear,
    batchIds,
    enabled = true,
  } = options;

  // 1. Week Query (default, enabled when activeTab === 'week')
  const weekQuery = useStudentTimetableWeek(weekReferenceDate, {
    batchIds,
    enabled: enabled && activeTab === 'week',
  });

  // 2. Today Query (enabled when activeTab === 'today')
  const todayQuery = useStudentTimetableToday({
    batchIds,
    enabled: enabled && activeTab === 'today',
  });

  // 3. Month Query (enabled only when activeTab === 'month')
  const monthQuery = useStudentTimetableMonth(monthYear, monthNumber, {
    batchIds,
    enabled: enabled && activeTab === 'month',
  });

  // 4. Annual Query (enabled only when activeTab === 'year')
  const annualQuery = useStudentTimetableAnnual(selectedStartYear, {
    batchIds,
    enabled: enabled && activeTab === 'year',
  });

  // Derive active loading state
  const isLoading = useMemo(() => {
    if (!enabled) return false;
    switch (activeTab) {
      case 'today':
        return todayQuery.isLoading;
      case 'week':
        return weekQuery.isLoading;
      case 'month':
        return monthQuery.isLoading;
      case 'year':
        return annualQuery.isLoading;
      default:
        return false;
    }
  }, [
    activeTab,
    enabled,
    todayQuery.isLoading,
    weekQuery.isLoading,
    monthQuery.isLoading,
    annualQuery.isLoading,
  ]);

  const isFetching = useMemo(() => {
    if (!enabled) return false;
    switch (activeTab) {
      case 'today':
        return todayQuery.isFetching;
      case 'week':
        return weekQuery.isFetching;
      case 'month':
        return monthQuery.isFetching;
      case 'year':
        return annualQuery.isFetching;
      default:
        return false;
    }
  }, [
    activeTab,
    enabled,
    todayQuery.isFetching,
    weekQuery.isFetching,
    monthQuery.isFetching,
    annualQuery.isFetching,
  ]);

  const isError = useMemo(() => {
    switch (activeTab) {
      case 'today':
        return todayQuery.isError;
      case 'week':
        return weekQuery.isError;
      case 'month':
        return monthQuery.isError;
      case 'year':
        return annualQuery.isError;
      default:
        return false;
    }
  }, [activeTab, todayQuery.isError, weekQuery.isError, monthQuery.isError, annualQuery.isError]);

  const error = useMemo(() => {
    switch (activeTab) {
      case 'today':
        return todayQuery.error;
      case 'week':
        return weekQuery.error;
      case 'month':
        return monthQuery.error;
      case 'year':
        return annualQuery.error;
      default:
        return null;
    }
  }, [activeTab, todayQuery.error, weekQuery.error, monthQuery.error, annualQuery.error]);

  const refetch = useCallback(async () => {
    switch (activeTab) {
      case 'today':
        return await todayQuery.refetch();
      case 'week':
        return await weekQuery.refetch();
      case 'month':
        return await monthQuery.refetch();
      case 'year':
        return await annualQuery.refetch();
    }
  }, [activeTab, todayQuery, weekQuery, monthQuery, annualQuery]);

  const fallbackAcademicYear = useMemo(() => {
    return selectedStartYear ? buildAcademicYearFromStartYear(selectedStartYear) : getAcademicYearInfo();
  }, [selectedStartYear]);

  const fallbackAnnualMonths = useMemo(() => {
    return getAcademicYearMonths(fallbackAcademicYear.startYear);
  }, [fallbackAcademicYear.startYear]);

  const fallbackWeekDays = useMemo(() => {
    return getWeekDaysForDate(weekReferenceDate ?? new Date());
  }, [weekReferenceDate]);

  return {
    todaySessions: todayQuery.data?.sessions ?? [],
    weekSessions: weekQuery.data?.sessions ?? [],
    weekDays: weekQuery.data?.days ?? fallbackWeekDays,
    monthSessions: monthQuery.data?.sessions ?? [],
    annualSessions: annualQuery.data?.sessions ?? [],
    annualMonths: annualQuery.data?.months ?? fallbackAnnualMonths,
    annualInfo: annualQuery.data?.academicYear ?? fallbackAcademicYear,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  };
}
