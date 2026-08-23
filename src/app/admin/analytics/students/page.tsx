'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useStudentAggregateAnalytics } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { ProgressRing } from '@/components/analytics/ProgressRing';
import { BarChart } from '@/components/analytics/BarChart';
import { StudentBucketDrawer } from '@/components/analytics/StudentBucketDrawer';
import { LeaderboardCard } from '@/components/analytics/LeaderboardCard';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters, DistributionBucket, StudentSummary, TimeSeriesPoint } from '@/types/analytics-extended';

export default function StudentAnalyticsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [drilldownBucket, setDrilldownBucket] = useState<{
    type: 'score' | 'accuracy' | 'weekly' | 'monthly';
    bucketRange: string;
    min?: number;
    max?: number;
    periodStart?: string;
    periodEnd?: string;
  } | null>(null);

  const { data, isLoading } = useStudentAggregateAnalytics(instituteId, filters);

  const scoreDist = data?.scoreDistribution ?? [];
  const accuracyDist = data?.accuracyDistribution ?? [];
  const weeklyAct = data?.weeklyActivity ?? [];
  const monthlyAct = data?.monthlyActivity ?? [];

  // Compute weekly & monthly trend summaries (Hooks declared unconditionally at component root)
  const weeklySummary = useMemo(() => {
    if (weeklyAct.length === 0) return null;
    const current = weeklyAct[weeklyAct.length - 1].value;
    const prev = weeklyAct.length >= 2 ? weeklyAct[weeklyAct.length - 2].value : null;
    const pctChange =
      prev === null ? null : prev === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - prev) / prev) * 100);
    return { current, prev, pctChange };
  }, [weeklyAct]);

  const monthlySummary = useMemo(() => {
    if (monthlyAct.length === 0) return null;
    const current = monthlyAct[monthlyAct.length - 1].value;
    const prev = monthlyAct.length >= 2 ? monthlyAct[monthlyAct.length - 2].value : null;
    const pctChange =
      prev === null ? null : prev === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - prev) / prev) * 100);
    return { current, prev, pctChange };
  }, [monthlyAct]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Student Analytics" description="Analyze student performance, activity, and engagement" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showExport showBatch />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const active = data?.activeStudents;
  const top = data?.topPerformers ?? [];
  const weak = data?.weakStudents ?? [];
  const improved = data?.mostImprovedStudents ?? [];
  const inactive = data?.inactiveStudents ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Analytics"
        description="Analyze student performance, activity, and engagement across all tests"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} />

      {/* Active Students Summary */}
      {active && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Total Students" value={active.total} color="blue" />
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500">Active (Week)</p>
              <ProgressRing
                percentage={active.total > 0 ? (active.activeLastWeek / active.total) * 100 : 0}
                size={64}
                color="#10B981"
                label="of total"
              />
            </div>
            <MetricCard label="Active (Last Month)" value={active.activeLastMonth} color="cyan" />
            <MetricCard label="Active (Quarter)" value={active.activeLastQuarter} color="indigo" />
            <MetricCard label="Inactive" value={active.inactive} color="rose" />
          </div>

          {/* Top Performer ScoreCard */}
          {top.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ScoreCard
                title="Top Performer"
                score={top[0].averagePercentage}
                percentage={top[0].averagePercentage}
                maxScore={100}
                subtitle={top[0].name}
                color="#10B981"
                trend="up"
                trendLabel={`${top[0].testsAttempted} tests`}
              />
              <ScoreCard
                title="Most Improved"
                score={improved.length > 0 ? improved[0].averagePercentage : 0}
                percentage={improved.length > 0 ? improved[0].averagePercentage : 0}
                maxScore={100}
                subtitle={improved.length > 0 ? improved[0].name : '—'}
                color="#8B5CF6"
                trend="up"
                trendLabel={improved.length > 0 ? `${improved[0].testsAttempted} tests` : undefined}
              />
              <ScoreCard
                title="Needs Attention"
                score={weak.length > 0 ? weak[0].averagePercentage : 0}
                percentage={weak.length > 0 ? weak[0].averagePercentage : 0}
                maxScore={100}
                subtitle={weak.length > 0 ? weak[0].name : '—'}
                color="#EF4444"
                trend="down"
                trendLabel={weak.length > 0 ? `${weak[0].testsAttempted} tests` : undefined}
              />
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Score Distribution */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Score Distribution</h3>
          <BarChart
            data={scoreDist.map((d: DistributionBucket) => ({
              label: d.range,
              value: d.count,
              color: d.min >= 80 ? '#10B981' : d.min >= 60 ? '#3B82F6' : d.min >= 40 ? '#F59E0B' : '#EF4444',
              metadata: d,
            }))}
            height={180}
            showValues={false}
            onBarClick={(point) => {
              const bucket = point.metadata as DistributionBucket;
              if (bucket) {
                setDrilldownBucket({
                  type: 'score',
                  bucketRange: bucket.range,
                  min: bucket.min,
                  max: bucket.max,
                });
              }
            }}
          />
        </div>

        {/* Accuracy Distribution */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Accuracy Distribution</h3>
          <BarChart
            data={accuracyDist.map((d: DistributionBucket) => ({
              label: d.range,
              value: d.count,
              color: d.min >= 80 ? '#10B981' : d.min >= 60 ? '#3B82F6' : d.min >= 40 ? '#F59E0B' : '#EF4444',
              metadata: d,
            }))}
            height={180}
            showValues={false}
            onBarClick={(point) => {
              const bucket = point.metadata as DistributionBucket;
              if (bucket) {
                setDrilldownBucket({
                  type: 'accuracy',
                  bucketRange: bucket.range,
                  min: bucket.min,
                  max: bucket.max,
                });
              }
            }}
          />
        </div>

        {/* Weekly Activity */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Weekly Activity</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Completed test attempts per week</p>
            </div>
            {weeklySummary && (
              <div className="text-right">
                <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                  {weeklySummary.current} {weeklySummary.current === 1 ? 'test' : 'tests'} this week
                </span>
                {weeklySummary.pctChange !== null && (
                  <p
                    className={`text-[11px] font-medium ${
                      weeklySummary.pctChange > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : weeklySummary.pctChange < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-gray-500'
                    }`}
                  >
                    {weeklySummary.pctChange > 0 ? '↑' : weeklySummary.pctChange < 0 ? '↓' : '→'}{' '}
                    {Math.abs(weeklySummary.pctChange)}% vs previous week
                  </p>
                )}
              </div>
            )}
          </div>
          <BarChart
            data={weeklyAct.map((p: TimeSeriesPoint) => ({
              label: p.label,
              value: p.value,
              color: '#3B82F6',
              metadata: p,
            }))}
            height={160}
            showValues={false}
            onBarClick={(point) => {
              const p = point.metadata as TimeSeriesPoint;
              if (p?.date) {
                const weekStart = new Date(p.date + 'T00:00:00.000Z');
                const weekEnd = new Date(weekStart);
                weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
                weekEnd.setUTCHours(23, 59, 59, 999);
                setDrilldownBucket({
                  type: 'weekly',
                  bucketRange: `${p.label} (${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`,
                  periodStart: weekStart.toISOString(),
                  periodEnd: weekEnd.toISOString(),
                });
              }
            }}
          />
        </div>

        {/* Monthly Activity */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Monthly Activity</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Completed test attempts per month</p>
            </div>
            {monthlySummary && (
              <div className="text-right">
                <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                  {monthlySummary.current} {monthlySummary.current === 1 ? 'test' : 'tests'} this month
                </span>
                {monthlySummary.pctChange !== null && (
                  <p
                    className={`text-[11px] font-medium ${
                      monthlySummary.pctChange > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : monthlySummary.pctChange < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-gray-500'
                    }`}
                  >
                    {monthlySummary.pctChange > 0 ? '↑' : monthlySummary.pctChange < 0 ? '↓' : '→'}{' '}
                    {Math.abs(monthlySummary.pctChange)}% vs previous month
                  </p>
                )}
              </div>
            )}
          </div>
          <BarChart
            data={monthlyAct.map((p: TimeSeriesPoint) => ({
              label: p.label,
              value: p.value,
              color: '#8B5CF6',
              metadata: p,
            }))}
            height={160}
            showValues={false}
            onBarClick={(point) => {
              const p = point.metadata as TimeSeriesPoint;
              if (p?.date) {
                const [yearStr, monthStr] = p.date.split('-');
                const year = parseInt(yearStr, 10);
                const month = parseInt(monthStr, 10) - 1;
                const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
                const monthEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
                const formattedMonth = new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                });
                setDrilldownBucket({
                  type: 'monthly',
                  bucketRange: formattedMonth,
                  periodStart: monthStart.toISOString(),
                  periodEnd: monthEnd.toISOString(),
                });
              }
            }}
          />
        </div>
      </div>

      {/* Student Rankings */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <LeaderboardCard
          title="Top Performers"
          entries={top.map((s: StudentSummary, i: number) => ({
            rank: i + 1,
            id: s.studentId,
            name: s.name,
            value: s.averagePercentage,
            unit: '%',
            change: s.trend === 'improving' ? 'up' as const : s.trend === 'declining' ? 'down' as const : 'stable' as const,
            metadata: `${s.testsAttempted} tests`,
          }))}
          valueLabel="Avg %"
          emptyMessage="No student data available"
        />

        <LeaderboardCard
          title="Needs Attention"
          entries={weak.map((s: StudentSummary, i: number) => ({
            rank: i + 1,
            id: s.studentId,
            name: s.name,
            value: s.averagePercentage,
            unit: '%',
            change: s.trend === 'improving' ? 'up' as const : 'down' as const,
            metadata: `${s.testsAttempted} tests`,
          }))}
          valueLabel="Avg %"
          emptyMessage="All students performing well"
        />

        <LeaderboardCard
          title="Most Improved"
          entries={improved.map((s: StudentSummary, i: number) => ({
            rank: i + 1,
            id: s.studentId,
            name: s.name,
            value: s.averagePercentage,
            unit: '%',
            change: 'up' as const,
            metadata: `${s.testsAttempted} tests`,
          }))}
          valueLabel="Avg %"
          emptyMessage="Not enough data yet"
        />

        <LeaderboardCard
          title="Inactive Students"
          entries={inactive.map((s: StudentSummary, i: number) => ({
            rank: i + 1,
            id: s.studentId,
            name: s.name,
            value: s.testsAttempted,
            unit: ' tests',
            metadata: s.lastActive ? `Last active: ${new Date(s.lastActive).toLocaleDateString()}` : 'Never active',
          }))}
          valueLabel="Tests"
          emptyMessage="No inactive students"
        />
      </div>
{/* Student Bucket Drilldown Drawer */}
      {drilldownBucket && (
        <StudentBucketDrawer
          isOpen={!!drilldownBucket}
          onClose={() => setDrilldownBucket(null)}
          instituteId={instituteId}
          type={drilldownBucket.type}
          bucketRange={drilldownBucket.bucketRange}
          min={drilldownBucket.min}
          max={drilldownBucket.max}
          periodStart={drilldownBucket.periodStart}
          periodEnd={drilldownBucket.periodEnd}
          filters={filters}
          baseRoute="/admin/students"
        />
      )}
    </div>
  );
}
