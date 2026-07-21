'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useBatchManagementCounts,
  useBatchList,
  useActivateBatch,
  useDeactivateBatch,
  useArchiveBatch,
  useRestoreBatch,
  useDeleteBatch,
} from '@/hooks/admin/useBatchManagement';
import { CreateBatchDialog } from '@/components/admin/batches/CreateBatchDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import type { BatchListItem } from '@/services/admin/batchManagementService';
import {
  ArrowsClockwise,
  Users,
  Archive,
  Prohibit,
  Power,
  Baby,
  GraduationCap,
  Play,
  Trash,
  CheckCircle,
  XCircle,
  CircleNotch,
  Plus,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'name_asc', label: 'Batch Name (A-Z)' },
  { value: 'name_desc', label: 'Batch Name (Z-A)' },
  { value: 'studentCount_desc', label: 'Student Count (High to Low)' },
  { value: 'studentCount_asc', label: 'Student Count (Low to High)' },
  { value: 'capacity_desc', label: 'Capacity (High to Low)' },
  { value: 'capacity_asc', label: 'Capacity (Low to High)' },
  { value: 'teacherName_asc', label: 'Teacher (A-Z)' },
  { value: 'teacherName_desc', label: 'Teacher (Z-A)' },
];

const STREAM_OPTIONS = [
  { value: '', label: 'All Streams' },
];

const TEACHER_OPTIONS = [
  { value: '', label: 'All Teachers' },
];

const SUBJECT_OPTIONS = [
  { value: '', label: 'All Subjects' },
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

/**
 * Parses a sort key like "createdAt_desc" or "studentCount_asc" into
 * separate sortBy and sortDirection values for the service layer.
 */
function getSortValue(sortKey: string): {
  sortBy: 'name' | 'createdAt' | 'studentCount' | 'capacity' | 'teacherName';
  sortDirection: 'asc' | 'desc';
} {
  const parts = sortKey.split('_');
  // The last part is always the direction
  const dir = parts.pop() as 'asc' | 'desc';
  const field = parts.join('_') as any;
  return { sortBy: field ?? 'createdAt', sortDirection: dir ?? 'desc' };
}

/**
 * Maps a DB batch status to a user-friendly display label.
 */
function getStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'upcoming':
      return 'Upcoming';
    case 'completed':
      return 'Completed';
    case 'archived':
      return 'Archived';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/**
 * Maps the UI "inactive" filter to the DB statuses it represents.
 */
function mapFilterStatus(status: string): string | undefined {
  if (!status) return undefined;
  // "inactive" maps to both "upcoming" and "completed" in the DB
  if (status === 'inactive') return 'upcoming,completed';
  return status;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton Components
// ═══════════════════════════════════════════════════════════════════════════

function SummaryCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
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

export default function BatchManagementPage() {
  const router = useRouter();

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
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

  // ── Create Batch Dialog State ────────────────────────────────────────
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // ── Selection & Confirmation State ───────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<{
    type: 'activate' | 'deactivate' | 'archive' | 'restore' | 'delete';
    batch: BatchListItem | null;
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
    status: mapFilterStatus(statusFilter),
    streamId: streamFilter || undefined,
    teacherId: teacherFilter || undefined,
    search: debouncedSearch || undefined,
  }), [statusFilter, streamFilter, teacherFilter, debouncedSearch]);

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useBatchManagementCounts();

  const {
    data: batchList,
    isLoading: listLoading,
    isError,
    error,
    refetch: refetchList,
  } = useBatchList(filters, sort, { page, pageSize });

  const isLoading = countsLoading || listLoading;

  const handleRefresh = useCallback(() => {
    refetchCounts();
    refetchList();
  }, [refetchCounts, refetchList]);

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const activateMutation = useActivateBatch();
  const deactivateMutation = useDeactivateBatch();
  const archiveMutation = useArchiveBatch();
  const restoreMutation = useRestoreBatch();
  const deleteMutation = useDeleteBatch();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (
    action: 'activate' | 'deactivate' | 'archive' | 'restore' | 'delete',
    batch?: BatchListItem | null,
  ) => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      let result;
      switch (action) {
        case 'activate':
          result = await activateMutation.mutateAsync(batch!.batchId);
          break;
        case 'deactivate':
          result = await deactivateMutation.mutateAsync(batch!.batchId);
          break;
        case 'archive':
          result = await archiveMutation.mutateAsync(batch!.batchId);
          break;
        case 'restore':
          result = await restoreMutation.mutateAsync(batch!.batchId);
          break;
        case 'delete':
          result = await deleteMutation.mutateAsync(batch!.batchId);
          break;
      }

      if (!result.success) {
        setActionError(result.error ?? 'Action failed. Please try again.');
        setActionLoading(false);
        return;
      }

      setActionSuccess(`Batch ${action === 'activate' ? 'activated' : action === 'deactivate' ? 'deactivated' : action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : 'deleted'} successfully`);
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [
    activateMutation,
    deactivateMutation,
    archiveMutation,
    restoreMutation,
    deleteMutation,
    clearFeedback,
  ]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type, confirmAction.batch);
  }, [confirmAction, executeAction]);

  // ── Confirm Dialog Configuration ────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type, batch } = confirmAction;
    const label = batch?.batchName ?? 'this batch';

    switch (type) {
      case 'activate':
        return {
          title: 'Activate Batch',
          message: `Are you sure you want to activate "${label}"? It will be made available for students.`,
          confirmLabel: 'Activate',
          variant: 'default' as const,
        };
      case 'deactivate':
        return {
          title: 'Deactivate Batch',
          message: `Are you sure you want to deactivate "${label}"? Students will lose access to this batch.`,
          confirmLabel: 'Deactivate',
          variant: 'warning' as const,
        };
      case 'archive':
        return {
          title: 'Archive Batch',
          message: `Are you sure you want to archive "${label}"? This batch will be retired for historical reference.`,
          confirmLabel: 'Archive',
          variant: 'warning' as const,
        };
      case 'restore':
        return {
          title: 'Restore Batch',
          message: `Are you sure you want to restore "${label}"? It will be returned to active status.`,
          confirmLabel: 'Restore',
          variant: 'default' as const,
        };
      case 'delete':
        return {
          title: 'Delete Batch',
          message: `Are you sure you want to delete "${label}"? This action cannot be undone.`,
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
      { label: 'Total Batches', value: counts.total, color: 'blue' as const, icon: <GraduationCap size={20} weight="duotone" /> },
      { label: 'Active', value: counts.active, color: 'emerald' as const, icon: <Play size={20} weight="duotone" /> },
      { label: 'Inactive', value: counts.inactive, color: 'amber' as const, icon: <Prohibit size={20} weight="duotone" /> },
      { label: 'Archived', value: counts.archived, color: 'rose' as const, icon: <Archive size={20} weight="duotone" /> },
      { label: 'Full Batches', value: counts.full, color: 'purple' as const, icon: <Users size={20} weight="duotone" /> },
      { label: 'Available Seats', value: counts.availableSeats, color: 'cyan' as const, icon: <Baby size={20} weight="duotone" /> },
    ];
  }, [counts]);

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<BatchListItem>[] = useMemo(() => [
    {
      key: 'batchCode',
      header: 'Batch Code',
      render: (item) => (
        <span className="font-mono text-xs font-medium text-gray-900 dark:text-gray-100">
          {item.batchCode}
        </span>
      ),
    },
    {
      key: 'batchName',
      header: 'Batch Name',
      className: 'max-w-xs',
      render: (item) => (
        <div className="max-w-xs">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {item.batchName}
          </p>
        </div>
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
      key: 'studentCount',
      header: 'Students',
      render: (item) => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {item.studentCount}
        </span>
      ),
    },
    {
      key: 'capacity',
      header: 'Capacity',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.capacity !== null ? item.capacity : '∞'}
        </span>
      ),
    },
    {
      key: 'availableSeats',
      header: 'Available Seats',
      render: (item) => {
        const seats = item.availableSeats;
        const isFull = seats !== null && seats <= 0;
        const isUnlimited = seats === null;
        return (
          <span className={`text-xs font-medium ${
            isFull
              ? 'text-rose-600'
              : isUnlimited
                ? 'text-gray-400'
                : 'text-emerald-600'
          }`}>
            {isUnlimited ? '∞' : isFull ? 'Full' : seats}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => (
        <StatusBadge status={item.status} showDot={true} />
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
      className: 'w-32 text-right',
      render: (_item) => (
        <div className="flex items-center justify-end gap-1">
          {/* Active → Deactivate, Archive */}
          {_item.status === 'active' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'deactivate', batch: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-amber-600 transition-colors hover:bg-amber-50 disabled:opacity-40 dark:hover:bg-amber-900/20"
              >
                {actionLoading && confirmAction?.batch?.batchId === _item.batchId && confirmAction?.type === 'deactivate' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Deactivate
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'archive', batch: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
              >
                {actionLoading && confirmAction?.batch?.batchId === _item.batchId && confirmAction?.type === 'archive' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Archive
              </button>
            </>
          )}

          {/* Upcoming / Completed → Activate */}
          {(_item.status === 'upcoming' || _item.status === 'completed') && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'activate', batch: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.batch?.batchId === _item.batchId && confirmAction?.type === 'activate' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Activate
              </button>
            </>
          )}

          {/* Archived → Restore, Delete */}
          {_item.status === 'archived' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'restore', batch: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.batch?.batchId === _item.batchId && confirmAction?.type === 'restore' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Restore
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', batch: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
              >
                {actionLoading && confirmAction?.batch?.batchId === _item.batchId && confirmAction?.type === 'delete' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Delete
              </button>
            </>
          )}
        </div>
      ),
    },
  ], []);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title="Batch Management"
        description="Manage batches, assign teachers, monitor capacity, and organize students."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Batch Management' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700"
            >
              <Plus size={16} weight="bold" />
              Create Batch
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowsClockwise size={14} className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
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
                Failed to load batch data
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {summaryCards.map((stat) => (
            <MetricCard
              key={stat.label}
              label={stat.label}
              value={typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
              icon={stat.icon}
              color={stat.color}
            />
          ))}
        </div>
      )}

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
          Filters Bar
         ════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by batch name or code..."
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
          className="min-w-[160px]"
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Batch Table
         ════════════════════════════════════════════════════════════════ */}
      <DataTable
        columns={columns}
        data={batchList?.data ?? []}
        keyExtractor={(item) => item.batchId}
        onRowClick={(item) => router.push(`/admin/batches/${item.batchId}`)}
        isLoading={listLoading}
        emptyState={
          <EmptyState
            icon={<GraduationCap size={40} weight="thin" />}
            title="No batches found"
            description={
              debouncedSearch || statusFilter || streamFilter || teacherFilter
                ? 'Try adjusting your search or filters.'
                : 'Batches will appear here once they are created.'
            }
          />
        }
        page={page}
        pageSize={pageSize}
        totalCount={batchList?.count ?? 0}
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

      {/* ════════════════════════════════════════════════════════════════
          Create Batch Dialog
         ════════════════════════════════════════════════════════════════ */}
      <CreateBatchDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </div>
  );
}
