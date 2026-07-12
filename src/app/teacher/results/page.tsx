'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useResults } from '@/hooks/mockTest/useMockResults';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { computeAccuracy, formatDuration, getScoreColorClass } from '@/utils/mockResults';
import type { MockResult } from '@/types/mockTest';

function ResultRow({ result }: { result: MockResult }) {
  const accuracy = computeAccuracy(result.correctCount, result.wrongCount);
  return (
    <Link
      href={`/teacher/results/${result.resultId}`}
      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">
            Result #{result.resultId.slice(0, 8)}
          </span>
          <StatusBadge status={result.isReleased ? 'published' : 'draft'} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>{result.correctCount} correct</span>
          <span>·</span>
          <span>{result.wrongCount} wrong</span>
          <span>·</span>
          <span>{result.skippedCount} skipped</span>
          <span>·</span>
          <span>{formatDuration(result.totalTimeSeconds)}</span>
        </div>
      </div>
      <div className="ml-4 text-right">
        <p className={`text-lg font-bold ${getScoreColorClass(result.percentage)}`}>
          {result.percentage.toFixed(1)}%
        </p>
        <p className="text-xs text-gray-500">
          {result.totalScore}/{result.maxScore}
        </p>
        {accuracy !== null && (
          <p className="text-[11px] text-gray-400">{accuracy.toFixed(0)}% accuracy</p>
        )}
        {result.rank && <p className="text-[11px] text-gray-400">Rank #{result.rank}</p>}
      </div>
    </Link>
  );
}

export default function ResultsDashboardPage() {
  const { data: resultsData, isLoading } = useResults(
    undefined,
    { sortBy: 'generatedAt', sortDirection: 'desc' },
    { page: 1, pageSize: 1000 },
  );
  const results = resultsData?.data ?? [];

  

  const stats = useMemo(() => {
    if (results.length === 0) {
      return { totalResults: 0, totalScore: 0, avgPercentage: 0, totalCorrect: 0, totalWrong: 0, totalSkipped: 0, highestScore: 0, releasedCount: 0 };
    }
    const totalScore = results.reduce((s, r) => s + r.totalScore, 0);
    const avgPercentage = results.reduce((s, r) => s + r.percentage, 0) / results.length;
    const totalCorrect = results.reduce((s, r) => s + r.correctCount, 0);
    const totalWrong = results.reduce((s, r) => s + r.wrongCount, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skippedCount, 0);
    const highestScore = Math.max(...results.map((r) => r.percentage));
    const releasedCount = results.filter((r) => r.isReleased).length;
    return { totalResults: results.length, totalScore, avgPercentage, totalCorrect, totalWrong, totalSkipped, highestScore, releasedCount };
  }, [results]);

  const recentResults = useMemo(() => {
    return results.slice(0, 10);
  }, [results]);

  const statCards = [
    { label: 'Total Results', value: stats.totalResults, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
    { label: 'Released', value: stats.releasedCount, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
    { label: 'Avg Score', value: `${stats.avgPercentage.toFixed(1)}%`, color: stats.avgPercentage >= 60 ? 'text-emerald-600' : 'text-amber-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200 dark:border-gray-700' },
    { label: 'Highest', value: `${stats.highestScore.toFixed(1)}%`, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800' },
    { label: 'Questions Answered', value: stats.totalCorrect + stats.totalWrong, color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200 dark:border-gray-700' },
  ];

  return (
    <div>
      <PageHeader
        title="Results"
        description="View student test results and performance analytics"
        actions={
          <Link href="/teacher/results/list"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            View All Results
          </Link>
        }
      />

      {isLoading ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
              <Skeleton className="mb-2 h-3 w-20" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {statCards.map((stat) => (
            <div key={stat.label} className={`rounded-xl border ${stat.border} ${stat.bg} p-5 transition-shadow hover:shadow-md`}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{stat.label}</p>
              <p className={`mt-1.5 text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Recent Results</h2>
        <Link href="/teacher/results/list" className="text-xs font-medium text-blue-600 hover:text-blue-700">
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : recentResults.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="Student test results will appear here once attempts are evaluated."
        />
      ) : (
        <div className="space-y-2">
          {recentResults.map((result) => (
            <ResultRow key={result.resultId} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}
