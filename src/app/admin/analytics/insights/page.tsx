'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherInsights } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { InsightCard } from '@/components/analytics/InsightCard';
import { MetricCard } from '@/components/analytics/MetricCard';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters, InsightItem } from '@/types/analytics-extended';

export default function InsightsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [filterType, setFilterType] = useState<string>('all');

  const { data, isLoading } = useTeacherInsights(instituteId, filters);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Insights" description="Data-driven insights and analysis of student performance" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showExport showSubject showBatch />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const allInsights = data?.insights ?? [];
  const summary = data?.summary;

  const filteredInsights = filterType === 'all'
    ? allInsights
    : allInsights.filter((i) => i.type === filterType);

  const criticalInsights = allInsights.filter((i) => i.severity === 'high');
  const positiveInsights = allInsights.filter((i) => i.type === 'positive');
  const actionableInsights = allInsights.filter((i) => i.actionable);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        description="Data-driven insights automatically derived from student performance data"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} showExport showSubject showBatch />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Total Insights" value={summary.totalInsights} color="blue" />
          <MetricCard label="Positive" value={summary.positiveCount} color="emerald" />
          <MetricCard label="Negative" value={summary.negativeCount} color="rose" />
          <MetricCard label="Warnings" value={summary.criticalCount} color="amber" />
          <MetricCard label="Neutral" value={summary.neutralCount} color="gray" />
        </div>
      )}

      {/* Critical/High Priority */}
      {criticalInsights.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-rose-600 dark:text-rose-400">
            High Priority ({criticalInsights.length})
          </h2>
          <div className="space-y-3">
            {criticalInsights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { value: 'all', label: `All (${allInsights.length})` },
          { value: 'positive', label: `Positive (${allInsights.filter((i) => i.type === 'positive').length})` },
          { value: 'negative', label: `Negative (${allInsights.filter((i) => i.type === 'negative').length})` },
          { value: 'warning', label: `Warnings (${allInsights.filter((i) => i.type === 'warning').length})` },
          { value: 'neutral', label: `Neutral (${allInsights.filter((i) => i.type === 'neutral').length})` },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilterType(tab.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterType === tab.value
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Insights List */}
      {filteredInsights.length === 0 ? (
        <EmptyState
          title="No insights available"
          description="Insights will appear here once sufficient data is available."
        />
      ) : (
        <div className="space-y-3">
          {filteredInsights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}

      {/* Summary Section */}
      {summary && allInsights.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Summary</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/10">
              <p className="text-[11px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400">Actionable</p>
              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{actionableInsights.length}</p>
              <p className="text-xs text-blue-500 dark:text-blue-400">Requires attention</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-4 dark:bg-emerald-900/10">
              <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Positive</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{positiveInsights.length}</p>
              <p className="text-xs text-emerald-500 dark:text-emerald-400">Good performance areas</p>
            </div>
            <div className="rounded-lg bg-rose-50 p-4 dark:bg-rose-900/10">
              <p className="text-[11px] font-medium uppercase tracking-wider text-rose-600 dark:text-rose-400">Critical</p>
              <p className="text-xl font-bold text-rose-700 dark:text-rose-300">{criticalInsights.length}</p>
              <p className="text-xs text-rose-500 dark:text-rose-400">Requires immediate action</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">Last Updated</p>
              <p className="text-xl font-bold text-gray-700 dark:text-gray-300">
                {new Date(summary.lastUpdated).toLocaleDateString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(summary.lastUpdated).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Note about AI */}
      <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/50 p-4 text-center dark:border-blue-700 dark:bg-blue-900/10">
        <p className="text-xs text-blue-600 dark:text-blue-400">
          💡 Insights are derived from existing database data only. AI-powered insights can be enabled in a future release.
        </p>
      </div>
    </div>
  );
}
