'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherSubjectAnalytics } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { ComparisonCard } from '@/components/analytics/ComparisonCard';
import { BarChart } from '@/components/analytics/BarChart';
import { LeaderboardCard } from '@/components/analytics/LeaderboardCard';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters, SubjectComparisonItem, SubjectRankingItem } from '@/types/analytics-extended';

export default function SubjectAnalyticsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const { data, isLoading } = useTeacherSubjectAnalytics(instituteId, filters);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Subject Analytics" description="Compare subject performance across all students" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showSubject showBatch showExport />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const subjects = data?.comparisonData ?? [];
  const ranking = data?.ranking ?? [];
  const overall = data?.overallStats;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subject Analytics"
        description="Compare performance across subjects and identify strengths and weaknesses"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} showSubject showBatch showExport />

      {/* Overall Stats */}
      {overall && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Total Subjects" value={overall.totalSubjects} color="blue" />
          <MetricCard label="Questions Attempted" value={overall.totalQuestionsAttempted} color="purple" />
          <ScoreCard
            title="Best Subject"
            score={overall.bestSubject ?? 'N/A'}
            percentage={subjects.length > 0 ? Math.max(...subjects.map((s: SubjectComparisonItem) => s.averageScore)) : 0}
            subtitle={subjects.length > 0 ? `Score: ${Math.max(...subjects.map((s: SubjectComparisonItem) => s.averageScore)).toFixed(1)}%` : ''}
            color="#10B981"
            size="sm"
          />
          <ScoreCard
            title="Weakest Subject"
            score={overall.weakestSubject ?? 'N/A'}
            percentage={subjects.length > 0 ? Math.min(...subjects.map((s: SubjectComparisonItem) => s.averageScore)) : 0}
            subtitle={subjects.length > 0 ? `Score: ${Math.min(...subjects.map((s: SubjectComparisonItem) => s.averageScore)).toFixed(1)}%` : ''}
            color="#EF4444"
            size="sm"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Subject Comparison Chart */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Average Score by Subject</h3>
          <BarChart
            data={subjects.map((s: SubjectComparisonItem) => ({
              label: s.subjectName,
              value: s.averageScore,
              color: s.averageScore >= 60 ? '#10B981' : s.averageScore >= 40 ? '#F59E0B' : '#EF4444',
            }))}
            height={200}
            showValues={false}
          />
        </div>

        {/* Accuracy Comparison */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Accuracy by Subject</h3>
          <BarChart
            data={subjects.map((s: SubjectComparisonItem) => ({
              label: s.subjectName,
              value: s.averageAccuracy ?? 0,
              color: (s.averageAccuracy ?? 0) >= 60 ? '#10B981' : (s.averageAccuracy ?? 0) >= 40 ? '#F59E0B' : '#EF4444',
            }))}
            height={200}
            showValues={false}
          />
        </div>
      </div>

      {/* Subject Comparison Details */}
      {subjects.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Subject Comparison</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Rank</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Subject</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Avg Score</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Accuracy</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Attempts</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Completion</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Pass %</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {ranking.map((r: SubjectRankingItem) => {
                  const subj = subjects.find((s: SubjectComparisonItem) => s.subjectId === r.subjectId);
                  return (
                    <tr key={r.subjectId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-500">#{r.rank}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{r.subjectName}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{subj?.averageScore.toFixed(1) ?? '—'}%</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{subj?.averageAccuracy != null ? `${subj.averageAccuracy.toFixed(0)}%` : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{subj?.totalAttempts ?? 0}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{subj?.completionRate.toFixed(0) ?? '—'}%</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{subj?.passPercentage.toFixed(0) ?? '—'}%</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                          r.trend === 'improving' ? 'text-emerald-600' : r.trend === 'declining' ? 'text-rose-600' : 'text-gray-400'
                        }`}>
                          {r.trend === 'improving' ? '↑' : r.trend === 'declining' ? '↓' : '→'} {r.trend}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
