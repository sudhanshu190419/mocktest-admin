'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  useMockTestManagementCounts,
  useMockTestList,
  usePublishMockTest,
  useArchiveMockTest,
  useRestoreMockTest,
  useDuplicateMockTest,
  useDeleteMockTest,
} from '@/hooks/admin/useMockTestManagement';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import type { MockTestListItem } from '@/services/admin/mockTestManagementService';
import {
  ArrowsClockwise,
  Clock,
  CheckCircle,
  Archive,
  FileText,
  Exam,
  BookOpen,
  XCircle,
  CircleNotch,
  Sparkle,
  CopySimple,
  Trash,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'title_asc', label: 'Title (A-Z)' },
  { value: 'title_desc', label: 'Title (Z-A)' },
  { value: 'durationMin_asc', label: 'Duration (Shortest)' },
  { value: 'durationMin_desc', label: 'Duration (Longest)' },
  { value: 'totalMarks_desc', label: 'Total Marks (High to Low)' },
  { value: 'totalMarks_asc', label: 'Total Marks (Low to High)' },
];

const STREAM_OPTIONS = [
  { value: '', label: 'All Streams' },
];

const SUBJECT_OPTIONS = [
  { value: '', label: 'All Subjects' },
];

const TEACHER_OPTIONS = [
  { value: '', label: 'All Teachers' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const days = Math.floor((now - then) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function getSortValue(sortKey: string): { sortBy: 'title' | 'durationMin' | 'totalMarks' | 'createdAt'; sortDirection: 'asc' | 'desc' } {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as any, sortDirection: dir ?? 'desc' };
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton Components
// ═══════════════════════════════════════════════════════════════════════════

function SummaryCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <Skeleton className="mb-2 h-3 w-16" />
          <Skeleton className="mb-1 h-6 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function MockTestManagementPage() {
  const router = useRouter();
  const { canRestoreDeletedData } = usePermissions();

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [sortKey, setSortKey] = useState('createdAt_desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Debounce search input to avoid rapid re-fetching
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(value), 400);
  }, []);

  // Reset page when any filter changes
  const handleFilterChange = useCallback((setter: (val: string) => void, value: string) => {
    setter(value);
    setPage(1);
  }, []);

  // ── Selection & Confirmation State ───────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<{
    type: 'publish' | 'archive' | 'restore' | 'duplicate' | 'delete';
    test: MockTestListItem | null;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Clear feedback after timeout
  const clearFeedback = useCallback(() => {
    setTimeout(() => {
      setActionError(null);
      setActionSuccess(null);
    }, 4000);
  }, []);

  // ── Data Fetching ────────────────────────────────────────────────────
  const sort = getSortValue(sortKey);

  const filters = useMemo(() => ({
    status: statusFilter || undefined,
    streamId: streamFilter || undefined,
    subjectId: subjectFilter || undefined,
    teacherId: teacherFilter || undefined,
    search: debouncedSearch || undefined,
  }), [statusFilter, streamFilter, subjectFilter, teacherFilter, debouncedSearch]);

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useMockTestManagementCounts();

  const {
    data: mockTestList,
    isLoading: listLoading,
    isError,
    error,
    refetch: refetchList,
  } = useMockTestList(filters, sort, { page, pageSize });

  const isLoading = countsLoading || listLoading;

  const handleRefresh = useCallback(() => {
    refetchCounts();
    refetchList();
  }, [refetchCounts, refetchList]);

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const publishMutation = usePublishMockTest();
  const archiveMutation = useArchiveMockTest();
  const restoreMutation = useRestoreMockTest();
  const duplicateMutation = useDuplicateMockTest();
  const deleteMutation = useDeleteMockTest();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (
    action: 'publish' | 'archive' | 'restore' | 'duplicate' | 'delete',
    test?: MockTestListItem | null,
  ) => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      let result;
      switch (action) {
        case 'publish':
          result = await publishMutation.mutateAsync(test!.testId);
          break;
        case 'archive':
          result = await archiveMutation.mutateAsync(test!.testId);
          break;
        case 'restore':
          result = await restoreMutation.mutateAsync(test!.testId);
          break;
        case 'duplicate':
          result = await duplicateMutation.mutateAsync(test!.testId);
          break;
        case 'delete':
          result = await deleteMutation.mutateAsync(test!.testId);
          break;
      }

      if (!result.success) {
        setActionError(result.error ?? 'Action failed. Please try again.');
        setActionLoading(false);
        return;
      }

      setActionSuccess(`Mock test ${action === 'publish' ? 'published' : action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : action === 'duplicate' ? 'duplicated' : 'deleted'} successfully`);
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [
    publishMutation,
    archiveMutation,
    restoreMutation,
    duplicateMutation,
    deleteMutation,
    clearFeedback,
  ]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type, confirmAction.test);
  }, [confirmAction, executeAction]);

  // ── Confirm Dialog Configuration ────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type, test } = confirmAction;
    const label = test?.title ?? 'this mock test';

    switch (type) {
      case 'publish':
        return {
          title: 'Publish Mock Test',
          message: `Are you sure you want to publish "${label}"? It will be made available to students.`,
          confirmLabel: 'Publish',
          variant: 'default' as const,
        };
      case 'archive':
        return {
          title: 'Archive Mock Test',
          message: `Are you sure you want to archive "${label}"? Students will no longer see it.`,
          confirmLabel: 'Archive',
          variant: 'warning' as const,
        };
      case 'restore':
        return {
          title: 'Restore Mock Test',
          message: `Are you sure you want to restore "${label}"? It will be returned to published status.`,
          confirmLabel: 'Restore',
          variant: 'default' as const,
        };
      case 'duplicate':
        return {
          title: 'Duplicate Mock Test',
          message: `Create a copy of "${label}"? The duplicate will be created as a draft.`,
          confirmLabel: 'Duplicate',
          variant: 'default' as const,
        };
      case 'delete':
        return {
          title: 'Delete Mock Test',
          message: `Are you sure you want to delete "${label}"? This item will be moved to the Recycle Bin and can be restored later.`,
          confirmLabel: 'Delete',
          variant: 'danger' as const,
        };
      default:
        return null;
    }
  }, [confirmAction]);

  // ── Summary Cards ────────────────────────────────────────────────────
  const summaryCards = useMemo(() => {
    if (!counts) return [];
    return [
      { label: 'Total Tests', value: counts.total, color: 'blue' as const, icon: <Exam size={20} weight="duotone" /> },
      { label: 'Draft', value: counts.draft, color: 'gray' as const, icon: <FileText size={20} weight="duotone" /> },
      { label: 'Pending Approval', value: counts.pendingApproval, color: 'amber' as const, icon: <Clock size={20} weight="duotone" /> },
      { label: 'Published', value: counts.published, color: 'emerald' as const, icon: <CheckCircle size={20} weight="duotone" /> },
      { label: 'Archived', value: counts.archived, color: 'rose' as const, icon: <Archive size={20} weight="duotone" /> },
    ];
  }, [counts]);

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<MockTestListItem>[] = useMemo(() => [
    {
      key: 'testName',
      header: 'Test Name',
      className: 'max-w-xs',
      render: (item) => (
        <div className="max-w-xs">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {item.title}
          </p>
          {item.description && (
            <p className="truncate text-[11px] text-gray-400">{item.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'streamName',
      header: 'Stream',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.streamName ?? '—'}
        </span>
      ),
    },
    {
      key: 'subjectName',
      header: 'Subject',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.subjectName ?? '—'}
        </span>
      ),
    },
    {
      key: 'teacherName',
      header: 'Teacher',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.teacherName ?? '—'}
        </span>
      ),
    },
    {
      key: 'testType',
      header: 'Type',
      render: (item) => (
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">
          {item.testType.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => (
        <StatusBadge status={item.status} showDot={true} />
      ),
    },
    {
      key: 'durationMin',
      header: 'Duration',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {formatDuration(item.durationMin)}
        </span>
      ),
    },
    {
      key: 'totalMarks',
      header: 'Total Marks',
      render: (item) => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {item.totalMarks}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created Date',
      render: (item) => (
        <div className="text-xs text-gray-500">
          <p>{formatDate(item.createdAt)}</p>
          <p className="text-[10px] text-gray-400">{formatTimeAgo(item.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'w-28 text-right',
      render: (_item) => (
        <div className="flex items-center justify-end gap-1">
          {/* Draft → Delete, Duplicate */}
          {_item.status === 'draft' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'duplicate', test: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:hover:bg-indigo-900/20"
              >
                {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'duplicate' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Duplicate
              </button>
              {canRestoreDeletedData && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', test: _item }); }}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
                >
                  {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'delete' ? (
                    <CircleNotch size={10} className="animate-spin" />
                  ) : null}
                  Delete
                </button>
              )}
            </>
          )}

          {/* Pending Approval → Publish, Delete */}
          {_item.status === 'pending_approval' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'publish', test: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'publish' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Publish
              </button>
              {canRestoreDeletedData && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', test: _item }); }}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
                >
                  {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'delete' ? (
                    <CircleNotch size={10} className="animate-spin" />
                  ) : null}
                  Delete
                </button>
              )}
            </>
          )}

          {/* Published → Archive, Duplicate */}
          {_item.status === 'published' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'archive', test: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-40 dark:hover:bg-orange-900/20"
              >
                {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'archive' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Archive
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'duplicate', test: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:hover:bg-indigo-900/20"
              >
                {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'duplicate' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Duplicate
              </button>
            </>
          )}

          {/* Archived → Restore, Duplicate */}
          {_item.status === 'archived' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'restore', test: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'restore' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Restore
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'duplicate', test: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:hover:bg-indigo-900/20"
              >
                {actionLoading && confirmAction?.test?.testId === _item.testId && confirmAction?.type === 'duplicate' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Duplicate
              </button>
            </>
          )}
        </div>
      ),
    },
  ], [canRestoreDeletedData]);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title="Mock Test Management"
        description="Manage, publish, archive and monitor mock tests."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Mock Tests' },
        ]}
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ArrowsClockwise size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        }
      />

      {/* ════════════════════════════════════════════════════════════════
          Error State
         ════════════════════════════════════════════════════════════════ */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 flex-shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Failed to load mock test data
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                {error instanceof Error ? error.message : 'An unexpected error occurred.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Summary Cards
         ════════════════════════════════════════════════════════════════ */}
      {countsLoading ? (
        <SummaryCardsSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((stat) => (
            <MetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value.toLocaleString()}
              icon={stat.icon}
              color={stat.color}
            />
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Filters Bar
         ════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by title or description..."
          className="min-w-[200px] flex-1"
        />
        <Select
          value={statusFilter}
          onChange={(v) => handleFilterChange(setStatusFilter, v)}
          options={STATUS_OPTIONS}
          placeholder="All Statuses"
          label="Status"
          className="min-w-[150px]"
        />
        <Select
          value={streamFilter}
          onChange={(v) => handleFilterChange(setStreamFilter, v)}
          options={STREAM_OPTIONS}
          placeholder="All Streams"
          label="Stream"
          className="min-w-[140px]"
        />
        <Select
          value={subjectFilter}
          onChange={(v) => handleFilterChange(setSubjectFilter, v)}
          options={SUBJECT_OPTIONS}
          placeholder="All Subjects"
          label="Subject"
          className="min-w-[140px]"
        />
        <Select
          value={teacherFilter}
          onChange={(v) => handleFilterChange(setTeacherFilter, v)}
          options={TEACHER_OPTIONS}
          placeholder="All Teachers"
          label="Teacher"
          className="min-w-[140px]"
        />
        <Select
          value={sortKey}
          onChange={(v) => handleFilterChange(setSortKey, v)}
          options={SORT_OPTIONS}
          placeholder="Sort by"
          label="Sort"
          className="min-w-[150px]"
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Success Banner
         ════════════════════════════════════════════════════════════════ */}
      {actionSuccess && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <CheckCircle size={18} className="text-emerald-600" weight="fill" />
          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            {actionSuccess}
          </span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Error Banner
         ════════════════════════════════════════════════════════════════ */}
      {actionError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <XCircle size={18} className="text-red-600" weight="fill" />
          <span className="text-sm font-medium text-red-800 dark:text-red-300">
            {actionError}
          </span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Mock Test Table
         ════════════════════════════════════════════════════════════════ */}
      <DataTable
        columns={columns}
        data={mockTestList?.data ?? []}
        keyExtractor={(item) => item.testId}
        onRowClick={(item) => router.push(`/admin/mock-tests/${item.testId}`)}
        isLoading={listLoading}
        emptyState={
          <EmptyState
            icon={<BookOpen size={40} weight="thin" />}
            title="No mock tests found"
            description={
              debouncedSearch || statusFilter || streamFilter || subjectFilter || teacherFilter
                ? 'Try adjusting your search or filters.'
                : 'Mock tests will appear here once they are created by teachers.'
            }
          />
        }
        page={page}
        pageSize={pageSize}
        totalCount={mockTestList?.count ?? 0}
        onPageChange={setPage}
      />

      {/* ════════════════════════════════════════════════════════════════
          Confirmation Dialog
         ════════════════════════════════════════════════════════════════ */}
      {confirmDialogConfig && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => {
            if (!actionLoading) setConfirmAction(null);
          }}
          onConfirm={handleConfirm}
          title={confirmDialogConfig.title}
          message={confirmDialogConfig.message}
          confirmLabel={confirmDialogConfig.confirmLabel}
          variant={confirmDialogConfig.variant}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
