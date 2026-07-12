'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useStudentAnalytics,
  useSubjectAnalytics,
  useChapterAnalytics,
  usePerformanceTrend,
  useRecentActivity,
} from '@/hooks/analytics/useAnalytics';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { getScoreColorClass, formatDuration } from '@/utils/mockResults';

export default function StudentAnalyticsPage() {
  const params = useParams();
  const studentId = params.id as string;

  const { data: analytics, isLoading, error } = useStudentAnalytics(studentId);
  const { data: subjectData, isLoading: subjectLoading } = useSubjectAnalytics(studentId);
  const { data: chapterData, isLoading: chapterLoading } = useChapterAnalytics(studentId);
  const { data: trendData, isLoading: trendLoading } = usePerformanceTrend(studentId);
  const { data: activityData, isLoading: activityLoading } = useRecentActivity(studentId, 5);

  if (isLoading || subjectLoading || chapterLoading || trendLoading || activityLoading) {
    return (
      <div>
        <PageHeader title="Performance Analytics" breadcrumbs={[{ label: 'Students', href: '/teacher/students' }, { label: 'Analytics' }]} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Performance Analytics" breadcrumbs={[{ label: 'Students', href: '/teacher/students' }, { label: 'Analytics' }]} />
        <EmptyState
          title="Failed to load analytics"
          description={(error as Error)?.message ?? 'An error occurred while loading analytics.'}
        />
      </div>
    );
  }

  const subjects = subjectData?.subjects ?? analytics?.strongSubjects ?? [];
  const chapters = chapterData?.chapters ?? [];
  const trend = trendData ?? analytics?.performanceTrend ?? [];
  const activity = activityData ?? [];

  // Best and worst subjects
  const sortedSubjects = [...subjects].sort((a, b) => b.percentage - a.percentage);
  const bestSubject = sortedSubjects[0];
  const worstSubject = sortedSubjects[sortedSubjects.length - 1];

  // Question type distribution
  const questionTypeStats = analytics ? [
    { label: 'Correct', value: analytics.correctAnswers, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200' },
    { label: 'Wrong', value: analytics.wrongAnswers, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200' },
    { label: 'Skipped', value: analytics.skippedQuestions, color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200' },
  ] : [];

  // Summary stat blocks
  const summaryStats = analytics ? [
    {
      label: 'Best Subject',
      value: bestSubject?.subjectName ?? '—',
      subtext: bestSubject ? `${bestSubject.percentage.toFixed(0)}% accuracy` : 'No data',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      border: 'border-emerald-200 dark:border-emerald-800',
    },
    {
      label: 'Weakest Subject',
      value: worstSubject?.subjectName ?? '—',
      subtext: worstSubject ? `${worstSubject.percentage.toFixed(0)}% accuracy` : 'No data',
      color: analytics?.weakSubjects?.[0] ? 'text-rose-600' : 'text-gray-400',
      bg: 'bg-rose-50 dark:bg-rose-900/20',
      border: 'border-rose-200 dark:border-rose-800',
    },
    {
      label: 'Average Rank',
      value: analytics.averageRank ? `#${analytics.averageRank.toFixed(0)}` : '—',
      subtext: `from ${analytics.testsAttempted} tests`,
      color: analytics.averageRank && analytics.averageRank <= 5 ? 'text-emerald-600' : 'text-indigo-600',
      bg: 'bg-indigo-50 dark:bg-indigo-900/20',
      border: 'border-indigo-200 dark:border-indigo-800',
    },
    {
      label: 'Total Time',
      value: formatDuration(analytics.totalTimeSpentSeconds),
      subtext: `avg ${analytics.averageTimePerQuestionSeconds.toFixed(1)}s/q`,
      color: 'text-purple-600',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      border: 'border-purple-200 dark:border-purple-800',
    },
  ] : [];

  return (
    <div>
      <PageHeader
        title="Performance Analytics"
        breadcrumbs={[
          { label: 'Students', href: '/teacher/students' },
          { label: 'Profile' },
          { label: 'Analytics' },
        ]}
        actions={
          <Link
            href={`/teacher/students/${studentId}/results`}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            View Results
          </Link>
        }
      />

      {/* Summary Stat Blocks */}
      {summaryStats.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summaryStats.map((stat) => (
            <div
              key={stat.label}
              className={`rounded-xl border ${stat.border} ${stat.bg} p-5`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                {stat.label}
              </p>
              <p className={`mt-1 text-lg font-bold ${stat.color}`}>{stat.value}</p>
              <p className="mt-0.5 text-xs text-gray-400">{stat.subtext}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Subject Performance */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Subject Performance</h3>
          {subjects.length === 0 ? (
            <p className="text-sm text-gray-500">No data yet.</p>
          ) : (
            <div className="space-y-4">
              {subjects.map((s) => {
                const answered = s.correct + s.wrong;
                return (
                  <div key={s.subjectId}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {s.subjectName}
                      </span>
                      <span className={`text-xs font-semibold ${getScoreColorClass(s.percentage)}`}>
                        {s.percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min(s.percentage, 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                      <span>{answered} answered · {s.skipped} skipped</span>
                      <span>{s.score}/{s.maxScore} marks</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Question Type Stats */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Question Analysis</h3>
          {questionTypeStats.length === 0 ? (
            <p className="text-sm text-gray-500">No data yet.</p>
          ) : (
            <div className="space-y-4">
              {questionTypeStats.map((stat) => {
                const total = (analytics?.correctAnswers ?? 0) + (analytics?.wrongAnswers ?? 0) + (analytics?.skippedQuestions ?? 0);
                const pct = total > 0 ? ((stat.value / total) * 100).toFixed(0) : '0';
                return (
                  <div key={stat.label}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {stat.label}
                      </span>
                      <span className={`text-sm font-bold ${stat.color}`}>
                        {stat.value} <span className="text-xs text-gray-400">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className={`h-full rounded-full transition-all`}
                        style={{
                          width: `${pct}%`,
                          backgroundColor: stat.label === 'Correct' ? '#059669' : stat.label === 'Wrong' ? '#e11d48' : '#6b7280',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Performance Trend */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Performance Trend</h3>
          {trend.length === 0 ? (
            <p className="text-sm text-gray-500">No trend data yet.</p>
          ) : (
            <div className="space-y-3">
              {trend.slice(-10).map((point, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-20 flex-shrink-0">
                    <p className="text-[10px] text-gray-500">
                      {new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          point.percentage >= 60 ? 'bg-emerald-500' : point.percentage >= 40 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(point.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-16 flex-shrink-0 text-right">
                    <span className={`text-xs font-semibold ${getScoreColorClass(point.percentage)}`}>
                      {point.percentage.toFixed(0)}%
                    </span>
                  </div>
                  {point.rank && (
                    <div className="w-12 flex-shrink-0 text-right">
                      <span className="text-[10px] text-gray-400">#{point.rank}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chapter Performance */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Chapter Performance</h3>
          {chapters.length === 0 ? (
            <p className="text-sm text-gray-500">No chapter data yet.</p>
          ) : (
            <div className="space-y-3">
              {chapters.slice(0, 8).map((ch) => (
                <div key={ch.chapterId}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">
                      {ch.chapterName}
                    </span>
                    <span className={`flex-shrink-0 text-xs font-semibold ${getScoreColorClass(ch.percentage)}`}>
                      {ch.percentage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${Math.min(ch.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Strong vs Weak Subjects */}
        {analytics && (analytics.strongSubjects.length > 0 || analytics.weakSubjects.length > 0) && (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Strong Subjects</h3>
              {analytics.strongSubjects.length === 0 ? (
                <p className="text-sm text-gray-500">No data yet.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.strongSubjects.slice(0, 5).map((s) => (
                    <div key={s.subjectId} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s.subjectName}</span>
                      <span className="text-xs font-semibold text-emerald-600">{s.percentage.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Weak Subjects</h3>
              {analytics.weakSubjects.length === 0 ? (
                <p className="text-sm text-gray-500">No data yet.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.weakSubjects.slice(0, 5).map((s) => (
                    <div key={s.subjectId} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s.subjectName}</span>
                      <span className="text-xs font-semibold text-rose-600">{s.percentage.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
