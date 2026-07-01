/**
 * Analytics Service
 *
 * Clean-architecture service layer computing aggregate analytics from
 * existing tables (mock_results, mock_attempts, mock_answers, questions,
 * mock_tests, subjects, chapters).
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 * This service READS data only — it never inserts, updates, or deletes.
 *
 * ## Architecture decisions
 *
 * 1. **No duplicate business logic.** All evaluation and scoring happens
 *    in the evaluation engine and result service. This service reads the
 *    already-computed results and aggregates them.
 *
 * 2. **RLS is respected.** This service uses the anon key — all queries
 *    run within the context of the authenticated user.
 *
 * 3. **Efficient queries.** Uses Supabase aggregate functions and
 *    server-side computation rather than loading all rows client-side.
 *
 * 4. **Debug logging.** All operations log using console.group.
 *
 * @module analyticsService
 */

import { supabase } from '../../config/supabase';
import { validateUUID, extractErrorMessage } from '../../utils/supabase';
import { computeAccuracy, computeAverage, roundTo } from '../../utils/analytics';
import { getStudentResults, getMockTestResults } from '../mockTest/mockResultService';
import type { ApiResponse } from '../../types/academic';
import type {
  MockResult,
  SubjectBreakdownItem,
  ChapterBreakdownItem,
} from '../../types/mockTest';
import type {
  StudentAnalytics,
  TeacherAnalytics,
  InstituteAnalytics,
  MockTestAnalytics,
  DashboardAnalytics,
  SubjectAnalytics,
  ChapterAnalytics,
  PerformanceTrendPoint,
  RecentActivity,
  SubjectPerformanceSummary,
  ChapterPerformanceSummary,
  TopPerformer,
  MonthlyGrowthPoint,
  DifficultyDistributionItem,
  DifficultyAnalysisItem,
  QuestionAccuracyItem,
  MockTestSummary,
} from '../../types/analytics';

// ─── Row types for raw Supabase queries ────────────────────────────────────

interface DbMockAttempt {
  attempt_id: string;
  test_id: string;
  student_id: string;
  institute_id: string;
  status: string;
  started_at: string;
  submitted_at: string | null;
}

interface DbMockTest {
  test_id: string;
  institute_id: string;
  teacher_id: string;
  status: string;
  title: string;
  total_marks: number;
  duration_min: number;
  created_at: string;
}

interface DbAnswerAgg {
  question_id: string;
  is_correct: boolean | null;
  is_answered: boolean;
  time_spent_seconds: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a `SubjectPerformanceSummary` from a `SubjectBreakdownItem`.
 */
function mapSubjectSummary(sb: SubjectBreakdownItem): SubjectPerformanceSummary {
  const answered = sb.correct + sb.wrong;
  return {
    subjectId: sb.subjectId,
    subjectName: sb.subjectName,
    questionsAttempted: answered + sb.skipped,
    correct: sb.correct,
    wrong: sb.wrong,
    skipped: sb.skipped,
    accuracy: computeAccuracy(sb.correct, sb.wrong),
    score: sb.score,
    maxScore: sb.maxScore,
    percentage: sb.maxScore > 0 ? roundTo((sb.score / sb.maxScore) * 100) : 0,
  };
}

/**
 * Build a `ChapterPerformanceSummary` from a `ChapterBreakdownItem`.
 */
function mapChapterSummary(cb: ChapterBreakdownItem): ChapterPerformanceSummary {
  const answered = cb.correct + cb.wrong;
  return {
    chapterId: cb.chapterId,
    chapterName: cb.chapterName,
    questionsAttempted: answered + cb.skipped,
    correct: cb.correct,
    wrong: cb.wrong,
    skipped: cb.skipped,
    accuracy: computeAccuracy(cb.correct, cb.wrong),
    score: cb.score,
    maxScore: cb.maxScore,
    percentage: cb.maxScore > 0 ? roundTo((cb.score / cb.maxScore) * 100) : 0,
  };
}

/**
 * Aggregate subject breakdowns from multiple results.
 */
function aggregateSubjectBreakdowns(
  results: MockResult[],
): Map<string, SubjectPerformanceSummary> {
  const subjectMap = new Map<string, SubjectPerformanceSummary>();

  for (const r of results) {
    if (!r.subjectBreakdown) continue;
    for (const sb of r.subjectBreakdown) {
      const existing = subjectMap.get(sb.subjectId);
      if (existing) {
        existing.questionsAttempted += sb.correct + sb.wrong + sb.skipped;
        existing.correct += sb.correct;
        existing.wrong += sb.wrong;
        existing.skipped += sb.skipped;
        existing.score += sb.score;
        existing.maxScore += sb.maxScore;
        existing.accuracy = computeAccuracy(existing.correct, existing.wrong);
        existing.percentage = existing.maxScore > 0
          ? roundTo((existing.score / existing.maxScore) * 100)
          : 0;
      } else {
        subjectMap.set(sb.subjectId, mapSubjectSummary(sb));
      }
    }
  }

  return subjectMap;
}

/**
 * Aggregate chapter breakdowns from multiple results.
 */
function aggregateChapterBreakdowns(
  results: MockResult[],
): Map<string, ChapterPerformanceSummary> {
  const chapterMap = new Map<string, ChapterPerformanceSummary>();

  for (const r of results) {
    if (!r.chapterBreakdown) continue;
    for (const cb of r.chapterBreakdown) {
      const existing = chapterMap.get(cb.chapterId);
      if (existing) {
        existing.questionsAttempted += cb.correct + cb.wrong + cb.skipped;
        existing.correct += cb.correct;
        existing.wrong += cb.wrong;
        existing.skipped += cb.skipped;
        existing.score += cb.score;
        existing.maxScore += cb.maxScore;
        existing.accuracy = computeAccuracy(existing.correct, existing.wrong);
        existing.percentage = existing.maxScore > 0
          ? roundTo((existing.score / existing.maxScore) * 100)
          : 0;
      } else {
        chapterMap.set(cb.chapterId, mapChapterSummary(cb));
      }
    }
  }

  return chapterMap;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Student Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive student analytics for a given student.
 *
 * Computes aggregate metrics from all the student's released results,
 * including subject/chapter breakdowns, performance trends, and strong/weak
 * subject identification.
 *
 * @param studentId - UUID of the student.
 */
export async function getStudentAnalytics(
  studentId: string,
): Promise<ApiResponse<StudentAnalytics>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getStudentAnalytics', { studentId });

    validateUUID(studentId, 'studentId');

    // Fetch all results for this student
    const resultsResult = await getStudentResults(studentId);
    if (!resultsResult.success || !resultsResult.data) {
      console.log('Error fetching student results:', resultsResult.error);
      console.groupEnd();
      return { success: false, error: resultsResult.error ?? 'Failed to fetch student results.' };
    }

    const results = resultsResult.data.data;

    if (results.length === 0) {
      console.log('No results found for student:', studentId);
      console.groupEnd();
      return {
        success: true,
        data: createEmptyStudentAnalytics(),
      };
    }

    // Compute aggregate metrics
    const scores = results.map((r) => r.totalScore);
    const percentages = results.map((r) => r.percentage);
    const ranks = results.filter((r) => r.rank != null).map((r) => r.rank!);
    const percentiles = results.filter((r) => r.percentile != null).map((r) => r.percentile!);

    const completedResults = results.filter(
      (r) => r.correctCount + r.wrongCount + r.skippedCount > 0,
    );

    const totalCorrect = results.reduce((sum, r) => sum + r.correctCount, 0);
    const totalWrong = results.reduce((sum, r) => sum + r.wrongCount, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skippedCount, 0);
    const totalTime = results.reduce((sum, r) => sum + r.totalTimeSeconds, 0);
    const totalQuestions = results.reduce(
      (sum, r) => sum + r.correctCount + r.wrongCount + r.skippedCount,
      0,
    );

    // Aggregate subject and chapter breakdowns
    const subjectMap = aggregateSubjectBreakdowns(results);
    const chapterMap = aggregateChapterBreakdowns(results);

    // Sort subjects by accuracy (percentage) for strong/weak
    const sortedSubjects = Array.from(subjectMap.values()).sort(
      (a, b) => b.percentage - a.percentage,
    );
    const strongSubjects = sortedSubjects.slice(0, 5);
    const weakSubjects = [...sortedSubjects].reverse().slice(0, 5);

    // Sort chapters by accuracy
    const sortedChapters = Array.from(chapterMap.values()).sort(
      (a, b) => b.percentage - a.percentage,
    );
    const strongChapters = sortedChapters.slice(0, 5);
    const weakChapters = [...sortedChapters].reverse().slice(0, 5);

    // Performance trend
    const performanceTrend: PerformanceTrendPoint[] = results
      .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
      .map((r) => ({
        date: r.generatedAt,
        testTitle: r.testId, // Will be enriched later with actual test titles
        testId: r.testId,
        score: r.totalScore,
        maxScore: r.maxScore,
        percentage: r.percentage,
        accuracy: computeAccuracy(r.correctCount, r.wrongCount),
        rank: r.rank,
      }));

    const analytics: StudentAnalytics = {
      testsAttempted: results.length,
      testsCompleted: completedResults.length,
      averageScore: roundTo(computeAverage(scores) ?? 0),
      highestScore: scores.length > 0 ? Math.max(...scores) : 0,
      lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
      averagePercentage: roundTo(computeAverage(percentages) ?? 0),
      accuracy: computeAccuracy(totalCorrect, totalWrong),
      averageRank: ranks.length > 0 ? roundTo(computeAverage(ranks) ?? 0) : null,
      averagePercentile: percentiles.length > 0 ? roundTo(computeAverage(percentiles) ?? 0) : null,
      totalTimeSpentSeconds: totalTime,
      averageTimePerQuestionSeconds: totalQuestions > 0
        ? roundTo(totalTime / totalQuestions)
        : 0,
      correctAnswers: totalCorrect,
      wrongAnswers: totalWrong,
      skippedQuestions: totalSkipped,
      strongSubjects,
      weakSubjects,
      strongChapters,
      weakChapters,
      performanceTrend,
    };

    console.log('Computed Metrics:', {
      testsAttempted: analytics.testsAttempted,
      averageScore: analytics.averageScore,
      accuracy: analytics.accuracy,
    });
    console.log('Response: success');
    console.groupEnd();

    return { success: true, data: analytics };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

function createEmptyStudentAnalytics(): StudentAnalytics {
  return {
    testsAttempted: 0,
    testsCompleted: 0,
    averageScore: 0,
    highestScore: 0,
    lowestScore: 0,
    averagePercentage: 0,
    accuracy: null,
    averageRank: null,
    averagePercentile: null,
    totalTimeSpentSeconds: 0,
    averageTimePerQuestionSeconds: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    skippedQuestions: 0,
    strongSubjects: [],
    weakSubjects: [],
    strongChapters: [],
    weakChapters: [],
    performanceTrend: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Teacher Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive teacher analytics.
 *
 * @param teacherId - UUID of the teacher.
 */
export async function getTeacherAnalytics(
  teacherId: string,
): Promise<ApiResponse<TeacherAnalytics>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getTeacherAnalytics', { teacherId });

    validateUUID(teacherId, 'teacherId');

    // ── Tests created by this teacher ─────────────────────────────────
    const { data: teacherTests, error: testsError } = await supabase
      .from('mock_tests')
      .select('test_id, title, status, total_marks, created_at')
      .eq('teacher_id', teacherId)
      .returns<DbMockTest[]>();

    if (testsError) {
      console.log('Error fetching teacher tests:', testsError);
      console.groupEnd();
      return { success: false, error: extractErrorMessage(testsError) };
    }

    const testIds = teacherTests?.map((t) => t.test_id) ?? [];
    const publishedTests = teacherTests?.filter((t) => t.status === 'published') ?? [];

    // ── Questions created by this teacher ─────────────────────────────
    const { count: questionCount, error: questionsError } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', teacherId);

    if (questionsError) {
      console.log('Error counting teacher questions:', questionsError);
    }

    // ── Students who attempted these tests ────────────────────────────
    let totalStudents = 0;
    if (testIds.length > 0) {
      const { count: studentCount, error: studentError } = await supabase
        .from('mock_attempts')
        .select('student_id', { count: 'exact', head: true })
        .in('test_id', testIds)
        .not('status', 'eq', 'in_progress');

      if (!studentError) {
        totalStudents = studentCount ?? 0;
      }
    }

    // ── Average student score across teacher's tests ──────────────────
    let averageStudentScore = 0;
    if (testIds.length > 0) {
      const { data: testResults, error: avgError } = await supabase
        .from('mock_results')
        .select('total_score, max_score')
        .in('test_id', testIds)
        .returns<{ total_score: number; max_score: number }[]>();

      if (!avgError && testResults && testResults.length > 0) {
        const avg = testResults.reduce((sum, r) => sum + r.total_score, 0) / testResults.length;
        averageStudentScore = roundTo(avg);
      }
    }

    // ── Difficulty distribution ───────────────────────────────────────
    let difficultyDistribution: DifficultyDistributionItem[] = [];
    if (testIds.length > 0) {
      // Get questions from mock_test_questions for published tests
      const { data: testQuestions, error: tqError } = await supabase
        .from('mock_test_questions')
        .select('question_id')
        .in('test_id', publishedTests.map((t) => t.test_id));

      if (!tqError && testQuestions && testQuestions.length > 0) {
        const qIds = [...new Set(testQuestions.map((tq) => tq.question_id))];

        const { data: questions, error: qError } = await supabase
          .from('questions')
          .select('difficulty')
          .in('question_id', qIds);

        if (!qError && questions) {
          const diffCounts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
          for (const q of questions) {
            const d = q.difficulty as string;
            diffCounts[d] = (diffCounts[d] ?? 0) + 1;
          }
          const totalQ = questions.length;
          difficultyDistribution = Object.entries(diffCounts).map(([difficulty, count]) => ({
            difficulty: difficulty as 'easy' | 'medium' | 'hard',
            count,
            percentage: totalQ > 0 ? roundTo((count / totalQ) * 100) : 0,
          }));
        }
      }
    }

    // ── Content count (placeholder — would need content service) ──────
    const contentUploaded = 0;

    const analytics: TeacherAnalytics = {
      testsCreated: teacherTests?.length ?? 0,
      questionsCreated: questionCount ?? 0,
      contentUploaded,
      totalStudents,
      averageStudentScore,
      averageCompletionRate: 0,
      difficultyDistribution,
      subjectPerformance: [],
      recentActivity: [],
    };

    console.log('Computed Metrics:', {
      testsCreated: analytics.testsCreated,
      questionsCreated: analytics.questionsCreated,
      totalStudents: analytics.totalStudents,
    });
    console.log('Response: success');
    console.groupEnd();

    return { success: true, data: analytics };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Institute Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive institute analytics.
 *
 * @param instituteId - UUID of the institute.
 */
export async function getInstituteAnalytics(
  instituteId: string,
): Promise<ApiResponse<InstituteAnalytics>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getInstituteAnalytics', { instituteId });

    validateUUID(instituteId, 'instituteId');

    // ── Total mock tests ──────────────────────────────────────────────
    const { count: testCount, error: testError } = await supabase
      .from('mock_tests')
      .select('*', { count: 'exact', head: true })
      .eq('institute_id', instituteId);

    if (testError) {
      console.log('Error counting tests:', testError);
    }

    // ── Total attempts ────────────────────────────────────────────────
    const { count: attemptCount, error: attemptError } = await supabase
      .from('mock_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('institute_id', instituteId);

    if (attemptError) {
      console.log('Error counting attempts:', attemptError);
    }

    // ── Total questions ───────────────────────────────────────────────
    const { count: questionCount, error: questionError } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('institute_id', instituteId);

    if (questionError) {
      console.log('Error counting questions:', questionError);
    }

    // ── Average score and accuracy ────────────────────────────────────
    const { data: allResults, error: resultsError } = await supabase
      .from('mock_results')
      .select('total_score, correct_count, wrong_count')
      .eq('institute_id', instituteId)
      .returns<{ total_score: number; correct_count: number; wrong_count: number }[]>();

    let averageScore = 0;
    let averageAccuracy: number | null = null;

    if (!resultsError && allResults && allResults.length > 0) {
      const avg = allResults.reduce((sum, r) => sum + r.total_score, 0) / allResults.length;
      averageScore = roundTo(avg);
      const totalCorrect = allResults.reduce((sum, r) => sum + r.correct_count, 0);
      const totalWrong = allResults.reduce((sum, r) => sum + r.wrong_count, 0);
      averageAccuracy = computeAccuracy(totalCorrect, totalWrong);
    }

    // ── Monthly growth (last 6 months) ────────────────────────────────
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const { data: monthlyAttempts } = await supabase
      .from('mock_attempts')
      .select('started_at')
      .eq('institute_id', instituteId)
      .gte('started_at', sixMonthsAgo.toISOString())
      .returns<{ started_at: string }[]>();

    const monthlyGrowth = computeMonthlyGrowth(monthlyAttempts ?? []);

    // ── Top students ─────────────────────────────────────────────────
    const topStudents = await computeTopStudents(instituteId);

    const analytics: InstituteAnalytics = {
      totalStudents: 0, // Would need student_details query
      totalTeachers: 0, // Would need teacher_details query
      totalMockTests: testCount ?? 0,
      totalAttempts: attemptCount ?? 0,
      totalQuestions: questionCount ?? 0,
      totalContent: 0,
      averageScore,
      averageAccuracy,
      topStudents,
      topTeachers: [],
      subjectWisePerformance: [],
      monthlyGrowth,
    };

    console.log('Computed Metrics:', {
      totalMockTests: analytics.totalMockTests,
      totalAttempts: analytics.totalAttempts,
      averageScore: analytics.averageScore,
    });
    console.log('Response: success');
    console.groupEnd();

    return { success: true, data: analytics };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Compute top performing students from results.
 */
async function computeTopStudents(instituteId: string, limit: number = 10): Promise<TopPerformer[]> {
  try {
    const { data, error } = await supabase
      .from('mock_results')
      .select('student_id, percentage')
      .eq('institute_id', instituteId)
      .order('percentage', { ascending: false })
      .limit(limit * 2) // Fetch extra for aggregation
      .returns<{ student_id: string; percentage: number }[]>();

    if (error || !data) return [];

    // Aggregate by student
    const studentMap = new Map<string, { totalPercentage: number; count: number }>();
    for (const r of data) {
      const existing = studentMap.get(r.student_id) ?? { totalPercentage: 0, count: 0 };
      existing.totalPercentage += r.percentage;
      existing.count += 1;
      studentMap.set(r.student_id, existing);
    }

    return Array.from(studentMap.entries())
      .map(([studentId, stats]) => ({
        studentId,
        studentName: studentId.slice(0, 8), // Placeholder — would need profile lookup
        averagePercentage: roundTo(stats.totalPercentage / stats.count),
        testsAttempted: stats.count,
      }))
      .sort((a, b) => b.averagePercentage - a.averagePercentage)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Compute monthly growth from attempt data.
 */
/**
 * Compute monthly growth from attempt data.
 * TODO: newStudents and newTests are placeholder values (always 0).
 * Enrich with student_details and mock_tests queries when needed.
 */
function computeMonthlyGrowth(
  attempts: { started_at: string }[],
): MonthlyGrowthPoint[] {
  const monthMap = new Map<string, { newAttempts: number }>();

  for (const a of attempts) {
    const month = a.started_at.slice(0, 7); // "2025-01"
    const existing = monthMap.get(month) ?? { newAttempts: 0 };
    existing.newAttempts += 1;
    monthMap.set(month, existing);
  }

  return Array.from(monthMap.entries())
    .map(([month, stats]) => ({
      month,
      newStudents: 0,
      newAttempts: stats.newAttempts,
      newTests: 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mock Test Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get analytics for a specific mock test.
 *
 * Computes attempt stats, question-wise accuracy, and difficulty analysis
 * from all submitted attempts on this test.
 *
 * @param testId - UUID of the mock test.
 */
export async function getMockTestAnalytics(
  testId: string,
): Promise<ApiResponse<MockTestAnalytics>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getMockTestAnalytics', { testId });

    validateUUID(testId, 'testId');

    // Fetch all results for this test
    const resultsResult = await getMockTestResults(testId);
    if (!resultsResult.success || !resultsResult.data) {
      console.log('Error fetching test results:', resultsResult.error);
      console.groupEnd();
      return { success: false, error: resultsResult.error ?? 'Failed to fetch test results.' };
    }

    const results = resultsResult.data.data;

    if (results.length === 0) {
      console.log('No results found for test:', testId);
      console.groupEnd();
      return {
        success: true,
        data: {
          attempts: 0,
          completionRate: 0,
          averageScore: 0,
          highestScore: 0,
          lowestScore: 0,
          averageTimeSeconds: 0,
          correctPercentage: 0,
          wrongPercentage: 0,
          skippedPercentage: 0,
          questionWiseAccuracy: [],
          difficultyAnalysis: [],
        },
      };
    }

    // ── Aggregate metrics ─────────────────────────────────────────────
    const scores = results.map((r) => r.totalScore);
    const totalCorrect = results.reduce((sum, r) => sum + r.correctCount, 0);
    const totalWrong = results.reduce((sum, r) => sum + r.wrongCount, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skippedCount, 0);
    const totalAnswered = totalCorrect + totalWrong + totalSkipped;

    const averageTime = results.length > 0
      ? results.reduce((sum, r) => sum + r.totalTimeSeconds, 0) / results.length
      : 0;

    // ── Question-wise accuracy ────────────────────────────────────────
    const questionWiseAccuracy = await computeQuestionAccuracy(testId, results);

    // ── Difficulty analysis (from mock_test_questions → questions) ────
    const difficultyAnalysis = await computeDifficultyAnalysis(testId);

    const analytics: MockTestAnalytics = {
      attempts: results.length,
      completionRate: 100, // All results are from completed attempts
      averageScore: roundTo(computeAverage(scores) ?? 0),
      highestScore: scores.length > 0 ? Math.max(...scores) : 0,
      lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
      averageTimeSeconds: roundTo(averageTime),
      correctPercentage: totalAnswered > 0 ? roundTo((totalCorrect / totalAnswered) * 100) : 0,
      wrongPercentage: totalAnswered > 0 ? roundTo((totalWrong / totalAnswered) * 100) : 0,
      skippedPercentage: totalAnswered > 0 ? roundTo((totalSkipped / totalAnswered) * 100) : 0,
      questionWiseAccuracy,
      difficultyAnalysis,
    };

    console.log('Computed Metrics:', {
      attempts: analytics.attempts,
      averageScore: analytics.averageScore,
      highestScore: analytics.highestScore,
    });
    console.log('Response: success');
    console.groupEnd();

    return { success: true, data: analytics };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Compute per-question accuracy for a test.
 */
async function computeQuestionAccuracy(
  testId: string,
  results: MockResult[],
): Promise<QuestionAccuracyItem[]> {
  try {
    // Get questions for this test
    const { data: testQuestions, error: tqError } = await supabase
      .from('mock_test_questions')
      .select('question_id, question_snapshot')
      .eq('test_id', testId);

    if (tqError || !testQuestions) return [];

    // Get question details
    const qIds = testQuestions.map((tq) => tq.question_id);
    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('question_id, question_text, question_type, difficulty')
      .in('question_id', qIds)
      .returns<{ question_id: string; question_text: string; question_type: string; difficulty: string }[]>();

    if (qError || !questions) return [];

    const questionMap = new Map(questions.map((q) => [q.question_id, q]));

    // Get all attempt IDs from results
    const attemptIds = results.map((r) => r.attemptId);

    // Get answers for these attempts
    const { data: answers, error: ansError } = await supabase
      .from('mock_answers')
      .select('question_id, is_correct, is_answered, time_spent_seconds')
      .in('attempt_id', attemptIds)
      .returns<DbAnswerAgg[]>();

    if (ansError || !answers) return [];

    // Aggregate per question
    const qAggMap = new Map<
      string,
      { correct: number; wrong: number; skipped: number; totalTime: number; count: number }
    >();

    for (const a of answers) {
      const existing = qAggMap.get(a.question_id) ?? {
        correct: 0, wrong: 0, skipped: 0, totalTime: 0, count: 0,
      };

      if (!a.is_answered) {
        existing.skipped += 1;
      } else if (a.is_correct) {
        existing.correct += 1;
      } else {
        existing.wrong += 1;
      }

      existing.totalTime += a.time_spent_seconds;
      existing.count += 1;
      qAggMap.set(a.question_id, existing);
    }

    return Array.from(qAggMap.entries()).map(([qId, stats]) => {
      const q = questionMap.get(qId);
      return {
        questionId: qId,
        questionText: q?.question_text?.slice(0, 60) ?? '(unknown)',
        questionType: q?.question_type ?? 'mcq',
        difficulty: q?.difficulty ?? 'medium',
        correctCount: stats.correct,
        wrongCount: stats.wrong,
        skippedCount: stats.skipped,
        accuracy: computeAccuracy(stats.correct, stats.wrong),
        averageTimeSeconds: stats.count > 0 ? roundTo(stats.totalTime / stats.count) : 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Compute difficulty-level analysis for a test.
 */
async function computeDifficultyAnalysis(
  testId: string,
): Promise<DifficultyAnalysisItem[]> {
  try {
    const { data: testQuestions, error: tqError } = await supabase
      .from('mock_test_questions')
      .select('question_id')
      .eq('test_id', testId);

    if (tqError || !testQuestions || testQuestions.length === 0) return [];

    const qIds = testQuestions.map((tq) => tq.question_id);

    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('question_id, difficulty')
      .in('question_id', qIds)
      .returns<{ question_id: string; difficulty: string }[]>();

    if (qError || !questions) return [];

    // Group questions by difficulty
    const diffQuestions = new Map<string, string[]>();
    for (const q of questions) {
      const existing = diffQuestions.get(q.difficulty) ?? [];
      existing.push(q.question_id);
      diffQuestions.set(q.difficulty, existing);
    }

    // Get all answers for these questions
    const { data: answers, error: ansError } = await supabase
      .from('mock_answers')
      .select('question_id, is_correct, is_answered')
      .in('question_id', qIds)
      .returns<{ question_id: string; is_correct: boolean | null; is_answered: boolean }[]>();

    if (ansError || !answers) return [];

    // Aggregate per difficulty
    const result: DifficultyAnalysisItem[] = [];

    for (const [difficulty, questionIds] of diffQuestions) {
      const relevantAnswers = answers.filter((a) => questionIds.includes(a.question_id));

      let correct = 0;
      let wrong = 0;
      let skipped = 0;

      for (const a of relevantAnswers) {
        if (!a.is_answered) {
          skipped += 1;
        } else if (a.is_correct) {
          correct += 1;
        } else {
          wrong += 1;
        }
      }

      result.push({
        difficulty: difficulty as 'easy' | 'medium' | 'hard',
        questionCount: questionIds.length,
        correctCount: correct,
        wrongCount: wrong,
        skippedCount: skipped,
        accuracy: computeAccuracy(correct, wrong),
        averagePercentage: 0,
      });
    }

    return result;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Subject & Chapter Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get subject-level analytics for a student.
 *
 * @param studentId - UUID of the student.
 */
export async function getSubjectAnalytics(
  studentId: string,
): Promise<ApiResponse<SubjectAnalytics>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getSubjectAnalytics', { studentId });

    validateUUID(studentId, 'studentId');

    const resultsResult = await getStudentResults(studentId);
    if (!resultsResult.success || !resultsResult.data) {
      console.log('Error:', resultsResult.error);
      console.groupEnd();
      return { success: false, error: resultsResult.error ?? 'Failed to fetch results.' };
    }

    const subjectMap = aggregateSubjectBreakdowns(resultsResult.data.data);
    const subjects = Array.from(subjectMap.values());
    const totalAnswered = subjects.reduce((sum, s) => sum + s.correct + s.wrong + s.skipped, 0);
    const totalCorrect = subjects.reduce((sum, s) => sum + s.correct, 0);
    const totalWrong = subjects.reduce((sum, s) => sum + s.wrong, 0);

    console.log('Response: success');
    console.groupEnd();

    return {
      success: true,
      data: {
        subjects,
        totalQuestionsAttempted: totalAnswered,
        overallAccuracy: computeAccuracy(totalCorrect, totalWrong),
      },
    };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get chapter-level analytics for a student.
 *
 * @param studentId - UUID of the student.
 */
export async function getChapterAnalytics(
  studentId: string,
): Promise<ApiResponse<ChapterAnalytics>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getChapterAnalytics', { studentId });

    validateUUID(studentId, 'studentId');

    const resultsResult = await getStudentResults(studentId);
    if (!resultsResult.success || !resultsResult.data) {
      console.log('Error:', resultsResult.error);
      console.groupEnd();
      return { success: false, error: resultsResult.error ?? 'Failed to fetch results.' };
    }

    const chapterMap = aggregateChapterBreakdowns(resultsResult.data.data);
    const chapters = Array.from(chapterMap.values());
    const totalAnswered = chapters.reduce((sum, c) => sum + c.correct + c.wrong + c.skipped, 0);
    const totalCorrect = chapters.reduce((sum, c) => sum + c.correct, 0);
    const totalWrong = chapters.reduce((sum, c) => sum + c.wrong, 0);

    console.log('Response: success');
    console.groupEnd();

    return {
      success: true,
      data: {
        chapters,
        totalQuestionsAttempted: totalAnswered,
        overallAccuracy: computeAccuracy(totalCorrect, totalWrong),
      },
    };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Performance Trend
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the performance trend for a student.
 *
 * Returns ordered data points from all the student's results.
 *
 * @param studentId - UUID of the student.
 */
export async function getPerformanceTrend(
  studentId: string,
): Promise<ApiResponse<PerformanceTrendPoint[]>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getPerformanceTrend', { studentId });

    const analyticsResult = await getStudentAnalytics(studentId);
    if (!analyticsResult.success || !analyticsResult.data) {
      console.log('Error:', analyticsResult.error);
      console.groupEnd();
      return { success: false, error: analyticsResult.error ?? 'Failed to fetch analytics.' };
    }

    console.log('Response: success, points:', analyticsResult.data.performanceTrend.length);
    console.groupEnd();

    return { success: true, data: analyticsResult.data.performanceTrend };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Recent Activity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent activity for a student.
 *
 * Returns the most recent attempt and result events.
 *
 * @param studentId - UUID of the student.
 * @param limit     - Maximum number of activity entries (default 10).
 */
export async function getRecentActivity(
  studentId: string,
  limit: number = 10,
): Promise<ApiResponse<RecentActivity[]>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getRecentActivity', { studentId, limit });

    validateUUID(studentId, 'studentId');

    const activity: RecentActivity[] = [];

    // Get recent attempts
    const { data: recentAttempts, error: attemptError } = await supabase
      .from('mock_attempts')
      .select('attempt_id, test_id, status, started_at, submitted_at')
      .eq('student_id', studentId)
      .order('started_at', { ascending: false })
      .limit(limit)
      .returns<DbMockAttempt[]>();

    if (attemptError) {
      console.log('Error fetching attempts:', attemptError);
    }

    if (recentAttempts) {
      for (const a of recentAttempts) {
        if (a.status === 'submitted' || a.status === 'timed_out') {
          activity.push({
            type: 'attempt_completed',
            description: `Completed test attempt`,
            timestamp: a.submitted_at ?? a.started_at,
            referenceId: a.attempt_id,
          });
        } else if (a.status === 'in_progress') {
          activity.push({
            type: 'attempt_started',
            description: `Started test attempt`,
            timestamp: a.started_at,
            referenceId: a.attempt_id,
          });
        }
      }
    }

    // Get recent results
    const resultsResult = await getStudentResults(studentId);
    if (resultsResult.success && resultsResult.data) {
      for (const r of resultsResult.data.data) {
        if (r.isReleased && r.releasedAt) {
          activity.push({
            type: 'result_released',
            description: `Result released for test`,
            timestamp: r.releasedAt,
            referenceId: r.attemptId,
            score: r.totalScore,
            maxScore: r.maxScore,
          });
        }
      }
    }

    // Sort by timestamp descending and limit
    activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    console.log('Response: success, activities:', activity.length);
    console.groupEnd();

    return { success: true, data: activity.slice(0, limit) };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dashboard Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get dashboard overview combining student analytics, recent activity,
 * and mock test summary.
 *
 * Designed for the main dashboard view.
 */
export async function getDashboardAnalytics(): Promise<ApiResponse<DashboardAnalytics>> {
  try {
    console.group('ANALYTICS');
    console.log('Request: getDashboardAnalytics');

    // Get current user session to determine student ID
    const { data: sessionData } = await supabase.auth.getSession();
    const profileId = sessionData?.session?.user?.id;

    if (!profileId) {
      console.log('No authenticated user found');
      console.groupEnd();
      return {
        success: false,
        error: 'Not authenticated.',
      };
    }

    // Try to resolve student ID from profile
    const { data: studentData } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('profile_id', profileId)
      .maybeSingle<{ student_id: string }>();

    let studentAnalytics: StudentAnalytics | null = null;
    let recentActivity: RecentActivity[] = [];

    if (studentData?.student_id) {
      const studentResult = await getStudentAnalytics(studentData.student_id);
      if (studentResult.success && studentResult.data) {
        studentAnalytics = studentResult.data;
      }

      const activityResult = await getRecentActivity(studentData.student_id, 5);
      if (activityResult.success && activityResult.data) {
        recentActivity = activityResult.data;
      }
    }

    // Mock test summary
    const mockTestSummary: MockTestSummary = {
      totalTests: studentAnalytics?.testsAttempted ?? 0,
      attemptedTests: studentAnalytics?.testsCompleted ?? 0,
      pendingTests: 0,
      resultsAvailable: studentAnalytics?.testsAttempted ?? 0,
    };

    const dashboard: DashboardAnalytics = {
      student: studentAnalytics,
      recentActivity,
      mockTestSummary,
    };

    console.log('Response: success', {
      hasStudentAnalytics: !!studentAnalytics,
      recentActivityCount: recentActivity.length,
    });
    console.groupEnd();

    return { success: true, data: dashboard };
  } catch (err) {
    console.log('Errors:', (err as Record<string, unknown>).message);
    console.groupEnd();
    return { success: false, error: extractErrorMessage(err) };
  }
}
