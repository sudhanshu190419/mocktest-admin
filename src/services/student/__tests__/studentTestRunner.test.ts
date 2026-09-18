import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seededShuffle } from '@/utils/seededShuffle';
import { evaluateScientificExpression } from '@/components/student/test-runner/ScientificCalculatorModal';
import {
  fetchStudentTestRunnerData,
} from '@/services/student/studentTestWebService';
import { webPersistenceQueue } from '@/services/student/webPersistenceQueue';
import { supabase } from '@/config/supabase';

// Mock Supabase
vi.mock('@/config/supabase', () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
        getUser: vi.fn(),
      },
      from: vi.fn(),
      rpc: vi.fn(),
      storage: {
        from: vi.fn(() => ({
          createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      },
    },
  };
});

describe('Student Web Test Runner Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webPersistenceQueue.dispose();
  });

  describe('1. Deterministic seededShuffle (Mulberry32 PRNG)', () => {
    it('returns empty array when input is null/undefined or empty', () => {
      expect(seededShuffle(null, 'seed-1')).toEqual([]);
      expect(seededShuffle(undefined, 'seed-1')).toEqual([]);
      expect(seededShuffle([], 'seed-1')).toEqual([]);
    });

    it('returns a new single-element array without mutation', () => {
      const original = ['Q1'];
      const result = seededShuffle(original, 'seed-1');
      expect(result).toEqual(['Q1']);
      expect(result).not.toBe(original);
    });

    it('deterministically shuffles with identical permutation for the same seed', () => {
      const items = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'];
      const run1 = seededShuffle(items, 'attempt-uuid-1234:questions');
      const run2 = seededShuffle(items, 'attempt-uuid-1234:questions');
      const runDifferentSeed = seededShuffle(items, 'attempt-uuid-9999:questions');

      expect(run1).toEqual(run2);
      expect(run1.length).toBe(items.length);
      expect(new Set(run1)).toEqual(new Set(items));
      // Different seed produces different permutation
      expect(run1).not.toEqual(runDifferentSeed);
    });
  });

  describe('2. Scientific Calculator Expression Evaluator', () => {
    it('evaluates basic arithmetic expressions safely', () => {
      expect(evaluateScientificExpression('2 + 3 * 4')).toBe('14');
      expect(evaluateScientificExpression('(10 - 2) / 4')).toBe('2');
      expect(evaluateScientificExpression('15 ÷ 3 × 2')).toBe('10');
    });

    it('evaluates scientific functions: sin, cos, tan, log, ln, sqrt, powers', () => {
      expect(evaluateScientificExpression('sin(90)')).toBe('1');
      expect(evaluateScientificExpression('cos(0)')).toBe('1');
      expect(evaluateScientificExpression('√(16)')).toBe('4');
      expect(evaluateScientificExpression('2^3')).toBe('8');
      expect(evaluateScientificExpression('log(100)')).toBe('2');
    });

    it('handles division by zero and invalid syntax gracefully', () => {
      expect(evaluateScientificExpression('1 / 0')).toBe('Undefined');
      expect(evaluateScientificExpression('invalid_text()')).toBe('Error');
      expect(evaluateScientificExpression('')).toBe('0');
    });
  });

  describe('3. Service Bridge - fetchStudentTestRunnerData', () => {
    const validTestId = '11111111-1111-4111-8111-111111111111';
    const validAttemptId = '22222222-2222-4222-8222-222222222222';
    const validStudentId = '33333333-3333-4333-8333-333333333333';
    const validUserId = 'user-test-123';

    it('rejects invalid UUID parameters', async () => {
      const res = await fetchStudentTestRunnerData('invalid-id', 'invalid-attempt');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid Test or Attempt ID format');
    });

    it('assembles complete session with questions, answers and restored state', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: { user: { id: validUserId } } },
        error: null,
      });
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: validUserId } },
        error: null,
      });

      const createChain = (resolvedValue: any) => {
        const obj: any = {};
        obj.select = vi.fn(() => obj);
        obj.eq = vi.fn(() => obj);
        obj.in = vi.fn(() => obj);
        obj.order = vi.fn().mockResolvedValue(resolvedValue);
        obj.single = vi.fn().mockResolvedValue(resolvedValue);
        obj.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
        return obj;
      };

      const profilesChain = createChain({
        data: { student_id: validStudentId, account_status: 'approved' },
        error: null,
      });

      const testChain = createChain({
        data: {
          test_id: validTestId,
          title: 'JEE Advanced Full Mock 1',
          description: 'Comprehensive test',
          test_type: 'mock_test',
          duration_min: 180,
          total_marks: 300,
          passing_marks: 120,
          negative_marking: 1,
          calculator_allowed: true,
          shuffle_questions: true,
          shuffle_options: true,
        },
        error: null,
      });

      const attemptChain = createChain({
        data: {
          attempt_id: validAttemptId,
          test_id: validTestId,
          student_id: validStudentId,
          status: 'in_progress',
          started_at: new Date(Date.now() - 60000).toISOString(),
          time_remaining_seconds: 10740,
        },
        error: null,
      });

      const questionsChain = createChain({
        data: [
          {
            question_id: 'q-1',
            test_id: validTestId,
            order_sequence: 1,
            section_name: 'Physics',
            marks: 4,
            negative_marks_override: 1,
            question_snapshot: {
              questionId: 'q-1',
              questionText: 'What is Newton second law?',
              questionType: 'mcq',
              marks: 4,
              negativeMarks: 1,
              subjectName: 'Physics',
              options: [
                { optionId: 'opt-1', optionText: 'F = ma', isCorrect: true, orderSequence: 1 },
                { optionId: 'opt-2', optionText: 'E = mc^2', isCorrect: false, orderSequence: 2 },
              ],
            },
          },
          {
            question_id: 'q-2',
            test_id: validTestId,
            order_sequence: 2,
            section_name: 'Chemistry',
            marks: 4,
            negative_marks_override: 1,
            question_snapshot: {
              questionId: 'q-2',
              questionText: 'Select noble gases',
              questionType: 'msq',
              marks: 4,
              negativeMarks: 1,
              subjectName: 'Chemistry',
              options: [
                { optionId: 'opt-3', optionText: 'Helium', isCorrect: true, orderSequence: 1 },
                { optionId: 'opt-4', optionText: 'Neon', isCorrect: true, orderSequence: 2 },
              ],
            },
          },
        ],
        error: null,
      });

      const answersChain = createChain({
        data: [
          {
            answer_id: 'ans-1',
            attempt_id: validAttemptId,
            question_id: 'q-1',
            is_answered: true,
            is_marked_for_review: false,
            selected_option_ids: ['opt-1'],
            time_spent_seconds: 45,
          },
          {
            answer_id: 'ans-2',
            attempt_id: validAttemptId,
            question_id: 'q-2',
            is_answered: false,
            is_marked_for_review: true,
            selected_option_ids: null,
            time_spent_seconds: 15,
          },
        ],
        error: null,
      });
      // For mock_answers, eq returns a Promise directly:
      answersChain.eq = vi.fn().mockResolvedValue({
        data: [
          {
            answer_id: 'ans-1',
            attempt_id: validAttemptId,
            question_id: 'q-1',
            is_answered: true,
            is_marked_for_review: false,
            selected_option_ids: ['opt-1'],
            time_spent_seconds: 45,
          },
          {
            answer_id: 'ans-2',
            attempt_id: validAttemptId,
            question_id: 'q-2',
            is_answered: false,
            is_marked_for_review: true,
            selected_option_ids: null,
            time_spent_seconds: 15,
          },
        ],
        error: null,
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') return profilesChain;
        if (table === 'mock_tests') return testChain;
        if (table === 'mock_attempts') return attemptChain;
        if (table === 'mock_test_questions') return questionsChain;
        if (table === 'mock_answers') return answersChain;
        return createChain({ data: null, error: null });
      });

      const res = await fetchStudentTestRunnerData(validTestId, validAttemptId, validUserId);

            expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      const session = res.data!;
      expect(session.test.title).toBe('JEE Advanced Full Mock 1');
      expect(session.test.calculatorAllowed).toBe(true);
      expect(session.questions.length).toBe(2);

      // Verify restored state mapping
      expect(session.restoredState.selectedOptions).toBeDefined();
      expect(session.restoredState.accumulatedQuestionTimes['q-1']).toBe(45);
      expect(session.restoredState.accumulatedQuestionTimes['q-2']).toBe(15);
      const q2Index = session.questions.findIndex((q) => q.id === "q-2");
      expect(session.restoredState.markedForReviewIndices).toContain(q2Index);
    });

    it('safely rejects already submitted test attempts', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: { user: { id: validUserId } } },
        error: null,
      });
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: validUserId } },
        error: null,
      });

      const createChain = (resolvedValue: any) => {
        const obj: any = {};
        obj.select = vi.fn(() => obj);
        obj.eq = vi.fn(() => obj);
        obj.single = vi.fn().mockResolvedValue(resolvedValue);
        obj.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
        return obj;
      };

      const profilesChain = createChain({
        data: { student_id: validStudentId, account_status: 'approved' },
        error: null,
      });

      const testChain = createChain({
        data: { test_id: validTestId, title: 'Mock 1' },
        error: null,
      });

      const attemptChain = createChain({
        data: {
          attempt_id: validAttemptId,
          test_id: validTestId,
          student_id: validStudentId,
          status: 'submitted', // Already submitted!
        },
        error: null,
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') return profilesChain;
        if (table === 'mock_tests') return testChain;
        if (table === 'mock_attempts') return attemptChain;
        return createChain({ data: null, error: null });
      });

      const res = await fetchStudentTestRunnerData(validTestId, validAttemptId, validUserId);
      expect(res.success).toBe(false);
            expect(res.isAlreadySubmitted).toBe(true);
      expect(res.error).toContain('submitted');
    });
  });

  describe('4. Persistence Queue Integration in Runner Workflow', () => {
    it('buffers answers on user selection without direct RPC calls', () => {
      const attemptId = 'att-123';
      webPersistenceQueue.markAnswerDirty(
        {
          answerId: 'ans-1',
          questionId: 'q-1',
          questionType: 'mcq',
          value: 'opt-1',
          isMarkedForReview: false,
          isAnswered: true,
          timeSpentSeconds: 30,
        },
        attemptId
      );

      expect(webPersistenceQueue.getDirtyCount()).toBe(1);
      expect(webPersistenceQueue.isDirty('ans-1')).toBe(true);
    });

    it('drains all dirty answers during pre-submission barrier', async () => {
      const attemptId = 'att-123';
      webPersistenceQueue.registerPersistHandler(async (_aid, answers) => {
        return { success: true, syncedCount: answers.length };
      });

      webPersistenceQueue.markAnswerDirty(
        {
          answerId: 'ans-1',
          questionId: 'q-1',
          questionType: 'numerical',
          value: '42.5',
          isMarkedForReview: true,
          isAnswered: true,
          timeSpentSeconds: 60,
        },
        attemptId
      );

      await webPersistenceQueue.drainAllDirtyAnswers(attemptId, 5000);
      expect(webPersistenceQueue.getDirtyCount()).toBe(0);
    });
  });
});
