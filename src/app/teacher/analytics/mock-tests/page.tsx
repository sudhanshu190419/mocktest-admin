'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherMockTestAnalytics } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { ComparisonCard } from '@/components/analytics/ComparisonCard';
import { LeaderboardCard } from '@/components/analytics/LeaderboardCard';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { formatDuration } from '@/utils/mockResults';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters, MockTestSummary } from '@/types/analytics-extended';

export default function MockTestAnalyticsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const { data, isLoading } = useTeacherMockTestAnalytics(instituteId, filters);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Mock Test Analytics" description="Analyze mock test performance and engagement" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showExport showMockTest showBatch />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const stats = data?.overallStats;
  const mostAttempted = data?.mostAttemptedTests ?? [];
  const highestScoring = data?.highestScoringTests ?? [];
  const lowestScoring = data?.lowestScoringTests ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mock Test Analytics"
        description="Analyze mock test performance, completion rates, and engagement"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} />

      {/* Overall Stats */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Tests" value={stats.totalTests} color="blue" />
          <MetricCard label="Total Attempts" value={stats.totalAttempts} color="emerald" />
          <MetricCard label="Avg Completion" value={`${stats.averageCompletionRate.toFixed(0)}%`} color="purple" />
          <MetricCard label="Avg Pass Rate" value={`${stats.averagePassPercentage.toFixed(0)}%`} color="indigo" />
          <ScoreCard
            title="Avg Score"
            score={stats.averageScore}
            percentage={stats.averageScore}
            maxScore={100}
            size="sm"
            color={stats.averageScore >= 60 ? '#10B981' : stats.averageScore >= 40 ? '#F59E0B' : '#EF4444'}
          />
          <MetricCard label="Avg Time" value={formatDuration(stats.averageTimeSeconds)} color="cyan" />
        </div>
      )}

      {/* Highest vs Lowest Comparison */}
      {highestScoring.length > 0 && lowestScoring.length > 0 && (
        <ComparisonCard
          title="Highest vs Lowest Scoring"
          primary={{
            label: 'Highest',
            value: `${highestScoring[0].averageScore.toFixed(1)}%`,
            color: '#10B981',
            trend: 'up',
            trendLabel: highestScoring[0].title,
          }}
          secondary={{
            label: 'Lowest',
            value: `${lowestScoring[0].averageScore.toFixed(1)}%`,
            color: '#EF4444',
            trend: 'down',
            trendLabel: lowestScoring[0].title,
          }}
          difference={{
            value: `${(highestScoring[0].averageScore - lowestScoring[0].averageScore).toFixed(1)}%`,
            label: 'gap',
            type: 'positive',
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Most Attempted */}
        <LeaderboardCard
          title="Most Attempted Tests"
          entries={mostAttempted.map((t: MockTestSummary, i: number) => ({
            rank: i + 1,
            id: t.testId,
            name: t.title,
            value: t.totalAttempts,
            unit: '',
            metadata: `${t.completionRate.toFixed(0)}% completion`,
          }))}
          valueLabel="Attempts"
          emptyMessage="No test data available"
        />

        {/* Highest Scoring */}
        <LeaderboardCard
          title="Highest Scoring Tests"
          entries={highestScoring.map((t: MockTestSummary, i: number) => ({
            rank: i + 1,
            id: t.testId,
            name: t.title,
            value: t.averageScore,
            unit: '%',
            metadata: `${t.totalAttempts} attempts`,
          }))}
          valueLabel="Avg Score"
          emptyMessage="No test data available"
        />

        {/* Lowest Scoring */}
        <LeaderboardCard
          title="Lowest Scoring Tests"
          entries={lowestScoring.map((t: MockTestSummary, i: number) => ({
            rank: i + 1,
            id: t.testId,
            name: t.title,
            value: t.averageScore,
            unit: '%',
            metadata: `${t.totalAttempts} attempts · ${t.passPercentage.toFixed(0)}% pass`,
          }))}
          valueLabel="Avg Score"
          emptyMessage="No test data available"
        />
      </div>

      {/* Test Details */}
      {mostAttempted.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Test Performance Details</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Test</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Attempts</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Completion</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Avg Score</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Avg Time</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Pass %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {mostAttempted.map((t: MockTestSummary) => (
                  <tr key={t.testId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{t.title}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{t.totalAttempts}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{t.completionRate.toFixed(0)}%</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{t.averageScore.toFixed(1)}%</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDuration(t.averageTimeSeconds)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{t.passPercentage.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
