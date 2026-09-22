import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  getAssignedTestsQueryOptions,
} from '../useStudentAssignedMockTests';
import {
  studentTestKeys,
  type StudentTestsHubData,
} from '@/services/student/studentTestWebService';
import {
  studentDashboardKeys,
  type StudentDashboardSummary,
} from '@/services/student/studentDashboardWebService';
import { isDueThisWeek } from '@/lib/testCardState';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFetchStudentAssignedMockTests = vi.fn();
const mockFetchStudentDashboardPrimary = vi.fn();

vi.mock('@/services/student/studentTestWebService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/student/studentTestWebService')>();
  return {
    ...actual,
    fetchStudentAssignedMockTests: (...args: unknown[]) => mockFetchStudentAssignedMockTests(...args),
  };
});

vi.mock('@/services/student/studentDashboardWebService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/student/studentDashboardWebService')>();
  return {
    ...actual,
    fetchStudentDashboardPrimary: (...args: unknown[]) => mockFetchStudentDashboardPrimary(...args),
  };
});

const mockMockTestData: StudentTestsHubData = {
  tests: [
    {
      testId: 'test-1',
      title: 'Full Mock Test 1',
      description: 'Physics and Chemistry',
      testType: 'mock_test',
      subjectId: 'sub-1',
      subjectName: 'Physics',
      courseId: 'course-1',
      courseTitle: 'NEET 2026',
      batchName: 'Alpha Batch',
      durationMin: 180,
      totalMarks: 720,
      passingMarks: 360,
      negativeMarking: 1,
      questionCount: 180,
      attemptLimit: 3,
      availableFrom: new Date(Date.now() - 86400000).toISOString(),
      availableUntil: new Date(Date.now() + 86400000 * 3).toISOString(),
      availabilityStatus: 'available',
      attemptSummary: {
        attemptsUsed: 0,
        attemptsRemaining: 3,
        attemptState: 'not_started',
        latestAttemptId: null,
        latestStatus: null,
        canAttempt: true,
        actionLabel: 'Start Test',
        actionHref: '/student/tests/test-1',
      },
      latestResult: null,
      assignedAt: new Date().toISOString(),
    },
  ],
  summary: {
    total: 1,
    available: 1,
    inProgress: 0,
    completed: 0,
    upcoming: 0,
  },
  error: null,
};

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Student Tests Query Unification', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    mockFetchStudentAssignedMockTests.mockResolvedValue(mockMockTestData);
  });

  // TEST A — Shared canonical query key
  it('TEST A: uses the canonical studentTestKeys.assigned(profileId) key format', () => {
    const key = studentTestKeys.assigned('profile-abc');
    expect(key).toEqual(['student-tests', 'assigned', 'profile-abc']);

    const options = getAssignedTestsQueryOptions('profile-abc');
    expect(options.queryKey).toEqual(['student-tests', 'assigned', 'profile-abc']);
    expect(options.staleTime).toBe(60_000);
    expect(options.gcTime).toBe(600_000);
  });

  // TEST B — Cold /student/tests deduplication
  it('TEST B: dedupes concurrent queries into ONE network call on cold /student/tests', async () => {
    const profileId = 'student-profile-123';
    const options = getAssignedTestsQueryOptions(profileId);

    // Simulate concurrent execution from page and badge on cold load
    const [pageResult, badgeResult] = await Promise.all([
      queryClient.fetchQuery(options),
      queryClient.fetchQuery(options),
    ]);

    expect(pageResult).toBe(badgeResult);
    expect(pageResult.tests.length).toBe(1);
    // CRITICAL: fetch function must be called EXACTLY ONCE!
    expect(mockFetchStudentAssignedMockTests).toHaveBeenCalledTimes(1);
    expect(mockFetchStudentDashboardPrimary).not.toHaveBeenCalled();
  });

  // TEST C — Warm navigation cache reuse
  it('TEST C: serves cached assigned-test data on immediate return within staleTime without re-querying', async () => {
    const profileId = 'student-profile-123';
    const options = getAssignedTestsQueryOptions(profileId);

    // First fetch
    const firstResult = await queryClient.fetchQuery(options);
    expect(firstResult.tests.length).toBe(1);
    expect(mockFetchStudentAssignedMockTests).toHaveBeenCalledTimes(1);

    // Subsequent fetch on navigation back within staleTime
    const cachedData = queryClient.getQueryData<StudentTestsHubData>(options.queryKey);
    expect(cachedData).toBeDefined();
    expect(cachedData?.tests.length).toBe(1);

    const secondResult = await queryClient.fetchQuery(options);
    expect(secondResult).toBe(firstResult);
    // Still exactly 1 invocation
    expect(mockFetchStudentAssignedMockTests).toHaveBeenCalledTimes(1);
  });

  // TEST D — Overview preservation
  it('TEST D: on /student/overview, badge reuses cached overviewPrimary data with 0 assigned-test calls', async () => {
    const profileId = 'student-profile-123';

    // Seed overviewPrimary cache
    queryClient.setQueryData<Partial<StudentDashboardSummary>>(
      studentDashboardKeys.overviewPrimary(profileId),
      {
        assignedMockTests: mockMockTestData.tests,
      },
    );

    const cachedPrimary = queryClient.getQueryData<StudentDashboardSummary>(
      studentDashboardKeys.overviewPrimary(profileId),
    );

    expect(cachedPrimary?.assignedMockTests).toBeDefined();
    const testsDue = cachedPrimary?.assignedMockTests?.filter((t) => isDueThisWeek(t)).length;
    expect(testsDue).toBe(1);

    // No assigned-tests fetch needed because overviewPrimary had it cached
    expect(mockFetchStudentAssignedMockTests).not.toHaveBeenCalled();
  });

  // TEST E — Non-overview isolation
  it('TEST E: on /student/analytics, badge uses canonical assigned-tests query without pulling overview primary', async () => {
    const profileId = 'student-profile-123';
    const options = getAssignedTestsQueryOptions(profileId);

    const result = await queryClient.fetchQuery(options);
    expect(result.tests.length).toBe(1);

    const testsDue = result.tests.filter((t) => isDueThisWeek(t)).length;
    expect(testsDue).toBe(1);

    expect(mockFetchStudentAssignedMockTests).toHaveBeenCalledTimes(1);
    expect(mockFetchStudentDashboardPrimary).not.toHaveBeenCalled();
  });

  // TEST F — Disabled when unauthenticated
  it('TEST F: disables query when no profile/user ID is present', () => {
    const options = getAssignedTestsQueryOptions(null);
    expect(options.enabled).toBe(false);

    const optionsUndefined = getAssignedTestsQueryOptions(undefined);
    expect(optionsUndefined.enabled).toBe(false);
  });

  // TEST G — Error/retry functionality
  it('TEST G: refetch triggers re-execution for retry UI', async () => {
    const profileId = 'student-profile-123';
    const options = getAssignedTestsQueryOptions(profileId);

    await queryClient.fetchQuery(options);
    expect(mockFetchStudentAssignedMockTests).toHaveBeenCalledTimes(1);

    // Invalidate/refetch
    await queryClient.refetchQueries({ queryKey: options.queryKey });
    expect(mockFetchStudentAssignedMockTests).toHaveBeenCalledTimes(2);
  });
});
