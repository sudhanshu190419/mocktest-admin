'use client';

import { useQuery } from '@tanstack/react-query';
import { useMyDoubts } from '@/hooks/doubt/useDoubt';
import { fetchStudentAssignedMockTests, type StudentMockTestCardItem } from '@/services/student/studentTestWebService';
import { isDueThisWeek } from '@/lib/testCardState';

/**
 * PRD C6 — badge counts for the nav surfaces:
 *  - Tests: tests due this week (opens, available, in-progress, or submitted)
 *  - Doubts: open + in-progress ("waiting on faculty" + "faculty is on it")
 *
 * Shared by the sub-nav and the mobile bottom bar; react-query caches one truth.
 */

const TESTS_STALE_MS = 120_000;

export interface NavBadgeCounts {
  testsDue: number;
  openDoubts: number;
}

/** Open + in-progress doubts via server count on two targeted page-1 queries. */
export function useOpenDoubtCount(): number {
  const open = useMyDoubts({ status: 'open' }, { page: 1, pageSize: 1 });
  const inProgress = useMyDoubts({ status: 'in_progress' }, { page: 1, pageSize: 1 });
  return (open.data?.count ?? 0) + (inProgress.data?.count ?? 0);
}

/** Tests due this week (§7.3 isDueThisWeek), resilient (0 on error). */
export function useTestsDueCount(): number {
  const query = useQuery<{ tests: StudentMockTestCardItem[] }>({
    queryKey: ['nav-badge-tests-due'],
    queryFn: async () => {
      const result = await fetchStudentAssignedMockTests();
      return { tests: result.tests || [] };
    },
    staleTime: TESTS_STALE_MS,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const tests = query.data?.tests;
  if (!tests) return 0;
  return tests.filter((t) => isDueThisWeek(t)).length;
}

export function useNavBadgeCounts(): NavBadgeCounts {
  const openDoubts = useOpenDoubtCount();
  const testsDue = useTestsDueCount();
  return { openDoubts, testsDue };
}
