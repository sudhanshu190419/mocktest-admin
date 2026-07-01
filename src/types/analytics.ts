/**
 * Analytics Module Types
 *
 * Production-ready type definitions for the Analytics module — student,
 * teacher, institute, and mock test analytics.
 *
 * These types define the response shapes returned by the analytics service
 * layer. All data is computed from existing tables (mock_results,
 * mock_attempts, mock_answers, questions, mock_tests, subjects, chapters)
 * with no duplicate business logic.
 *
 * @module types/analytics
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Student Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate performance summary for a student across all attempts.
 */
export interface StudentAnalytics {
  /** Total number of tests attempted. */
  testsAttempted: number;
  /** Number of tests completed (submitted or timed_out). */
  testsCompleted: number;
  /** Average score across all attempts. */
  averageScore: number;
  /** Highest score achieved. */
  highestScore: number;
  /** Lowest score achieved. */
  lowestScore: number;
  /** Average percentage across all completed attempts. */
  averagePercentage: number;
  /** Overall accuracy percentage (correct / (correct + wrong)). Null if no answered questions. */
  accuracy: number | null;
  /** Average rank across ranked attempts. Null if no rankings. */
  averageRank: number | null;
  /** Average percentile across ranked attempts. Null if no rankings. */
  averagePercentile: number | null;
  /** Total time spent across all attempts in seconds. */
  totalTimeSpentSeconds: number;
  /** Average time per question across all attempts in seconds. */
  averageTimePerQuestionSeconds: number;
  /** Total correct answers across all attempts. */
  correctAnswers: number;
  /** Total wrong answers across all attempts. */
  wrongAnswers: number;
  /** Total skipped questions across all attempts. */
  skippedQuestions: number;
  /** Subjects ranked by performance (strongest first). */
  strongSubjects: SubjectPerformanceSummary[];
  /** Subjects ranked by weakness (weakest first). */
  weakSubjects: SubjectPerformanceSummary[];
  /** Chapters ranked by performance (strongest first). */
  strongChapters: ChapterPerformanceSummary[];
  /** Chapters ranked by weakness (weakest first). */
  weakChapters: ChapterPerformanceSummary[];
  /** Performance trend over time (ordered by date ascending). */
  performanceTrend: PerformanceTrendPoint[];
}

/**
 * Subject-level performance summary used in analytics.
 */
export interface SubjectPerformanceSummary {
  /** FK → subjects.subject_id. */
  subjectId: string;
  /** Subject display name. */
  subjectName: string;
  /** Number of questions attempted in this subject. */
  questionsAttempted: number;
  /** Number of correct answers. */
  correct: number;
  /** Number of wrong answers. */
  wrong: number;
  /** Number of skipped questions. */
  skipped: number;
  /** Accuracy percentage for this subject. Null if no answered questions. */
  accuracy: number | null;
  /** Total score in this subject. */
  score: number;
  /** Maximum possible score in this subject. */
  maxScore: number;
  /** Percentage score for this subject. */
  percentage: number;
}

/**
 * Chapter-level performance summary used in analytics.
 */
export interface ChapterPerformanceSummary {
  /** FK → chapters.chapter_id. */
  chapterId: string;
  /** Chapter display name. */
  chapterName: string;
  /** Number of questions attempted in this chapter. */
  questionsAttempted: number;
  /** Number of correct answers. */
  correct: number;
  /** Number of wrong answers. */
  wrong: number;
  /** Number of skipped questions. */
  skipped: number;
  /** Accuracy percentage. Null if no answered questions. */
  accuracy: number | null;
  /** Total score in this chapter. */
  score: number;
  /** Maximum possible score in this chapter. */
  maxScore: number;
  /** Percentage score for this chapter. */
  percentage: number;
}

/**
 * A single data point in a performance trend.
 */
export interface PerformanceTrendPoint {
  /** Date of the attempt (ISO date string). */
  date: string;
  /** Test title or identifier. */
  testTitle: string;
  /** Test ID. */
  testId: string;
  /** Score achieved. */
  score: number;
  /** Maximum possible score. */
  maxScore: number;
  /** Percentage score. */
  percentage: number;
  /** Accuracy for this attempt. Null if no answered questions. */
  accuracy: number | null;
  /** Rank in this test. Null if not ranked. */
  rank: number | null;
}

/**
 * A recent activity entry.
 */
export interface RecentActivity {
  /** Type of activity. */
  type: 'attempt_completed' | 'attempt_started' | 'result_released';
  /** Description of the activity. */
  description: string;
  /** Timestamp of the activity. */
  timestamp: string;
  /** Reference ID (attempt_id, test_id, etc.). */
  referenceId: string;
  /** Optional test title. */
  testTitle?: string;
  /** Optional score for completed attempts. */
  score?: number;
  /** Optional max score. */
  maxScore?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Teacher Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate performance summary for a teacher.
 */
export interface TeacherAnalytics {
  /** Number of tests created by this teacher. */
  testsCreated: number;
  /** Number of questions authored by this teacher. */
  questionsCreated: number;
  /** Number of content items uploaded. */
  contentUploaded: number;
  /** Total number of students who have attempted this teacher's tests. */
  totalStudents: number;
  /** Average student score across this teacher's tests. */
  averageStudentScore: number;
  /** Average completion rate across this teacher's tests. */
  averageCompletionRate: number;
  /** Distribution of questions by difficulty level. */
  difficultyDistribution: DifficultyDistributionItem[];
  /** Performance breakdown by subject. */
  subjectPerformance: SubjectPerformanceSummary[];
  /** Recent activity entries. */
  recentActivity: RecentActivity[];
}

/**
 * A single item in a difficulty distribution.
 */
export interface DifficultyDistributionItem {
  /** Difficulty level. */
  difficulty: 'easy' | 'medium' | 'hard';
  /** Number of questions at this difficulty. */
  count: number;
  /** Percentage of total questions. */
  percentage: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Institute Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate performance summary for an institute.
 */
export interface InstituteAnalytics {
  /** Total number of students in the institute. */
  totalStudents: number;
  /** Total number of teachers in the institute. */
  totalTeachers: number;
  /** Total number of mock tests created. */
  totalMockTests: number;
  /** Total number of attempts across all tests. */
  totalAttempts: number;
  /** Total number of questions in the question bank. */
  totalQuestions: number;
  /** Total number of content items. */
  totalContent: number;
  /** Average score across all completed attempts. */
  averageScore: number;
  /** Average accuracy across all completed attempts. */
  averageAccuracy: number | null;
  /** Top performing students by average percentage. */
  topStudents: TopPerformer[];
  /** Top performing teachers by tests created / average student score. */
  topTeachers: TopTeacherPerformer[];
  /** Performance breakdown by subject. */
  subjectWisePerformance: SubjectPerformanceSummary[];
  /** Monthly growth data (ordered by month ascending). */
  monthlyGrowth: MonthlyGrowthPoint[];
}

/**
 * A top performer entry (student).
 */
export interface TopPerformer {
  /** Student ID. */
  studentId: string;
  /** Student display name. */
  studentName: string;
  /** Average percentage across attempts. */
  averagePercentage: number;
  /** Number of tests attempted. */
  testsAttempted: number;
}

/**
 * A top performer entry (teacher).
 */
export interface TopTeacherPerformer {
  /** Teacher ID. */
  teacherId: string;
  /** Teacher display name. */
  teacherName: string;
  /** Number of tests created. */
  testsCreated: number;
  /** Average student score across their tests. */
  averageStudentScore: number;
}

/**
 * A single data point in monthly growth.
 */
export interface MonthlyGrowthPoint {
  /** Month label (e.g. "2025-01"). */
  month: string;
  /** New students enrolled this month. */
  newStudents: number;
  /** New attempts created this month. */
  newAttempts: number;
  /** New tests created this month. */
  newTests: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mock Test Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Performance analytics for a single mock test.
 */
export interface MockTestAnalytics {
  /** Total number of attempts on this test. */
  attempts: number;
  /** Completion rate (submitted / total attempts * 100). */
  completionRate: number;
  /** Average score across all completed attempts. */
  averageScore: number;
  /** Highest score. */
  highestScore: number;
  /** Lowest score. */
  lowestScore: number;
  /** Average time spent in seconds. */
  averageTimeSeconds: number;
  /** Percentage of correct answers across all attempts. */
  correctPercentage: number;
  /** Percentage of wrong answers across all attempts. */
  wrongPercentage: number;
  /** Percentage of skipped questions across all attempts. */
  skippedPercentage: number;
  /** Accuracy for each question in the test. */
  questionWiseAccuracy: QuestionAccuracyItem[];
  /** Difficulty analysis — how students performed per difficulty level. */
  difficultyAnalysis: DifficultyAnalysisItem[];
}

/**
 * Accuracy for a single question.
 */
export interface QuestionAccuracyItem {
  /** Question ID. */
  questionId: string;
  /** Question text (truncated for display). */
  questionText: string;
  /** Question type. */
  questionType: string;
  /** Difficulty. */
  difficulty: string;
  /** Number of students who answered correctly. */
  correctCount: number;
  /** Number of students who answered incorrectly. */
  wrongCount: number;
  /** Number of students who skipped. */
  skippedCount: number;
  /** Accuracy percentage. Null if no one answered. */
  accuracy: number | null;
  /** Average time spent on this question in seconds. */
  averageTimeSeconds: number;
}

/**
 * Performance breakdown by difficulty level.
 */
export interface DifficultyAnalysisItem {
  /** Difficulty level. */
  difficulty: 'easy' | 'medium' | 'hard';
  /** Number of questions at this difficulty. */
  questionCount: number;
  /** Number of correct answers across all attempts at this difficulty. */
  correctCount: number;
  /** Number of wrong answers across all attempts at this difficulty. */
  wrongCount: number;
  /** Number of skipped questions at this difficulty. */
  skippedCount: number;
  /** Accuracy percentage at this difficulty. */
  accuracy: number | null;
  /** Average score percentage at this difficulty. */
  averagePercentage: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dashboard Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dashboard overview combining key metrics across all entities.
 */
export interface DashboardAnalytics {
  /** Student-level dashboard data. Null if user is not a student. */
  student: StudentAnalytics | null;
  /** Recent activity for the current user. */
  recentActivity: RecentActivity[];
  /** Upcoming/past mock tests summary. */
  mockTestSummary: MockTestSummary;
}

/**
 * Quick summary of mock test activity.
 */
export interface MockTestSummary {
  /** Total available tests. */
  totalTests: number;
  /** Tests attempted by the student. */
  attemptedTests: number;
  /** Tests not yet attempted. */
  pendingTests: number;
  /** Tests with results released. */
  resultsAvailable: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Subject & Chapter Analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-subject analytics for a student.
 */
export interface SubjectAnalytics {
  /** List of subject performance summaries. */
  subjects: SubjectPerformanceSummary[];
  /** Total questions attempted across all subjects. */
  totalQuestionsAttempted: number;
  /** Overall accuracy across all subjects. */
  overallAccuracy: number | null;
}

/**
 * Per-chapter analytics for a student.
 */
export interface ChapterAnalytics {
  /** List of chapter performance summaries. */
  chapters: ChapterPerformanceSummary[];
  /** Total questions attempted across all chapters. */
  totalQuestionsAttempted: number;
  /** Overall accuracy across all chapters. */
  overallAccuracy: number | null;
}
