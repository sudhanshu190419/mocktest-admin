'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useMyDoubtCount } from '@/hooks/doubt/useDoubt';
import { useAuth } from '@/context/AuthContext';
import {
  type StudentMockTestCardItem,
} from '@/services/student/studentTestWebService';
import {
  fetchStudentDashboardPrimary,
  studentDashboardKeys,
  type StudentDashboardSummary,
} from '@/services/student/studentDashboardWebService';
import { getAssignedTestsQueryOptions } from '@/hooks/student/useStudentAssignedMockTests';
import { isDueThisWeek } from '@/lib/testCardState';

import type { DoubtStatus } from '@/types/doubt';

/**
 * PRD C6 — badge counts for the nav surfaces:
 *  - Tests: tests due this week (opens, available, in-progress, or submitted)
 *  - Doubts: open + in-progress ("waiting on faculty" + "faculty is on it")
 *
 * Shared by the sub-nav and the mobile bottom bar; react-query caches one truth.
 */

export interface NavBadgeCounts {
  testsDue: number;
  openDoubts: number;
}

const OPEN_DOUBT_STATUSES: DoubtStatus[] = ['open', 'in_progress'];

/** Open + in-progress doubts via one count-only server request. */
export function useOpenDoubtCount(): number {
  const query = useMyDoubtCount(OPEN_DOUBT_STATUSES);
  return query.data ?? 0;
}

/** Tests due this week (§7.3 isDueThisWeek), resilient (0 on error). */
export function useTestsDueCount(): number {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const pathname = usePathname();
  const isOverviewRoute = pathname === '/student/overview';

  // 1. On /student/overview, share the overview primary query so the badge and
  // the dashboard stay deduplicated on the same React Query key.
  const overviewPrimaryQuery = useQuery<{ tests: StudentMockTestCardItem[] }>({
    queryKey: ['nav-badge-overview-tests', profileId],
    queryFn: async () => {
      const cachedPrimary = queryClient.getQueryData<StudentDashboardSummary>(
        studentDashboardKeys.overviewPrimary(profileId),
      );
      if (cachedPrimary?.assignedMockTests) {
        return { tests: cachedPrimary.assignedMockTests };
      }

      try {
        const primary = await queryClient.fetchQuery({
          queryKey: studentDashboardKeys.overviewPrimary(profileId),
          queryFn: fetchStudentDashboardPrimary,
          staleTime: 30_000,
        });
        return { tests: primary.assignedMockTests };
      } catch {
        const result = await queryClient.fetchQuery(getAssignedTestsQueryOptions(profileId));
        return { tests: result.tests || [] };
      }
    },
    enabled: isOverviewRoute && Boolean(profileId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // 2. On non-overview routes (/student/tests, /student/analytics, etc.), use the
  // canonical assigned-tests query. This shares one in-flight request and cache
  // with /student/tests on cold load, and avoids pulling the overview pipeline.
  const assignedTestsQuery = useQuery({
    ...getAssignedTestsQueryOptions(profileId),
    enabled: !isOverviewRoute && Boolean(profileId),
    refetchOnWindowFocus: false,
  });

  if (isOverviewRoute) {
    const tests = overviewPrimaryQuery.data?.tests;
    if (!tests) return 0;
    return tests.filter((t) => isDueThisWeek(t)).length;
  }

  // On non-overview routes: check if overviewPrimary happens to be cached in memory (Plan A)
  const cachedPrimary = queryClient.getQueryData<StudentDashboardSummary>(
    studentDashboardKeys.overviewPrimary(profileId),
  );
  const tests = cachedPrimary?.assignedMockTests || assignedTestsQuery.data?.tests;
  if (!tests) return 0;
  return tests.filter((t) => isDueThisWeek(t)).length;
}

export function useNavBadgeCounts(): NavBadgeCounts {
  const openDoubts = useOpenDoubtCount();
  const testsDue = useTestsDueCount();
  return { openDoubts, testsDue };
}
