'use client';

/**
 * useStudentRecordings
 *
 * React Query hooks for the Student Recorded Classes module.
 * Direct port of the optimized two-tier mobile architecture.
 *
 * Provides:
 * - useStudentActiveBatchIds — 3-tier batch resolution (cached dashboard -> in-flight -> direct fallback)
 * - useStudentRecordingSubjects — Level 1 subject overview RPC
 * - useStudentRecordingsInfinite — Level 2 subject recordings keyset cursor pagination
 * - invalidateStudentRecordings — selective query invalidation
 *
 * @module hooks/student/useStudentRecordings
 */

import { useMemo } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import {
  studentDashboardKeys,
  type StudentDashboardSummary,
  type StudentDashboardShell,
} from '@/services/student/studentDashboardWebService';
import { isUuidString } from '@/services/student/studentCourseWebService';
import {
  getStudentRecordingSubjects,
  getStudentRecordingsPage,
  fetchActiveStudentBatchIds,
  type StudentSubjectSummary,
  type RecordingCursor,
  type StudentRecordingsPage,
} from '@/services/student/studentRecordingWebService';

// ═══════════════════════════════════════════════════════════════════════════
//  Query Keys
// ═══════════════════════════════════════════════════════════════════════════

export const studentRecordingKeys = {
  all: ['student', 'recordings'] as const,
  subjects: (userId?: string | null, batchIdsKey?: string) =>
    [...studentRecordingKeys.all, 'subjects', userId ?? '', batchIdsKey ?? ''] as const,
  lists: () => [...studentRecordingKeys.all, 'list'] as const,
  subjectList: (userId?: string | null, subjectId?: string | null, batchIdsKey?: string) =>
    [...studentRecordingKeys.lists(), userId ?? '', subjectId ?? '', batchIdsKey ?? ''] as const,
  details: () => [...studentRecordingKeys.all, 'detail'] as const,
  detail: (id: string) => [...studentRecordingKeys.details(), id] as const,
  playback: (id: string) => [...studentRecordingKeys.all, 'playback', id] as const,
  progress: (id: string) => [...studentRecordingKeys.all, 'progress', id] as const,
  batches: (userId?: string | null) => [...studentRecordingKeys.all, 'batches', userId ?? ''] as const,
};

// ═══════════════════════════════════════════════════════════════════════════
//  Batch Resolution Hook (3-Tier Strategy)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolves active batch IDs for the student with a multi-tier strategy:
 * 1. Synchronously checks already-cached Dashboard data in React Query:
 *    - studentDashboardKeys.overviewPrimary
 *    - studentDashboardKeys.overviewShell
 *    - studentDashboardKeys.bootstrap
 *    If cached, returns batch IDs synchronously with 0 lag and 0 network requests.
 * 2. Reuses in-flight dashboard queries if one is currently fetching.
 * 3. Fallback: queries batch_students directly using authenticated client + Postgres RLS.
 */
export function useStudentActiveBatchIds(options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const profileId = user?.id ?? null;

  // Tier 1: Check existing React Query cache synchronously
  const synchronousBatchIds = useMemo(() => {
    if (!profileId) return null;

    // Check primary dashboard summary
    const cachedPrimary = queryClient.getQueryData<StudentDashboardSummary>(
      studentDashboardKeys.overviewPrimary(profileId),
    );
    if (Array.isArray(cachedPrimary?.activeBatches) && cachedPrimary.activeBatches.length > 0) {
      return cachedPrimary.activeBatches
        .map((b) => b.batch_id)
        .filter((id) => typeof id === 'string' && isUuidString(id));
    }

    // Check shell dashboard summary
    const cachedShell = queryClient.getQueryData<StudentDashboardShell>(
      studentDashboardKeys.overviewShell(profileId),
    );
    if (Array.isArray(cachedShell?.bootstrap?.active_batches) && cachedShell.bootstrap.active_batches.length > 0) {
      return cachedShell.bootstrap.active_batches
        .map((b: any) => b.batch_id)
        .filter((id: any) => typeof id === 'string' && isUuidString(id));
    }

    // Check raw bootstrap
    const cachedBootstrap = queryClient.getQueryData<any>(
      studentDashboardKeys.bootstrap(profileId),
    );
    if (Array.isArray(cachedBootstrap?.active_batches) && cachedBootstrap.active_batches.length > 0) {
      return cachedBootstrap.active_batches
        .map((b: any) => b.batch_id)
        .filter((id: any) => typeof id === 'string' && isUuidString(id));
    }

    return null;
  }, [profileId, queryClient]);

  // Tier 2 & 3: When not synchronously cached, resolve via in-flight query or fallback
  const asyncQuery = useQuery({
    queryKey: studentRecordingKeys.batches(profileId),
    queryFn: async () => {
      if (!profileId) return [];

      // Check for in-flight primary query
      const queryCache = queryClient.getQueryCache();
      const existingPrimary = queryCache.find({
        queryKey: studentDashboardKeys.overviewPrimary(profileId),
      });

      if (
        existingPrimary?.promise ||
        (existingPrimary?.state.fetchStatus === 'fetching' && existingPrimary?.state.status === 'pending')
      ) {
        try {
          const primaryData = (await (existingPrimary.promise ||
            queryClient.fetchQuery({
              queryKey: studentDashboardKeys.overviewPrimary(profileId),
            }))) as StudentDashboardSummary;

          if (Array.isArray(primaryData?.activeBatches)) {
            return primaryData.activeBatches
              .map((b) => b.batch_id)
              .filter((id) => typeof id === 'string' && isUuidString(id));
          }
        } catch (err) {
          console.warn('[useStudentActiveBatchIds] In-flight primary failed, falling back to batch_students:', err);
        }
      }

      // Fallback: direct query to batch_students
      return fetchActiveStudentBatchIds();
    },
    enabled: (options?.enabled ?? true) && !!profileId && synchronousBatchIds === null,
    staleTime: 5 * 60 * 1000,
  });

  const batchIds = synchronousBatchIds ?? asyncQuery.data ?? [];
  const isLoading = synchronousBatchIds === null && asyncQuery.isLoading;

  return {
    batchIds,
    isLoading,
    isError: asyncQuery.isError,
    error: asyncQuery.error,
    refetch: async () => {
      if (asyncQuery.refetch) {
        await asyncQuery.refetch();
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Level 1: Subject Overview Hook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch subject summaries (Level 1 Overview) for student's batches.
 * Returns only subjects that have >= 1 completed, non-deleted recording.
 *
 * Query Key: ['student', 'recordings', 'subjects', userId, batchIdsKey]
 * Stale time: 5 minutes.
 */
export function useStudentRecordingSubjects(
  batchIds: string[],
  options?: { enabled?: boolean },
) {
  const { user } = useAuth();
  const sortedBatchKey = useMemo(() => batchIds.slice().sort().join(','), [batchIds]);

  return useQuery<StudentSubjectSummary[], Error>({
    queryKey: studentRecordingKeys.subjects(user?.id, sortedBatchKey),
    queryFn: () => getStudentRecordingSubjects(batchIds),
    enabled: (options?.enabled ?? true) && batchIds.length > 0 && !!user,
    staleTime: 5 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Level 2: Subject Recordings Infinite Hook (Keyset Pagination)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch paginated recordings for a specific subject (Level 2) using keyset cursor pagination.
 *
 * Query Key: ['student', 'recordings', 'list', userId, subjectId, batchIdsKey]
 * Stale time: 5 minutes.
 */
export function useStudentRecordingsInfinite(
  batchIds: string[],
  subjectId: string | null | undefined,
  options?: { enabled?: boolean; search?: string; pageSize?: number },
) {
  const { user } = useAuth();
  const sortedBatchKey = useMemo(() => batchIds.slice().sort().join(','), [batchIds]);
  const pageSize = options?.pageSize ?? 20;

  return useInfiniteQuery<
    StudentRecordingsPage,
    Error,
    InfiniteData<StudentRecordingsPage>,
    readonly unknown[],
    RecordingCursor | null
  >({
    queryKey: studentRecordingKeys.subjectList(user?.id, subjectId ?? '', sortedBatchKey),
    queryFn: ({ pageParam }) =>
      getStudentRecordingsPage(batchIds, {
        subjectId: subjectId!,
        cursor: pageParam,
        pageSize,
        search: options?.search,
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled:
      (options?.enabled ?? true) &&
      !!subjectId &&
      isUuidString(subjectId) &&
      batchIds.length > 0 &&
      !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/** Invalidate all student recording queries (Level 1 summaries and Level 2 recording lists). */
export function invalidateStudentRecordings(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...studentRecordingKeys.all, 'subjects'],
    }),
    queryClient.invalidateQueries({
      queryKey: [...studentRecordingKeys.all, 'list'],
    }),
  ]);
}
