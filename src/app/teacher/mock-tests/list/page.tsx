'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMockTests, usePublishMockTest, useArchiveMockTest, useRestoreMockTest, useDeleteMockTest } from '@/hooks/mockTest/useMockTests';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { MockTest, MockTestStatus } from '@/types/mockTest';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const TEST_TYPES: Record<string, string> = {
  practice: 'Practice',
  mock: 'Mock Test',
  chapter_test: 'Chapter Test',
  pyq_paper: 'PYQ Paper',
};

export default function MockTestListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const PAGE_SIZE = 20;

  const filters: any = {};
  if (search) filters.search = search;
  if (statusFilter) filters.status = statusFilter;

  const { data: testsData, isLoading } = useMockTests(
    Object.keys(filters).length ? filters : undefined,
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );
  const tests = testsData?.data ?? [];
  const totalCount = testsData?.count ?? 0;

  const { mutate: publishTest } = usePublishMockTest();
  const { mutate: archiveTest } = useArchiveMockTest();
  const { mutate: restoreTest } = useRestoreMockTest();
  const { mutate: deleteTest } = useDeleteMockTest();

  const [confirmAction, setConfirmAction] = useState<{ type: string; id: string } | null>(null);

  const columns: Column<MockTest>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      render: (t) => (
        <div>
          <p className="text-sm font-medium text-gray-900 truncate max-w-xs">{t.title}</p>
          <p className="text-[11px] text-gray-500">{TEST_TYPES[t.testType] ?? t.testType} · {t.durationMin} min · {t.totalMarks} marks</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: 'totalMarks',
      header: 'Marks',
      sortable: true,
      className: 'text-center',
    },
    {
      key: 'durationMin',
      header: 'Duration',
      sortable: true,
      render: (t) => <span className="text-xs">{t.durationMin} min</span>,
    },
    {
      key: 'negativeMarking',
      header: 'Neg. Marking',
      render: (t) => <span className="text-xs">{t.negativeMarking > 0 ? `-${t.negativeMarking}` : 'None'}</span>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      render: (t) => <span className="text-xs text-gray-500">{new Date(t.updatedAt).toLocaleDateString()}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (t) => (
        <div className="flex items-center gap-1">
          <Link href={`/teacher/mock-tests/${t.testId}/edit`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">Edit</Link>
          <Link href={`/teacher/mock-tests/${t.testId}/questions`}
            className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Questions</Link>
          <Link href={`/teacher/mock-tests/${t.testId}/preview`}
            className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Preview</Link>
          {t.status === 'draft' && (
            <Link href={`/teacher/mock-tests/${t.testId}/publish`}
              className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50">Publish</Link>
          )}
          {t.status === 'published' && (
            <button type="button" onClick={() => setConfirmAction({ type: 'archive', id: t.testId })}
              className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">Archive</button>
          )}
          {t.status === 'archived' && (
            <button type="button" onClick={() => restoreTest(t.testId)}
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Restore</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Mock Tests"
        description={`${totalCount} test${totalCount !== 1 ? 's' : ''} created`}
        breadcrumbs={[{ label: 'Mock Tests', href: '/teacher/mock-tests' }, { label: 'All Tests' }]}
        actions={
          <Link href="/teacher/mock-tests/create"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Test
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search tests..." className="min-w-[240px] flex-1" />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <DataTable<MockTest>
        columns={columns}
        data={tests}
        keyExtractor={(t) => t.testId}
        onRowClick={(t) => router.push(`/teacher/mock-tests/${t.testId}/edit`)}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No mock tests found"
            description={search ? 'Try a different search term.' : 'Get started by creating your first mock test.'}
            action={
              <Link href="/teacher/mock-tests/create"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Create Test
              </Link>
            }
          />
        }
      />

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => { if (confirmAction?.id) archiveTest(confirmAction.id); setConfirmAction(null); }}
        title="Archive Test"
        message="Archived tests are hidden from students but data is preserved. You can restore it later."
        confirmLabel="Archive"
        variant="warning"
      />
    </div>
  );
}
