'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherPerformanceTrends } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { ComparisonCard } from '@/components/analytics/ComparisonCard';
import { TrendCard } from '@/components/analytics/TrendCard';
import { LineChart } from '@/components/analytics/LineChart';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { PerformanceTrendPoint } from '@/types/analytics';
import type { AnalyticsFilters } from '@/types/analytics-extended';

export default function PerformanceTrendsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');

  const { data, isLoading } = useTeacherPerformanceTrends(instituteId, filters);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Performance Trends" description="Track performance metrics over time" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showExport showBatch />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const currentPeriod = view === 'weekly' ? data?.weekly : view === 'monthly' ? data?.monthly : data?.yearly;
  const comparison = data?.comparison;
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Trends"
        description="Track and compare performance metrics over time"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} showExport showBatch />

      {/* Period selector */}
      <div className="flex items-center gap-2">
        {(['weekly', 'monthly', 'yearly'] as const).map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => setView(period)}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
              view === period
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            {period.charAt(0).toUpperCase() + period.slice(1)}
          </button>
        ))}
      </div>

      {/* Trend Comparison Cards */}
      {comparison && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ComparisonCard
            title="Current vs Previous"
            primary={{
              label: 'Current Period',
              value: `${comparison.currentPeriod.toFixed(1)}%`,
              color: comparison.percentageChange >= 0 ? '#10B981' : '#EF4444',
              trend: comparison.percentageChange >= 0 ? 'up' as const : 'down' as const,
            }}
            secondary={{
              label: 'Previous Period',
              value: `${comparison.previousPeriod.toFixed(1)}%`,
              color: '#6B7280',
            }}
            difference={{
              value: `${comparison.percentageChange > 0 ? '+' : ''}${comparison.percentageChange.toFixed(1)}%`,
              label: 'change',
              type: comparison.percentageChange >= 0 ? 'positive' as const : 'negative' as const,
            }}
          />
          <ScoreCard
            title="Absolute Change"
            score={comparison.absoluteChange > 0 ? `+${comparison.absoluteChange.toFixed(1)}%` : `${comparison.absoluteChange.toFixed(1)}%`}
            percentage={Math.abs(comparison.absoluteChange * 10)}
            color={comparison.absoluteChange >= 0 ? '#10B981' : '#EF4444'}
            size="md"
          />
          <ScoreCard
            title="Growth"
            score={comparison.percentageChange > 0 ? `+${comparison.percentageChange.toFixed(1)}%` : `${comparison.percentageChange.toFixed(1)}%`}
            percentage={Math.min(Math.abs(comparison.percentageChange), 100)}
            color={comparison.percentageChange >= 0 ? '#10B981' : '#EF4444'}
            size="md"
          />
          <TrendCard
            title="Previous Period"
            currentValue={comparison.previousPeriod}
            previousValue={comparison.currentPeriod}
            unit="%"
            format="percentage"
          />
        </div>
      )}

      {/* Trend Chart */}
      {currentPeriod && currentPeriod.points.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {view.charAt(0).toUpperCase() + view.slice(1)} Trend
              <span className="ml-2 text-xs font-normal text-gray-500">
                Growth: {currentPeriod.growth > 0 ? '+' : ''}{currentPeriod.growth.toFixed(1)}%
              </span>
            </h3>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
              currentPeriod.trend === 'improving' ? 'bg-emerald-100 text-emerald-700' :
              currentPeriod.trend === 'declining' ? 'bg-rose-100 text-rose-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {currentPeriod.trend === 'improving' ? '↑ Improving' : currentPeriod.trend === 'declining' ? '↓ Declining' : '→ Stable'}
            </span>
          </div>
          <LineChart
            data={currentPeriod.points.map((p: PerformanceTrendPoint) => ({
              label: p.date.slice(5, 10),
              value: p.percentage,
            }))}
            height={250}
            showArea
            yAxisLabel="Percentage (%)"
          />
        </div>
      )}

      {/* Summary & Insights */}
      {summary && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Trend Summary</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Best Week</p>
                  <p className="text-lg font-bold text-emerald-600">{summary.bestWeek ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Worst Week</p>
                  <p className="text-lg font-bold text-rose-600">{summary.worstWeek ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Best Month</p>
                  <p className="text-lg font-bold text-emerald-600">{summary.bestMonth ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Worst Month</p>
                  <p className="text-lg font-bold text-rose-600">{summary.worstMonth ?? '—'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Performance Metrics</h3>
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Overall Growth</p>
                <p className={`text-2xl font-bold ${summary.overallGrowth > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {summary.overallGrowth > 0 ? '+' : ''}{summary.overallGrowth.toFixed(1)}%
                </p>
              </div>
              <div className="h-px bg-gray-100 dark:bg-gray-700" />
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Consistency Score</p>
                <p className={`text-2xl font-bold ${summary.consistencyScore >= 70 ? 'text-emerald-600' : summary.consistencyScore >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                  {summary.consistencyScore.toFixed(0)}/100
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {summary.consistencyScore >= 70 ? 'Very Consistent' : summary.consistencyScore >= 50 ? 'Moderately Consistent' : 'Highly Variable'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
