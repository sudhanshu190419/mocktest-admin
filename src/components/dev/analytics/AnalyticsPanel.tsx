'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useStudentAnalytics,
  useTeacherAnalytics,
  useInstituteAnalytics,
  useMockTestAnalytics,
  useDashboardAnalytics,
  useSubjectAnalytics,
  useChapterAnalytics,
  usePerformanceTrend,
  useRecentActivity,
} from '@/hooks/analytics/useAnalytics';
import { useAuth } from '@/hooks/useAuth';
import { formatDuration, roundTo, computeGrade } from '@/utils/analytics';
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
  TopPerformer,
  MonthlyGrowthPoint,
} from '@/types/analytics';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface AnalyticsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedEntity: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface AnalyticsPanelProps {
  onDebugInfo?: (info: AnalyticsDebugInfo) => void;
}

type AnalyticsTab = 'dashboard' | 'student' | 'teacher' | 'institute' | 'mocktest' | 'subject' | 'chapter' | 'trend' | 'activity';

const TAB_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  student: 'Student',
  teacher: 'Teacher',
  institute: 'Institute',
  mocktest: 'Mock Test',
  subject: 'Subject',
  chapter: 'Chapter',
  trend: 'Trend',
  activity: 'Activity',
};

export default function AnalyticsPanel({ onDebugInfo }: AnalyticsPanelProps) {
  const { user } = useAuth();

  // ── Tab state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('dashboard');
  const [entityId, setEntityId] = useState('');
  const [loadEntityId, setLoadEntityId] = useState('');

  // ── Operation feedback ───────────────────────────────────────────────
  const [operationError, setOperationError] = useState<string | null>(null);

  // ── Analog to mutationLoading for analytics (no mutations) ───────────
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ────────────────────────────────────────────────────────────
  const {
    data: dashboardData,
    isLoading: dashboardLoading,
    isFetching: dashboardFetching,
    isStale: dashboardStale,
    refetch: dashboardRefetch,
  } = useDashboardAnalytics();

  const {
    data: studentData,
    isLoading: studentLoading,
    refetch: studentRefetch,
  } = useStudentAnalytics(activeTab === 'student' ? (loadEntityId || user?.id) : null);

  const {
    data: teacherData,
    isLoading: teacherLoading,
    refetch: teacherRefetch,
  } = useTeacherAnalytics(activeTab === 'teacher' ? loadEntityId : null);

  const {
    data: instituteData,
    isLoading: instituteLoading,
    refetch: instituteRefetch,
  } = useInstituteAnalytics(activeTab === 'institute' ? (loadEntityId || user?.instituteId) : null);

  const {
    data: mockTestData,
    isLoading: mockTestLoading,
    refetch: mockTestRefetch,
  } = useMockTestAnalytics(activeTab === 'mocktest' ? loadEntityId : null);

  const {
    data: subjectData,
    isLoading: subjectLoading,
    refetch: subjectRefetch,
  } = useSubjectAnalytics(activeTab === 'subject' ? (loadEntityId || user?.id) : null);

  const {
    data: chapterData,
    isLoading: chapterLoading,
    refetch: chapterRefetch,
  } = useChapterAnalytics(activeTab === 'chapter' ? (loadEntityId || user?.id) : null);

  const {
    data: trendData,
    isLoading: trendLoading,
    refetch: trendRefetch,
  } = usePerformanceTrend(activeTab === 'trend' ? (loadEntityId || user?.id) : null);

  const {
    data: activityData,
    isLoading: activityLoading,
    refetch: activityRefetch,
  } = useRecentActivity(activeTab === 'activity' ? (loadEntityId || user?.id) : null);

  const isLoading = activeTab === 'dashboard' ? dashboardLoading
    : activeTab === 'student' ? studentLoading
    : activeTab === 'teacher' ? teacherLoading
    : activeTab === 'institute' ? instituteLoading
    : activeTab === 'mocktest' ? mockTestLoading
    : activeTab === 'subject' ? subjectLoading
    : activeTab === 'chapter' ? chapterLoading
    : activeTab === 'trend' ? trendLoading
    : activityLoading;

  const currentRefetch = activeTab === 'dashboard' ? dashboardRefetch
    : activeTab === 'student' ? studentRefetch
    : activeTab === 'teacher' ? teacherRefetch
    : activeTab === 'institute' ? instituteRefetch
    : activeTab === 'mocktest' ? mockTestRefetch
    : activeTab === 'subject' ? subjectRefetch
    : activeTab === 'chapter' ? chapterRefetch
    : activeTab === 'trend' ? trendRefetch
    : activityRefetch;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: false,
      selectedEntity: TAB_LABELS[activeTab],
      cacheStatus: dashboardStale ? 'stale' : 'fresh',
      queryStatus: dashboardFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: operationError,
    });
  });

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleTabChange = useCallback((tab: AnalyticsTab) => {
    setActiveTab(tab);
    setLoadEntityId(entityId);
    setOperationError(null);
    setLastHookCalled(`tab: ${TAB_LABELS[tab]}`);
  }, [entityId]);

  const handleLoad = useCallback(() => {
    setLoadEntityId(entityId.trim());
    setLastHookCalled(`load: ${entityId.trim()}`);
    setLastApiResponse(null);
    setOperationError(null);
  }, [entityId]);

  const handleRefresh = useCallback(() => {
    currentRefetch().catch(() => {});
    setLastHookCalled('refetch');
  }, [currentRefetch]);

  // ── Render helpers ────────────────────────────────────────────────────
  const scoreColor = (pct: number) => {
    if (pct >= 80) return 'text-green-400';
    if (pct >= 60) return 'text-blue-400';
    if (pct >= 40) return 'text-amber-400';
    return 'text-red-400';
  };

  const ProgressBar = ({ value, max = 100, color = 'bg-blue-600' }: { value: number; max?: number; color?: string }) => {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
      <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  };

  const Card = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
    <div className="rounded border border-gray-700 bg-gray-900 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-100">{value}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );

  const SectionTitle = ({ title }: { title: string }) => (
    <h3 className="text-sm font-semibold text-gray-100 mt-4 mb-2">{title}</h3>
  );

  // ═══════════════════════════════════════════════════════════════════════
  //  Tab Renderers
  // ═══════════════════════════════════════════════════════════════════════

  const renderDashboard = (data: DashboardAnalytics) => (
    <div>
      <SectionTitle title="Dashboard Overview" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Tests Attempted" value={data.mockTestSummary.totalTests} />
        <Card label="Completed" value={data.mockTestSummary.attemptedTests} />
        <Card label="Pending" value={data.mockTestSummary.pendingTests} />
        <Card label="Results Available" value={data.mockTestSummary.resultsAvailable} />
      </div>

      {data.student && (
        <>
          <SectionTitle title="Performance Summary" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="Avg Score" value={roundTo(data.student.averageScore)} />
            <Card
              label="Accuracy"
              value={data.student.accuracy != null ? `${roundTo(data.student.accuracy)}%` : '—'}
            />
            <Card label="Avg Rank" value={data.student.averageRank != null ? `#${roundTo(data.student.averageRank)}` : '—'} />
            <Card label="Avg Percentile" value={data.student.averagePercentile != null ? `${roundTo(data.student.averagePercentile)}` : '—'} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            <Card label="Correct" value={data.student.correctAnswers} />
            <Card label="Wrong" value={data.student.wrongAnswers} />
            <Card label="Skipped" value={data.student.skippedQuestions} />
            <Card label="Time Spent" value={formatDuration(data.student.totalTimeSpentSeconds)} />
          </div>
        </>
      )}

      {data.recentActivity.length > 0 && (
        <>
          <SectionTitle title="Recent Activity" />
          <ActivityTable items={data.recentActivity} />
        </>
      )}
    </div>
  );

  const renderStudentAnalytics = (data: StudentAnalytics) => (
    <div>
      <SectionTitle title="Student Performance Overview" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Tests Attempted" value={data.testsAttempted} />
        <Card label="Tests Completed" value={data.testsCompleted} />
        <Card label="Avg Score" value={roundTo(data.averageScore)} sub={`Range: ${data.lowestScore} – ${data.highestScore}`} />
        <Card label="Avg %" value={`${roundTo(data.averagePercentage)}%`} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
        <Card
          label="Accuracy"
          value={data.accuracy != null ? `${roundTo(data.accuracy)}%` : '—'}
          sub={`Grade: ${data.accuracy != null ? computeGrade(data.accuracy) : '—'}`}
        />
        <Card label="Avg Rank" value={data.averageRank != null ? `#${roundTo(data.averageRank)}` : '—'} />
        <Card label="Avg Percentile" value={data.averagePercentile != null ? `${roundTo(data.averagePercentile)}` : '—'} />
        <Card label="Grade" value={data.averagePercentage > 0 ? computeGrade(data.averagePercentage) : '—'} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
        <Card label="Correct" value={data.correctAnswers} />
        <Card label="Wrong" value={data.wrongAnswers} />
        <Card label="Skipped" value={data.skippedQuestions} />
        <Card label="Time Spent" value={formatDuration(data.totalTimeSpentSeconds)} sub={`Avg: ${data.averageTimePerQuestionSeconds}s/q`} />
      </div>

      {data.strongSubjects.length > 0 && (
        <>
          <SectionTitle title="Strong Subjects" />
          <SubjectTable items={data.strongSubjects} />
        </>
      )}

      {data.weakSubjects.length > 0 && (
        <>
          <SectionTitle title="Weak Subjects" />
          <SubjectTable items={data.weakSubjects} />
        </>
      )}

      {data.strongChapters.length > 0 && (
        <>
          <SectionTitle title="Strong Chapters" />
          <ChapterTable items={data.strongChapters} />
        </>
      )}

      {data.weakChapters.length > 0 && (
        <>
          <SectionTitle title="Weak Chapters" />
          <ChapterTable items={data.weakChapters} />
        </>
      )}

      {data.performanceTrend.length > 0 && (
        <>
          <SectionTitle title="Performance Trend" />
          <TrendTable items={data.performanceTrend} />
        </>
      )}
    </div>
  );

  const renderTeacherAnalytics = (data: TeacherAnalytics) => (
    <div>
      <SectionTitle title="Teacher Overview" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Tests Created" value={data.testsCreated} />
        <Card label="Questions Created" value={data.questionsCreated} />
        <Card label="Content Uploaded" value={data.contentUploaded} />
        <Card label="Total Students" value={data.totalStudents} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <Card label="Avg Student Score" value={roundTo(data.averageStudentScore)} />
        <Card label="Avg Completion Rate" value={`${roundTo(data.averageCompletionRate)}%`} />
      </div>

      {data.difficultyDistribution.length > 0 && (
        <>
          <SectionTitle title="Question Difficulty Distribution" />
          <DifficultyTable items={data.difficultyDistribution} />
        </>
      )}

      {data.recentActivity.length > 0 && (
        <>
          <SectionTitle title="Recent Activity" />
          <ActivityTable items={data.recentActivity} />
        </>
      )}
    </div>
  );

  const renderInstituteAnalytics = (data: InstituteAnalytics) => (
    <div>
      <SectionTitle title="Institute Overview" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Total Students" value={data.totalStudents} />
        <Card label="Total Teachers" value={data.totalTeachers} />
        <Card label="Total Mock Tests" value={data.totalMockTests} />
        <Card label="Total Attempts" value={data.totalAttempts} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
        <Card label="Total Questions" value={data.totalQuestions} />
        <Card label="Total Content" value={data.totalContent} />
        <Card label="Avg Score" value={roundTo(data.averageScore)} />
        <Card label="Avg Accuracy" value={data.averageAccuracy != null ? `${roundTo(data.averageAccuracy)}%` : '—'} />
      </div>

      {data.topStudents.length > 0 && (
        <>
          <SectionTitle title="Top Performing Students" />
          <TopStudentsTable items={data.topStudents} />
        </>
      )}

      {data.topTeachers.length > 0 && (
        <>
          <SectionTitle title="Top Performing Teachers" />
          <TopTeachersTable items={data.topTeachers} />
        </>
      )}

      {data.monthlyGrowth.length > 0 && (
        <>
          <SectionTitle title="Monthly Growth" />
          <MonthlyGrowthTable items={data.monthlyGrowth} />
        </>
      )}
    </div>
  );

  const renderMockTestAnalytics = (data: MockTestAnalytics) => (
    <div>
      <SectionTitle title="Mock Test Performance" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Total Attempts" value={data.attempts} />
        <Card label="Completion Rate" value={`${roundTo(data.completionRate)}%`} />
        <Card label="Avg Score" value={roundTo(data.averageScore)} />
        <Card label="Avg Time" value={formatDuration(data.averageTimeSeconds)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
        <Card label="Highest Score" value={data.highestScore} />
        <Card label="Lowest Score" value={data.lowestScore} />
        <Card label="Correct %" value={`${roundTo(data.correctPercentage)}%`} />
        <Card label="Wrong %" value={`${roundTo(data.wrongPercentage)}%`} />
        <Card label="Skipped %" value={`${roundTo(data.skippedPercentage)}%`} />
      </div>

      {data.difficultyAnalysis.length > 0 && (
        <>
          <SectionTitle title="Difficulty Analysis" />
          <DifficultyAnalysisTable items={data.difficultyAnalysis} />
        </>
      )}

      {data.questionWiseAccuracy.length > 0 && (
        <>
          <SectionTitle title="Question-Wise Accuracy" />
          <QuestionAccuracyTable items={data.questionWiseAccuracy} />
        </>
      )}
    </div>
  );

  const renderSubjectAnalytics = (data: SubjectAnalytics) => (
    <div>
      <SectionTitle title={`Subject Analysis (${data.totalQuestionsAttempted} questions)`} />
      <Card label="Overall Accuracy" value={data.overallAccuracy != null ? `${roundTo(data.overallAccuracy)}%` : '—'} />

      {data.subjects.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Subject</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Qns</th>
                <th className="text-right px-3 py-2 text-green-400 font-medium">C</th>
                <th className="text-right px-3 py-2 text-red-400 font-medium">W</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">S</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Score</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
              </tr>
            </thead>
            <tbody>
              {data.subjects.map((s) => (
                <tr key={s.subjectId} className="border-b border-gray-800 hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-200">{s.subjectName}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{s.questionsAttempted}</td>
                  <td className="px-3 py-2 text-right text-green-400">{s.correct}</td>
                  <td className="px-3 py-2 text-right text-red-400">{s.wrong}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{s.skipped}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{s.score}/{s.maxScore}</td>
                  <td className={`px-3 py-2 text-right ${scoreColor(s.percentage)}`}>
                    {roundTo(s.percentage)}%
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300">
                    {s.accuracy != null ? `${roundTo(s.accuracy)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-500 mt-2">No subject data available.</p>
      )}
    </div>
  );

  const renderChapterAnalytics = (data: ChapterAnalytics) => (
    <div>
      <SectionTitle title={`Chapter Analysis (${data.totalQuestionsAttempted} questions)`} />
      <Card label="Overall Accuracy" value={data.overallAccuracy != null ? `${roundTo(data.overallAccuracy)}%` : '—'} />

      {data.chapters.length > 0 ? (
        <div className="mt-3 overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Chapter</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Qns</th>
                <th className="text-right px-3 py-2 text-green-400 font-medium">C</th>
                <th className="text-right px-3 py-2 text-red-400 font-medium">W</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">S</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Score</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
              </tr>
            </thead>
            <tbody>
              {data.chapters.map((c) => (
                <tr key={c.chapterId} className="border-b border-gray-800 hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-200">{c.chapterName}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{c.questionsAttempted}</td>
                  <td className="px-3 py-2 text-right text-green-400">{c.correct}</td>
                  <td className="px-3 py-2 text-right text-red-400">{c.wrong}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{c.skipped}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{c.score}/{c.maxScore}</td>
                  <td className={`px-3 py-2 text-right ${scoreColor(c.percentage)}`}>
                    {roundTo(c.percentage)}%
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300">
                    {c.accuracy != null ? `${roundTo(c.accuracy)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-500 mt-2">No chapter data available.</p>
      )}
    </div>
  );

  const renderTrend = (data: PerformanceTrendPoint[]) => (
    <div>
      <SectionTitle title={`Performance Trend (${data.length} attempts)`} />
      {data.length > 0 ? (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Date</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Test</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Score</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Rank</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Visual</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p, idx) => (
                <tr key={`${p.testId}-${idx}`} className="border-b border-gray-800 hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                    {new Date(p.date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-gray-300 max-w-[150px] truncate">{p.testTitle.slice(0, 8)}...</td>
                  <td className={`px-3 py-2 text-right ${scoreColor(p.percentage)}`}>
                    {p.score}/{p.maxScore}
                  </td>
                  <td className={`px-3 py-2 text-right ${scoreColor(p.percentage)}`}>
                    {roundTo(p.percentage)}%
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300">
                    {p.accuracy != null ? `${roundTo(p.accuracy)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {p.rank != null ? `#${p.rank}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ProgressBar value={p.percentage} color={p.percentage >= 60 ? 'bg-green-600' : 'bg-amber-600'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-500">No trend data available.</p>
      )}
    </div>
  );

  const renderActivity = (data: RecentActivity[]) => (
    <div>
      <SectionTitle title={`Recent Activity (${data.length} events)`} />
      <ActivityTable items={data} />
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  //  Sub-Component Tables
  // ═══════════════════════════════════════════════════════════════════════

  const SubjectTable = ({ items }: { items: StudentAnalytics['strongSubjects'] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Subject</th>
            <th className="text-right px-3 py-2 text-green-400 font-medium">C</th>
            <th className="text-right px-3 py-2 text-red-400 font-medium">W</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">S</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.subjectId} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-200">{s.subjectName}</td>
              <td className="px-3 py-2 text-right text-green-400">{s.correct}</td>
              <td className="px-3 py-2 text-right text-red-400">{s.wrong}</td>
              <td className="px-3 py-2 text-right text-gray-600">{s.skipped}</td>
              <td className={`px-3 py-2 text-right ${scoreColor(s.percentage)}`}>{roundTo(s.percentage)}%</td>
              <td className="px-3 py-2 text-right text-gray-300">{s.accuracy != null ? `${roundTo(s.accuracy)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const ChapterTable = ({ items }: { items: StudentAnalytics['strongChapters'] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Chapter</th>
            <th className="text-right px-3 py-2 text-green-400 font-medium">C</th>
            <th className="text-right px-3 py-2 text-red-400 font-medium">W</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.chapterId} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-200">{c.chapterName}</td>
              <td className="px-3 py-2 text-right text-green-400">{c.correct}</td>
              <td className="px-3 py-2 text-right text-red-400">{c.wrong}</td>
              <td className={`px-3 py-2 text-right ${scoreColor(c.percentage)}`}>{roundTo(c.percentage)}%</td>
              <td className="px-3 py-2 text-right text-gray-300">{c.accuracy != null ? `${roundTo(c.accuracy)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const TrendTable = ({ items }: { items: PerformanceTrendPoint[] }) => (
    <div className="overflow-x-auto max-h-64 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Date</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Score</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Rank</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Bar</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p, i) => (
            <tr key={i} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{new Date(p.date).toLocaleDateString()}</td>
              <td className={`px-3 py-2 text-right ${scoreColor(p.percentage)}`}>{roundTo(p.score)}</td>
              <td className={`px-3 py-2 text-right ${scoreColor(p.percentage)}`}>{roundTo(p.percentage)}%</td>
              <td className="px-3 py-2 text-right text-gray-300">{p.accuracy != null ? `${roundTo(p.accuracy)}%` : '—'}</td>
              <td className="px-3 py-2 text-right text-gray-400">{p.rank != null ? `#${p.rank}` : '—'}</td>
              <td className="px-3 py-2 w-24">
                <ProgressBar value={p.percentage} color={p.percentage >= 60 ? 'bg-green-600' : 'bg-amber-600'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const ActivityTable = ({ items }: { items: RecentActivity[] }) => (
    <div className="overflow-x-auto max-h-64 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Type</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Description</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Timestamp</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Score</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a, i) => (
            <tr key={i} className="border-b border-gray-800">
              <td className="px-3 py-2">
                <StatusBadge
                  label={a.type.replace('_', ' ')}
                  variant={a.type === 'result_released' ? 'success' : a.type === 'attempt_completed' ? 'info' : 'warning'}
                />
              </td>
              <td className="px-3 py-2 text-gray-300">{a.description}</td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-gray-300">
                {a.score != null ? `${a.score}/${a.maxScore}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const DifficultyTable = ({ items }: { items: TeacherAnalytics['difficultyDistribution'] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Difficulty</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Count</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">%</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Bar</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.difficulty} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-200 capitalize">{d.difficulty}</td>
              <td className="px-3 py-2 text-right text-gray-300">{d.count}</td>
              <td className="px-3 py-2 text-right text-gray-400">{roundTo(d.percentage)}%</td>
              <td className="px-3 py-2 w-24">
                <ProgressBar value={d.percentage} color={d.difficulty === 'easy' ? 'bg-green-600' : d.difficulty === 'medium' ? 'bg-amber-600' : 'bg-red-600'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const DifficultyAnalysisTable = ({ items }: { items: MockTestAnalytics['difficultyAnalysis'] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Difficulty</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Questions</th>
            <th className="text-right px-3 py-2 text-green-400 font-medium">C</th>
            <th className="text-right px-3 py-2 text-red-400 font-medium">W</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">S</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Bar</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.difficulty} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-200 capitalize">{d.difficulty}</td>
              <td className="px-3 py-2 text-right text-gray-300">{d.questionCount}</td>
              <td className="px-3 py-2 text-right text-green-400">{d.correctCount}</td>
              <td className="px-3 py-2 text-right text-red-400">{d.wrongCount}</td>
              <td className="px-3 py-2 text-right text-gray-600">{d.skippedCount}</td>
              <td className="px-3 py-2 text-right text-gray-300">{d.accuracy != null ? `${roundTo(d.accuracy)}%` : '—'}</td>
              <td className="px-3 py-2 w-24">
                <ProgressBar value={d.accuracy ?? 0} color="bg-blue-600" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const QuestionAccuracyTable = ({ items }: { items: MockTestAnalytics['questionWiseAccuracy'] }) => (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Question</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Type</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Diff</th>
            <th className="text-right px-3 py-2 text-green-400 font-medium">C</th>
            <th className="text-right px-3 py-2 text-red-400 font-medium">W</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">S</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Acc</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Avg T</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Bar</th>
          </tr>
        </thead>
        <tbody>
          {items.map((q) => (
            <tr key={q.questionId} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate" title={q.questionText}>
                {q.questionText.slice(0, 40)}...
              </td>
              <td className="px-3 py-2 text-gray-500">{q.questionType}</td>
              <td className="px-3 py-2 text-gray-500 capitalize">{q.difficulty}</td>
              <td className="px-3 py-2 text-right text-green-400">{q.correctCount}</td>
              <td className="px-3 py-2 text-right text-red-400">{q.wrongCount}</td>
              <td className="px-3 py-2 text-right text-gray-600">{q.skippedCount}</td>
              <td className="px-3 py-2 text-right text-gray-300">{q.accuracy != null ? `${roundTo(q.accuracy)}%` : '—'}</td>
              <td className="px-3 py-2 text-right text-gray-500">{q.averageTimeSeconds.toFixed(1)}s</td>
              <td className="px-3 py-2 w-20">
                <ProgressBar value={q.accuracy ?? 0} color="bg-blue-600" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const TopStudentsTable = ({ items }: { items: TopPerformer[] }) => (
    <div className="overflow-x-auto max-h-64 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">#</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Student</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Avg %</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Tests</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s, i) => (
            <tr key={s.studentId} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-500">{i + 1}</td>
              <td className="px-3 py-2 text-gray-200">{s.studentName}</td>
              <td className={`px-3 py-2 text-right ${scoreColor(s.averagePercentage)}`}>{roundTo(s.averagePercentage)}%</td>
              <td className="px-3 py-2 text-right text-gray-400">{s.testsAttempted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const TopTeachersTable = ({ items }: { items: InstituteAnalytics['topTeachers'] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">#</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Teacher</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Tests</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Avg Score</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t, i) => (
            <tr key={t.teacherId} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-500">{i + 1}</td>
              <td className="px-3 py-2 text-gray-200">{t.teacherName}</td>
              <td className="px-3 py-2 text-right text-gray-400">{t.testsCreated}</td>
              <td className="px-3 py-2 text-right text-gray-300">{roundTo(t.averageStudentScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const MonthlyGrowthTable = ({ items }: { items: MonthlyGrowthPoint[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/50">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Month</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">New Students</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">New Attempts</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">New Tests</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.month} className="border-b border-gray-800">
              <td className="px-3 py-2 text-gray-300">{m.month}</td>
              <td className="px-3 py-2 text-right text-gray-400">{m.newStudents}</td>
              <td className="px-3 py-2 text-right text-gray-300">{m.newAttempts}</td>
              <td className="px-3 py-2 text-right text-gray-400">{m.newTests}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  //  Main Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Analytics Console</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {TAB_LABELS[activeTab]} — Explore computed metrics from mock results, attempts, and questions
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
        </div>
      </div>

      {operationError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{operationError}</span>
        </div>
      )}

      {/* ── Tab Navigation ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {(['dashboard', 'student', 'teacher', 'institute', 'mocktest', 'subject', 'chapter', 'trend', 'activity'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* ── Entity ID Input (for non-dashboard tabs) ─────────────────────── */}
      {activeTab !== 'dashboard' && (
        <div className="rounded border border-gray-700 bg-gray-900 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[280px]">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500">
                {activeTab === 'student' ? 'Student ID' :
                 activeTab === 'teacher' ? 'Teacher ID' :
                 activeTab === 'institute' ? 'Institute ID' :
                 activeTab === 'mocktest' ? 'Mock Test ID' :
                 'User ID'}
              </label>
              <input
                type="text"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="UUID (leave empty for current user)"
                className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
              />
            </div>
            <button
              type="button"
              onClick={handleLoad}
              className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white"
            >
              Load
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* ── Dashboard Tab ────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        dashboardLoading ? (
          <LoadingIndicator label="Loading dashboard..." />
        ) : dashboardData ? (
          renderDashboard(dashboardData)
        ) : (
          <p className="text-xs text-gray-500">No dashboard data available. Authenticate to view.</p>
        )
      )}

      {/* ── Student Analytics Tab ────────────────────────────────────────── */}
      {activeTab === 'student' && (
        studentLoading ? (
          <LoadingIndicator label="Loading student analytics..." />
        ) : studentData ? (
          renderStudentAnalytics(studentData)
        ) : (
          <p className="text-xs text-gray-500">Enter a Student ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Teacher Analytics Tab ────────────────────────────────────────── */}
      {activeTab === 'teacher' && (
        teacherLoading ? (
          <LoadingIndicator label="Loading teacher analytics..." />
        ) : teacherData ? (
          renderTeacherAnalytics(teacherData)
        ) : (
          <p className="text-xs text-gray-500">Enter a Teacher ID, then click Load.</p>
        )
      )}

      {/* ── Institute Analytics Tab ──────────────────────────────────────── */}
      {activeTab === 'institute' && (
        instituteLoading ? (
          <LoadingIndicator label="Loading institute analytics..." />
        ) : instituteData ? (
          renderInstituteAnalytics(instituteData)
        ) : (
          <p className="text-xs text-gray-500">Enter an Institute ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Mock Test Analytics Tab ──────────────────────────────────────── */}
      {activeTab === 'mocktest' && (
        mockTestLoading ? (
          <LoadingIndicator label="Loading mock test analytics..." />
        ) : mockTestData ? (
          renderMockTestAnalytics(mockTestData)
        ) : (
          <p className="text-xs text-gray-500">Enter a Mock Test ID, then click Load.</p>
        )
      )}

      {/* ── Subject Analytics Tab ────────────────────────────────────────── */}
      {activeTab === 'subject' && (
        subjectLoading ? (
          <LoadingIndicator label="Loading subject analytics..." />
        ) : subjectData ? (
          renderSubjectAnalytics(subjectData)
        ) : (
          <p className="text-xs text-gray-500">Enter a Student ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Chapter Analytics Tab ────────────────────────────────────────── */}
      {activeTab === 'chapter' && (
        chapterLoading ? (
          <LoadingIndicator label="Loading chapter analytics..." />
        ) : chapterData ? (
          renderChapterAnalytics(chapterData)
        ) : (
          <p className="text-xs text-gray-500">Enter a Student ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Trend Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'trend' && (
        trendLoading ? (
          <LoadingIndicator label="Loading performance trend..." />
        ) : trendData ? (
          renderTrend(trendData)
        ) : (
          <p className="text-xs text-gray-500">Enter a Student ID or leave empty for current user, then click Load.</p>
        )
      )}

      {/* ── Activity Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'activity' && (
        activityLoading ? (
          <LoadingIndicator label="Loading recent activity..." />
        ) : activityData ? (
          renderActivity(activityData)
        ) : (
          <p className="text-xs text-gray-500">Enter a Student ID or leave empty for current user, then click Load.</p>
        )
      )}
    </div>
  );
}


