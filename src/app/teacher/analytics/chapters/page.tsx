'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherChapterAnalytics } from '@/hooks/analytics/useTeacherAnalyticsService';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/analytics/MetricCard';
import { ScoreCard } from '@/components/analytics/ScoreCard';
import { ComparisonCard } from '@/components/analytics/ComparisonCard';
import { BarChart } from '@/components/analytics/BarChart';
import { LeaderboardCard } from '@/components/analytics/LeaderboardCard';
import { AnalyticsFilter } from '@/components/analytics/AnalyticsFilter';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { cn } from '@/lib/utils';
import { DEFAULT_FILTERS } from '@/types/analytics-extended';
import type { AnalyticsFilters, ChapterDifficultyItem } from '@/types/analytics-extended';
import type { ChapterPerformanceSummary } from '@/types/analytics';

export default function ChapterAnalyticsPage() {
  const { instituteId } = useAuth();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const { data, isLoading } = useTeacherChapterAnalytics(instituteId, filters);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Chapter Analytics" description="Analyze chapter-wise performance" />
        <AnalyticsFilter filters={filters} onChange={setFilters} showExport showSubject showBatch />
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const chapters = data?.chapters ?? [];
  const difficultyByChapter = data?.difficultyByChapter ?? [];
  const weak = data?.weakChapters ?? [];
  const strong = data?.strongChapters ?? [];
  const overall = data?.overallStats;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chapter Analytics"
        description="Analyze chapter-wise performance and identify difficult chapters"
      />

      <AnalyticsFilter filters={filters} onChange={setFilters} showExport showSubject showBatch />

      {/* Overall Stats */}
      {overall && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Total Chapters" value={overall.totalChapters} color="blue" />
          <MetricCard label="Questions Attempted" value={overall.totalQuestionsAttempted} color="purple" />
          <ScoreCard
            title="Easiest Chapter"
            score={overall.easiestChapter ?? 'N/A'}
            percentage={strong.length > 0 ? (strong[0].accuracy ?? 0) : 0}
            color="#10B981"
            size="sm"
          />
          <ScoreCard
            title="Hardest Chapter"
            score={overall.hardestChapter ?? 'N/A'}
            percentage={weak.length > 0 ? (weak[0].accuracy ?? 0) : 0}
            color="#EF4444"
            size="sm"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Chapter Difficulty */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Chapter Difficulty Index</h3>
          <BarChart
            data={difficultyByChapter.slice(0, 15).map((c: ChapterDifficultyItem) => ({
              label: c.chapterName.length > 15 ? c.chapterName.slice(0, 15) + '…' : c.chapterName,
              value: c.difficulty,
              color: c.difficulty >= 70 ? '#EF4444' : c.difficulty >= 40 ? '#F59E0B' : '#10B981',
            }))}
            height={200}
            showValues={false}
          />
        </div>

        {/* Chapter Accuracy */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Chapter Accuracy</h3>
          <BarChart
            data={chapters.slice(0, 15).map((c: ChapterPerformanceSummary) => ({
              label: c.chapterName.length > 15 ? c.chapterName.slice(0, 15) + '…' : c.chapterName,
              value: c.accuracy ?? 0,
              color: (c.accuracy ?? 0) >= 60 ? '#10B981' : (c.accuracy ?? 0) >= 40 ? '#F59E0B' : '#EF4444',
            }))}
            height={200}
            showValues={false}
          />
        </div>
      </div>

      {/* Strong vs Weak */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LeaderboardCard
          title="Strong Chapters"
          entries={strong.map((c: ChapterPerformanceSummary, i: number) => ({
            rank: i + 1,
            id: c.chapterId,
            name: c.chapterName,
            value: c.accuracy ?? 0,
            unit: '%',
            metadata: `${c.correct + c.wrong + c.skipped} questions`,
          }))}
          valueLabel="Accuracy"
          emptyMessage="No chapter data available"
        />

        <LeaderboardCard
          title="Weak Chapters"
          entries={weak.map((c: ChapterPerformanceSummary, i: number) => ({
            rank: i + 1,
            id: c.chapterId,
            name: c.chapterName,
            value: c.accuracy ?? 0,
            unit: '%',
            metadata: `${c.correct + c.wrong + c.skipped} questions`,
          }))}
          valueLabel="Accuracy"
          emptyMessage="No chapter data available"
        />
      </div>

      {/* Chapter Details Table */}
      {chapters.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">All Chapters</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Chapter</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Accuracy</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Correct</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Wrong</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Skipped</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Score</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Max</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {chapters.map((c: ChapterPerformanceSummary) => (
                  <tr key={c.chapterId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{c.chapterName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs font-medium',
                        (c.accuracy ?? 0) >= 60 ? 'text-emerald-600' : (c.accuracy ?? 0) >= 40 ? 'text-amber-600' : 'text-rose-600'
                      )}>
                        {c.accuracy != null ? `${c.accuracy.toFixed(0)}%` : '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-emerald-600 font-medium">{c.correct}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-rose-600 font-medium">{c.wrong}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{c.skipped}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{c.score.toFixed(1)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{c.maxScore.toFixed(1)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{c.percentage.toFixed(0)}%</td>
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
