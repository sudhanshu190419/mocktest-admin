'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  useCourseManagementCounts,
  useCourseList,
  usePublishCourse,
  useArchiveCourse,
  useRestoreCourse,
  useDeleteCourse,
} from '@/hooks/admin/useCourseManagement';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { useStreams } from '@/hooks/academic/useStreams';
import { CourseCreateModal } from '@/components/ui/CourseCreateModal';
import { CourseEditModal } from '@/components/ui/CourseEditModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import type { CourseListItem } from '@/services/admin/courseManagementService';
import {
  ArrowsClockwise,
  BookOpen,
  CheckCircle,
  Archive,
  FileText,
  Sparkle,
  Clock,
  XCircle,
  CircleNotch,
  Trash,
  Star,
  TrendUp,
  Plus,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'title_asc', label: 'Title (A-Z)' },
  { value: 'title_desc', label: 'Title (Z-A)' },
  { value: 'originalPrice_desc', label: 'Price (High to Low)' },
  { value: 'originalPrice_asc', label: 'Price (Low to High)' },
  { value: 'duration_desc', label: 'Duration (Longest)' },
  { value: 'duration_asc', label: 'Duration (Shortest)' },
  { value: 'publishedAt_desc', label: 'Published (Newest)' },
];

const BOOLEAN_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
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

function getSortValue(sortKey: string): { sortBy: 'title' | 'originalPrice' | 'duration' | 'createdAt' | 'publishedAt'; sortDirection: 'asc' | 'desc' } {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as any, sortDirection: dir ?? 'desc' };
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'draft': return 'Draft';
    case 'pending_approval': return 'Pending Approval';
    case 'approved': return 'Approved';
    case 'published': return 'Published';
    case 'archived': return 'Archived';
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
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

export default function CourseManagementPage() {
  const router = useRouter();
  const { canRestoreDeletedData } = usePermissions();

  // ── Create & Edit Modal State ─────────────────────────────────────────
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseListItem | null>(null);

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [featuredFilter, setFeaturedFilter] = useState('');
  const [trendingFilter, setTrendingFilter] = useState('');
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
    type: 'publish' | 'archive' | 'restore' | 'delete';
    course: CourseListItem | null;
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
    featured: featuredFilter ? featuredFilter === 'true' : undefined,
    trending: trendingFilter ? trendingFilter === 'true' : undefined,
    search: debouncedSearch || undefined,
  }), [statusFilter, streamFilter, featuredFilter, trendingFilter, debouncedSearch]);

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useCourseManagementCounts();

  const {
    data: courseList,
    isLoading: listLoading,
    isError,
    error,
    refetch: refetchList,
  } = useCourseList(filters, sort, { page, pageSize });

  // ── Dynamic Streams for Filter ──────────────────────────────────────
  const { data: streamsData, refetch: refetchStreams } = useStreams(undefined, undefined, { page: 1, pageSize: 100 });

  const streamOptions = useMemo(() => {
    const options = [{ value: '', label: 'All Streams' }];
    if (streamsData?.data) {
      streamsData.data.forEach((s) => {
        options.push({ value: s.streamId, label: s.name });
      });
    }
    return options;
  }, [streamsData]);

  const isLoading = countsLoading || listLoading;

  const handleRefresh = useCallback(() => {
    refetchCounts();
    refetchList();
    refetchStreams();
  }, [refetchCounts, refetchList, refetchStreams]);

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const publishMutation = usePublishCourse();
  const archiveMutation = useArchiveCourse();
  const restoreMutation = useRestoreCourse();
  const deleteMutation = useDeleteCourse();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (
    action: 'publish' | 'archive' | 'restore' | 'delete',
    course?: CourseListItem | null,
  ) => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      let result;
      switch (action) {
        case 'publish':
          result = await publishMutation.mutateAsync(course!.courseId);
          break;
        case 'archive':
          result = await archiveMutation.mutateAsync(course!.courseId);
          break;
        case 'restore':
          result = await restoreMutation.mutateAsync(course!.courseId);
          break;
        case 'delete':
          result = await deleteMutation.mutateAsync(course!.courseId);
          break;
      }

      if (!result.success) {
        setActionError(result.error ?? 'Action failed. Please try again.');
        setActionLoading(false);
        return;
      }

      setActionSuccess(`Course ${action === 'publish' ? 'published' : action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : 'deleted'} successfully`);
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
    deleteMutation,
    clearFeedback,
  ]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type, confirmAction.course);
  }, [confirmAction, executeAction]);

  // ── Confirm Dialog Configuration ────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type, course } = confirmAction;
    const label = course?.title ?? 'this course';

    switch (type) {
      case 'publish':
        return {
          title: 'Publish Course',
          message: `Are you sure you want to publish "${label}"? It will be made available in the student catalog.`,
          confirmLabel: 'Publish',
          variant: 'default' as const,
        };
      case 'archive':
        return {
          title: 'Archive Course',
          message: `Are you sure you want to archive "${label}"? It will be hidden from the catalog but existing enrollments will be preserved.`,
          confirmLabel: 'Archive',
          variant: 'warning' as const,
        };
      case 'restore':
        return {
          title: 'Restore Course',
          message: `Are you sure you want to restore "${label}"? It will be returned to published status.`,
          confirmLabel: 'Restore',
          variant: 'default' as const,
        };
      case 'delete':
        return {
          title: 'Delete Course',
          message: `Are you sure you want to delete "${label}"? Only courses without active enrollments can be deleted. This item will be moved to the Recycle Bin and can be restored later.`,
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
      { label: 'Total Courses', value: counts.total, color: 'blue' as const, icon: <BookOpen size={20} weight="duotone" /> },
      { label: 'Draft', value: counts.draft, color: 'gray' as const, icon: <FileText size={20} weight="duotone" /> },
      { label: 'Pending Approval', value: counts.pendingApproval, color: 'amber' as const, icon: <Clock size={20} weight="duotone" /> },
      { label: 'Approved', value: counts.approved, color: 'indigo' as const, icon: <CheckCircle size={20} weight="duotone" /> },
      { label: 'Published', value: counts.published, color: 'emerald' as const, icon: <Sparkle size={20} weight="duotone" /> },
      { label: 'Archived', value: counts.archived, color: 'rose' as const, icon: <Archive size={20} weight="duotone" /> },
    ];
  }, [counts]);

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<CourseListItem>[] = useMemo(() => [
    {
      key: 'title',
      header: 'Course Title',
      className: 'max-w-xs',
      render: (item) => (
        <div className="flex items-center gap-3 max-w-xs">
          {/* Thumbnail placeholder */}
          <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm">
            {item.thumbnailPath ? (
              <img
                src={item.thumbnailPath}
                alt={item.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <BookOpen size={16} weight="fill" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {item.title}
            </p>
            <p className="truncate text-[11px] text-gray-400">
              {item.shortDescription ?? item.slug}
            </p>
          </div>
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
      key: 'batchesCount',
      header: 'Batches',
      render: (item) => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {item.batchesCount}
        </span>
      ),
    },
    {
      key: 'originalPrice',
      header: 'Original Price',
      render: (item) => (
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {formatPrice(item.originalPrice, item.currency)}
        </span>
      ),
    },
    {
      key: 'discountedPrice',
      header: 'Discounted Price',
      render: (item) => {
        if (item.discountedPrice === null) {
          return <span className="text-xs text-gray-400">—</span>;
        }
        const hasDiscount = item.discountedPrice < item.originalPrice;
        return (
          <span className={`text-xs font-medium ${hasDiscount ? 'text-emerald-600' : 'text-gray-500'}`}>
            {formatPrice(item.discountedPrice, item.currency)}
            {hasDiscount && (
              <span className="ml-1 text-[10px] text-emerald-500">
                ({Math.round((1 - item.discountedPrice / item.originalPrice) * 100)}% off)
              </span>
            )}
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
      key: 'featured',
      header: 'Featured',
      render: (item) => (
        item.featured
          ? <Star size={16} weight="fill" className="text-amber-500" />
          : <span className="text-xs text-gray-400">—</span>
      ),
    },
    {
      key: 'trending',
      header: 'Trending',
      render: (item) => (
        item.trending
          ? <TrendUp size={16} weight="fill" className="text-emerald-500" />
          : <span className="text-xs text-gray-400">—</span>
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
          {/* Edit */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditingCourse(_item); }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            Edit
          </button>

          {/* Draft → Publish, Delete */}
          {(_item.status === 'draft' || _item.status === 'pending_approval' || _item.status === 'approved') && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'publish', course: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.course?.courseId === _item.courseId && confirmAction?.type === 'publish' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Publish
              </button>
            </>
          )}

          {/* Published → Archive */}
          {_item.status === 'published' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'archive', course: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-40 dark:hover:bg-orange-900/20"
              >
                {actionLoading && confirmAction?.course?.courseId === _item.courseId && confirmAction?.type === 'archive' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Archive
              </button>
            </>
          )}

          {/* Archived → Restore, Delete */}
          {_item.status === 'archived' && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'restore', course: _item }); }}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.course?.courseId === _item.courseId && confirmAction?.type === 'restore' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Restore
              </button>
              {canRestoreDeletedData && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', course: _item }); }}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
                >
                  {actionLoading && confirmAction?.course?.courseId === _item.courseId && confirmAction?.type === 'delete' ? (
                    <CircleNotch size={10} className="animate-spin" />
                  ) : null}
                  Delete
                </button>
              )}
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
        title="Course Management"
        description="Create, manage, and organize courses for the student catalog."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Courses' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus size={14} weight="bold" />
              Create Course
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
                Failed to load course data
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
              value={stat.value.toLocaleString()}
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
          placeholder="Search by title, slug, or description..."
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
          options={streamOptions}
          placeholder="All Streams"
          label="Stream"
          className="min-w-[140px]"
        />
        <Select
          value={featuredFilter}
          onChange={(v) => handleFilterChange(setFeaturedFilter, v)}
          options={BOOLEAN_OPTIONS}
          placeholder="All"
          label="Featured"
          className="min-w-[120px]"
        />
        <Select
          value={trendingFilter}
          onChange={(v) => handleFilterChange(setTrendingFilter, v)}
          options={BOOLEAN_OPTIONS}
          placeholder="All"
          label="Trending"
          className="min-w-[120px]"
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
          Course DataTable
         ════════════════════════════════════════════════════════════════ */}
      <DataTable
        columns={columns}
        data={courseList?.data ?? []}
        keyExtractor={(item) => item.courseId}
        onRowClick={(item) => router.push(`/admin/courses/${item.courseId}`)}
        isLoading={listLoading}
        emptyState={
          <EmptyState
            icon={<BookOpen size={40} weight="thin" />}
            title="No courses found"
            description={
              debouncedSearch || statusFilter || streamFilter || featuredFilter || trendingFilter
                ? 'Try adjusting your search or filters.'
                : 'Courses will appear here once they are created.'
            }
          />
        }
        page={page}
        pageSize={pageSize}
        totalCount={courseList?.count ?? 0}
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
          Create Course Modal
         ════════════════════════════════════════════════════════════════ */}
      <CourseCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => {
          setActionSuccess('Course created successfully!');
          clearFeedback();
          handleRefresh();
        }}
      />

      {/* ════════════════════════════════════════════════════════════════
          Edit Course Modal
         ════════════════════════════════════════════════════════════════ */}
      <CourseEditModal
        open={!!editingCourse}
        onClose={() => setEditingCourse(null)}
        course={editingCourse}
        onSuccess={() => {
          setActionSuccess('Course updated successfully!');
          clearFeedback();
          handleRefresh();
        }}
      />
    </div>
  );
}
