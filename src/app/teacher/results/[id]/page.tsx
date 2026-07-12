'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useMockResult, useReleaseResult, useHideResult } from '@/hooks/mockTest/useMockResults';
import { useMockTest } from '@/hooks/mockTest/useMockTests';
import { useMockTestQuestions } from '@/hooks/mockTest/useMockTestQuestions';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { computeAccuracy, formatDuration, getScoreColorClass } from '@/utils/mockResults';

export default function ResultDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: resultId } = use(params);

  const { data: result, isLoading: resultLoading } = useMockResult(resultId);
  const { data: test } = useMockTest(result?.testId);
  const { data: assignedQuestions } = useMockTestQuestions(result?.testId);

  const releaseResult = useReleaseResult();
  const hideResult = useHideResult();

  const accuracy = useMemo(() => {
    if (!result) return null;
    return computeAccuracy(result.correctCount, result.wrongCount);
  }, [result]);

  if (resultLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Loading result details..." />
        <Skeleton className="mb-4 h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Result not found.</p>
        <Link href="/teacher/results" className="mt-2 inline-block text-sm text-blue-600 hover:underline">Back to Results</Link>
      </div>
    );
  }

  const questionCount = assignedQuestions?.length ?? 0;

  const statCards = [
    { label: 'Percentage', value: `${result.percentage.toFixed(1)}%`, color: getScoreColorClass(result.percentage) },
    { label: 'Score', value: `${result.totalScore}/${result.maxScore}`, color: 'text-gray-900' },
    { label: 'Accuracy', value: accuracy !== null ? `${accuracy.toFixed(0)}%` : '—', color: accuracy !== null && accuracy >= 60 ? 'text-emerald-600' : 'text-amber-600' },
    { label: 'Correct', value: result.correctCount, color: 'text-emerald-600' },
    { label: 'Wrong', value: result.wrongCount, color: 'text-red-600' },
    { label: 'Skipped', value: result.skippedCount, color: 'text-gray-500' },
    { label: 'Time', value: formatDuration(result.totalTimeSeconds), color: 'text-gray-900' },
    { label: 'Avg / Question', value: `${result.avgTimePerQuestion.toFixed(0)}s`, color: 'text-gray-500' },
    { label: 'Rank', value: result.rank ? `#${result.rank}` : '—', color: result.rank ? 'text-purple-600' : 'text-gray-400' },
    { label: 'Questions', value: `${questionCount}`, color: 'text-gray-900' },
  ];

  return (
    <div>
      <PageHeader
        title={`Result #${result.resultId.slice(0, 8)}`}
        description={test?.title ?? 'Loading test...'}
        breadcrumbs={[
          { label: 'Results', href: '/teacher/results' },
          { label: `#${result.resultId.slice(0, 8)}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={result.isReleased ? 'published' : 'draft'} />
            {result.isReleased ? (
              <button type="button" onClick={() => hideResult.mutate(result.resultId)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-300 hover:bg-amber-50">
                Hide
              </button>
            ) : (
              <button type="button" onClick={() => releaseResult.mutate(result.resultId)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                Release
              </button>
            )}
            <Link href={`/teacher/results/${result.resultId}/questions`}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
              Question Analysis
            </Link>
          </div>
        }
      />

      {/* Stats grid */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{stat.label}</p>
            <p className={`mt-1 text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Subject Breakdown */}
      {result.subjectBreakdown && result.subjectBreakdown.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Subject Breakdown</h2>
          <div className="space-y-2">
            {result.subjectBreakdown.map((sb) => (
              <div key={sb.subjectId}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{sb.subjectName}</p>
                    <p className="text-xs text-gray-500">
                      {sb.correct} correct · {sb.wrong} wrong · {sb.skipped} skipped
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${getScoreColorClass(sb.maxScore > 0 ? (sb.score / sb.maxScore) * 100 : 0)}`}>
                      {sb.score}/{sb.maxScore}
                    </p>
                    <p className="text-xs text-gray-500">
                      {sb.maxScore > 0 ? ((sb.score / sb.maxScore) * 100).toFixed(1) : '0'}%
                    </p>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${sb.maxScore > 0 ? (sb.score / sb.maxScore) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chapter Breakdown */}
      {result.chapterBreakdown && result.chapterBreakdown.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Chapter Breakdown</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {result.chapterBreakdown.map((cb) => (
              <div key={cb.chapterId}
                className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                <p className="text-xs font-medium text-gray-900 truncate">{cb.chapterName}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                  <span className="text-emerald-600 font-medium">{cb.correct}</span>/<span className="text-red-600 font-medium">{cb.wrong}</span>/<span className="text-gray-400">{cb.skipped}</span>
                  <span className="ml-auto font-medium">{cb.score}/{cb.maxScore}</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${cb.maxScore > 0 ? (cb.score / cb.maxScore) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw Breakdown Data */}
      {!result.subjectBreakdown && !result.chapterBreakdown && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-sm text-gray-500">No subject or chapter breakdown data available for this result.</p>
        </div>
      )}
    </div>
  );
}
