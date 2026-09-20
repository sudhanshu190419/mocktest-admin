import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchStudentTestResults,
  fetchStudentAssignedMockTests,
  fetchStudentTestInstructions,
  initializeStudentTestAttempt,
} from '../studentTestWebService';
import { supabase } from '@/config/supabase';

// Mock Supabase client
vi.mock('@/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('studentTestWebService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchStudentTestResults', () => {
    it('returns empty map if studentId is missing or testIds is empty', async () => {
      const res1 = await fetchStudentTestResults(null, ['11111111-1111-4111-8111-111111111111']);
      expect(res1.size).toBe(0);

      const res2 = await fetchStudentTestResults('student-1', []);
      expect(res2.size).toBe(0);
    });

    it('queries mock_results and aggregates latest result per test', async () => {
      const mockResultsData = [
        {
          result_id: 'res-1',
          attempt_id: 'att-1',
          test_id: 'test-1',
          total_score: 85,
          max_score: 100,
          percentage: 85,
          correct_count: 17,
          wrong_count: 3,
          skipped_count: 0,
          is_released: true,
          generated_at: '2026-09-01T10:00:00Z',
          mock_attempts: { submitted_at: '2026-09-01T09:59:00Z' },
        },
      ];

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockResultsData, error: null }),
            }),
          }),
        }),
      });

      const res = await fetchStudentTestResults('student-1', ['11111111-1111-4111-8111-111111111111']);
      expect(res.has('test-1')).toBe(true);
      const test1Res = res.get('test-1')!;
      expect(test1Res.totalScore).toBe(85);
      expect(test1Res.percentage).toBe(85);
      expect(test1Res.accuracy).toBe(85); // 17 / (17 + 3) = 85%
      expect(test1Res.isReleased).toBe(true);
    });
  });

  describe('fetchStudentAssignedMockTests', () => {
    it('returns empty data when student has no active batches', async () => {
      // Mock session
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: { user: { id: 'prof-1' } } },
      });

      // Mock student_details lookup
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: 'stud-1' } }),
              }),
            }),
          };
        }
        if (table === 'batch_students') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [] }),
              }),
            }),
          };
        }
        if (table === 'course_enrollments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [] }),
              }),
            }),
          };
        }
        if (table === 'student_pyq_purchases') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [] }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const result = await fetchStudentAssignedMockTests();
      expect(result.tests).toEqual([]);
      expect(result.summary.total).toBe(0);
      expect(result.error).toBeNull();
    });
  });

  describe('fetchStudentTestInstructions', () => {
    it('rejects invalid UUID test IDs', async () => {
      const res = await fetchStudentTestInstructions('invalid-uuid');
      expect(res.data).toBeNull();
      expect(res.error).toBe('Invalid Test ID format');
    });

    it('returns error if test is not found', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: { user: { id: 'prof-1' } } },
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: 'stud-1' } }),
              }),
            }),
          };
        }
        if (table === 'mock_tests') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const res = await fetchStudentTestInstructions('11111111-1111-4111-8111-111111111111');
      expect(res.data).toBeNull();
      expect(res.error).toBe('Test not found or no longer available');
    });
  });

  describe('initializeStudentTestAttempt', () => {
    it('rejects invalid UUIDs without calling RPC', async () => {
      const res = await initializeStudentTestAttempt('bad-id', 'inst-id', 3);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid Test ID');
    });

    it('delegates to initialize_mock_attempt RPC and returns attempt data', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: { user: { id: 'prof-1' } } },
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: 'stud-1' } }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      (supabase.rpc as any).mockResolvedValue({
        data: {
          success: true,
          attempt_id: 'att-12345',
          reused: false,
          effective_remaining_seconds: 10800,
        },
        error: null,
      });

      const res = await initializeStudentTestAttempt(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        3
      );

      expect(res.success).toBe(true);
      expect(res.data?.attemptId).toBe('att-12345');
      expect(res.data?.reused).toBe(false);
      expect(supabase.rpc).toHaveBeenCalledWith('initialize_mock_attempt', {
        p_test_id: '11111111-1111-4111-8111-111111111111',
        p_student_id: 'stud-1',
        p_institute_id: '22222222-2222-4222-8222-222222222222',
        p_attempt_limit: 3,
      });
    });
  });
});
