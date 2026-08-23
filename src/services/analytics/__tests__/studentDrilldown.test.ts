import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

import { getStudentBucketDrilldown, getSubjectAnalytics } from '../teacherAnalyticsService';

const INSTITUTE_ID = '11111111-1111-4111-8111-111111111111';

describe('teacherAnalyticsService.getStudentBucketDrilldown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters students by average score bucket, respects date presets, and resolves student names/batches', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_results') {
        const queryObj = {
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
        };
        (queryObj as any).then = (resolve: any) =>
          resolve({
            data: [
              // Student 1: Avg = 65% (in 60-70 range)
              { student_id: 'std-1', percentage: 60, correct_count: 6, wrong_count: 2, generated_at: '2026-08-20T10:00:00Z' },
              { student_id: 'std-1', percentage: 70, correct_count: 7, wrong_count: 1, generated_at: '2026-08-21T10:00:00Z' },
              // Student 2: Avg = 85% (NOT in 60-70 range)
              { student_id: 'std-2', percentage: 85, correct_count: 8, wrong_count: 1, generated_at: '2026-08-20T10:00:00Z' },
              // Student 3: Avg = 62% (in 60-70 range)
              { student_id: 'std-3', percentage: 62, correct_count: 6, wrong_count: 4, generated_at: '2026-08-22T10:00:00Z' },
            ],
            error: null,
          });
        return {
          select: vi.fn().mockReturnValue(queryObj),
        };
      }
      if (table === 'student_details') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'std-1', profile_id: 'prof-1', profiles: { name: 'Alice Smith', email: 'alice@test.com' } },
                { student_id: 'std-3', profile_id: 'prof-3', profiles: { name: 'Charlie Brown', email: 'charlie@test.com' } },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'std-1', batches: { name: 'NEET Morning' } },
                { student_id: 'std-3', batches: { name: 'JEE Evening' } },
              ],
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    const result = await getStudentBucketDrilldown(INSTITUTE_ID, {
      type: 'score',
      min: 60,
      max: 70,
      filters: { dateRange: { from: '', to: '', preset: 'last30days' } } as any,
      page: 1,
      pageSize: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.totalCount).toBe(2);
    expect(result.data?.items).toHaveLength(2);

    const std1 = result.data?.items.find((x) => x.studentId === 'std-1');
    expect(std1?.name).toBe('Alice Smith');
    expect(std1?.email).toBe('alice@test.com');
    expect(std1?.batchName).toBe('NEET Morning');
    expect(std1?.averageScore).toBe(65);
    expect(std1?.testsAttempted).toBe(2);

    const std3 = result.data?.items.find((x) => x.studentId === 'std-3');
    expect(std3?.name).toBe('Charlie Brown');
    expect(std3?.batchName).toBe('JEE Evening');
    expect(std3?.averageScore).toBe(62);
  });

  it('includes exactly 100% score/accuracy in 90–100 bucket', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_results') {
        const queryObj = {
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
        };
        (queryObj as any).then = (resolve: any) =>
          resolve({
            data: [
              // Perfect student: 100% score and 100% accuracy
              { student_id: 'std-perfect', percentage: 100, correct_count: 20, wrong_count: 0, generated_at: '2026-08-20T10:00:00Z' },
            ],
            error: null,
          });
        return {
          select: vi.fn().mockReturnValue(queryObj),
        };
      }
      if (table === 'student_details') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'std-perfect', profile_id: 'prof-perf', profiles: { name: 'Top Achiever', email: 'top@test.com' } },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'std-perfect', batches: { name: 'NEET Elite' } },
              ],
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      };
    });

    const result = await getStudentBucketDrilldown(INSTITUTE_ID, {
      type: 'accuracy',
      min: 90,
      max: 100,
      page: 1,
      pageSize: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data?.totalCount).toBe(1);
    expect(result.data?.items[0].name).toBe('Top Achiever');
    expect(result.data?.items[0].accuracy).toBe(100);
  });

  it('filters students by weekly period date range', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_results') {
        const queryObj = {
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
        };
        (queryObj as any).then = (resolve: any) =>
          resolve({
            data: [
              { student_id: 'std-1', percentage: 75, correct_count: 15, wrong_count: 5, generated_at: '2026-08-11T10:00:00Z' },
              { student_id: 'std-1', percentage: 85, correct_count: 17, wrong_count: 3, generated_at: '2026-08-12T10:00:00Z' },
              { student_id: 'std-2', percentage: 90, correct_count: 18, wrong_count: 2, generated_at: '2026-08-14T10:00:00Z' },
            ],
            error: null,
          });
        return {
          select: vi.fn().mockReturnValue(queryObj),
        };
      }
      if (table === 'student_details') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'std-1', profile_id: 'prof-1', profiles: { name: 'Alice Smith', email: 'alice@test.com' } },
                { student_id: 'std-2', profile_id: 'prof-2', profiles: { name: 'Bob Jones', email: 'bob@test.com' } },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'std-1', batches: { name: 'NEET Morning' } },
                { student_id: 'std-2', batches: { name: 'JEE Evening' } },
              ],
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      };
    });

    const result = await getStudentBucketDrilldown(INSTITUTE_ID, {
      type: 'weekly',
      periodStart: '2026-08-10T00:00:00.000Z',
      periodEnd: '2026-08-16T23:59:59.999Z',
      page: 1,
      pageSize: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data?.totalCount).toBe(2);
    expect(result.data?.items).toHaveLength(2);

    expect(result.data?.items[0].studentId).toBe('std-1');
    expect(result.data?.items[0].testsAttempted).toBe(2);
    expect(result.data?.items[0].averageScore).toBe(80);
    expect(result.data?.items[0].accuracy).toBe(80);

    expect(result.data?.items[1].studentId).toBe('std-2');
    expect(result.data?.items[1].testsAttempted).toBe(1);
  });
});


describe('teacherAnalyticsService.getSubjectAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates subject breakdown data from mock_results correctly', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_results') {
        const queryObj = {
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
        };
        (queryObj as any).then = (resolve: any) =>
          resolve({
            data: [
              {
                attempt_id: 'att-1',
                percentage: 80,
                total_score: 80,
                max_score: 100,
                correct_count: 8,
                wrong_count: 2,
                skipped_count: 0,
                generated_at: '2026-08-20T10:00:00Z',
                subject_breakdown: [
                  {
                    subjectId: 'sub-physics',
                    subjectName: 'Physics',
                    score: 40,
                    maxScore: 50,
                    correct: 4,
                    wrong: 1,
                    skipped: 0,
                  },
                  {
                    subjectId: 'sub-chem',
                    subjectName: 'Chemistry',
                    score: 40,
                    maxScore: 50,
                    correct: 4,
                    wrong: 1,
                    skipped: 0,
                  },
                ],
              },
              {
                attempt_id: 'att-2',
                percentage: 60,
                total_score: 60,
                max_score: 100,
                correct_count: 6,
                wrong_count: 4,
                skipped_count: 0,
                generated_at: '2026-08-21T10:00:00Z',
                subject_breakdown: [
                  {
                    subjectId: 'sub-physics',
                    subjectName: 'Physics',
                    score: 50,
                    maxScore: 50,
                    correct: 5,
                    wrong: 0,
                    skipped: 0,
                  },
                  {
                    subjectId: 'sub-chem',
                    subjectName: 'Chemistry',
                    score: 10,
                    maxScore: 50,
                    correct: 1,
                    wrong: 4,
                    skipped: 0,
                  },
                ],
              },
            ],
            error: null,
          });
        return {
          select: vi.fn().mockReturnValue(queryObj),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ data: [], error: null }),
      };
    });

    const result = await getSubjectAnalytics(INSTITUTE_ID, {
      dateRange: { from: '', to: '', preset: 'last30days' },
    } as any);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.comparisonData).toHaveLength(2);

    const physics = result.data?.comparisonData.find((s) => s.subjectId === 'sub-physics');
    expect(physics).toBeDefined();
    expect(physics?.subjectName).toBe('Physics');
    // Physics: 40 + 50 = 90 out of 100 => 90%
    expect(physics?.averageScore).toBe(90);
    // Physics accuracy: (4+5)/(4+5+1+0) = 9/10 = 90%
    expect(physics?.averageAccuracy).toBe(90);
    expect(physics?.totalAttempts).toBe(2);

    const chemistry = result.data?.comparisonData.find((s) => s.subjectId === 'sub-chem');
    expect(chemistry).toBeDefined();
    expect(chemistry?.subjectName).toBe('Chemistry');
    // Chem: 40 + 10 = 50 out of 100 => 50%
    expect(chemistry?.averageScore).toBe(50);
    // Chem accuracy: (4+1)/(4+1+1+4) = 5/10 = 50%
    expect(chemistry?.averageAccuracy).toBe(50);

    expect(result.data?.overallStats.bestSubject).toBe('Physics');
    expect(result.data?.overallStats.weakestSubject).toBe('Chemistry');
    expect(result.data?.overallStats.totalSubjects).toBe(2);
  });

  it('handles historical fallback when subject_breakdown is NULL', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_results') {
        const queryObj = {
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
        };
        (queryObj as any).then = (resolve: any) =>
          resolve({
            data: [
              {
                attempt_id: 'att-hist-1',
                percentage: 75,
                total_score: 75,
                max_score: 100,
                correct_count: 3,
                wrong_count: 1,
                skipped_count: 0,
                generated_at: '2026-08-15T10:00:00Z',
                subject_breakdown: null, // Historical row with NULL breakdown
              },
            ],
            error: null,
          });
        return {
          select: vi.fn().mockReturnValue(queryObj),
        };
      }
      if (table === 'mock_answers') {
        const queryObj = {
          in: vi.fn().mockResolvedValue({
            data: [
              {
                attempt_id: 'att-hist-1',
                is_correct: true,
                marks_awarded: 25,
                is_answered: true,
                questions: {
                  question_id: 'q-1',
                  marks: 25,
                  subject_id: 'sub-bio',
                  subjects: {
                    subject_id: 'sub-bio',
                    name: 'Biology',
                  },
                },
              },
              {
                attempt_id: 'att-hist-1',
                is_correct: false,
                marks_awarded: 0,
                is_answered: true,
                questions: {
                  question_id: 'q-2',
                  marks: 25,
                  subject_id: 'sub-bio',
                  subjects: {
                    subject_id: 'sub-bio',
                    name: 'Biology',
                  },
                },
              },
            ],
            error: null,
          }),
        };
        return {
          select: vi.fn().mockReturnValue(queryObj),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ data: [], error: null }),
      };
    });

    const result = await getSubjectAnalytics(INSTITUTE_ID);

    expect(result.success).toBe(true);
    expect(result.data?.comparisonData).toHaveLength(1);
    const biology = result.data?.comparisonData[0];
    expect(biology?.subjectName).toBe('Biology');
    expect(biology?.averageScore).toBe(50); // 25 out of 50
    expect(biology?.averageAccuracy).toBe(50); // 1 correct, 1 wrong
  });
});
