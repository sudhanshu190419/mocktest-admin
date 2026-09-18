import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyQuestionStatus,
  fetchStudentTestResult,
  fetchStudentAnswerReview,
} from '../studentTestResultWebService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => {
  const mockFrom = vi.fn();
  const mockStorage = {
    from: vi.fn().mockReturnValue({
      createSignedUrls: vi.fn().mockResolvedValue({
        data: [{ path: 'img1.png', signedUrl: 'https://signed.cdn/img1.png' }],
        error: null,
      }),
    }),
  };

  return {
    supabase: {
      from: mockFrom,
      storage: mockStorage,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr-student-1' } }, error: null }),
      },
    },
  };
});

describe('studentTestResultWebService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classifyQuestionStatus', () => {
    it('correctly classifies objective questions', () => {
      expect(
        classifyQuestionStatus({ questionType: 'mcq', isAnswered: true, isCorrect: true })
      ).toBe('correct');

      expect(
        classifyQuestionStatus({ questionType: 'msq', isAnswered: true, isCorrect: false })
      ).toBe('incorrect');

      expect(
        classifyQuestionStatus({ questionType: 'numerical', isAnswered: false, isCorrect: null })
      ).toBe('skipped');
    });

    it('correctly classifies subjective / text-based questions', () => {
      expect(
        classifyQuestionStatus({
          questionType: 'subjective',
          textAnswer: 'My essay answer',
          evaluationStatus: 'manual_evaluated',
        })
      ).toBe('evaluated');

      expect(
        classifyQuestionStatus({
          questionType: 'subjective',
          textAnswer: 'My draft answer',
          evaluationStatus: null,
        })
      ).toBe('pending');

      expect(
        classifyQuestionStatus({
          questionType: 'subjective',
          textAnswer: '',
          evaluationStatus: null,
        })
      ).toBe('skipped');
    });
  });

  describe('fetchStudentTestResult', () => {
    it('returns structured scorecard data for released result', async () => {
      // Mock student profile
      const studentDetailsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: 'stu-1' } }),
      };

      // Mock mock_results
      const resultsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            result_id: 'res-1',
            attempt_id: 'att-1',
            test_id: 'test-1',
            student_id: 'stu-1',
            total_score: 80,
            max_score: 100,
            percentage: 80,
            correct_count: 20,
            wrong_count: 5,
            skipped_count: 5,
            total_time_seconds: 2400,
            avg_time_per_question: 80,
            is_released: true,
            released_at: '2026-09-16T00:00:00Z',
            rank: 4,
            percentile: 96,
            subject_breakdown: [
              {
                subjectId: 'sub-1',
                subjectName: 'Physics',
                score: 40,
                maxScore: 50,
                correct: 10,
                wrong: 2,
                skipped: 3,
              },
            ],
          },
        }),
      };

      // Mock mock_attempts
      const attemptsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            attempt_id: 'att-1',
            student_id: 'stu-1',
            test_id: 'test-1',
            attempt_number: 1,
            started_at: '2026-09-15T23:00:00Z',
            submitted_at: '2026-09-15T23:40:00Z',
          },
        }),
      };

      // Mock mock_tests
      const testsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            test_id: 'test-1',
            title: 'JEE Advanced Mock 1',
            test_type: 'mock_test',
            duration_min: 60,
            passing_marks: 35,
            attempt_limit: 3,
          },
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') return studentDetailsChain;
        if (table === 'mock_results') return resultsChain;
        if (table === 'mock_attempts') return attemptsChain;
        if (table === 'mock_tests') return testsChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
      });

      const res = await fetchStudentTestResult('test-1', 'att-1', 'usr-student-1');

      expect(res.success).toBe(true);
      if (res.success && res.isReleased) {
        expect(res.data.testTitle).toBe('JEE Advanced Mock 1');
        expect(res.data.totalScore).toBe(80);
        expect(res.data.maxScore).toBe(100);
        expect(res.data.percentage).toBe(80);
        expect(res.data.accuracy).toBe(80);
        expect(res.data.rank).toBe(4);
        expect(res.data.percentile).toBe(96);
        expect(res.data.isPassed).toBe(true);
        expect(res.data.subjectBreakdown).toHaveLength(1);
        expect(res.data.subjectBreakdown[0].subjectName).toBe('Physics');
        expect(res.data.canRetake).toBe(true);
      }
    });

    it('gates scorecard when result is_released is false', async () => {
      const studentDetailsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: 'stu-1' } }),
      };

      const resultsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            result_id: 'res-unreleased',
            attempt_id: 'att-2',
            is_released: false,
            released_at: '2026-09-20T00:00:00Z',
          },
        }),
      };

      const attemptsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { attempt_id: 'att-2', student_id: 'stu-1', attempt_number: 1 },
        }),
      };

      const testsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { test_id: 'test-2', title: 'Unreleased Test' },
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') return studentDetailsChain;
        if (table === 'mock_results') return resultsChain;
        if (table === 'mock_attempts') return attemptsChain;
        if (table === 'mock_tests') return testsChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
      });

      const res = await fetchStudentTestResult('test-2', 'att-2', 'usr-student-1');

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.isReleased).toBe(false);
        if (!res.isReleased) {
          expect(res.data.testTitle).toBe('Unreleased Test');
          expect(res.data.releasedAt).toBe('2026-09-20T00:00:00Z');
        }
      }
    });

    it('rejects access if student does not own attempt', async () => {
      const studentDetailsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: 'stu-different' } }),
      };

      const attemptsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { attempt_id: 'att-3', student_id: 'stu-owner' },
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'student_details') return studentDetailsChain;
        if (table === 'mock_attempts') return attemptsChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
      });

      const res = await fetchStudentTestResult('test-1', 'att-3', 'usr-student-1');

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain('not authorized');
      }
    });
  });

  describe('fetchStudentAnswerReview', () => {
    it('loads full review session with question snapshots, answers, and explanations', async () => {
      const testsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { test_id: 'test-1', title: 'Review Test', duration_min: 60, total_marks: 4 },
        }),
      };

      const attemptsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { attempt_id: 'att-1', attempt_number: 1 },
        }),
      };

      const resultsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { result_id: 'res-1', total_score: 4, max_score: 4, percentage: 100, is_released: true },
        }),
      };

      const questionsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              question_id: 'q-1',
              section_name: 'Physics',
              marks: 4,
              question_snapshot: {
                questionId: 'q-1',
                questionText: 'What is acceleration due to gravity?',
                questionType: 'mcq',
                marks: 4,
                options: [
                  { optionId: 'opt-1', optionText: '9.8 m/s²', isCorrect: true },
                  { optionId: 'opt-2', optionText: '5.0 m/s²', isCorrect: false },
                ],
              },
            },
          ],
        }),
      };

      const answersChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: [
            {
              answer_id: 'ans-1',
              question_id: 'q-1',
              is_answered: true,
              is_correct: true,
              awarded_marks: 4,
              time_spent_seconds: 45,
            },
          ],
        }),
      };

      const optionsJunctionChain = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [{ answer_id: 'ans-1', option_id: 'opt-1' }],
        }),
      };

      const explanationsChain = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [{ question_id: 'q-1', explanation_text: 'Standard Earth gravity is 9.8 m/s².' }],
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'mock_tests') return testsChain;
        if (table === 'mock_attempts') return attemptsChain;
        if (table === 'mock_results') return resultsChain;
        if (table === 'mock_test_questions') return questionsChain;
        if (table === 'mock_answers') return answersChain;
        if (table === 'mock_answer_options') return optionsJunctionChain;
        if (table === 'question_explanations') return explanationsChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
      });

      const res = await fetchStudentAnswerReview('test-1', 'att-1', 'usr-student-1');

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.questions).toHaveLength(1);
        const q = res.data.questions[0];
        expect(q.questionText).toBe('What is acceleration due to gravity?');
        expect(q.status).toBe('correct');
        expect(q.marksAwarded).toBe(4);
        expect(q.options[0].feedback).toBe('selected');
        expect(q.explanationText).toBe('Standard Earth gravity is 9.8 m/s².');
      }
    });
  });
});
