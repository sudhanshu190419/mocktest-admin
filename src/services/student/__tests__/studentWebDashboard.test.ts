import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getPostLoginDestination } from '@/lib/auth/routing';
import {
  fetchCompleteStudentDashboard,
  fetchStudentDashboardPrimary,
  fetchStudentDashboardShell,
} from '@/services/student/studentDashboardWebService';
import { supabase } from '@/config/supabase';
import * as testWebService from '@/services/student/studentTestWebService';

describe('Student Web Shell & Dashboard Verification', () => {
  it('Routing matrix directs role=student and role=user to /student/overview', () => {
    expect(getPostLoginDestination('student', 'approved')).toBe('/student/overview');
    expect(getPostLoginDestination('user', 'approved')).toBe('/student/overview');
    expect(getPostLoginDestination('teacher', 'approved')).toBe('/teacher');
    expect(getPostLoginDestination('admin', 'approved')).toBe('/admin');
  });

  it('Student Layout exists and wraps children with StudentGuard', () => {
    const layoutPath = 'src/app/student/layout.tsx';
    expect(fs.existsSync(layoutPath)).toBe(true);

    const layoutContent = fs.readFileSync(layoutPath, 'utf8');
    expect(layoutContent).toContain('StudentGuard');
    expect(layoutContent).toContain('CourseStoreShell');
    expect(layoutContent).toContain('StudentBottomNav');
  });

  it('Student Sidebar exports navigation for all core student modules', () => {
    const sidebarPath = 'src/components/student/StudentSidebar.tsx';
    expect(fs.existsSync(sidebarPath)).toBe(true);

    const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
    expect(sidebarContent).toContain('/student/overview');
    expect(sidebarContent).toContain('/student/courses');
    expect(sidebarContent).toContain('/student/classes');
    expect(sidebarContent).toContain('/student/recordings');
    expect(sidebarContent).toContain('/student/tests');
    expect(sidebarContent).toContain('/student/results');
    expect(sidebarContent).toContain('/student/timetable');
    expect(sidebarContent).toContain('/student/doubts');
    expect(sidebarContent).toContain('/student/analytics');
    expect(sidebarContent).toContain('/student/profile');
  });

  it('Student Overview Dashboard imports and renders core sections with empty and dynamic states', () => {
    const overviewPath = 'src/app/student/overview/page.tsx';
    expect(fs.existsSync(overviewPath)).toBe(true);

    const overviewContent = fs.readFileSync(overviewPath, 'utf8');
    // Section 1: Greeting / Resume
    expect(overviewContent).toContain('getGreeting');
    // Section 2: Live Class Banner
    expect(overviewContent).toContain('Live Class Active');
    // Section 3: Today's schedule
    expect(overviewContent).toContain('schedule');
    // Section 4: This week's tests
    expect(overviewContent).toContain('tests');
    // Section 5: Momentum
    expect(overviewContent).toContain('Momentum');
    // Section 6: Worth practicing
    expect(overviewContent).toContain('Worth practicing');
  });

  it('All 8 placeholder student routes exist', () => {
    const routes = ['courses', 'classes', 'recordings', 'tests', 'timetable', 'doubts', 'analytics', 'profile'];
    for (const route of routes) {
      const p = path.join('src/app/student', route, 'page.tsx');
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('studentDashboardWebService reuses get_home_screen_bootstrap and get_courses_content_summary RPCs', () => {
    const servicePath = 'src/services/student/studentDashboardWebService.ts';
    expect(fs.existsSync(servicePath)).toBe(true);

    const serviceContent = fs.readFileSync(servicePath, 'utf8');
    expect(serviceContent).toContain('get_home_screen_bootstrap');
    expect(serviceContent).toContain('get_courses_content_summary');
    expect(serviceContent).toContain('get_student_subject_analytics');
    expect(serviceContent).toContain('get_student_weak_chapters');
    expect(serviceContent).toContain('get_student_score_trend');
    expect(serviceContent).toContain('fetchStudentAssignedMockTests');
  });
});

describe('Task 1: Student Overview Dashboard Cleanup Verification', () => {
  const overviewContent = fs.readFileSync('src/app/student/overview/page.tsx', 'utf8');
  const serviceContent = fs.readFileSync('src/services/student/studentDashboardWebService.ts', 'utf8');

  it('1. No hardcoded mock test titles remain in overview page', () => {
    expect(overviewContent).not.toContain('NEET Full Length Mock Test #04');
    expect(overviewContent).not.toContain('Organic Chemistry Chapter-wise Assessment');
    expect(overviewContent).not.toContain('Physics Mechanics Unit Speed Test');
  });

  it('2. Empty assigned mock tests state is present and user-friendly', () => {
    expect(overviewContent).toContain('No tests due this week');
    expect(overviewContent).toContain('weekTests.length > 0');
  });

  it('3. Real assigned mock tests are wired from service and render dynamic properties', () => {
    expect(overviewContent).toContain('assignedMockTests');
    expect(overviewContent).toContain('TestStateCard');
    expect(overviewContent).toContain('weekTests');
  });

  it('4. No fabricated weak chapter names remain in overview page', () => {
    expect(overviewContent).not.toContain('Rotational Dynamics');
    expect(overviewContent).not.toContain('Aldehydes, Ketones & Carboxylic');
    expect(overviewContent).not.toContain('Plant Physiology & Transport');
  });

  it('5. Educational empty state is shown when no weak chapters exist', () => {
    expect(overviewContent).toContain('No weak areas identified yet');
    expect(overviewContent).toContain("we&apos;ll point out exactly what to practice.");
  });

  it('6. No fabricated rank (#42) exists in service or overview', () => {
    expect(serviceContent).not.toContain("'#42'");
    expect(serviceContent).not.toContain('"#42"');
    expect(overviewContent).not.toContain("'#42'");
  });

  it('7. No synthetic percentile formula (* 1.1) exists in service or overview', () => {
    expect(serviceContent).not.toContain('* 1.1');
    expect(serviceContent).not.toContain('overallAccuracy * 1.1');
    expect(overviewContent).not.toContain('* 1.1');
  });

  it('8. No fabricated subject fallback array exists in overview', () => {
    expect(overviewContent).not.toContain("{ subject_id: 'phy', subject_name: 'Physics'");
    expect(overviewContent).not.toContain("{ subject_id: 'chem', subject_name: 'Chemistry'");
  });

  it('9. Error and loading states are properly supported with retry capability', () => {
    expect(overviewContent).toContain('Try Again');
    expect(overviewContent).toContain("load your day");
    expect(overviewContent).toContain('skeleton');
  });
});

describe('Student Dashboard Analytics & Data Contract Functional Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Default chainable mock for supabase.from
    const mockQuery: any = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    vi.spyOn(supabase, 'from').mockReturnValue(mockQuery);
  });

  it('fetchCompleteStudentDashboard returns honest neutral values when student has 0 tests', async () => {
    // Mock Supabase RPC responses
    vi.spyOn(supabase, 'rpc').mockImplementation(((rpcName: string) => {
      if (rpcName === 'get_home_screen_bootstrap') {
        return {
          data: {
            profile: { profile_id: 'p-1', name: 'Test Student', role: 'student' },
            active_batches: [],
            enrolled_courses: [],
            unread_notifications_count: 0,
          },
          error: null,
        } as any;
      }
      if (rpcName === 'get_student_score_trend') {
        return { data: [], error: null } as any;
      }
      if (rpcName === 'get_student_subject_analytics') {
        return { data: [], error: null } as any;
      }
      if (rpcName === 'get_student_weak_chapters') {
        return { data: [], error: null } as any;
      }
      if (rpcName === 'get_courses_content_summary') {
        return { data: {}, error: null } as any;
      }
      return { data: null, error: null } as any;
    }) as any);

    vi.spyOn(testWebService, 'fetchStudentAssignedMockTests').mockResolvedValue({
      tests: [],
      summary: { total: 0, available: 0, inProgress: 0, completed: 0, upcoming: 0 },
      error: null,
    });

    const dashboard = await fetchCompleteStudentDashboard();

    expect(dashboard.analytics.testsAttempted).toBe(0);
    expect(dashboard.analytics.averageScore).toBe(0);
    expect(dashboard.analytics.accuracy).toBe(0);
    expect(dashboard.analytics.rank).toBe('--');
    expect(dashboard.analytics.percentile).toBeNull();
    expect(dashboard.assignedMockTests).toEqual([]);
    expect(dashboard.weakChapters).toEqual([]);
    expect(dashboard.subjectAnalytics).toEqual([]);
  });

  it('fetchCompleteStudentDashboard preserves genuine rank and percentile from backend test results', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(((rpcName: string) => {
      if (rpcName === 'get_home_screen_bootstrap') {
        return {
          data: {
            profile: { profile_id: 'p-2', name: 'Top Student', role: 'student' },
            active_batches: [{ batch_id: 'b-1', name: 'NEET Droppers 2026', batch_code: 'NEET-01' }],
            enrolled_courses: [{ course_id: 'c-1', title: 'Complete Physics' }],
            unread_notifications_count: 2,
          },
          error: null,
        } as any;
      }
      if (rpcName === 'get_student_score_trend') {
        return {
          data: [
            {
              result_id: 'res-1',
              test_id: 't-1',
              test_name: 'NEET Grand Test 1',
              score: 650,
              max_score: 720,
              percentage: 90,
              accuracy: 94,
              rank: 3,
              percentile: 98.5,
              attempted_on: '2026-09-15T10:00:00Z',
            },
          ],
          error: null,
        } as any;
      }
      if (rpcName === 'get_student_subject_analytics') {
        return {
          data: [
            {
              subject_id: 's-1',
              subject_name: 'Physics',
              questions_attempted: 50,
              correct_count: 47,
              wrong_count: 3,
              skipped_count: 0,
              accuracy: 94,
              score: 188,
              total_score: 200,
            },
          ],
          error: null,
        } as any;
      }
      if (rpcName === 'get_student_weak_chapters') {
        return {
          data: [
            {
              chapter_id: 'ch-1',
              chapter_name: 'Fluid Mechanics',
              subject_name: 'Physics',
              accuracy: 55,
              questions_attempted: 20,
              correct_count: 11,
              wrong_count: 9,
              skipped_count: 0,
            },
          ],
          error: null,
        } as any;
      }
      if (rpcName === 'get_courses_content_summary') {
        return { data: {}, error: null } as any;
      }
      return { data: null, error: null } as any;
    }) as any);

    vi.spyOn(testWebService, 'fetchStudentAssignedMockTests').mockResolvedValue({
      tests: [
        {
          testId: 't-real-101',
          title: 'NEET Grand Mock Test 2',
          description: 'Full syllabus mock test',
          testType: 'mock_test',
          subjectId: null,
          subjectName: 'All Subjects',
          courseId: 'c-1',
          courseTitle: 'Complete Physics',
          batchName: 'NEET Droppers 2026',
          durationMin: 180,
          totalMarks: 720,
          passingMarks: 360,
          negativeMarking: 1,
          questionCount: 180,
          attemptLimit: 3,
          availableFrom: null,
          availableUntil: null,
          availabilityStatus: 'available',
          attemptSummary: {
            attemptsUsed: 0,
            attemptsRemaining: 3,
            attemptState: 'not_started',
            latestAttemptId: null,
            latestStatus: null,
            canAttempt: true,
            actionLabel: 'Start Test',
            actionHref: '/student/tests/t-real-101',
          },
          latestResult: null,
          assignedAt: '2026-09-16T08:00:00Z',
        },
      ],
      summary: { total: 1, available: 1, inProgress: 0, completed: 0, upcoming: 0 },
      error: null,
    });

    const dashboard = await fetchCompleteStudentDashboard();

    expect(dashboard.analytics.testsAttempted).toBe(1);
    expect(dashboard.analytics.averageScore).toBe(90);
    expect(dashboard.analytics.accuracy).toBe(94);
    expect(dashboard.analytics.rank).toBe('#3');
    expect(dashboard.analytics.percentile).toBe(98.5);
    expect(dashboard.assignedMockTests).toHaveLength(1);
    expect(dashboard.assignedMockTests[0].title).toBe('NEET Grand Mock Test 2');
    expect(dashboard.weakChapters).toHaveLength(1);
    expect(dashboard.weakChapters[0].chapter_name).toBe('Fluid Mechanics');
    expect(dashboard.subjectAnalytics).toHaveLength(1);
    expect(dashboard.subjectAnalytics[0].subject_name).toBe('Physics');
  });

  /** Chainable Supabase mock shared by the Plan B structural tests below. */
  const installDiscoveryMocks = (
    tableCalls: Record<string, number>,
    rpcCalls: Record<string, number>,
    batchSubjectRow: unknown,
  ) => {
    vi.spyOn(supabase, 'rpc').mockImplementation(((name: string) => {
      rpcCalls[name] = (rpcCalls[name] || 0) + 1;
      if (name === 'get_home_screen_bootstrap') {
        return {
          data: {
            profile: { profile_id: 'p-shared', name: 'Shared Student', role: 'student' },
            active_batches: [{ batch_id: '11111111-1111-4111-8111-111111111111', name: 'Batch One' }],
            enrolled_courses: [],
          },
          error: null,
        } as any;
      }
      if (name === 'get_student_score_trend') return { data: [], error: null } as any;
      if (name === 'get_courses_content_summary') return { data: {}, error: null } as any;
      return { data: null, error: null } as any;
    }) as any);

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      tableCalls[table] = (tableCalls[table] || 0) + 1;
      const result =
        table === 'batch_subjects' && batchSubjectRow
          ? { data: [batchSubjectRow], error: null }
          : table === 'student_details'
            ? { data: { student_id: 's-shared' }, error: null }
            : { data: [], error: null };
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
        then: (resolve: any) => Promise.resolve(result).then(resolve),
      };
      return chain;
    }) as any);
  };

  it('shares ONE batch_subjects request between assigned-test and live-class discovery', async () => {
    const tableCalls: Record<string, number> = {};
    const rpcCalls: Record<string, number> = {};

    installDiscoveryMocks(tableCalls, rpcCalls, {
      batch_subject_id: 'bs-1',
      batch_id: '11111111-1111-4111-8111-111111111111',
      subject_id: '22222222-2222-4222-8222-222222222222',
      is_active: true,
      subjects: { name: 'Physics', code: 'PHY' },
      batches: {
        name: 'Batch One',
        batch_code: 'B1',
        course_batches: [{ courses: { course_id: 'c-1', title: 'Physics Course' } }],
      },
    });

    const summary = await fetchStudentDashboardPrimary();

    // ONE batch_subjects request serves BOTH branches, and bootstrap is consumed
    // once from the shared shell.
    expect(tableCalls['batch_subjects']).toBe(1);
    expect(rpcCalls['get_home_screen_bootstrap']).toBe(1);
    // Branches still resolve to the expected (empty) dashboard shape.
    expect(summary.assignedMockTests).toEqual([]);
    expect(summary.liveClass).toBeNull();
    expect(summary.profile?.profile_id).toBe('p-shared');
  });

  it('coalesces concurrent dashboard shell fetches into a single bootstrap request', async () => {
    const tableCalls: Record<string, number> = {};
    const rpcCalls: Record<string, number> = {};
    installDiscoveryMocks(tableCalls, rpcCalls, null);

    const [first, second] = await Promise.all([
      fetchStudentDashboardShell(),
      fetchStudentDashboardShell(),
    ]);

    expect(rpcCalls['get_home_screen_bootstrap']).toBe(1);
    expect(first).toBe(second);
  });
});
