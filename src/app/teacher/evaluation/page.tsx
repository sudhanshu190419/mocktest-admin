'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePendingEvaluations } from '@/hooks/teacher/useEvaluation';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

interface AttemptGroup {
  attemptId: string;
  studentName: string;
  testTitle: string;
  totalPending: number;
  startedAt: string;
}

export default function EvaluationDashboardPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, error } = usePendingEvaluations({ page, pageSize });

  // Group pending items by attemptId
  const attemptGroups = useMemo(() => {
    if (!data?.data) return [];
    const groups: Record<string, AttemptGroup> = {};
    for (const item of data.data) {
      if (!groups[item.attemptId]) {
        groups[item.attemptId] = {
          attemptId: item.attemptId,
          studentName: item.studentName ?? 'Unknown Student',
          testTitle: item.testTitle,
          totalPending: 0,
          startedAt: item.startedAt,
        };
      }
      groups[item.attemptId].totalPending++;
    }
    return Object.values(groups);
  }, [data]);

  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div>
      <PageHeader
        title="Subjective Evaluation"
        description="Evaluate pending subjective answers from student submissions"
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-2 h-4 w-1/3" />
              <Skeleton className="mb-1 h-3 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load evaluations. Please try again.
          </p>
          <p className="mt-1 text-xs text-red-500 dark:text-red-500">
            {error.message}
          </p>
        </div>
      ) : attemptGroups.length === 0 ? (
        <EmptyState
          icon={
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
          }
          title="No pending evaluations"
          description="There are no pending subjective answers to evaluate right now."
        />
      ) : (
        <>
          <div className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            {totalCount} pending question{totalCount !== 1 ? 's' : ''} across{' '}
            {attemptGroups.length} attempt{attemptGroups.length !== 1 ? 's' : ''}
          </div>

          <div className="space-y-3">
            {attemptGroups.map((group) => (
              <Link
                key={group.attemptId}
                href={`/teacher/evaluation/${group.attemptId}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-600"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {group.studentName}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Pending Evaluation
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                      {group.testTitle}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                      <span>
                        {group.totalPending} pending question{group.totalPending !== 1 ? 's' : ''}
                      </span>
                      <span>·</span>
                      <span>
                        Submitted {new Date(group.startedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <span className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors group-hover:bg-blue-700">
                      Evaluate →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
