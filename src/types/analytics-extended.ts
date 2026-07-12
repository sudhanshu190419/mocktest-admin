/**
 * Extended Analytics Module Types
 *
 * Teacher-level analytics types that aggregate data across all students,
 * subjects, chapters, mock tests, questions, and time periods.
 *
 * These types are built on top of the existing analytics types and reuse
 * the same data structures wherever possible.
 *
 * @module types/analytics-extended
 */

import type {
  SubjectPerformanceSummary,
  ChapterPerformanceSummary,
  PerformanceTrendPoint,
} from './analytics';

// ═══════════════════════════════════════════════════════════════════════════
//  Teacher Analytics Dashboard
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherAnalyticsDashboard {
  summaryCards: DashboardSummaryCards;
  recentActivity: DashboardActivityItem[];
  quickStats: QuickStats;
}

export interface DashboardSummaryCards {
  totalStudents: number;
  totalTests: number;
  totalAttempts: number;
  averageScore: number;
  averageAccuracy: number | null;
  completionRate: number;
  averageTimeSeconds: number;
  passPercentage: number;
}

export interface DashboardActivityItem {
  id: string;
  type: 'attempt' | 'result' | 'test_created' | 'student_joined';
  description: string;
  timestamp: string;
  metadata?: Record<string, string | number>;
}

export interface QuickStats {
  testsCreated: number;
  questionsCreated: number;
  publishedTests: number;
  draftTests: number;
  pendingApprovals: number;
  unreadNotifications: number;
  resultsToRelease: number;
  activeStudents: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Student Analytics (Teacher View)
// ═══════════════════════════════════════════════════════════════════════════

export interface StudentAggregateAnalytics {
  scoreDistribution: DistributionBucket[];
  accuracyDistribution: DistributionBucket[];
  completionRateDistribution: DistributionBucket[];
  activeStudents: ActiveStudentSummary;
  weeklyActivity: TimeSeriesPoint[];
  monthlyActivity: TimeSeriesPoint[];
  topPerformers: StudentSummary[];
  weakStudents: StudentSummary[];
  mostImprovedStudents: StudentSummary[];
  inactiveStudents: StudentSummary[];
}

export interface DistributionBucket {
  range: string;
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface ActiveStudentSummary {
  total: number;
  activeLastWeek: number;
  activeLastMonth: number;
  activeLastQuarter: number;
  inactive: number;
}

export interface TimeSeriesPoint {
  date: string;
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface StudentSummary {
  studentId: string;
  name: string;
  averagePercentage: number;
  testsAttempted: number;
  trend: 'improving' | 'declining' | 'stable';
  lastActive: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mock Test Analytics (Teacher View)
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherMockTestAnalytics {
  mostAttemptedTests: MockTestSummary[];
  highestScoringTests: MockTestSummary[];
  lowestScoringTests: MockTestSummary[];
  attemptsOverTime: TimeSeriesPoint[];
  scoreTrends: TimeSeriesPoint[];
  overallStats: MockTestOverallStats;
}

export interface MockTestSummary {
  testId: string;
  title: string;
  totalAttempts: number;
  completionRate: number;
  averageScore: number;
  averageTimeSeconds: number;
  passPercentage: number;
  questionCount: number;
  difficulty: string;
}

export interface MockTestOverallStats {
  totalTests: number;
  totalAttempts: number;
  averageCompletionRate: number;
  averageScore: number;
  averageTimeSeconds: number;
  averagePassPercentage: number;
  totalQuestions: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Subject Analytics (Teacher View)
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherSubjectAnalytics {
  subjects: SubjectPerformanceSummary[];
  comparisonData: SubjectComparisonItem[];
  ranking: SubjectRankingItem[];
  overallStats: SubjectOverallStats;
}

export interface SubjectComparisonItem {
  subjectId: string;
  subjectName: string;
  averageScore: number;
  averageAccuracy: number | null;
  totalAttempts: number;
  completionRate: number;
  passPercentage: number;
}

export interface SubjectRankingItem {
  rank: number;
  subjectId: string;
  subjectName: string;
  averagePercentage: number;
  trend: 'improving' | 'declining' | 'stable';
}

export interface SubjectOverallStats {
  totalSubjects: number;
  totalQuestionsAttempted: number;
  overallAccuracy: number | null;
  bestSubject: string | null;
  weakestSubject: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Chapter Analytics (Teacher View)
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherChapterAnalytics {
  chapters: ChapterPerformanceSummary[];
  difficultyByChapter: ChapterDifficultyItem[];
  weakChapters: ChapterPerformanceSummary[];
  strongChapters: ChapterPerformanceSummary[];
  overallStats: ChapterOverallStats;
}

export interface ChapterDifficultyItem {
  chapterId: string;
  chapterName: string;
  subjectName: string;
  difficulty: number; // 0-100 scale based on accuracy (higher = more difficult)
  accuracy: number | null;
  averageMarks: number;
  totalAttempts: number;
}

export interface ChapterOverallStats {
  totalChapters: number;
  totalQuestionsAttempted: number;
  overallAccuracy: number | null;
  easiestChapter: string | null;
  hardestChapter: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Question Analytics (Teacher View)
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherQuestionAnalytics {
  mostMissedQuestions: QuestionAnalyticsItem[];
  mostSolvedQuestions: QuestionAnalyticsItem[];
  mostSkippedQuestions: QuestionAnalyticsItem[];
  longestTimeQuestions: QuestionAnalyticsItem[];
  difficultyBreakdown: DifficultyBreakdownItem[];
  questionTypeDistribution: QuestionTypeDistributionItem[];
  overallStats: QuestionOverallStats;
}

export interface QuestionAnalyticsItem {
  questionId: string;
  questionText: string;
  questionType: string;
  difficulty: string;
  subjectName: string;
  chapterName: string;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  totalAttempts: number;
  accuracy: number | null;
  averageTimeSeconds: number;
  discriminationIndex: number | null;
  successRate: number | null;
}

export interface DifficultyBreakdownItem {
  difficulty: 'easy' | 'medium' | 'hard';
  totalQuestions: number;
  totalAttempts: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  accuracy: number | null;
  averageTimeSeconds: number;
}

export interface QuestionTypeDistributionItem {
  questionType: string;
  count: number;
  percentage: number;
}

export interface QuestionOverallStats {
  totalQuestions: number;
  totalAttempts: number;
  overallAccuracy: number | null;
  averageTimeSeconds: number;
  mostMissedQuestionId: string | null;
  mostSolvedQuestionId: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Performance Trends (Teacher View)
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherPerformanceTrends {
  weekly: TrendPeriodData;
  monthly: TrendPeriodData;
  yearly: TrendPeriodData;
  comparison: TrendComparison;
  summary: TrendSummary;
}

export interface TrendPeriodData {
  points: PerformanceTrendPoint[];
  movingAverage: number[];
  growth: number;
  trend: 'improving' | 'declining' | 'stable';
}

export interface TrendComparison {
  currentPeriod: number;
  previousPeriod: number;
  absoluteChange: number;
  percentageChange: number;
}

export interface TrendSummary {
  bestWeek: string | null;
  worstWeek: string | null;
  bestMonth: string | null;
  worstMonth: string | null;
  overallGrowth: number;
  consistencyScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Leaderboards
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherLeaderboard {
  topStudents: LeaderboardEntry[];
  topBatches: BatchLeaderboardEntry[];
  topSubjects: SubjectLeaderboardEntry[];
  highestScores: ScoreLeaderboardEntry[];
  mostImproved: LeaderboardEntry[];
  consistencyRanking: LeaderboardEntry[];
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  value: number;
  unit: string;
  change: 'up' | 'down' | 'stable';
  changeValue?: number;
  testsAttempted: number;
}

export interface BatchLeaderboardEntry {
  rank: number;
  batchId: string;
  batchName: string;
  averagePercentage: number;
  studentCount: number;
  testsAttempted: number;
  change: 'up' | 'down' | 'stable';
}

export interface SubjectLeaderboardEntry {
  rank: number;
  subjectId: string;
  subjectName: string;
  averagePercentage: number;
  totalStudents: number;
  totalAttempts: number;
}

export interface ScoreLeaderboardEntry {
  rank: number;
  studentId: string;
  studentName: string;
  testId: string;
  testTitle: string;
  score: number;
  maxScore: number;
  percentage: number;
  achievedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Insights
// ═══════════════════════════════════════════════════════════════════════════

export interface TeacherInsights {
  insights: InsightItem[];
  summary: InsightSummary;
}

export interface InsightItem {
  id: string;
  type: 'positive' | 'negative' | 'neutral' | 'warning';
  category: 'performance' | 'engagement' | 'trend' | 'comparison' | 'anomaly';
  title: string;
  description: string;
  metric: string;
  value: string | number;
  change?: string | number;
  trend?: 'up' | 'down' | 'stable';
  severity: 'low' | 'medium' | 'high';
  actionable: boolean;
  relatedEntityId?: string;
  relatedEntityType?: 'student' | 'test' | 'subject' | 'chapter' | 'question';
}

export interface InsightSummary {
  totalInsights: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  criticalCount: number;
  lastUpdated: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Filter Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalyticsFilters {
  dateRange: DateRangeFilter;
  subjectId: string;
  chapterId: string;
  batchId: string;
  streamId: string;
  mockTestId: string;
  difficulty: string;
  questionType: string;
  teacherId: string;
  status: string;
}

export interface DateRangeFilter {
  from: string;
  to: string;
  preset: DateRangePreset;
}

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'last90days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'custom';

export const DEFAULT_FILTERS: AnalyticsFilters = {
  dateRange: { from: '', to: '', preset: 'last30days' },
  subjectId: '',
  chapterId: '',
  batchId: '',
  streamId: '',
  mockTestId: '',
  difficulty: '',
  questionType: '',
  teacherId: '',
  status: '',
};

export const FILTER_DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'last90days', label: 'Last 90 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'thisQuarter', label: 'This Quarter' },
  { value: 'thisYear', label: 'This Year' },
];
