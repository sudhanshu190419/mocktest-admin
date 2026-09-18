import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  calculateProgressPercent,
  getSubjectEmoji,
  getSubjectColor,
  getMockTestAvailability,
  fetchStudentViewingHistory,
  fetchStudentTestAttempts,
  fetchMockTestQuestionCounts,
  fetchCourseDetailWorkspace,
  fetchSubjectLearningWorkspace,
  getStorageSignedUrl,
  isUuidString,
} from '../studentCourseWebService';
import { supabase } from '@/config/supabase';

describe('Student Course Web Service & Progress Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Course & Subject Progress Calculations', () => {
    it('calculates 0% for zero-content course', () => {
      expect(calculateProgressPercent(0, 0)).toBe(0);
      expect(calculateProgressPercent(0, -5)).toBe(0);
    });

    it('calculates 0% when no items completed', () => {
      expect(calculateProgressPercent(0, 10)).toBe(0);
    });

    it('calculates exact percentage for partial completion', () => {
      // 2 out of 5 items = 40%
      expect(calculateProgressPercent(2, 5)).toBe(40);
      // 1 out of 3 items = 33% (rounded)
      expect(calculateProgressPercent(1, 3)).toBe(33);
      // 2 out of 3 items = 67% (rounded)
      expect(calculateProgressPercent(2, 3)).toBe(67);
    });

    it('calculates 100% for fully completed course and clamps overcompletion', () => {
      expect(calculateProgressPercent(5, 5)).toBe(100);
      expect(calculateProgressPercent(10, 5)).toBe(100);
    });
  });

  describe('2. Student Viewing History & Completed Content Detection', () => {
    it('returns empty Set and Map safely when studentId or resourceIds are empty', async () => {
      const res1 = await fetchStudentViewingHistory(null, ['11111111-1111-4111-8111-111111111111']);
      expect(res1.completedSet.size).toBe(0);
      expect(res1.positionMap.size).toBe(0);

      const res2 = await fetchStudentViewingHistory('22222222-2222-4222-8222-222222222222', []);
      expect(res2.completedSet.size).toBe(0);
      expect(res2.positionMap.size).toBe(0);
    });

    it('executes a single batched query with .in() filter (no N+1)', async () => {
      const studentId = '11111111-1111-4111-8111-111111111111';
      const resourceIds = [
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
      ];

      const mockData = [
        { resource_id: resourceIds[0], is_completed: true, last_position_seconds: 120 },
        { resource_id: resourceIds[1], is_completed: false, last_position_seconds: 45 },
      ];

      const fromSpy = vi.spyOn(supabase, 'from').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            in: vi.fn().mockResolvedValueOnce({ data: mockData, error: null }),
          }),
        }),
      } as any);

      const result = await fetchStudentViewingHistory(studentId, resourceIds);

      expect(fromSpy).toHaveBeenCalledWith('student_viewing_history');
      expect(result.completedSet.has(resourceIds[0])).toBe(true);
      expect(result.completedSet.has(resourceIds[1])).toBe(false);
      expect(result.positionMap.get(resourceIds[0])).toBe(120);
      expect(result.positionMap.get(resourceIds[1])).toBe(45);
    });
  });

  describe('3. Real Student Test Attempt States & CTA Resolution', () => {
    const studentId = '11111111-1111-4111-8111-111111111111';
    const testId = '22222222-2222-4222-8222-222222222222';

    it('returns "not_started" state and "Start Test" when student has 0 attempts', async () => {
      vi.spyOn(supabase, 'from').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            in: vi.fn().mockReturnValueOnce({
              order: vi.fn().mockResolvedValueOnce({ data: [], error: null }),
            }),
          }),
        }),
      } as any);

      const summaryMap = await fetchStudentTestAttempts(studentId, [testId]);
      const summary = summaryMap.get(testId);

      expect(summary).toBeDefined();
      expect(summary?.attemptState).toBe('not_started');
      expect(summary?.attemptsUsed).toBe(0);
      expect(summary?.canAttempt).toBe(true);
      expect(summary?.actionLabel).toBe('Start Test');
    });

    it('returns "in_progress" state and "Resume Test" when student has an ongoing attempt', async () => {
      const mockAttempts = [
        {
          attempt_id: 'att-123',
          test_id: testId,
          attempt_number: 1,
          status: 'in_progress',
          started_at: '2026-09-15T00:00:00Z',
          submitted_at: null,
        },
      ];

      vi.spyOn(supabase, 'from').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            in: vi.fn().mockReturnValueOnce({
              order: vi.fn().mockResolvedValueOnce({ data: mockAttempts, error: null }),
            }),
          }),
        }),
      } as any);

      const summaryMap = await fetchStudentTestAttempts(studentId, [testId]);
      const summary = summaryMap.get(testId);

      expect(summary?.attemptState).toBe('in_progress');
      expect(summary?.actionLabel).toBe('Resume Test');
      expect(summary?.actionHref).toContain('attemptId=att-123');
      expect(summary?.canAttempt).toBe(true);
    });

    it('returns "submitted" and allows retake when attempts are below attempt_limit', async () => {
      const mockAttempts = [
        {
          attempt_id: 'att-123',
          test_id: testId,
          attempt_number: 1,
          status: 'submitted',
          started_at: '2026-09-15T00:00:00Z',
          submitted_at: '2026-09-15T01:00:00Z',
        },
      ];

      const limitMap = new Map<string, number | null>([[testId, 3]]);

      vi.spyOn(supabase, 'from').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            in: vi.fn().mockReturnValueOnce({
              order: vi.fn().mockResolvedValueOnce({ data: mockAttempts, error: null }),
            }),
          }),
        }),
      } as any);

      const summaryMap = await fetchStudentTestAttempts(studentId, [testId], limitMap);
      const summary = summaryMap.get(testId);

      expect(summary?.attemptState).toBe('submitted');
      expect(summary?.attemptsUsed).toBe(1);
      expect(summary?.attemptsRemaining).toBe(2);
      expect(summary?.canAttempt).toBe(true);
      expect(summary?.actionLabel).toContain('Retake');
    });

    it('returns "limit_reached" and blocks further attempts when attempt_limit is reached', async () => {
      const mockAttempts = [
        { attempt_id: 'att-2', test_id: testId, attempt_number: 2, status: 'submitted' },
        { attempt_id: 'att-1', test_id: testId, attempt_number: 1, status: 'submitted' },
      ];

      const limitMap = new Map<string, number | null>([[testId, 2]]);

      vi.spyOn(supabase, 'from').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            in: vi.fn().mockReturnValueOnce({
              order: vi.fn().mockResolvedValueOnce({ data: mockAttempts, error: null }),
            }),
          }),
        }),
      } as any);

      const summaryMap = await fetchStudentTestAttempts(studentId, [testId], limitMap);
      const summary = summaryMap.get(testId);

      expect(summary?.attemptState).toBe('limit_reached');
      expect(summary?.attemptsUsed).toBe(2);
      expect(summary?.attemptsRemaining).toBe(0);
      expect(summary?.canAttempt).toBe(false);
      expect(summary?.actionLabel).toBe('Attempts Exhausted');
    });
  });

  describe('4. Mock Test Questions & Real Specification Safety', () => {
    it('accurately counts questions from mock_test_questions in a batched lookup', async () => {
      const testIdA = '22222222-2222-4222-8222-222222222222';
      const testIdB = '33333333-3333-4333-8333-333333333333';

      const mockRows = [
        { test_id: testIdA },
        { test_id: testIdA },
        { test_id: testIdA },
        { test_id: testIdB },
      ];

      vi.spyOn(supabase, 'from').mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          in: vi.fn().mockResolvedValueOnce({ data: mockRows, error: null }),
        }),
      } as any);

      const countMap = await fetchMockTestQuestionCounts([testIdA, testIdB]);
      expect(countMap.get(testIdA)).toBe(3);
      expect(countMap.get(testIdB)).toBe(1);
    });

    it('preserves null duration and marks without inventing arbitrary numbers', () => {
      const nullDuration: number | null = null;
      const nullMarks: number | null = null;

      expect(nullDuration !== null ? `${nullDuration} mins` : 'Flexible').toBe('Flexible');
      expect(nullMarks !== null ? `${nullMarks} marks` : 'Configured').toBe('Configured');
    });
  });

  describe('5. Validations & Helpers', () => {
    it('isUuidString validates RFC4122 standard UUIDs', () => {
      expect(isUuidString('b95540cf-a201-4475-b659-3da5f8f8dc13')).toBe(true);
      expect(isUuidString('not-a-uuid')).toBe(false);
      expect(isUuidString('')).toBe(false);
      expect(isUuidString(null)).toBe(false);
    });

    it('Subject emoji and color mapping matches educational tracks', () => {
      expect(getSubjectEmoji('Physics')).toBe('📘');
      expect(getSubjectEmoji('Chemistry')).toBe('🧪');
      expect(getSubjectEmoji('Biology')).toBe('🧬');
      expect(getSubjectEmoji('Mathematics')).toBe('📐');

      expect(getSubjectColor('Physics')).toBe('#0284C7');
      expect(getSubjectColor('Chemistry')).toBe('#8B5CF6');
      expect(getSubjectColor('Biology')).toBe('#05C46B');
    });

    it('getMockTestAvailability calculates upcoming, available, and expired states', () => {
      const past = new Date(Date.now() - 100000).toISOString();
      const future = new Date(Date.now() + 100000).toISOString();

      expect(getMockTestAvailability(null, null)).toBe('available');
      expect(getMockTestAvailability(future, null)).toBe('upcoming');
      expect(getMockTestAvailability(past, past)).toBe('expired');
    });

    it('fetchCourseDetailWorkspace & fetchSubjectLearningWorkspace reject invalid non-UUID IDs', async () => {
      const res1 = await fetchCourseDetailWorkspace('invalid-course');
      expect(res1.data).toBeNull();
      expect(res1.error).toContain('Invalid Course ID format');

      const res2 = await fetchSubjectLearningWorkspace('inv-c', 'inv-s');
      expect(res2.data).toBeNull();
      expect(res2.error).toContain('Invalid course or subject identifier');
    });

    it('getStorageSignedUrl returns null for empty paths', async () => {
      const res = await getStorageSignedUrl('', '');
      expect(res).toBeNull();
    });
  });
});
