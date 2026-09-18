import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getStudentDashboardSummary,
  getStudentScoreTrend,
  getStudentAttemptedTestList,
  getSubjectAnalytics,
  getChapterAnalytics,
  getStudentWeakChapters,
  getStudentStrongChapters,
} from '@/services/analytics/analyticsService';
import { supabase } from '@/config/supabase';

// Mock Supabase
vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

describe('Student Web Analytics Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStudentDashboardSummary', () => {
    it('maps authoritative dashboard summary from get_student_dashboard_summary RPC correctly', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          tests_attempted: 5,
          average_score: 420.5,
          best_score: 510,
          overall_accuracy: 78.4,
          average_percentage: 72.8,
          latest_result: {
            result_id: 'res-1',
            attempt_id: 'att-1',
            test_id: 'test-1',
            total_score: 450,
            max_score: 600,
            percentage: 75.0,
            correct_count: 45,
            wrong_count: 10,
            skipped_count: 5,
            rank: 3,
            percentile: 94.5,
            generated_at: '2026-09-15T10:00:00Z',
            released_at: '2026-09-15T12:00:00Z',
          },
          continue_practice: null,
        },
        error: null,
      } as any);

      const result = await getStudentDashboardSummary();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.testsAttempted).toBe(5);
      expect(result.data?.averageScore).toBe(420.5);
      expect(result.data?.bestScore).toBe(510);
      expect(result.data?.overallAccuracy).toBe(78.4);
      expect(result.data?.averagePercentage).toBe(72.8);
      expect(result.data?.latestResult?.rank).toBe(3);
      expect(result.data?.latestResult?.percentile).toBe(94.5);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_dashboard_summary');
    });

    it('handles neutral empty summary when student has no attempts', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          tests_attempted: 0,
          average_score: 0,
          best_score: 0,
          overall_accuracy: null,
          average_percentage: null,
          latest_result: null,
          continue_practice: null,
        },
        error: null,
      } as any);

      const result = await getStudentDashboardSummary();

      expect(result.success).toBe(true);
      expect(result.data?.testsAttempted).toBe(0);
      expect(result.data?.overallAccuracy).toBeNull();
      expect(result.data?.averagePercentage).toBeNull();
      expect(result.data?.latestResult).toBeNull();
    });

    it('propagates RPC error response cleanly', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: 'Database RPC error: User not authenticated' },
      } as any);

      const result = await getStudentDashboardSummary();

      expect(result.success).toBe(false);
      expect(result.error).toContain('User not authenticated');
    });
  });

  describe('getStudentScoreTrend', () => {
    it('maps chronological score trend points from get_student_score_trend RPC', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            result_id: 'res-1',
            attempt_id: 'att-1',
            test_id: 'test-1',
            test_name: 'Physics Diagnostic Mock #1',
            attempted_on: '2026-08-01T10:00:00Z',
            score: 70,
            max_score: 100,
            percentage: 70.0,
            accuracy: 75.0,
            rank: 12,
            percentile: 88.0,
          },
          {
            result_id: 'res-2',
            attempt_id: 'att-2',
            test_id: 'test-2',
            test_name: 'Chemistry Grand Mock #2',
            attempted_on: '2026-08-15T10:00:00Z',
            score: 85,
            max_score: 100,
            percentage: 85.0,
            accuracy: 90.0,
            rank: 4,
            percentile: 96.5,
          },
        ],
        error: null,
      } as any);

      const result = await getStudentScoreTrend();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].testName).toBe('Physics Diagnostic Mock #1');
      expect(result.data?.[0].percentage).toBe(70.0);
      expect(result.data?.[0].accuracy).toBe(75.0);
      expect(result.data?.[1].testName).toBe('Chemistry Grand Mock #2');
      expect(result.data?.[1].percentage).toBe(85.0);
      expect(result.data?.[1].rank).toBe(4);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_score_trend');
    });

    it('returns empty array when student has no released trend data', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [],
        error: null,
      } as any);

      const result = await getStudentScoreTrend();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('getSubjectAnalytics', () => {
    it('maps subject performance from get_student_subject_analytics RPC in overall mode', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            subject_id: 'sub-phys',
            subject_name: 'Physics',
            questions_attempted: 30,
            correct_count: 24,
            wrong_count: 4,
            skipped_count: 2,
            accuracy: 85.71,
            total_score: 92,
            max_score: 120,
            percentage: 76.67,
            average_time_per_question_seconds: 48.5,
          },
        ],
        error: null,
      } as any);

      const result = await getSubjectAnalytics();

      expect(result.success).toBe(true);
      expect(result.data?.subjects).toHaveLength(1);
      expect(result.data?.subjects[0].subjectName).toBe('Physics');
      expect(result.data?.subjects[0].correct).toBe(24);
      expect(result.data?.subjects[0].accuracy).toBe(85.71);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_subject_analytics');
    });

    it('forwards p_test_id when testId is specified for test-wise subject performance', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            subject_id: 'sub-phys',
            subject_name: 'Physics',
            questions_attempted: 5,
            correct_count: 0,
            wrong_count: 1,
            skipped_count: 0,
            accuracy: 0,
            total_score: 6,
            max_score: 20,
            percentage: 30.0,
            average_time_per_question_seconds: 35.0,
          },
        ],
        error: null,
      } as any);

      const result = await getSubjectAnalytics('self', 'test-uuid-1234');

      expect(result.success).toBe(true);
      expect(result.data?.subjects).toHaveLength(1);
      expect(result.data?.subjects[0].score).toBe(6);
      expect(result.data?.subjects[0].percentage).toBe(30.0);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_subject_analytics', {
        p_test_id: 'test-uuid-1234',
      });
    });
  });

  describe('getChapterAnalytics', () => {
    it('maps chapter breakdown from get_student_chapter_analytics RPC with optional subject filter', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            chapter_id: 'chap-optics',
            chapter_name: 'Ray Optics',
            subject_id: 'sub-phys',
            subject_name: 'Physics',
            questions_attempted: 15,
            correct_count: 13,
            wrong_count: 2,
            skipped_count: 0,
            accuracy: 86.67,
            total_score: 50,
            max_score: 60,
            percentage: 83.33,
            average_time_per_question_seconds: 42.0,
          },
        ],
        error: null,
      } as any);

      const result = await getChapterAnalytics();

      expect(result.success).toBe(true);
      expect(result.data?.chapters).toHaveLength(1);
      expect(result.data?.chapters[0].chapterName).toBe('Ray Optics');
      expect(result.data?.chapters[0].accuracy).toBe(86.67);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_chapter_analytics');
    });
  });

  describe('getStudentAttemptedTestList', () => {
    it('retrieves and deduplicates attempted tests for the student', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { user: { id: 'prof-1' } } },
        error: null,
      } as any);

      vi.mocked(supabase.from).mockImplementationOnce((table: string) => {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { student_id: 'stud-1' },
            error: null,
          }),
        } as any;
      });

      vi.mocked(supabase.from).mockImplementationOnce((table: string) => {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                attempt_id: 'att-2',
                test_id: 'test-1',
                submitted_at: '2026-09-16T10:00:00Z',
                created_at: '2026-09-16T09:00:00Z',
                mock_tests: { test_id: 'test-1', title: 'Grand Mock Test 1' },
              },
              {
                attempt_id: 'att-1',
                test_id: 'test-1', // duplicate test attempt
                submitted_at: '2026-09-15T10:00:00Z',
                created_at: '2026-09-15T09:00:00Z',
                mock_tests: { test_id: 'test-1', title: 'Grand Mock Test 1' },
              },
              {
                attempt_id: 'att-3',
                test_id: 'test-2',
                submitted_at: '2026-09-14T10:00:00Z',
                created_at: '2026-09-14T09:00:00Z',
                mock_tests: { test_id: 'test-2', title: 'Physics Sectional Test' },
              },
            ],
            error: null,
          }),
        } as any;
      });

      const result = await getStudentAttemptedTestList();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2); // Deduplicated 3 attempts to 2 tests
      expect(result.data?.[0].testId).toBe('test-1');
      expect(result.data?.[0].testName).toBe('Grand Mock Test 1');
      expect(result.data?.[1].testId).toBe('test-2');
      expect(result.data?.[1].testName).toBe('Physics Sectional Test');
    });
  });

  describe('getStudentWeakChapters & getStudentStrongChapters', () => {
    it('retrieves weak chapters via get_student_weak_chapters RPC', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            chapter_id: 'chap-rot',
            chapter_name: 'Rotational Motion',
            subject_id: 'sub-phys',
            subject_name: 'Physics',
            questions_attempted: 20,
            correct_count: 6,
            wrong_count: 14,
            skipped_count: 0,
            accuracy: 30.0,
            total_score: 10,
            max_score: 80,
            percentage: 12.5,
            average_time_per_question_seconds: 65.0,
          },
        ],
        error: null,
      } as any);

      const result = await getStudentWeakChapters();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].chapterName).toBe('Rotational Motion');
      expect(result.data?.[0].accuracy).toBe(30.0);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_weak_chapters');
    });

    it('retrieves strong chapters via get_student_strong_chapters RPC', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            chapter_id: 'chap-thermo',
            chapter_name: 'Thermodynamics',
            subject_id: 'sub-chem',
            subject_name: 'Chemistry',
            questions_attempted: 25,
            correct_count: 23,
            wrong_count: 2,
            skipped_count: 0,
            accuracy: 92.0,
            total_score: 92,
            max_score: 100,
            percentage: 92.0,
            average_time_per_question_seconds: 35.0,
          },
        ],
        error: null,
      } as any);

      const result = await getStudentStrongChapters();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].chapterName).toBe('Thermodynamics');
      expect(result.data?.[0].accuracy).toBe(92.0);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_strong_chapters');
    });
  });
});
