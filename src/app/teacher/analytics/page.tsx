'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useTeacherAnalyticsDashboard } from '@/hooks/analytics/useTeacherAnalyticsService';
import { useTeacherAnalytics } from '@/hooks/analytics/useAnalytics';
import { useMockTests } from '@/hooks/mockTest/useMockTests';
import { useQuestions } from '@/hooks/mockTest/useQuestions';
import { useResults } from '@/hooks/mockTest/useMockResults';
import { useNotificationDashboard } from '@/hooks/notification/useNotifications';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { ComparisonCard } from '@/components/analytics/ComparisonCard';
import { ProgressRing } from '@/components/analytics/ProgressRing';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { formatDuration } from '@/utils/mockResults';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters } from '@/types/analytics-extended';

export default function AnalyticsDashboardPage() {
  const { teacherProfile, instituteId, user } = useAuth();
  const instId = instituteId ?? teacherProfile?.id;
  const userId = user?.id;

  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const { data: dashboard, isLoading: dashLoading } = useTeacherAnalyticsDashboard(instId, filters);
  const { data: mockTestsData } = useMockTests({}, {}, { page: 1, pageSize: 1000 });
  const { data: questionsData } = useQuestions({}, {}, { page: 1, pageSize: 1 });
  const { data: resultsData } = useResults(undefined, undefined, { page: 1, pageSize: 1000 });
  const { data: teacherAnalytics } = useTeacherAnalytics(userId);
  const { data: notifDash } = useNotificationDashboard(userId, instId ?? undefined);

  const testStats = useMemo(() => {
    const tests = mockTestsData?.data ?? [];
    return {
      total: tests.length,
      draft: tests.filter((t) => t.status === 'draft').length,
      pending: tests.filter((t) => t.status === 'pending_approval').length,
      published: tests.filter((t) => t.status === 'published').length,
    };
  }, [mockTestsData]);

  const results = resultsData?.data ?? [];
  const resultReleaseCount = results.filter((r) => !r.isReleased).length;

  const summary = dashboard?.summaryCards;
  const isLoading = dashLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics Dashboard"
        description="High-level overview of student performance, test metrics, and engagement"
      />

      <AnalyticsFilter
        filters={filters}
        onChange={setFilters}
        showExport
        showBatch
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Students"
          value={summary?.totalStudents ?? 0}
          icon={
            <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07" />
            </svg>
          }
          color="blue"
          loading={isLoading}
        />
        <MetricCard
          label="Total Tests"
          value={summary?.totalTests ?? testStats.total}
          subtext={`${testStats.published} published`}
          icon={
            <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25" />
            </svg>
          }
          color="emerald"
          loading={isLoading}
        />
        <MetricCard
          label="Total Attempts"
          value={summary?.totalAttempts ?? results.length}
          subtext={summary ? `Avg ${(summary.totalAttempts / Math.max(summary.totalStudents, 1)).toFixed(1)} per student` : ''}
          icon={
            <svg className="h-4 w-4 text-purple-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
            </svg>
          }
          color="purple"
          loading={isLoading}
        />
        <ScoreCard
          title="Average Score"
          score={summary?.averageScore ?? 0}
          percentage={summary?.averageScore}
          maxScore={100}
          trend={summary && summary.averageScore >= 60 ? 'up' : summary && summary.averageScore >= 40 ? 'stable' : 'down'}
          color={summary && summary.averageScore >= 60 ? '#10B981' : summary && summary.averageScore >= 40 ? '#F59E0B' : '#EF4444'}
          loading={isLoading}
        />
        <MetricCard
          label="Average Accuracy"
          value={summary?.averageAccuracy != null ? `${summary.averageAccuracy.toFixed(0)}%` : '—'}
          icon={
            <svg className="h-4 w-4 text-cyan-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          }
          trend={summary && summary.averageAccuracy != null && summary.averageAccuracy >= 60 ? 'up' : 'down'}
          color={summary && summary.averageAccuracy != null && summary.averageAccuracy >= 60 ? 'emerald' : 'amber'}
          loading={isLoading}
        />
        <MetricCard
          label="Completion Rate"
          value={summary?.completionRate != null ? `${summary.completionRate.toFixed(0)}%` : '—'}
          trend={summary && summary.completionRate >= 70 ? 'up' : 'down'}
          color={summary && summary.completionRate >= 70 ? 'emerald' : 'rose'}
          loading={isLoading}
        />
        <MetricCard
          label="Average Time"
          value={summary?.averageTimeSeconds != null ? formatDuration(summary.averageTimeSeconds) : '—'}
          subtext="per attempt"
          icon={
            <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="indigo"
          loading={isLoading}
        />
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">Pass Percentage</p>
          {isLoading ? (
            <div className="flex justify-center">
              <div className="h-20 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
          ) : (
            <ProgressRing
              percentage={summary?.passPercentage ?? 0}
              size={80}
              color={summary && summary.passPercentage >= 60 ? '#10B981' : summary && summary.passPercentage >= 40 ? '#F59E0B' : '#EF4444'}
              label="score ≥ 40%"
            />
          )}
        </div>
      </div>

      {/* Quick Access Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left - Quick Links */}
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quick Access</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: 'Student Analytics', href: '/teacher/analytics/students', icon: '👥', color: 'bg-blue-600' },
              { label: 'Mock Test Analytics', href: '/teacher/analytics/mock-tests', icon: '📝', color: 'bg-emerald-600' },
              { label: 'Subject Performance', href: '/teacher/analytics/subjects', icon: '📚', color: 'bg-purple-600' },
              { label: 'Chapter Analysis', href: '/teacher/analytics/chapters', icon: '📖', color: 'bg-amber-600' },
              { label: 'Trends', href: '/teacher/analytics/trends', icon: '📈', color: 'bg-rose-600' },
              { label: 'Leaderboards', href: '/teacher/analytics/leaderboards', icon: '🏆', color: 'bg-cyan-600' },
            ].map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
              >
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm text-white shadow-sm ${action.color}`}>
                  {action.icon}
                </div>
                <span className="text-xs font-medium text-gray-700 group-hover:text-blue-600 dark:text-gray-300">
                  {action.label}
                </span>
              </Link>
            ))}
          </div>

          {/* Pending Items */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Pending Items</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Draft Tests', value: testStats.draft, href: '/teacher/mock-tests/list?status=draft', color: 'text-gray-600', bg: 'bg-gray-50' },
                { label: 'Pending Approval', value: testStats.pending, href: '/teacher/mock-tests/list?status=pending_approval', color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: 'Unread Notifications', value: notifDash?.unreadCount ?? 0, href: '/teacher/notifications', color: 'text-rose-600', bg: 'bg-rose-50' },
                { label: 'Results to Release', value: resultReleaseCount, href: '/teacher/results/list', color: 'text-blue-600', bg: 'bg-blue-50' },
              ].map((item) => (
                <Link key={item.label} href={item.href} className="group rounded-lg border border-gray-100 p-3 transition-colors hover:border-gray-200 dark:border-gray-700 dark:hover:border-gray-600">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{item.label}</p>
                  <p className={`mt-1 text-xl font-bold ${item.color}`}>{item.value}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Right - Overview Cards */}
        <div className="space-y-4">
          {/* Comparison: Accuracy vs Completion */}
          {summary && (
            <ComparisonCard
              title="Accuracy vs Completion"
              primary={{
                label: 'Accuracy',
                value: summary.averageAccuracy != null ? `${summary.averageAccuracy.toFixed(0)}%` : '—',
                trend: summary.averageAccuracy != null && summary.averageAccuracy >= 60 ? 'up' : 'down',
                color: summary.averageAccuracy != null && summary.averageAccuracy >= 60 ? '#10B981' : '#EF4444',
              }}
              secondary={{
                label: 'Completion',
                value: `${summary.completionRate.toFixed(0)}%`,
                trend: summary.completionRate >= 70 ? 'up' : 'down',
                color: summary.completionRate >= 70 ? '#10B981' : '#EF4444',
              }}
              difference={{
                value: `${(summary.averageAccuracy ?? summary.completionRate) > summary.completionRate ? '+' : ''}${((summary.averageAccuracy ?? summary.completionRate) - summary.completionRate).toFixed(0)}%`,
                label: 'gap',
                type: (summary.averageAccuracy ?? summary.completionRate) >= summary.completionRate ? 'positive' : 'negative',
              }}
            />
          )}
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Overview</h2>
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Teacher Stats</h3>
            <div className="space-y-3">
              {[
                { label: 'Tests Created', value: teacherAnalytics?.testsCreated ?? testStats.total },
                { label: 'Questions Authored', value: teacherAnalytics?.questionsCreated ?? questionsData?.count ?? 0 },
                { label: 'Total Students', value: teacherAnalytics?.totalStudents ?? summary?.totalStudents ?? 0 },
                { label: 'Avg Student Score', value: teacherAnalytics?.averageStudentScore ? `${teacherAnalytics.averageStudentScore.toFixed(1)}%` : '—' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{item.label}</span>
                  <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          {dashboard?.recentActivity && dashboard.recentActivity.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h3>
              <div className="space-y-2">
                {dashboard.recentActivity.slice(0, 5).map((activity) => (
                  <div key={activity.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <div className="mt-0.5 flex h-2 w-2 flex-shrink-0 items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700 dark:text-gray-300">{activity.description}</p>
                      <p className="text-[10px] text-gray-400">{new Date(activity.timestamp).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
