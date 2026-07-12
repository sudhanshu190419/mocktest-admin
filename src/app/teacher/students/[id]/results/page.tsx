'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useStudentResults } from '@/hooks/mockTest/useMockResults';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { computeAccuracy, formatDuration, getScoreColorClass } from '@/utils/mockResults';
import type { MockResult } from '@/types/mockTest';

const PAGE_SIZE = 20;

export default function StudentResultsPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;
  const [page, setPage] = useState(1);

  const { data: resultsData, isLoading } = useStudentResults(
    studentId,
    {},
    { sortBy: 'generatedAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );

  const results = resultsData?.data ?? [];
  const totalCount = resultsData?.count ?? 0;

  const columns: Column<MockResult>[] = [
    {
      key: 'testId',
      header: 'Test',
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Test #{r.testId.slice(0, 8)}
          </p>
          <p className="text-xs text-gray-500">
            {new Date(r.generatedAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
      ),
    },
    {
      key: 'percentage',
      header: 'Score',
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className={`text-lg font-bold ${getScoreColorClass(r.percentage)}`}>
            {r.percentage.toFixed(1)}%
          </span>
          <span className="text-xs text-gray-500">
            ({r.totalScore}/{r.maxScore})
          </span>
        </div>
      ),
    },
    {
      key: 'correctCount',
      header: 'Correct',
      sortable: true,
      render: (r) => (
        <span className="text-sm font-medium text-emerald-600">{r.correctCount}</span>
      ),
    },
    {
      key: 'wrongCount',
      header: 'Wrong',
      sortable: true,
      render: (r) => (
        <span className="text-sm font-medium text-rose-600">{r.wrongCount}</span>
      ),
    },
    {
      key: 'skippedCount',
      header: 'Skipped',
      render: (r) => (
        <span className="text-sm text-gray-500">{r.skippedCount}</span>
      ),
    },
    {
      key: 'accuracy',
      header: 'Accuracy',
      render: (r) => {
        const acc = computeAccuracy(r.correctCount, r.wrongCount);
        return acc !== null ? (
          <span className={`text-sm font-medium ${getScoreColorClass(acc)}`}>
            {acc.toFixed(0)}%
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        );
      },
    },
    {
      key: 'rank',
      header: 'Rank',
      sortable: true,
      render: (r) =>
        r.rank ? (
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">#{r.rank}</span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        ),
    },
    {
      key: 'totalTimeSeconds',
      header: 'Time',
      sortable: true,
      render: (r) => (
        <span className="text-xs text-gray-500">{formatDuration(r.totalTimeSeconds)}</span>
      ),
    },
    {
      key: 'isReleased',
      header: 'Status',
      render: (r) =>
        r.isReleased ? (
          <StatusBadge status="published" />
        ) : (
          <StatusBadge status="draft" />
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/teacher/results/${r.resultId}`);
            }}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            Detail
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/teacher/results/${r.resultId}/questions`);
            }}
            className="rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20"
          >
            Questions
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Test Results"
        description={`${totalCount} result${totalCount !== 1 ? 's' : ''}`}
        breadcrumbs={[
          { label: 'Students', href: '/teacher/students' },
          { label: 'Profile' },
          { label: 'Results' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/students/${studentId}/analytics`}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              Analytics
            </Link>
            <Link
              href={`/teacher/students/${studentId}/activity`}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-600"
            >
              Activity
            </Link>
          </div>
        }
      />

      <DataTable<MockResult>
        columns={columns}
        data={results}
        keyExtractor={(r) => r.resultId}
        onRowClick={(r) => router.push(`/teacher/results/${r.resultId}`)}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No results yet"
            description="This student hasn't completed any tests yet. Results will appear once tests are evaluated."
          />
        }
      />
    </div>
  );
}
