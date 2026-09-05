'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useResults, useReleaseResult, useHideResult, useAccessibleResultTests } from '@/hooks/mockTest/useMockResults';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatDuration, getScoreColorClass } from '@/utils/mockResults';
import type { MockResult } from '@/types/mockTest';

const PAGE_SIZE = 20;

export default function ResultsListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [testFilter, setTestFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: testsData } = useAccessibleResultTests();
  const tests = testsData ?? [];

  const filters: any = {};
  if (testFilter) filters.testId = testFilter;
  if (statusFilter === 'released') filters.isReleased = true;
  if (statusFilter === 'hidden') filters.isReleased = false;

  const { data: resultsData, isLoading } = useResults(
    Object.keys(filters).length > 0 ? filters : undefined,
    { sortBy: 'generatedAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );
  const results = resultsData?.data ?? [];
  const totalCount = resultsData?.count ?? 0;

  const releaseResult = useReleaseResult();
  const hideResult = useHideResult();

  const [confirmAction, setConfirmAction] = useState<{ type: 'release' | 'hide'; id: string } | null>(null);

  const columns: Column<MockResult>[] = [
    {
      key: 'studentName',
      header: 'Student',
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[11px] font-bold text-white">
            {(r.studentName || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {r.studentName || 'Unknown Student'}
            </p>
            <p className="text-xs text-gray-400">ID: {r.studentId.slice(0, 8)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'totalScore',
      header: 'Score',
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${getScoreColorClass(r.percentage)}`}>
            {r.totalScore}/{r.maxScore}
          </span>
        </div>
      ),
    },
    {
      key: 'percentage',
      header: '%',
      sortable: true,
      render: (r) => (
        <span className={`font-bold ${getScoreColorClass(r.percentage)}`}>
          {r.percentage.toFixed(1)}%
        </span>
      ),
    },
    {
      key: 'correctCount',
      header: 'C/W/S',
      render: (r) => (
        <span className="text-xs text-gray-600">
          <span className="text-emerald-600 font-medium">{r.correctCount}</span>
          /<span className="text-red-600 font-medium">{r.wrongCount}</span>
          /<span className="text-gray-400">{r.skippedCount}</span>
        </span>
      ),
    },
    {
      key: 'rank',
      header: 'Rank',
      sortable: true,
      render: (r) => r.rank ? <span className="text-xs font-medium">#{r.rank}</span> : <span className="text-xs text-gray-400">—</span>,
    },
    {
      key: 'totalTimeSeconds',
      header: 'Time',
      sortable: true,
      render: (r) => <span className="text-xs text-gray-500">{formatDuration(r.totalTimeSeconds)}</span>,
    },
    {
      key: 'isReleased',
      header: 'Status',
      render: (r) => r.isReleased
        ? <StatusBadge status="published" />
        : <StatusBadge status="draft" />,
    },
    {
      key: 'generatedAt',
      header: 'Generated',
      sortable: true,
      render: (r) => <span className="text-xs text-gray-500">{new Date(r.generatedAt).toLocaleDateString()}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1">
          <Link href={`/teacher/results/${r.resultId}`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">View</Link>
          {r.isReleased ? (
            <button type="button" onClick={() => setConfirmAction({ type: 'hide', id: r.resultId })}
              className="rounded px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50">Hide</button>
          ) : (
            <button type="button" onClick={() => setConfirmAction({ type: 'release', id: r.resultId })}
              className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50">Release</button>
          )}
        </div>
      ),
    },
  ];

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return;
    if (confirmAction.type === 'release') {
      releaseResult.mutate(confirmAction.id);
    } else {
      hideResult.mutate(confirmAction.id);
    }
    setConfirmAction(null);
  }, [confirmAction, releaseResult, hideResult]);

  return (
    <div>
      <PageHeader
        title="All Results"
        description={`${totalCount} result${totalCount !== 1 ? 's' : ''}`}
        breadcrumbs={[{ label: 'Results', href: '/teacher/results' }, { label: 'All Results' }]}
        actions={
          <Link href="/teacher/results"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
            Dashboard
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <select value={testFilter} onChange={(e) => { setTestFilter(e.target.value); setPage(1); }}
          className="min-w-[150px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <option value="">All Tests</option>
          {tests.map((t) => <option key={t.testId} value={t.testId}>{t.title}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <option value="">All Status</option>
          <option value="released">Released</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>

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
            title="No results found"
            description={'No evaluated results yet.'}
          />
        }
      />

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={confirmAction?.type === 'release' ? 'Release Result' : 'Hide Result'}
        message={confirmAction?.type === 'release'
          ? 'This result will be visible to the student. Are you sure?'
          : 'This result will be hidden from the student. You can release it again later.'}
        confirmLabel={confirmAction?.type === 'release' ? 'Release' : 'Hide'}
        variant={confirmAction?.type === 'hide' ? 'warning' : 'default'}
      />
    </div>
  );
}
