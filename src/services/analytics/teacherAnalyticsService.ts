/**
 * Teacher Analytics Service
 *
 * Aggregates data across all students, tests, subjects, chapters, and
 * questions to provide teacher-level analytics. Reuses existing services
 * (mockResultService, analyticsService, teacherService) rather than
 * duplicating business logic.
 *
 * Every public method returns a standardised `ApiResponse<T>` shape.
 *
 * @module services/analytics/teacherAnalyticsService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import { computeAccuracy, computeAverage, roundTo } from '@/utils/analytics';
import type { ApiResponse } from '@/types/academic';
import type {
  StudentBucketDrilldownParams,
  StudentBucketDrilldownItem,
  StudentBucketDrilldownResult,
  TeacherAnalyticsDashboard,
  DashboardSummaryCards,
  StudentAggregateAnalytics,
  DistributionBucket,
  ActiveStudentSummary,
  TimeSeriesPoint,
  StudentSummary,
  TeacherMockTestAnalytics,
  MockTestSummary,
  MockTestOverallStats,
  TeacherSubjectAnalytics,
  SubjectComparisonItem,
  SubjectRankingItem,
  SubjectOverallStats,
  TeacherChapterAnalytics,
  ChapterDifficultyItem,
  ChapterOverallStats,
  TeacherQuestionAnalytics,
  QuestionAnalyticsItem,
  DifficultyBreakdownItem,
  QuestionTypeDistributionItem,
  QuestionOverallStats,
  TeacherPerformanceTrends,
  TrendPeriodData,
  TrendComparison,
  TrendSummary,
  TeacherLeaderboard,
  LeaderboardEntry,
  BatchLeaderboardEntry,
  SubjectLeaderboardEntry,
  ScoreLeaderboardEntry,
  TeacherInsights,
  InsightItem,
  InsightSummary,
  AnalyticsFilters,
  DateRangeFilter,
} from '@/types/analytics-extended';

// ═══════════════════════════════════════════════════════════════════════════
//  Internal aggregation state types
// ═══════════════════════════════════════════════════════════════════════════

interface SubjectAggState {
  name: string;
  correct: number;
  wrong: number;
  skipped: number;
  scores: number[];
  maxScores: number[];
  percentages: number[];
  completed: number;
  passed: number;
  count: number;
}

interface ChapterAggState {
  name: string;
  correct: number;
  wrong: number;
  skipped: number;
  scores: number[];
  maxScores: number[];
  count: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function getDateRangeFilter(filters?: AnalyticsFilters): { from: string; to: string } {
  if (!filters?.dateRange || filters.dateRange.preset === 'custom') {
    return {
      from: filters?.dateRange?.from ?? '',
      to: filters?.dateRange?.to ?? '',
    };
  }

  const now = new Date();
  const to = now.toISOString();
  let from: string;

  switch (filters.dateRange.preset) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      break;
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      from = new Date(y.getFullYear(), y.getMonth(), y.getDate()).toISOString();
      break;
    }
    case 'last7days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      from = d.toISOString();
      break;
    }
    case 'last30days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      from = d.toISOString();
      break;
    }
    case 'last90days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 90);
      from = d.toISOString();
      break;
    }
    case 'thisMonth':
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      break;
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      from = first.toISOString();
      break;
    }
    case 'thisQuarter': {
      const q = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), q, 1).toISOString();
      break;
    }
    case 'thisYear':
      from = new Date(now.getFullYear(), 0, 1).toISOString();
      break;
    default:
      from = '';
  }

  return { from, to };
}

function computeDistributionBucket(
  values: number[],
  bucketSize: number = 10,
  max: number = 100,
): DistributionBucket[] {
  const buckets: DistributionBucket[] = [];
  for (let i = 0; i < max; i += bucketSize) {
    const min = i;
    const maxVal = i + bucketSize;
    const count = values.filter((v) =>
      maxVal === max ? v >= min && v <= maxVal : v >= min && v < maxVal,
    ).length;
    buckets.push({
      range: `${min}–${maxVal === max ? '100' : maxVal}`,
      min,
      max: maxVal,
      count,
      percentage: values.length > 0 ? (count / values.length) * 100 : 0,
    });
  }
  return buckets;
}

function computeWeeklyPoints(
  data: { date: string; value: number }[],
  mode: 'average' | 'count' | 'sum' = 'average',
): TimeSeriesPoint[] {
  const weekMap = new Map<string, { total: number; count: number }>();

  for (const d of data) {
    const date = new Date(d.date);
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    const weekKey = monday.toISOString().slice(0, 10);

    const existing = weekMap.get(weekKey) ?? { total: 0, count: 0 };
    existing.total += d.value;
    existing.count += 1;
    weekMap.set(weekKey, existing);
  }

  return Array.from(weekMap.entries())
    .map(([date, stats]) => ({
      date,
      label: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: mode === 'count' ? stats.count : mode === 'sum' ? roundTo(stats.total) : (stats.count > 0 ? roundTo(stats.total / stats.count) : 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeMonthlyPoints(
  data: { date: string; value: number }[],
  mode: 'average' | 'count' | 'sum' = 'average',
): TimeSeriesPoint[] {
  const monthMap = new Map<string, { total: number; count: number }>();

  for (const d of data) {
    const monthKey = d.date.slice(0, 7);

    const existing = monthMap.get(monthKey) ?? { total: 0, count: 0 };
    existing.total += d.value;
    existing.count += 1;
    monthMap.set(monthKey, existing);
  }

  return Array.from(monthMap.entries())
    .map(([date, stats]) => ({
      date,
      label: new Date(date + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      value: mode === 'count' ? stats.count : mode === 'sum' ? roundTo(stats.total) : (stats.count > 0 ? roundTo(stats.total / stats.count) : 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeMovingAverage(values: number[], window: number = 3): number[] {
  if (values.length < window) return values;
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
    result.push(roundTo(avg));
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get dashboard summary cards for the teacher analytics dashboard.
 * Aggregates across all results to compute high-level stats.
 */
export async function getAnalyticsDashboard(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherAnalyticsDashboard>> {
  try {
    const dateFilter = getDateRangeFilter(filters);

    let query = supabase
      .from('mock_results')
      .select('*', { count: 'exact' })
      .eq('institute_id', instituteId);

    if (dateFilter.from) query = query.gte('generated_at', dateFilter.from);
    if (dateFilter.to) query = query.lte('generated_at', dateFilter.to);

    const { data: results, error, count } = await query
      .returns<{
        total_score: number;
        max_score: number;
        percentage: number;
        correct_count: number;
        wrong_count: number;
        skipped_count: number;
        total_time_seconds: number;
        student_id: string;
        test_id: string;
        generated_at: string;
      }[]>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const r = results ?? [];

    // Unique students
    const uniqueStudents = new Set(r.map((x) => x.student_id));
    const uniqueTests = new Set(r.map((x) => x.test_id));

    // Summary metrics
    const scores = r.map((x) => x.total_score);
    const percentages = r.map((x) => x.percentage);
    const totalCorrect = r.reduce((s, x) => s + x.correct_count, 0);
    const totalWrong = r.reduce((s, x) => s + x.wrong_count, 0);
    const totalAnswered = r.reduce((s, x) => s + x.correct_count + x.wrong_count + x.skipped_count, 0);
    const totalTime = r.reduce((s, x) => s + x.total_time_seconds, 0);
    const completedCount = r.filter((x) => x.skipped_count + x.correct_count + x.wrong_count > 0).length;

    // Pass percentage (percentage >= 40 considered pass)
    const passedCount = r.filter((x) => x.percentage >= 40).length;

    const summary: DashboardSummaryCards = {
      totalStudents: uniqueStudents.size,
      totalTests: uniqueTests.size,
      totalAttempts: r.length,
      averageScore: r.length > 0 ? roundTo(computeAverage(scores) ?? 0) : 0,
      averageAccuracy: computeAccuracy(totalCorrect, totalWrong),
      completionRate: r.length > 0 ? roundTo((completedCount / r.length) * 100) : 0,
      averageTimeSeconds: r.length > 0 ? roundTo(totalTime / r.length) : 0,
      passPercentage: r.length > 0 ? roundTo((passedCount / r.length) * 100) : 0,
    };

    // Recent activity
    const recentActivity = r
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
      .slice(0, 10)
      .map((x) => ({
        id: `${x.test_id}-${x.student_id}-${x.generated_at}`,
        type: 'attempt' as const,
        description: `Student completed test attempt with ${x.percentage.toFixed(0)}%`,
        timestamp: x.generated_at,
        metadata: { score: x.total_score, maxScore: x.max_score, studentId: x.student_id },
      }));

    const dashboard: TeacherAnalyticsDashboard = {
      summaryCards: summary,
      recentActivity,
      quickStats: {
        testsCreated: uniqueTests.size,
        questionsCreated: 0,
        publishedTests: 0,
        draftTests: 0,
        pendingApprovals: 0,
        unreadNotifications: 0,
        resultsToRelease: 0,
        activeStudents: uniqueStudents.size,
      },
    };

    return { success: true, data: dashboard };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get student-level aggregate analytics across all students in the institute.
 */
export async function getStudentAggregateAnalytics(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<StudentAggregateAnalytics>> {
  try {
    const dateFilter = getDateRangeFilter(filters);

    let query = supabase
      .from('mock_results')
      .select('*')
      .eq('institute_id', instituteId);

    if (dateFilter.from) query = query.gte('generated_at', dateFilter.from);
    if (dateFilter.to) query = query.lte('generated_at', dateFilter.to);

    const { data: results, error } = await query
      .returns<{
        student_id: string;
        test_id: string;
        total_score: number;
        max_score: number;
        percentage: number;
        correct_count: number;
        wrong_count: number;
        skipped_count: number;
        total_time_seconds: number;
        generated_at: string;
      }[]>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const r = results ?? [];

    // Build student aggregates
    const studentMap = new Map<string, {
      percentages: number[];
      totalCorrect: number;
      totalWrong: number;
      totalSkipped: number;
      totalTime: number;
      tests: number;
      dates: string[];
    }>();

    for (const row of r) {
      const existing = studentMap.get(row.student_id) ?? {
        percentages: [],
        totalCorrect: 0,
        totalWrong: 0,
        totalSkipped: 0,
        totalTime: 0,
        tests: 0,
        dates: [],
      };
      existing.percentages.push(row.percentage);
      existing.totalCorrect += row.correct_count;
      existing.totalWrong += row.wrong_count;
      existing.totalSkipped += row.skipped_count;
      existing.totalTime += row.total_time_seconds;
      existing.tests += 1;
      existing.dates.push(row.generated_at);
      studentMap.set(row.student_id, existing);
    }

    const students = Array.from(studentMap.entries()).map(([id, s]) => ({
      studentId: id,
      percentages: s.percentages,
      avgPercentage: computeAverage(s.percentages) ?? 0,
      totalCorrect: s.totalCorrect,
      totalWrong: s.totalWrong,
      totalSkipped: s.totalSkipped,
      accuracy: computeAccuracy(s.totalCorrect, s.totalWrong),
      totalTime: s.totalTime,
      testsAttempted: s.tests,
      dates: s.dates,
    }));

    // Score distribution (student-level average score distribution)
    const allStudentAvgPercentages = students.map((s) => s.avgPercentage);
    const scoreDistribution = computeDistributionBucket(allStudentAvgPercentages, 10, 100);

    // Accuracy distribution
    const allAccuracies = students
      .filter((s) => s.accuracy != null)
      .map((s) => s.accuracy!);
    const accuracyDistribution = computeDistributionBucket(allAccuracies, 10, 100);

    // Completion rate distribution
    const completionRates = students.map((s) => {
      const answered = s.totalCorrect + s.totalWrong;
      const total = answered + s.totalSkipped;
      return total > 0 ? (answered / total) * 100 : 0;
    });
    const completionRateDistribution = computeDistributionBucket(completionRates, 10, 100);

    // Resolve total enrolled students from student_details
    const { count: totalEnrolledCount } = await supabase
      .from('student_details')
      .select('student_id', { count: 'exact', head: true })
      .eq('institute_id', instituteId);

    const totalStudentsCount = totalEnrolledCount ?? students.length;

    // Resolve real student names from student_details -> profiles
    const uniqueStudentIds = Array.from(studentMap.keys());
    const { data: studentDetails } = await supabase
      .from('student_details')
      .select('student_id, profiles(name)')
      .in('student_id', uniqueStudentIds);

    const studentNameMap = new Map<string, string>();
    for (const sd of studentDetails ?? []) {
      const p = (sd as any).profiles;
      const name = Array.isArray(p) ? p[0]?.name : p?.name;
      if (name) studentNameMap.set(sd.student_id, name);
    }

    // Active students
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const monthAgo = now - 30 * 86400000;
    const quarterAgo = now - 90 * 86400000;

    const activeLastWeek = students.filter((s) =>
      s.dates.some((d) => new Date(d).getTime() > weekAgo),
    ).length;
    const activeLastMonth = students.filter((s) =>
      s.dates.some((d) => new Date(d).getTime() > monthAgo),
    ).length;
    const activeLastQuarter = students.filter((s) =>
      s.dates.some((d) => new Date(d).getTime() > quarterAgo),
    ).length;

    const activeStudentSummary: ActiveStudentSummary = {
      total: totalStudentsCount,
      activeLastWeek,
      activeLastMonth,
      activeLastQuarter,
      inactive: Math.max(0, totalStudentsCount - activeLastQuarter),
    };

    // Weekly activity (count of mock_results per week)
    const weeklyData = r.map((x) => ({ date: x.generated_at, value: 1 }));
    const weeklyActivity = computeWeeklyPoints(weeklyData, 'count');

    // Monthly activity (count of mock_results per month)
    const monthlyActivity = computeMonthlyPoints(weeklyData, 'count');

    // Top performers (by avg percentage, min 2 tests)
    const topPerformers: StudentSummary[] = students
      .filter((s) => s.testsAttempted >= 2)
      .sort((a, b) => b.avgPercentage - a.avgPercentage)
      .slice(0, 10)
      .map((s) => ({
        studentId: s.studentId,
        name: studentNameMap.get(s.studentId) ?? `Student #${s.studentId.slice(0, 6)}`,
        averagePercentage: roundTo(s.avgPercentage),
        testsAttempted: s.testsAttempted,
        trend: determineTrend(s.percentages),
        lastActive: s.dates.sort().reverse()[0] ?? null,
      }));

    // Weak students (bottom by avg percentage, min 2 tests)
    const weakStudents: StudentSummary[] = students
      .filter((s) => s.testsAttempted >= 2)
      .sort((a, b) => a.avgPercentage - b.avgPercentage)
      .slice(0, 10)
      .map((s) => ({
        studentId: s.studentId,
        name: studentNameMap.get(s.studentId) ?? `Student #${s.studentId.slice(0, 6)}`,
        averagePercentage: roundTo(s.avgPercentage),
        testsAttempted: s.testsAttempted,
        trend: determineTrend(s.percentages),
        lastActive: s.dates.sort().reverse()[0] ?? null,
      }));

    // Most improved (by percentage change from first to last)
    const improvedWithExtra = students
      .filter((s) => s.testsAttempted >= 3 && s.percentages.length >= 2)
      .map((s) => ({
        studentId: s.studentId,
        name: studentNameMap.get(s.studentId) ?? `Student #${s.studentId.slice(0, 6)}`,
        averagePercentage: roundTo(s.avgPercentage),
        testsAttempted: s.testsAttempted,
        improvement: s.percentages[s.percentages.length - 1] - s.percentages[0],
        trend: determineTrend(s.percentages) as 'improving' | 'declining' | 'stable',
        lastActive: s.dates.sort().reverse()[0] ?? null,
      }));
    const mostImprovedStudents: StudentSummary[] = improvedWithExtra
      .sort((a, b) => b.improvement - a.improvement)
      .slice(0, 10)
      .map(({ improvement: _, ...rest }) => rest);

    // Inactive students (no activity in last 90 days)
    const inactiveStudents: StudentSummary[] = students
      .filter((s) => !s.dates.some((d) => new Date(d).getTime() > quarterAgo))
      .slice(0, 10)
      .map((s) => ({
        studentId: s.studentId,
        name: studentNameMap.get(s.studentId) ?? `Student #${s.studentId.slice(0, 6)}`,
        averagePercentage: roundTo(s.avgPercentage),
        testsAttempted: s.testsAttempted,
        trend: 'declining',
        lastActive: s.dates.sort().reverse()[0] ?? null,
      }));

    const analytics: StudentAggregateAnalytics = {
      scoreDistribution,
      accuracyDistribution,
      completionRateDistribution,
      activeStudents: activeStudentSummary,
      weeklyActivity,
      monthlyActivity,
      topPerformers,
      weakStudents,
      mostImprovedStudents,
      inactiveStudents,
    };

    return { success: true, data: analytics };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

function determineTrend(percentages: number[]): 'improving' | 'declining' | 'stable' {
  if (percentages.length < 2) return 'stable';
  const first = percentages[0];
  const last = percentages[percentages.length - 1];
  if (first === 0 && last > 0) return 'improving';
  if (first === 0 && last === 0) return 'stable';
  const change = ((last - first) / Math.abs(first || 1)) * 100;
  if (change > 5) return 'improving';
  if (change < -5) return 'declining';
  return 'stable';
}

/**
 * Get mock test analytics for the teacher.
 */
export async function getMockTestAnalytics(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherMockTestAnalytics>> {
  try {
    const dateFilter = getDateRangeFilter(filters);

    // Get all mock tests
    const { data: tests, error: testsError } = await supabase
      .from('mock_tests')
      .select('test_id, title, status, total_marks, duration_min')
      .eq('institute_id', instituteId);

    if (testsError) {
      return { success: false, error: extractErrorMessage(testsError) };
    }

    // Get all results
    let resultsQuery = supabase
      .from('mock_results')
      .select('test_id, total_score, max_score, percentage, correct_count, wrong_count, skipped_count, total_time_seconds')
      .eq('institute_id', instituteId);

    if (dateFilter.from) resultsQuery = resultsQuery.gte('generated_at', dateFilter.from);
    if (dateFilter.to) resultsQuery = resultsQuery.lte('generated_at', dateFilter.to);

    const { data: results, error: resultsError } = await resultsQuery
      .returns<{
        test_id: string;
        total_score: number;
        max_score: number;
        percentage: number;
        correct_count: number;
        wrong_count: number;
        skipped_count: number;
        total_time_seconds: number;
      }[]>();

    if (resultsError) {
      return { success: false, error: extractErrorMessage(resultsError) };
    }

    const r = results ?? [];
    const testMap = new Map(tests?.map((t) => [t.test_id, t]) ?? []);

    // Aggregate per test
    const testAggMap = new Map<string, {
      attempts: number;
      scores: number[];
      percentages: number[];
      completions: number;
      totalTime: number;
      totalAnswered: number;
      passed: number;
      difficulty: string;
    }>();

    for (const row of r) {
      const existing = testAggMap.get(row.test_id) ?? {
        attempts: 0,
        scores: [],
        percentages: [],
        completions: 0,
        totalTime: 0,
        totalAnswered: 0,
        passed: 0,
        difficulty: 'medium',
      };
      existing.attempts += 1;
      existing.scores.push(row.total_score);
      existing.percentages.push(row.percentage);
      existing.totalTime += row.total_time_seconds;
      existing.totalAnswered += row.correct_count + row.wrong_count + row.skipped_count;
      if (row.total_score > 0 && row.max_score > 0) {
        existing.completions += 1;
      }
      if (row.percentage >= 40) {
        existing.passed += 1;
      }
      testAggMap.set(row.test_id, existing);
    }

    // Build test summaries
    const testSummaries: MockTestSummary[] = Array.from(testAggMap.entries()).map(([testId, agg]) => {
      const test = testMap.get(testId);
      return {
        testId,
        title: test?.title ?? 'Unknown Test',
        totalAttempts: agg.attempts,
        completionRate: agg.attempts > 0 ? roundTo((agg.completions / agg.attempts) * 100) : 0,
        averageScore: agg.scores.length > 0 ? roundTo(computeAverage(agg.scores) ?? 0) : 0,
        averageTimeSeconds: agg.attempts > 0 ? roundTo(agg.totalTime / agg.attempts) : 0,
        passPercentage: agg.attempts > 0 ? roundTo((agg.passed / agg.attempts) * 100) : 0,
        questionCount: 0,
        difficulty: agg.difficulty,
      };
    });

    // Score over time
    const scoreTimeData = r
      .filter((x) => x.max_score > 0)
      .map((x) => ({ date: '', value: x.percentage }));

    const analytics: TeacherMockTestAnalytics = {
      mostAttemptedTests: [...testSummaries].sort((a, b) => b.totalAttempts - a.totalAttempts).slice(0, 10),
      highestScoringTests: [...testSummaries].sort((a, b) => b.averageScore - a.averageScore).slice(0, 10),
      lowestScoringTests: [...testSummaries].sort((a, b) => a.averageScore - b.averageScore).slice(0, 10),
      attemptsOverTime: [],
      scoreTrends: [],
      overallStats: {
        totalTests: tests?.length ?? 0,
        totalAttempts: r.length,
        averageCompletionRate: testSummaries.length > 0
          ? roundTo(computeAverage(testSummaries.map((t) => t.completionRate)) ?? 0)
          : 0,
        averageScore: testSummaries.length > 0
          ? roundTo(computeAverage(testSummaries.map((t) => t.averageScore)) ?? 0)
          : 0,
        averageTimeSeconds: r.length > 0
          ? roundTo(r.reduce((s, x) => s + x.total_time_seconds, 0) / r.length)
          : 0,
        averagePassPercentage: testSummaries.length > 0
          ? roundTo(computeAverage(testSummaries.map((t) => t.passPercentage)) ?? 0)
          : 0,
        totalQuestions: 0,
      },
    };

    return { success: true, data: analytics };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get subject-level analytics across all students.
 */
export async function getSubjectAnalytics(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherSubjectAnalytics>> {
  try {
    const dateFilter = getDateRangeFilter(filters);

    // Get all results with subject breakdown and attempt_id for fallback
    let query = supabase
      .from('mock_results')
      .select('attempt_id, subject_breakdown, percentage, total_score, max_score, correct_count, wrong_count, skipped_count, generated_at')
      .eq('institute_id', instituteId);

    if (dateFilter.from) query = query.gte('generated_at', dateFilter.from);
    if (dateFilter.to) query = query.lte('generated_at', dateFilter.to);

    const { data: results, error } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const r = results ?? [];

    // Aggregate subject data from subject_breakdown JSONB
    const subjectMap = new Map<string, SubjectAggState>();

    for (const row of r) {
      const breakdown = row.subject_breakdown as any[] | null;
      if (!breakdown) continue;

      for (const sb of breakdown) {
        let existing = subjectMap.get(sb.subjectId);
        if (!existing) {
          existing = {
            name: sb.subjectName,
            correct: 0,
            wrong: 0,
            skipped: 0,
            scores: [] as number[],
            maxScores: [] as number[],
            percentages: [] as number[],
            completed: 0,
            passed: 0,
            count: 0,
          };
        }
        existing.correct += sb.correct ?? 0;
        existing.wrong += sb.wrong ?? 0;
        existing.skipped += sb.skipped ?? 0;
        existing.scores.push(sb.score ?? 0);
        existing.maxScores.push(sb.maxScore ?? 0);
        existing.count += 1;
        if ((sb.correct ?? 0) + (sb.wrong ?? 0) > 0) existing.completed += 1;
        if (sb.maxScore && (sb.score / sb.maxScore) >= 0.40) existing.passed += 1;
        subjectMap.set(sb.subjectId, existing);
      }
    }

    // Historical fallback: if breakdown was null in historical rows, reconstruct from mock_answers
    if (subjectMap.size === 0 && r.length > 0) {
      const attemptIds = r.map((x: any) => x.attempt_id).filter(Boolean);
      if (attemptIds.length > 0) {
        const { data: answersData } = await supabase
          .from('mock_answers')
          .select(`
            attempt_id,
            is_correct,
            marks_awarded,
            is_answered,
            questions (
              question_id,
              marks,
              subject_id,
              subjects (
                subject_id,
                name
              )
            )
          `)
          .in('attempt_id', attemptIds);

        if (answersData) {
          for (const ans of answersData as any[]) {
            const subj = ans.questions?.subjects;
            if (!subj?.subject_id) continue;

            let existing = subjectMap.get(subj.subject_id);
            if (!existing) {
              existing = {
                name: subj.name,
                correct: 0,
                wrong: 0,
                skipped: 0,
                scores: [],
                maxScores: [],
                percentages: [],
                completed: 0,
                passed: 0,
                count: 0,
              };
            }

            const qMarks = ans.questions?.marks ?? 1;
            existing.maxScores.push(qMarks);
            existing.count += 1;

            if (!ans.is_answered) {
              existing.skipped += 1;
            } else if (ans.is_correct) {
              existing.correct += 1;
              existing.completed += 1;
              existing.scores.push(ans.marks_awarded ?? qMarks);
              if (ans.marks_awarded >= qMarks * 0.4) existing.passed += 1;
            } else {
              existing.wrong += 1;
              existing.completed += 1;
              existing.scores.push(ans.marks_awarded ?? 0);
            }

            subjectMap.set(subj.subject_id, existing);
          }
        }
      }
    }

    const subjects: SubjectComparisonItem[] = Array.from(subjectMap.entries()).map(([id, s]) => {
      const totalMax = s.maxScores.reduce((a, b) => a + b, 0);
      const totalScored = s.scores.reduce((a, b) => a + b, 0);
      const pct = totalMax > 0 ? (totalScored / totalMax) * 100 : 0;
      const avgScore = s.scores.length > 0 ? computeAverage(s.scores) ?? 0 : 0;

      return {
        subjectId: id,
        subjectName: s.name,
        averageScore: roundTo(pct > 0 ? pct : avgScore),
        averageAccuracy: computeAccuracy(s.correct, s.wrong),
        totalAttempts: s.count,
        completionRate: s.count > 0 ? roundTo((s.completed / s.count) * 100) : 0,
        passPercentage: s.count > 0 ? roundTo((s.passed / s.count) * 100) : 0,
      };
    });

    const sorted = [...subjects].sort((a, b) => b.averageScore - a.averageScore);
    const totalCorrect = Array.from(subjectMap.values()).reduce((sum, s) => sum + s.correct, 0);
    const totalWrong = Array.from(subjectMap.values()).reduce((sum, s) => sum + s.wrong, 0);

    const analytics: TeacherSubjectAnalytics = {
      subjects: subjects.map((s) => ({
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        questionsAttempted: s.totalAttempts,
        correct: 0,
        wrong: 0,
        skipped: 0,
        accuracy: s.averageAccuracy,
        score: s.averageScore,
        maxScore: 0,
        percentage: s.averageScore,
        averageTimePerQuestionSeconds: null,
      })),
      comparisonData: subjects,
      ranking: sorted.map((s, i) => ({
        rank: i + 1,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        averagePercentage: s.averageScore,
        trend: 'stable' as const,
      })),
      overallStats: {
        totalSubjects: subjects.length,
        totalQuestionsAttempted: subjects.reduce((s, x) => s + x.totalAttempts, 0),
        overallAccuracy: computeAccuracy(totalCorrect, totalWrong),
        bestSubject: sorted[0]?.subjectName ?? null,
        weakestSubject: sorted[sorted.length - 1]?.subjectName ?? null,
      },
    };

    return { success: true, data: analytics };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get chapter-level analytics across all students.
 */
export async function getChapterAnalytics(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherChapterAnalytics>> {
  try {
    const dateFilter = getDateRangeFilter(filters);

    let query = supabase
      .from('mock_results')
      .select('chapter_breakdown, generated_at')
      .eq('institute_id', instituteId);

    if (dateFilter.from) query = query.gte('generated_at', dateFilter.from);
    if (dateFilter.to) query = query.lte('generated_at', dateFilter.to);

    const { data: results, error } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const r = results ?? [];

    const chapterMap = new Map<string, ChapterAggState>();

    for (const row of r) {
      const breakdown = row.chapter_breakdown as any[] | null;
      if (!breakdown) continue;

      for (const cb of breakdown) {
        let existing = chapterMap.get(cb.chapterId);
        if (!existing) {
          existing = {
            name: cb.chapterName,
            correct: 0,
            wrong: 0,
            skipped: 0,
            scores: [] as number[],
            maxScores: [] as number[],
            count: 0,
          };
        }
        existing.correct += cb.correct ?? 0;
        existing.wrong += cb.wrong ?? 0;
        existing.skipped += cb.skipped ?? 0;
        existing.scores.push(cb.score ?? 0);
        existing.maxScores.push(cb.maxScore ?? 0);
        existing.count += 1;
        chapterMap.set(cb.chapterId, existing);
      }
    }

    const chapters = Array.from(chapterMap.entries()).map(([id, c]) => {
      const answered = c.correct + c.wrong;
      const totalMarks = c.maxScores.reduce((a, b) => a + b, 0);
      const scored = c.scores.reduce((a, b) => a + b, 0);
      const percentage = totalMarks > 0 ? (scored / totalMarks) * 100 : 0;
      return {
        chapterId: id,
        chapterName: c.name,
        subjectId: '',
        subjectName: '',
        questionsAttempted: answered + c.skipped,
        correct: c.correct,
        wrong: c.wrong,
        skipped: c.skipped,
        accuracy: computeAccuracy(c.correct, c.wrong),
        score: roundTo(scored),
        maxScore: roundTo(totalMarks),
        percentage: roundTo(percentage),
        averageTimePerQuestionSeconds: null,
      };
    });

    const sorted = [...chapters].sort((a, b) => b.percentage - a.percentage);
    const difficultySorted = [...chapters].sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));

    const analytics: TeacherChapterAnalytics = {
      chapters,
      difficultyByChapter: difficultySorted.map((c) => ({
        chapterId: c.chapterId,
        chapterName: c.chapterName,
        subjectName: '',
        difficulty: c.accuracy != null ? 100 - c.accuracy : 0,
        accuracy: c.accuracy,
        averageMarks: c.score,
        totalAttempts: c.questionsAttempted,
      })),
      weakChapters: [...chapters].sort((a, b) => a.percentage - b.percentage).slice(0, 5),
      strongChapters: [...chapters].sort((a, b) => b.percentage - a.percentage).slice(0, 5),
      overallStats: {
        totalChapters: chapters.length,
        totalQuestionsAttempted: chapters.reduce((s, c) => s + c.questionsAttempted, 0),
        overallAccuracy: computeAccuracy(
          chapters.reduce((s, c) => s + c.correct, 0),
          chapters.reduce((s, c) => s + c.wrong, 0),
        ),
        easiestChapter: sorted[0]?.chapterName ?? null,
        hardestChapter: sorted[sorted.length - 1]?.chapterName ?? null,
      },
    };

    return { success: true, data: analytics };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get question-level analytics.
 */
export async function getQuestionAnalytics(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherQuestionAnalytics>> {
  try {
    // Get all questions with their answer stats
    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('question_id, question_text, question_type, difficulty, subject_id, chapter_id, times_attempted')
      .eq('institute_id', instituteId)
      .limit(500);

    if (qError) {
      return { success: false, error: extractErrorMessage(qError) };
    }

    const qs = questions ?? [];

    // Get answer aggregates
    const qIds = qs.map((q) => q.question_id);
    let answersQuery = supabase
      .from('mock_answers')
      .select('question_id, is_correct, is_answered, time_spent_seconds')
      .in('question_id', qIds);

    if (filters?.mockTestId) {
      const { data: attemptIds } = await supabase
        .from('mock_attempts')
        .select('attempt_id')
        .eq('test_id', filters.mockTestId);
      if (attemptIds && attemptIds.length > 0) {
        answersQuery = answersQuery.in('attempt_id', attemptIds.map((a) => a.attempt_id));
      }
    }

    const { data: answers, error: aError } = await answersQuery
      .returns<{
        question_id: string;
        is_correct: boolean | null;
        is_answered: boolean;
        time_spent_seconds: number;
      }[]>();

    if (aError) {
      return { success: false, error: extractErrorMessage(aError) };
    }

    const ans = answers ?? [];

    // Aggregate per question
    const qAggMap = new Map<string, {
      correct: number;
      wrong: number;
      skipped: number;
      totalTime: number;
      count: number;
    }>();

    for (const a of ans) {
      const existing = qAggMap.get(a.question_id) ?? { correct: 0, wrong: 0, skipped: 0, totalTime: 0, count: 0 };
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

    // Build question items
    const questionItems: QuestionAnalyticsItem[] = qs.map((q) => {
      const agg = qAggMap.get(q.question_id);
      const correct = agg?.correct ?? 0;
      const wrong = agg?.wrong ?? 0;
      const skipped = agg?.skipped ?? 0;
      const total = correct + wrong + skipped;
      return {
        questionId: q.question_id,
        questionText: q.question_text?.slice(0, 100) ?? '(unknown)',
        questionType: q.question_type ?? 'mcq',
        difficulty: q.difficulty ?? 'medium',
        subjectName: '',
        chapterName: '',
        correctCount: correct,
        wrongCount: wrong,
        skippedCount: skipped,
        totalAttempts: total,
        accuracy: computeAccuracy(correct, wrong),
        averageTimeSeconds: agg && agg.count > 0 ? roundTo(agg.totalTime / agg.count) : 0,
        discriminationIndex: null,
        successRate: total > 0 ? roundTo((correct / total) * 100) : null,
      };
    });

    // Difficulty breakdown
    const diffMap = new Map<string, DifficultyBreakdownItem>();
    for (const qi of questionItems) {
      const existing = diffMap.get(qi.difficulty) ?? {
        difficulty: qi.difficulty as 'easy' | 'medium' | 'hard',
        totalQuestions: 0,
        totalAttempts: 0,
        correctCount: 0,
        wrongCount: 0,
        skippedCount: 0,
        accuracy: null,
        averageTimeSeconds: 0,
      };
      existing.totalQuestions += 1;
      existing.totalAttempts += qi.totalAttempts;
      existing.correctCount += qi.correctCount;
      existing.wrongCount += qi.wrongCount;
      existing.skippedCount += qi.skippedCount;
      diffMap.set(qi.difficulty, existing);
    }

    const difficultyBreakdown = Array.from(diffMap.values()).map((d) => ({
      ...d,
      accuracy: computeAccuracy(d.correctCount, d.wrongCount),
      averageTimeSeconds: d.totalAttempts > 0
        ? roundTo(questionItems
            .filter((qi) => qi.difficulty === d.difficulty)
            .reduce((s, qi) => s + qi.averageTimeSeconds * qi.totalAttempts, 0) / d.totalAttempts)
        : 0,
    }));

    // Question type distribution
    const typeMap = new Map<string, number>();
    for (const qi of questionItems) {
      typeMap.set(qi.questionType, (typeMap.get(qi.questionType) ?? 0) + 1);
    }
    const totalQ = questionItems.length;
    const questionTypeDistribution: QuestionTypeDistributionItem[] = Array.from(typeMap.entries()).map(([t, c]) => ({
      questionType: t,
      count: c,
      percentage: totalQ > 0 ? roundTo((c / totalQ) * 100) : 0,
    }));

    const sortedByCorrect = [...questionItems].sort((a, b) => a.correctCount - b.correctCount);

    const analytics: TeacherQuestionAnalytics = {
      mostMissedQuestions: [...questionItems].sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0)).slice(0, 10),
      mostSolvedQuestions: [...questionItems].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)).slice(0, 10),
      mostSkippedQuestions: [...questionItems].sort((a, b) => b.skippedCount - a.skippedCount).slice(0, 10),
      longestTimeQuestions: [...questionItems].sort((a, b) => b.averageTimeSeconds - a.averageTimeSeconds).slice(0, 10),
      difficultyBreakdown,
      questionTypeDistribution,
      overallStats: {
        totalQuestions: questionItems.length,
        totalAttempts: questionItems.reduce((s, qi) => s + qi.totalAttempts, 0),
        overallAccuracy: computeAccuracy(
          questionItems.reduce((s, qi) => s + qi.correctCount, 0),
          questionItems.reduce((s, qi) => s + qi.wrongCount, 0),
        ),
        averageTimeSeconds: questionItems.length > 0
          ? roundTo(questionItems.reduce((s, qi) => s + qi.averageTimeSeconds, 0) / questionItems.length)
          : 0,
        mostMissedQuestionId: sortedByCorrect[0]?.questionId ?? null,
        mostSolvedQuestionId: sortedByCorrect[sortedByCorrect.length - 1]?.questionId ?? null,
      },
    };

    return { success: true, data: analytics };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Get performance trends.
 */
export async function getPerformanceTrends(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherPerformanceTrends>> {
  try {
    const dateFilter = getDateRangeFilter(filters);

    const now = new Date();
    const currentEnd = dateFilter.to ? new Date(dateFilter.to) : now;
    const currentStart = dateFilter.from ? new Date(dateFilter.from) : new Date(now.getTime() - 30 * 86400000);

    const periodDurationMs = Math.max(currentEnd.getTime() - currentStart.getTime(), 86400000);
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(currentStart.getTime() - periodDurationMs);

    let query = supabase
      .from('mock_results')
      .select('percentage, total_score, max_score, generated_at')
      .eq('institute_id', instituteId)
      .gte('generated_at', previousStart.toISOString())
      .lte('generated_at', currentEnd.toISOString())
      .order('generated_at', { ascending: true });

    const { data: results, error } = await query
      .returns<{
        percentage: number;
        total_score: number;
        max_score: number;
        generated_at: string;
      }[]>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const allRows = results ?? [];

    // Filter to current period for points aggregation
    const r = allRows.filter((x) => {
      const d = new Date(x.generated_at);
      return d >= currentStart && d <= currentEnd;
    });

    // Week aggregation
    const weekData = r.map((x) => ({ date: x.generated_at, value: x.percentage }));
    const weeklyPoints = computeWeeklyPoints(weekData);
    const weeklyValues = weeklyPoints.map((p) => p.value);
    const weeklyMovingAvg = computeMovingAverage(weeklyValues, 4);
    const weeklyGrowth = weeklyValues.length >= 2
      ? roundTo(((weeklyValues[weeklyValues.length - 1] - weeklyValues[0]) / Math.abs(weeklyValues[0] || 1)) * 100)
      : 0;

    // Month aggregation
    const monthlyPoints = computeMonthlyPoints(weekData);
    const monthlyValues = monthlyPoints.map((p) => p.value);
    const monthlyMovingAvg = computeMovingAverage(monthlyValues, 3);
    const monthlyGrowth = monthlyValues.length >= 2
      ? roundTo(((monthlyValues[monthlyValues.length - 1] - monthlyValues[0]) / Math.abs(monthlyValues[0] || 1)) * 100)
      : 0;

    // Year aggregation
    const yearMap = new Map<string, { total: number; count: number }>();
    for (const row of r) {
      const yearKey = row.generated_at.slice(0, 4);
      const existing = yearMap.get(yearKey) ?? { total: 0, count: 0 };
      existing.total += row.percentage;
      existing.count += 1;
      yearMap.set(yearKey, existing);
    }
    const yearlyPoints: TimeSeriesPoint[] = Array.from(yearMap.entries())
      .map(([year, stats]) => ({
        date: year,
        label: year,
        value: roundTo(stats.total / stats.count),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const yearlyValues = yearlyPoints.map((p) => p.value);
    const yearlyGrowth = yearlyValues.length >= 2
      ? roundTo(((yearlyValues[yearlyValues.length - 1] - yearlyValues[0]) / Math.abs(yearlyValues[0] || 1)) * 100)
      : 0;

    // Current vs previous period comparison
    const currentResults = allRows.filter((x) => {
      const d = new Date(x.generated_at);
      return d >= currentStart && d <= currentEnd;
    });
    const previousResults = allRows.filter((x) => {
      const d = new Date(x.generated_at);
      return d >= previousStart && d <= previousEnd;
    });

    const currentAvg = currentResults.length > 0
      ? currentResults.reduce((s, x) => s + x.percentage, 0) / currentResults.length
      : 0;
    const previousAvg = previousResults.length > 0
      ? previousResults.reduce((s, x) => s + x.percentage, 0) / previousResults.length
      : 0;
    const change = previousAvg > 0 ? roundTo(((currentAvg - previousAvg) / previousAvg) * 100) : 0;

    // Best/worst weeks
    const bestWeek = weeklyPoints.length > 0
      ? [...weeklyPoints].sort((a, b) => b.value - a.value)[0]
      : null;
    const worstWeek = weeklyPoints.length > 0
      ? [...weeklyPoints].sort((a, b) => a.value - b.value)[0]
      : null;

    const trend: TrendPeriodData = {
      points: weeklyPoints.map((p) => ({
        date: p.date,
        testTitle: '',
        testId: '',
        score: p.value,
        maxScore: 100,
        percentage: p.value,
        accuracy: p.value,
        rank: null,
      })),
      movingAverage: weeklyMovingAvg,
      growth: weeklyGrowth,
      trend: weeklyGrowth > 5 ? 'improving' : weeklyGrowth < -5 ? 'declining' : 'stable',
    };

    const analytics: TeacherPerformanceTrends = {
      weekly: {
        ...trend,
        points: weeklyPoints.map((p) => ({
          date: p.date,
          testTitle: '',
          testId: '',
          score: p.value,
          maxScore: 100,
          percentage: p.value,
          accuracy: p.value,
          rank: null,
        })),
        movingAverage: weeklyMovingAvg,
        growth: weeklyGrowth,
        trend: weeklyGrowth > 5 ? 'improving' : weeklyGrowth < -5 ? 'declining' : 'stable',
      },
      monthly: {
        points: monthlyPoints.map((p) => ({
          date: p.date,
          testTitle: '',
          testId: '',
          score: p.value,
          maxScore: 100,
          percentage: p.value,
          accuracy: p.value,
          rank: null,
        })),
        movingAverage: monthlyMovingAvg,
        growth: monthlyGrowth,
        trend: monthlyGrowth > 5 ? 'improving' : monthlyGrowth < -5 ? 'declining' : 'stable',
      },
      yearly: {
        points: yearlyPoints.map((p) => ({
          date: p.date,
          testTitle: '',
          testId: '',
          score: p.value,
          maxScore: 100,
          percentage: p.value,
          accuracy: p.value,
          rank: null,
        })),
        movingAverage: [],
        growth: yearlyGrowth,
        trend: yearlyGrowth > 5 ? 'improving' : yearlyGrowth < -5 ? 'declining' : 'stable',
      },
      comparison: {
        currentPeriod: roundTo(currentAvg),
        previousPeriod: roundTo(previousAvg),
        absoluteChange: roundTo(currentAvg - previousAvg),
        percentageChange: change,
      },
      summary: {
        bestWeek: bestWeek?.label ?? null,
        worstWeek: worstWeek?.label ?? null,
        bestMonth: monthlyPoints.length > 0
          ? [...monthlyPoints].sort((a, b) => b.value - a.value)[0]?.label ?? null
          : null,
        worstMonth: monthlyPoints.length > 0
          ? [...monthlyPoints].sort((a, b) => a.value - b.value)[0]?.label ?? null
          : null,
        overallGrowth: weeklyGrowth,
        consistencyScore: weeklyValues.length > 0
          ? roundTo(100 - (computeStandardDeviation(weeklyValues) / Math.max(computeAverage(weeklyValues) ?? 0.01, 0.01)) * 100)
          : 0,
      },
    };

    return { success: true, data: analytics };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

function computeStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = computeAverage(values) ?? 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Get leaderboard data.
 */
export async function getLeaderboard(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherLeaderboard>> {
  try {
    const dateFilter = getDateRangeFilter(filters);

    let query = supabase
      .from('mock_results')
      .select('student_id, test_id, total_score, max_score, percentage, correct_count, wrong_count, generated_at')
      .eq('institute_id', instituteId);

    if (dateFilter.from) query = query.gte('generated_at', dateFilter.from);
    if (dateFilter.to) query = query.lte('generated_at', dateFilter.to);

    const { data: results, error } = await query
      .returns<{
        student_id: string;
        test_id: string;
        total_score: number;
        max_score: number;
        percentage: number;
        correct_count: number;
        wrong_count: number;
        generated_at: string;
      }[]>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const r = results ?? [];

    // Resolve student names
    const uniqueStudentIds = [...new Set(r.map((x) => x.student_id))];
    const { data: studentDetails } = await supabase
      .from('student_details')
      .select('student_id, profiles(name)')
      .in('student_id', uniqueStudentIds);

    const studentNameMap = new Map<string, string>();
    for (const sd of studentDetails ?? []) {
      const p = (sd as any).profiles;
      const name = Array.isArray(p) ? p[0]?.name : p?.name;
      if (name) studentNameMap.set(sd.student_id, name);
    }

    // Resolve test titles
    const uniqueTestIds = [...new Set(r.map((x) => x.test_id))];
    const { data: testRows } = await supabase
      .from('mock_tests')
      .select('test_id, title')
      .in('test_id', uniqueTestIds);

    const testTitleMap = new Map<string, string>();
    for (const t of testRows ?? []) {
      testTitleMap.set(t.test_id, t.title);
    }

    // Student averages
    const studentMap = new Map<string, { percentages: number[]; scores: { score: number; maxScore: number; testId: string; date: string }[]; count: number }>();
    for (const row of r) {
      const existing = studentMap.get(row.student_id) ?? { percentages: [], scores: [], count: 0 };
      existing.percentages.push(row.percentage);
      existing.scores.push({ score: row.total_score, maxScore: row.max_score, testId: row.test_id, date: row.generated_at });
      existing.count += 1;
      studentMap.set(row.student_id, existing);
    }

    // Top students by avg percentage
    const topStudents: LeaderboardEntry[] = Array.from(studentMap.entries())
      .map(([id, s]) => ({
        rank: 0,
        id,
        name: studentNameMap.get(id) ?? `Student #${id.slice(0, 6)}`,
        value: roundTo(computeAverage(s.percentages) ?? 0),
        unit: '%',
        change: 'stable' as const,
        testsAttempted: s.count,
      }))
      .sort((a, b) => b.value - a.value)
      .map((s, i) => ({ ...s, rank: i + 1 }))
      .slice(0, 20);

    // Top batches (using student grouping)
    const topBatches: BatchLeaderboardEntry[] = [];

    // Top subjects
    const topSubjects: SubjectLeaderboardEntry[] = [];

    // Highest scores
    const highestScores: ScoreLeaderboardEntry[] = r
      .filter((x) => x.max_score > 0)
      .map((x) => ({
        rank: 0,
        studentId: x.student_id,
        studentName: studentNameMap.get(x.student_id) ?? `Student #${x.student_id.slice(0, 6)}`,
        testId: x.test_id,
        testTitle: testTitleMap.get(x.test_id) ?? 'Mock Test',
        score: x.total_score,
        maxScore: x.max_score,
        percentage: roundTo(x.percentage),
        achievedAt: x.generated_at,
      }))
      .sort((a, b) => b.percentage - a.percentage)
      .map((s, i) => ({ ...s, rank: i + 1 }))
      .slice(0, 20);

    // Most improved
    const mostImproved: LeaderboardEntry[] = Array.from(studentMap.entries())
      .filter(([_, s]) => s.percentages.length >= 3)
      .map(([id, s]) => ({
        rank: 0,
        id,
        name: studentNameMap.get(id) ?? `Student #${id.slice(0, 6)}`,
        value: roundTo(s.percentages[s.percentages.length - 1] - s.percentages[0]),
        unit: '%',
        change: (s.percentages[s.percentages.length - 1] - s.percentages[0]) > 0 ? 'up' as const : 'down' as const,
        changeValue: roundTo(s.percentages[s.percentages.length - 1] - s.percentages[0]),
        testsAttempted: s.count,
      }))
      .sort((a, b) => b.value - a.value)
      .map((s, i) => ({ ...s, rank: i + 1 }))
      .slice(0, 20);

    // Consistency ranking (lowest stddev = most consistent)
    const consistencyRanking: LeaderboardEntry[] = Array.from(studentMap.entries())
      .filter(([_, s]) => s.percentages.length >= 3)
      .map(([id, s]) => {
        const stddev = computeStandardDeviation(s.percentages);
        return {
          rank: 0,
          id,
          name: studentNameMap.get(id) ?? `Student #${id.slice(0, 6)}`,
          value: roundTo(100 - stddev),
          unit: 'pts',
          change: 'stable' as const,
          testsAttempted: s.count,
        };
      })
      .sort((a, b) => b.value - a.value)
      .map((s, i) => ({ ...s, rank: i + 1 }))
      .slice(0, 20);

    const analytics: TeacherLeaderboard = {
      topStudents,
      topBatches,
      topSubjects,
      highestScores,
      mostImproved,
      consistencyRanking,
    };

    return { success: true, data: analytics };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Generate insights from existing data (no AI).
 */
export async function getInsights(
  instituteId: string,
  filters?: AnalyticsFilters,
): Promise<ApiResponse<TeacherInsights>> {
  try {
    const insights: InsightItem[] = [];

    // Get overall stats
    const dashResult = await getAnalyticsDashboard(instituteId, filters);

    if (dashResult.success && dashResult.data) {
      const summary = dashResult.data.summaryCards;

      // Check average score
      if (summary.averageScore < 40) {
        insights.push({
          id: 'insight-001',
          type: 'negative',
          category: 'performance',
          title: 'Low Average Score',
          description: `The overall average score is ${summary.averageScore.toFixed(1)}%, which is below the passing threshold. Consider reviewing the difficulty of recent tests.`,
          metric: 'Average Score',
          value: `${summary.averageScore.toFixed(1)}%`,
          change: undefined,
          severity: 'high',
          actionable: true,
        });
      } else if (summary.averageScore >= 70) {
        insights.push({
          id: 'insight-001',
          type: 'positive',
          category: 'performance',
          title: 'Strong Overall Performance',
          description: `Students are performing well with an average score of ${summary.averageScore.toFixed(1)}%.`,
          metric: 'Average Score',
          value: `${summary.averageScore.toFixed(1)}%`,
          change: undefined,
          trend: 'up',
          severity: 'low',
          actionable: false,
        });
      }

      // Check accuracy
      if (summary.averageAccuracy != null && summary.averageAccuracy < 50) {
        insights.push({
          id: 'insight-002',
          type: 'negative',
          category: 'performance',
          title: 'Low Accuracy',
          description: `Overall accuracy is ${summary.averageAccuracy.toFixed(1)}%. Students are getting more questions wrong than right.`,
          metric: 'Accuracy',
          value: `${summary.averageAccuracy.toFixed(1)}%`,
          change: undefined,
          severity: 'high',
          actionable: true,
        });
      }

      // Check completion rate
      if (summary.completionRate < 70) {
        insights.push({
          id: 'insight-003',
          type: 'warning',
          category: 'engagement',
          title: 'Low Completion Rate',
          description: `Only ${summary.completionRate.toFixed(1)}% of tests are being completed. Students may be finding tests too long or difficult.`,
          metric: 'Completion Rate',
          value: `${summary.completionRate.toFixed(1)}%`,
          change: undefined,
          severity: 'medium',
          actionable: true,
        });
      }

      // Student engagement
      if (summary.totalStudents > 0 && summary.totalAttempts < summary.totalStudents * 2) {
        insights.push({
          id: 'insight-004',
          type: 'neutral',
          category: 'engagement',
          title: 'Low Test Engagement',
          description: `With ${summary.totalStudents} students and only ${summary.totalAttempts} total attempts, average tests per student is below 2.`,
          metric: 'Attempts per Student',
          value: summary.totalStudents > 0 ? (summary.totalAttempts / summary.totalStudents).toFixed(1) : '0',
          change: undefined,
          severity: 'medium',
          actionable: true,
        });
      }
    }

    // Get subject-level data for subject-specific insights
    const subjectResult = await getSubjectAnalytics(instituteId, filters);
    if (subjectResult.success && subjectResult.data) {
      const subjects = subjectResult.data.comparisonData;

      // Find struggling subjects
      for (const subj of subjects) {
        if (subj.averageAccuracy != null && subj.averageAccuracy < 40) {
          insights.push({
            id: `insight-subj-${subj.subjectId}`,
            type: 'negative',
            category: 'performance',
            title: `Students Struggling with ${subj.subjectName}`,
            description: `${subj.subjectName} has the lowest accuracy at ${subj.averageAccuracy.toFixed(1)}%. Consider additional practice sessions.`,
            metric: 'Accuracy',
            value: `${subj.averageAccuracy.toFixed(1)}%`,
            severity: 'high',
            actionable: true,
            relatedEntityId: subj.subjectId,
            relatedEntityType: 'subject',
          });
        }
      }
    }

    // Get chapter-level data
    const chapterResult = await getChapterAnalytics(instituteId, filters);
    if (chapterResult.success && chapterResult.data) {
      // Weakest chapter
      if (chapterResult.data.weakChapters.length > 0) {
        const weakest = chapterResult.data.weakChapters[0];
        insights.push({
          id: 'insight-chap-weakest',
          type: 'negative',
          category: 'performance',
          title: `Weakest Chapter: ${weakest.chapterName}`,
          description: `Chapter "${weakest.chapterName}" has the lowest accuracy at ${(weakest.accuracy ?? 0).toFixed(1)}%. Students need more practice here.`,
          metric: 'Accuracy',
          value: `${(weakest.accuracy ?? 0).toFixed(1)}%`,
          severity: 'high',
          actionable: true,
          relatedEntityId: weakest.chapterId,
          relatedEntityType: 'chapter',
        });
      }

      // Strongest chapter
      if (chapterResult.data.strongChapters.length > 0) {
        const strongest = chapterResult.data.strongChapters[0];
        insights.push({
          id: 'insight-chap-strongest',
          type: 'positive',
          category: 'performance',
          title: `Highest Scoring Chapter: ${strongest.chapterName}`,
          description: `Students perform best in "${strongest.chapterName}" with ${(strongest.accuracy ?? 0).toFixed(1)}% accuracy.`,
          metric: 'Accuracy',
          value: `${(strongest.accuracy ?? 0).toFixed(1)}%`,
          severity: 'low',
          actionable: false,
          relatedEntityId: strongest.chapterId,
          relatedEntityType: 'chapter',
        });
      }
    }

    // Get question-level data
    const questionResult = await getQuestionAnalytics(instituteId, filters);
    if (questionResult.success && questionResult.data) {
      // Most missed question
      if (questionResult.data.mostMissedQuestions.length > 0) {
        const missed = questionResult.data.mostMissedQuestions[0];
        insights.push({
          id: 'insight-q-missed',
          type: 'negative',
          category: 'anomaly',
          title: 'Most Missed Question',
          description: `Question "${missed.questionText.slice(0, 60)}" has only ${(missed.accuracy ?? 0).toFixed(1)}% accuracy. Consider reviewing this topic.`,
          metric: 'Accuracy',
          value: `${(missed.accuracy ?? 0).toFixed(1)}%`,
          severity: 'medium',
          actionable: true,
          relatedEntityId: missed.questionId,
          relatedEntityType: 'question',
        });
      }

      // Difficulty analysis
      for (const diff of questionResult.data.difficultyBreakdown) {
        if (diff.accuracy != null && diff.accuracy < 30 && diff.difficulty === 'easy') {
          insights.push({
            id: `insight-diff-${diff.difficulty}`,
            type: 'warning',
            category: 'anomaly',
            title: `Easy Questions Have Low Success`,
            description: `Even easy questions have only ${diff.accuracy.toFixed(1)}% accuracy. Students may be rushing or lacking fundamentals.`,
            metric: 'Accuracy',
            value: `${diff.accuracy.toFixed(1)}%`,
            severity: 'high',
            actionable: true,
          });
        }
      }
    }

    // Get trends for trend-based insights
    const trendResult = await getPerformanceTrends(instituteId, filters);
    if (trendResult.success && trendResult.data) {
      const comparison = trendResult.data.comparison;

      if (comparison.percentageChange > 5) {
        insights.push({
          id: 'insight-trend-up',
          type: 'positive',
          category: 'trend',
          title: 'Score Improvement',
          description: `Average score increased by ${comparison.percentageChange.toFixed(1)}% compared to the previous period.`,
          metric: 'Score Change',
          value: `${comparison.percentageChange.toFixed(1)}%`,
          change: comparison.percentageChange,
          trend: 'up',
          severity: 'low',
          actionable: false,
        });
      } else if (comparison.percentageChange < -5) {
        insights.push({
          id: 'insight-trend-down',
          type: 'negative',
          category: 'trend',
          title: 'Score Decline',
          description: `Average score decreased by ${Math.abs(comparison.percentageChange).toFixed(1)}% compared to the previous period.`,
          metric: 'Score Change',
          value: `${comparison.percentageChange.toFixed(1)}%`,
          change: comparison.percentageChange,
          trend: 'down',
          severity: 'medium',
          actionable: true,
        });
      }
    }

    const total = insights.length;
    const positiveCount = insights.filter((i) => i.type === 'positive').length;
    const negativeCount = insights.filter((i) => i.type === 'negative').length;
    const warningCount = insights.filter((i) => i.type === 'warning').length;
    const neutralCount = insights.filter((i) => i.type === 'neutral').length;

    const result: TeacherInsights = {
      insights,
      summary: {
        totalInsights: total,
        positiveCount,
        negativeCount,
        neutralCount,
        criticalCount: warningCount,
        lastUpdated: new Date().toISOString(),
      },
    };

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Server-side drilldown to fetch individual students belonging to a score or accuracy bucket.
 */
export async function getStudentBucketDrilldown(
  instituteId: string,
  params: StudentBucketDrilldownParams,
): Promise<ApiResponse<StudentBucketDrilldownResult>> {
  try {
    let query = supabase
      .from('mock_results')
      .select('student_id, percentage, correct_count, wrong_count, generated_at')
      .eq('institute_id', instituteId);

    // Resolve date range through getDateRangeFilter for consistent preset handling
    const resolvedFilter = getDateRangeFilter(
      params.filters ?? (params.dateRange ? ({ dateRange: params.dateRange } as AnalyticsFilters) : undefined),
    );

    const fromDate = params.periodStart ?? (resolvedFilter.from || undefined);
    const toDate = params.periodEnd ?? (resolvedFilter.to || undefined);

    if (fromDate) {
      query = query.gte('generated_at', fromDate);
    }
    if (toDate) {
      query = query.lte('generated_at', toDate);
    }

    const { data: results, error } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const r = (results as any[]) ?? [];

    // Aggregate metrics per student
    const studentMap = new Map<string, {
      percentages: number[];
      totalCorrect: number;
      totalWrong: number;
      tests: number;
      lastActive: string | null;
    }>();

    for (const row of r) {
      const existing = studentMap.get(row.student_id) ?? {
        percentages: [],
        totalCorrect: 0,
        totalWrong: 0,
        tests: 0,
        lastActive: null,
      };
      existing.percentages.push(row.percentage);
      existing.totalCorrect += row.correct_count;
      existing.totalWrong += row.wrong_count;
      existing.tests += 1;
      if (!existing.lastActive || row.generated_at > existing.lastActive) {
        existing.lastActive = row.generated_at;
      }
      studentMap.set(row.student_id, existing);
    }

    // Filter students matching the bucket or period
    const matchingStudents: {
      studentId: string;
      averageScore: number;
      accuracy: number | null;
      testsAttempted: number;
      lastActive: string | null;
    }[] = [];

    for (const [studentId, s] of studentMap.entries()) {
      const avgScore = computeAverage(s.percentages) ?? 0;
      const accuracy = computeAccuracy(s.totalCorrect, s.totalWrong);

      if (params.type === 'weekly' || params.type === 'monthly') {
        matchingStudents.push({
          studentId,
          averageScore: roundTo(avgScore),
          accuracy,
          testsAttempted: s.tests,
          lastActive: s.lastActive,
        });
      } else {
        const min = params.min ?? 0;
        const max = params.max ?? 100;
        const metric = params.type === 'score' ? avgScore : accuracy;
        if (metric == null) continue;

        const inRange = max === 100
          ? metric >= min && metric <= 100
          : metric >= min && metric < max;

        if (inRange) {
          matchingStudents.push({
            studentId,
            averageScore: roundTo(avgScore),
            accuracy,
            testsAttempted: s.tests,
            lastActive: s.lastActive,
          });
        }
      }
    }

    if (matchingStudents.length === 0) {
      return {
        success: true,
        data: {
          items: [],
          totalCount: 0,
          page: params.page ?? 1,
          pageSize: params.pageSize ?? 10,
          totalPages: 1,
        },
      };
    }

    // Resolve student names and emails
    const matchingIds = matchingStudents.map((s) => s.studentId);
    const { data: studentDetails } = await supabase
      .from('student_details')
      .select('student_id, profile_id, profiles(name, email)')
      .in('student_id', matchingIds);

    const studentProfileMap = new Map<string, { profileId: string; name: string; email: string | null }>();
    for (const sd of studentDetails ?? []) {
      const p = (sd as any).profiles;
      const name = Array.isArray(p) ? p[0]?.name : p?.name;
      const email = Array.isArray(p) ? p[0]?.email : p?.email;
      studentProfileMap.set(sd.student_id, {
        profileId: sd.profile_id,
        name: name ?? `Student #${sd.student_id.slice(0, 6)}`,
        email: email ?? null,
      });
    }

    // Resolve batch names
    const { data: batchLinks } = await supabase
      .from('batch_students')
      .select('student_id, batches(name)')
      .in('student_id', matchingIds);

    const studentBatchMap = new Map<string, string>();
    for (const bl of batchLinks ?? []) {
      const b = (bl as any).batches;
      const bName = Array.isArray(b) ? b[0]?.name : b?.name;
      if (bName && !studentBatchMap.has(bl.student_id)) {
        studentBatchMap.set(bl.student_id, bName);
      }
    }

    // Construct full items
    let allItems: StudentBucketDrilldownItem[] = matchingStudents.map((s) => {
      const prof = studentProfileMap.get(s.studentId);
      return {
        studentId: s.studentId,
        profileId: prof?.profileId ?? s.studentId,
        name: prof?.name ?? `Student #${s.studentId.slice(0, 6)}`,
        email: prof?.email ?? null,
        batchName: studentBatchMap.get(s.studentId) ?? 'Unassigned',
        averageScore: s.averageScore,
        accuracy: s.accuracy,
        testsAttempted: s.testsAttempted,
        lastActive: s.lastActive,
      };
    });

    // Apply search filter if provided
    if (params.searchQuery && params.searchQuery.trim()) {
      const q = params.searchQuery.trim().toLowerCase();
      allItems = allItems.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.email && item.email.toLowerCase().includes(q)) ||
          (item.batchName && item.batchName.toLowerCase().includes(q)),
      );
    }

    // Sort by metric descending
    if (params.type === 'score') {
      allItems.sort((a, b) => b.averageScore - a.averageScore);
    } else if (params.type === 'accuracy') {
      allItems.sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
    } else {
      allItems.sort((a, b) => b.testsAttempted - a.testsAttempted || b.averageScore - a.averageScore);
    }

    // Paginate
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.max(1, params.pageSize ?? 10);
    const totalCount = allItems.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const from = (page - 1) * pageSize;
    const items = allItems.slice(from, from + pageSize);

    return {
      success: true,
      data: {
        items,
        totalCount,
        page,
        pageSize,
        totalPages,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
