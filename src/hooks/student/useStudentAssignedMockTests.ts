'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import {
  fetchStudentAssignedMockTests,
  studentTestKeys,
  type StudentTestsHubData,
} from '@/services/student/studentTestWebService';

/**
 * Shared query options for student assigned mock tests.
 * Guarantees that both the /student/tests page and the navigation badge
 * resolve the exact same queryKey, queryFn, and cache settings for
 * automatic React Query deduplication on cold and warm loads.
 */
export function getAssignedTestsQueryOptions(profileId?: string | null) {
  return {
    queryKey: studentTestKeys.assigned(profileId),
    queryFn: () =>
      fetchStudentAssignedMockTests(
        undefined,
        profileId ? { profileId } : undefined,
      ),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    enabled: Boolean(profileId),
  } as const;
}

/**
 * Canonical React Query hook for the Student Mock Tests Hub (/student/tests).
 */
export function useStudentAssignedMockTests() {
  const { user } = useAuth();
  const profileId = user?.id ?? null;

  return useQuery<StudentTestsHubData>({
    ...getAssignedTestsQueryOptions(profileId),
    refetchOnWindowFocus: false,
  });
}
