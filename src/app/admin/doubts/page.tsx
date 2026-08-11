'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminDoubts } from '@/hooks/doubt/useDoubt';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DoubtAcademicContext } from '@/components/teacher/doubts/DoubtAcademicContext';
import { StudentDoubtContext } from '@/components/teacher/doubts/StudentDoubtContext';
import type { DoubtStatus, StudentDoubt } from '@/types/doubt';

const PAGE_SIZE = 20;

type Segment = 'all' | 'unassigned';

const SEGMENT_LABELS: { value: Segment; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unassigned', label: 'Unassigned' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Status' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
];

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AdminDoubtsPage() {
  const router = useRouter();

  // ── Segment + filters (all server-side via RLS-scoped queries) ─────────
  const [segment, setSegment] = useState<Segment>('all');
  const [status, setStatus] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const changeSegment = (s: Segment) => {
    setSegment(s);
    setPage(1);
  };
  const changeStatus = (s: string) => {
    setStatus(s);
    setPage(1);
  };
  const changeSubject = (s: string) => {
    setSubjectId(s);
    setPage(1);
  };
  const changeSearch = (s: string) => {
    setSearchInput(s);
  };

  // Debounce search (300ms) — the page resets here (with the search) so the
  // query key changes atomically and we never fetch a stale page combo.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(() => {
    const f: {
      status?: DoubtStatus;
      subjectId?: string;
      unassigned?: boolean;
      search?: string;
    } = {};
    if (status) f.status = status as DoubtStatus;
    if (subjectId) f.subjectId = subjectId;
    if (segment === 'unassigned') f.unassigned = true;
    if (search) f.search = search;
    return f;
  }, [segment, status, subjectId, search]);

  const { data: doubtsData, isLoading } = useAdminDoubts(filters, {
    page,
    pageSize: PAGE_SIZE,
  });

  const doubts = doubtsData?.data ?? [];
  const totalCount = doubtsData?.count ?? 0;

  // Subject filter options — the admin's institute-wide subject list.
  const { data: subjectsData } = useSubjects(undefined, undefined, {
    page: 1,
    pageSize: 500,
  });

  const goToDetail = useCallback(
    (doubt: StudentDoubt) => router.push(`/admin/doubts/${doubt.doubtId}`),
    [router],
  );

  const columns: Column<StudentDoubt>[] = [
    {
      key: 'academic',
      header: 'Academic Context',
      render: (d) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              {d.subjectName ?? 'Subject'}
            </span>
            {d.assignedTo == null && d.status !== 'resolved' && d.status !== 'archived' && (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Awaiting Assignment
              </span>
            )}
          </div>
          <DoubtAcademicContext doubt={d} compact className="mt-1" />
        </div>
      ),
    },
    {
      key: 'question',
      header: 'Question',
      render: (d) => (
        <div className="max-w-md">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {d.title}
          </p>
          <StudentDoubtContext doubt={d} compact className="mt-1" />
        </div>
      ),
    },
    {
      key: 'assignment',
      header: 'Assignment',
      render: (d) => (
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {d.assignedTeacherName ?? (d.assignedTo ? 'Assigned' : 'Awaiting Assignment')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <StatusBadge status={d.status} />,
    },
    {
      key: 'createdAt',
      header: 'Received',
      render: (d) => (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatRelativeTime(d.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Doubts"
        description="Institute-wide doubt oversight — review student questions and assign teachers to the unassigned queue."
        breadcrumbs={[{ label: 'Doubts' }]}
      />

      {/* Toolbar: search + segment + status + subject (server-side) */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchInput}
          onChange={changeSearch}
          placeholder="Search doubts..."
          className="w-full max-w-xs"
        />
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          {SEGMENT_LABELS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => changeSegment(s.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                segment === s.value
                  ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-900 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Select
          value={status}
          onChange={changeStatus}
          options={STATUS_OPTIONS}
          placeholder="All Status"
          className="w-40"
        />
        <Select
          value={subjectId}
          onChange={changeSubject}
          options={(subjectsData?.data ?? []).map((s) => ({
            value: s.subjectId,
            label: s.name,
          }))}
          placeholder="All Subjects"
          className="w-44"
        />
      </div>

      <DataTable<StudentDoubt>
        columns={columns}
        data={doubts}
        keyExtractor={(d) => d.doubtId}
        onRowClick={goToDetail}
        isLoading={isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            icon={
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                />
              </svg>
            }
            title="No doubts found"
            description={
              search || status || subjectId || segment !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'New student doubts will appear here as soon as they are submitted.'
            }
          />
        }
      />
    </div>
  );
}
