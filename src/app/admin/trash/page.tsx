'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MetricCard } from '@/components/analytics/MetricCard';
import { PermissionGuard } from '@/components/admin/PermissionGuard';
import { useTrashList, useTrashItem, useRestoreTrashItem, usePermanentDeleteTrashItem, useBulkRestoreTrashItems, useBulkPermanentDeleteTrashItems } from '@/hooks/admin/useTrash';
import { useAdminUsers } from '@/hooks/admin/useAdminManagement';
import { useAuth } from '@/context/AuthContext';
import type {
  TrashResourceType,
  TrashItem,
  TrashSortOptions,
  BulkItemRef,
  BulkResult,
} from '@/services/admin/trashService';
import {
  Trash,
  TrashSimple,
  ArrowsClockwise,
  LockSimple,
  XCircle,
  CheckCircle,
  ArrowUUpLeft,
  ListMagnifyingGlass,
  X,
  CircleNotch,
  Stack,
  CaretDown,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 20;

/** Resource type filter options — mirrors the TrashResourceType union. */
const RESOURCE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Resource Types' },
  { value: 'questions', label: 'Questions' },
  { value: 'mock_tests', label: 'Mock Tests' },
  { value: 'content', label: 'Content' },
  { value: 'subjects', label: 'Subjects' },
  { value: 'chapters', label: 'Chapters' },
  { value: 'topics', label: 'Topics' },
  { value: 'streams', label: 'Streams' },
  { value: 'tags', label: 'Tags' },
  { value: 'batches', label: 'Batches' },
  { value: 'courses', label: 'Courses' },
  { value: 'recordings', label: 'Recordings' },
  { value: 'pyq_packages', label: 'PYQ Packages' },
  { value: 'pyq_papers', label: 'PYQ Papers' },
  { value: 'demo_classes', label: 'Demo Classes' },
];

const SORT_OPTIONS = [
  { value: 'deletedAt_desc', label: 'Deleted Date (Newest First)' },
  { value: 'deletedAt_asc', label: 'Deleted Date (Oldest First)' },
  { value: 'displayName_asc', label: 'Name (A-Z)' },
  { value: 'resourceType_asc', label: 'Resource Type (A-Z)' },
];

/** Resource type → friendly label, reused by table + summary cards. */
const RESOURCE_LABELS: Record<string, string> = {
  questions: 'Question',
  mock_tests: 'Mock Test',
  content: 'Content',
  subjects: 'Subject',
  chapters: 'Chapter',
  topics: 'Topic',
  streams: 'Stream',
  tags: 'Tag',
  batches: 'Batch',
  courses: 'Course',
  recordings: 'Recording',
  pyq_packages: 'PYQ Package',
  pyq_papers: 'PYQ Paper',
  demo_classes: 'Demo Class',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** Parse "sortBy_direction" into the TrashSortOptions shape. */
function parseSortKey(key: string): TrashSortOptions {
  const [sortBy, dir] = key.split('_');
  return {
    sortBy: (['deletedAt', 'displayName', 'resourceType'] as const).includes(
      sortBy as 'deletedAt' | 'displayName' | 'resourceType',
    )
      ? (sortBy as 'deletedAt' | 'displayName' | 'resourceType')
      : 'deletedAt',
    sortDirection: dir === 'asc' ? 'asc' : 'desc',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Detail Drawer (local — mirrors the audit drawer pattern, no new shared UI)
// ═══════════════════════════════════════════════════════════════════════════

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="flex-shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <span className="min-w-0 break-all text-right text-xs text-gray-700 dark:text-gray-300">
        {children}
      </span>
    </div>
  );
}

interface TrashItemDrawerProps {
  item?: TrashItem | null;
  isLoading?: boolean;
  error?: Error | null;
  onClose: () => void;
  onRestore: (item: TrashItem) => void;
  onPurge: (item: TrashItem) => void;
  actorName?: (profileId: string | null) => string | null;
}

function TrashItemDrawer({ item, isLoading, error, onClose, onRestore, onPurge, actorName }: TrashItemDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Deleted Item Detail
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Soft-deleted record in the Recycle Bin
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close detail"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {error ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <XCircle size={26} className="text-red-500" weight="fill" />
              <p className="text-xs text-gray-400">
                Failed to load this item: {error.message}
              </p>
            </div>
          ) : isLoading || !item ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <CircleNotch size={26} className="animate-spin text-amber-500" />
              <p className="text-xs text-gray-400">Loading deleted item…</p>
            </div>
          ) : (
            <>
              {/* ── General ────────────────────────────────────────────── */}
              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <Trash size={14} /> General
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  <DetailRow label="Resource Type">
                    {RESOURCE_LABELS[item.resourceType] ?? item.resourceType}
                  </DetailRow>
                  <DetailRow label="Name">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {item.displayName ?? '—'}
                    </span>
                  </DetailRow>
                  {item.status && <DetailRow label="Status"><StatusBadge status={item.status} /></DetailRow>}
                  <DetailRow label="Deleted At">{formatDateTime(item.deletedAt)}</DetailRow>
                  <DetailRow label="Deleted By">{actorName?.(item.deletedBy) ?? formatShortId(item.deletedBy)}</DetailRow>
                  <DetailRow label="Reason">{item.deleteReason ?? '—'}</DetailRow>
                </div>
              </section>

              {/* ── Parent ─────────────────────────────────────────────── */}
              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Parent
                </h3>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {item.parentResource ? (
                    <>
                      <DetailRow label="Type">
                        {RESOURCE_LABELS[item.parentResource.type] ?? item.parentResource.type}
                      </DetailRow>
                      <DetailRow label="Name">{item.parentResource.name ?? '—'}</DetailRow>
                      <DetailRow label="ID">
                        <span className="font-mono">{formatShortId(item.parentResource.id)}</span>
                      </DetailRow>
                    </>
                  ) : (
                    <p className="py-1.5 text-xs text-gray-500 dark:text-gray-400">No parent</p>
                  )}
                </div>
              </section>

              {/* ── Resource-specific metadata ─────────────────────────── */}
              {Object.keys(item.extraMetadata).length > 0 && (
                <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Resource Metadata
                  </h3>
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {Object.entries(item.extraMetadata).map(([key, value]) => (
                      <DetailRow key={key} label={key.replace(/([A-Z])/g, ' $1').trim()}>
                        {String(value ?? '—')}
                      </DetailRow>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {item && (
          <div className="space-y-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
            <button
              type="button"
              onClick={() => onRestore(item)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <ArrowUUpLeft size={16} weight="bold" />
              Restore this item
            </button>
            <button
              type="button"
              onClick={() => onPurge(item)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <TrashSimple size={16} weight="bold" />
              Delete Forever
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function RecycleBinPage() {
  const { instituteId } = useAuth();

  // ── Permanent Delete Confirmation State ──────────────────────────────
  const [purgeTarget, setPurgeTarget] = useState<TrashItem | null>(null);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgeReasonError, setPurgeReasonError] = useState<string | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purgeConfirmError, setPurgeConfirmError] = useState<string | null>(null);

  // ── Bulk Selection State (Phase 8C.5) ────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRestoreOpen, setBulkRestoreOpen] = useState(false);
  const [bulkPurgeOpen, setBulkPurgeOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkReasonError, setBulkReasonError] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult | null>(null);
  const [showFailureDetails, setShowFailureDetails] = useState(false);

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [deletedByFilter, setDeletedByFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortKey, setSortKey] = useState('deletedAt_desc');
  const [page, setPage] = useState(1);

  // ── Detail Drawer State ──────────────────────────────────────────────
  const [selected, setSelected] = useState<{ resourceType: TrashResourceType; resourceId: string } | null>(null);

  // ── Restore Confirmation State ───────────────────────────────────────
  const [restoreTarget, setRestoreTarget] = useState<TrashItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // ── Debounced search ─────────────────────────────────────────────────
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
      // A new search changes which rows are visible — drop the stale
      // selection so bulk actions can never target hidden rows.
      setSelectedIds(new Set());
    }, 400);
  }, []);

  // Reset page + selection whenever a filter changes
  const onFilterChange = useCallback(
    (setter: (v: string) => void) => (v: string) => {
      setter(v);
      setPage(1);
      setSelectedIds(new Set());
    },
    [],
  );

  // ── Data Fetching ────────────────────────────────────────────────────
  const filters = useMemo(
    () => ({
      resourceTypes: resourceTypeFilter
        ? ([resourceTypeFilter] as TrashResourceType[])
        : undefined,
      search: debouncedSearch || undefined,
      deletedBy: deletedByFilter || undefined,
      dateFrom: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
      dateTo: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
    }),
    [resourceTypeFilter, debouncedSearch, deletedByFilter, fromDate, toDate],
  );

  const sort = useMemo(() => parseSortKey(sortKey), [sortKey]);
  const pagination = useMemo(() => ({ page, pageSize: PAGE_SIZE }), [page]);

  const { data: listData, isLoading, isError, error, refetch } = useTrashList(
    filters,
    sort,
    pagination,
  );
  const {
    data: detailItem,
    isLoading: detailLoading,
    error: detailError,
  } = useTrashItem(
    selected?.resourceType ?? null,
    selected?.resourceId ?? null,
  );

  // Admin users used to resolve "deleted by" names in the table + filter.
  const { data: adminUsers } = useAdminUsers(instituteId);
  const actorName = useCallback(
    (profileId: string | null): string | null => {
      if (!profileId) return null;
      const user = (adminUsers ?? []).find((u) => u.profileId === profileId);
      return user?.name ?? null;
    },
    [adminUsers],
  );
  const actorOptions = useMemo(
    () => [
      { value: '', label: 'All Actors' },
      ...(adminUsers ?? []).map((u) => ({ value: u.profileId, label: u.name })),
    ],
    [adminUsers],
  );

  // ── Restore Mutation ─────────────────────────────────────────────────
  const restoreMutation = useRestoreTrashItem();

  // ── Permanent Delete Mutation ────────────────────────────────────────
  const purgeMutation = usePermanentDeleteTrashItem();

  // ── Bulk Mutations (Phase 8C.5) ──────────────────────────────────────
  const bulkRestoreMutation = useBulkRestoreTrashItems();
  const bulkPurgeMutation = useBulkPermanentDeleteTrashItems();

  const clearFeedback = useCallback(() => {
    setTimeout(() => {
      setActionError(null);
      setActionSuccess(null);
    }, 5000);
  }, []);

  const handleRestore = useCallback(
    async (item: TrashItem) => {
      setActionError(null);
      setActionSuccess(null);
      try {
        const result = await restoreMutation.mutateAsync({
          resourceType: item.resourceType,
          resourceId: item.resourceId,
        });
        if (!result.success) {
          setActionError(result.error ?? 'Restore failed. Please try again.');
          return;
        }
        setActionSuccess(
          `${RESOURCE_LABELS[item.resourceType] ?? item.resourceType} restored successfully`,
        );
        // The mutation invalidates the trash list → restored item disappears.
        setSelected(null);
      } catch (err: any) {
        setActionError(err?.message ?? 'An unexpected error occurred.');
      } finally {
        setRestoreTarget(null);
        clearFeedback();
      }
    },
    [restoreMutation, clearFeedback],
  );

  const openPurgeDialog = useCallback((item: TrashItem) => {
    setPurgeReason('');
    setPurgeReasonError(null);
    setPurgeConfirmText('');
    setPurgeConfirmError(null);
    setPurgeTarget(item);
  }, []);

  const handlePermanentDelete = useCallback(
    async (item: TrashItem) => {
      let hasError = false;
      const expectedTitle = (item.displayName ?? item.resourceId).trim();
      if (purgeConfirmText.trim() !== expectedTitle) {
        setPurgeConfirmError(`Please type "${expectedTitle}" exactly to confirm.`);
        hasError = true;
      }
      if (!purgeReason.trim()) {
        setPurgeReasonError('A delete reason is required.');
        hasError = true;
      }
      if (hasError) return;

      setActionError(null);
      setActionSuccess(null);
      try {
        const result = await purgeMutation.mutateAsync({
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          reason: purgeReason.trim(),
        });
        if (!result.success) {
          setActionError(result.error ?? 'Permanent delete failed. Please try again.');
          return;
        }
        setActionSuccess(
          `${RESOURCE_LABELS[item.resourceType] ?? item.resourceType} permanently deleted`,
        );
        // The mutation invalidates the trash list → item disappears.
        setSelected(null);
      } catch (err: any) {
        setActionError(err?.message ?? 'An unexpected error occurred.');
      } finally {
        setPurgeTarget(null);
        clearFeedback();
      }
    },
    [purgeMutation, purgeReason, clearFeedback],
  );

  // ── Summary Cards ────────────────────────────────────────────────────
  const summaryCards = useMemo(() => {
    const perType = listData?.perTypeCounts ?? {};
    return [
      {
        label: 'Total Deleted',
        value: listData?.total ?? 0,
        color: 'rose' as const,
        icon: <Trash size={20} weight="duotone" />,
      },
      {
        label: 'Questions',
        value: perType.questions ?? 0,
        color: 'blue' as const,
        icon: <ListMagnifyingGlass size={20} weight="duotone" />,
      },
      {
        label: 'Mock Tests',
        value: perType.mock_tests ?? 0,
        color: 'purple' as const,
        icon: <CheckCircle size={20} weight="duotone" />,
      },
      {
        label: 'Content',
        value: perType.content ?? 0,
        color: 'cyan' as const,
        icon: <ArrowUUpLeft size={20} weight="duotone" />,
      },
      {
        label: 'Batches',
        value: perType.batches ?? 0,
        color: 'amber' as const,
        icon: <Trash size={20} weight="duotone" />,
      },
      {
        label: 'Courses',
        value: perType.courses ?? 0,
        color: 'indigo' as const,
        icon: <Trash size={20} weight="duotone" />,
      },
    ];
  }, [listData]);

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<TrashItem>[] = useMemo(
    () => [
      {
        key: 'resourceType',
        header: 'Type',
        render: (item) => (
          <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {RESOURCE_LABELS[item.resourceType] ?? item.resourceType}
          </span>
        ),
      },
      {
        key: 'displayName',
        header: 'Name',
        className: 'max-w-[260px]',
        render: (item) => (
          <div className="max-w-[260px]">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {item.displayName ?? '—'}
            </p>
            <p className="font-mono text-[10px] text-gray-400">
              {formatShortId(item.resourceId)}
            </p>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => (
          item.status ? <StatusBadge status={item.status} showDot={true} /> : <span className="text-xs text-gray-400">—</span>
        ),
      },
      {
        key: 'parentResource',
        header: 'Parent',
        render: (item) => (
          <div className="max-w-[160px]">
            {item.parentResource?.name ? (
              <>
                <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                  {item.parentResource.name}
                </p>
                <p className="text-[10px] text-gray-400">
                  {RESOURCE_LABELS[item.parentResource.type] ?? item.parentResource.type}
                </p>
              </>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </div>
        ),
      },
      {
        key: 'deletedAt',
        header: 'Deleted At',
        render: (item) => (
          <div className="text-xs text-gray-600 dark:text-gray-400">
            <p>{formatDateTime(item.deletedAt)}</p>
          </div>
        ),
      },
      {
        key: 'deletedBy',
        header: 'Deleted By',
        render: (item) => (
          <span className="max-w-[140px] truncate text-xs text-gray-600 dark:text-gray-400">
            {actorName(item.deletedBy) ?? formatShortId(item.deletedBy)}
          </span>
        ),
      },
      {
        key: 'deleteReason',
        header: 'Reason',
        className: 'max-w-[180px]',
        render: (item) => (
          <span className="block max-w-[180px] truncate text-xs text-gray-500 dark:text-gray-400">
            {item.deleteReason ?? '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        className: 'w-44 text-right',
        render: (item) => (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRestoreTarget(item);
              }}
              disabled={restoreMutation.isPending || purgeMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
            >
              {restoreMutation.isPending && restoreTarget?.resourceId === item.resourceId ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : (
                <ArrowUUpLeft size={11} />
              )}
              Restore
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPurgeDialog(item);
              }}
              disabled={restoreMutation.isPending || purgeMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-900/20"
            >
              {purgeMutation.isPending && purgeTarget?.resourceId === item.resourceId ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : (
                <TrashSimple size={11} />
              )}
              Delete Forever
            </button>
          </div>
        ),
      },
    ],
    [actorName, restoreMutation.isPending, restoreTarget, purgeMutation.isPending, purgeTarget, openPurgeDialog],
  );

  const hasActiveFilters = !!(debouncedSearch || resourceTypeFilter || deletedByFilter || fromDate || toDate);

  // ── Bulk Selection Helpers (Phase 8C.5) ──────────────────────────────

  /** Selected items as { resourceType, resourceId } refs for the bulk API. */
  const bulkSelectedItems: BulkItemRef[] = useMemo(() => {
    return [...selectedIds].map((key) => {
      const sep = key.indexOf(':');
      return {
        resourceType: key.slice(0, sep) as TrashResourceType,
        resourceId: key.slice(sep + 1),
      };
    });
  }, [selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkRestore = useCallback(async () => {
    setActionError(null);
    setActionSuccess(null);
    setBulkResults(null);
    setShowFailureDetails(false);
    try {
      const result = await bulkRestoreMutation.mutateAsync(bulkSelectedItems);
      if (!result.success) {
        setActionError(result.error ?? 'Bulk restore failed.');
        return;
      }
      setBulkResults(result.data ?? null);
      setActionSuccess(
        `Bulk restore complete: ${result.data?.succeeded ?? 0} restored, ${result.data?.failed ?? 0} failed, ${result.data?.skipped ?? 0} skipped.`,
      );
      clearSelection();
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setBulkRestoreOpen(false);
      clearFeedback();
    }
  }, [bulkRestoreMutation, bulkSelectedItems, clearSelection, clearFeedback]);

  const openBulkPurgeDialog = useCallback(() => {
    setBulkReason('');
    setBulkReasonError(null);
    setBulkPurgeOpen(true);
  }, []);

  const handleBulkPurge = useCallback(async () => {
    if (!bulkReason.trim()) {
      setBulkReasonError('A delete reason is required.');
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    setBulkResults(null);
    setShowFailureDetails(false);
    try {
      const result = await bulkPurgeMutation.mutateAsync({
        items: bulkSelectedItems,
        reason: bulkReason.trim(),
      });
      if (!result.success) {
        setActionError(result.error ?? 'Bulk permanent delete failed.');
        return;
      }
      setBulkResults(result.data ?? null);
      setActionSuccess(
        `Bulk permanent delete complete: ${result.data?.succeeded ?? 0} deleted, ${result.data?.failed ?? 0} failed, ${result.data?.skipped ?? 0} skipped.`,
      );
      clearSelection();
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setBulkPurgeOpen(false);
      clearFeedback();
    }
  }, [bulkPurgeMutation, bulkSelectedItems, bulkReason, clearSelection, clearFeedback]);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <PermissionGuard
      permission="restoreDeletedData"
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
            <LockSimple size={36} className="mx-auto text-gray-400" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Access Restricted
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Only Super Admins can access the Recycle Bin.
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          title="Recycle Bin"
          description="Soft-deleted resources live here until restored. Restoring returns the item to its exact pre-delete state."
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Recycle Bin' },
          ]}
          actions={
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowsClockwise size={14} className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
          }
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {summaryCards.map((stat) => (
            <MetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value.toLocaleString()}
              icon={stat.icon}
              color={stat.color}
              loading={isLoading}
            />
          ))}
        </div>

        {/* Success Banner */}
        {actionSuccess && (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
            <CheckCircle size={18} className="text-emerald-600" weight="fill" />
            <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
              {actionSuccess}
            </span>
          </div>
        )}

        {/* Error Banner */}
        {actionError && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <XCircle size={18} className="text-red-600" weight="fill" />
            <span className="text-sm font-medium text-red-800 dark:text-red-300">
              {actionError}
            </span>
          </div>
        )}

        {/* Query Error State */}
        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
            <div className="flex items-center gap-3">
              <XCircle size={20} className="flex-shrink-0 text-red-600" weight="fill" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  Failed to load the Recycle Bin
                </p>
                <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                  {error instanceof Error ? error.message : 'An unexpected error occurred.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <SearchBar
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search deleted items..."
            className="min-w-[200px] flex-1"
          />
          <Select
            value={resourceTypeFilter}
            onChange={onFilterChange(setResourceTypeFilter)}
            options={RESOURCE_TYPE_OPTIONS}
            placeholder="All Resource Types"
            label="Type"
            className="min-w-[170px]"
          />
          <Select
            value={deletedByFilter}
            onChange={onFilterChange(setDeletedByFilter)}
            options={actorOptions}
            placeholder="All Actors"
            label="Deleted By"
            className="min-w-[160px]"
          />
          <div className="min-w-[140px]">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              From
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => onFilterChange(setFromDate)(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              To
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => onFilterChange(setToDate)(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
          <Select
            value={sortKey}
            onChange={setSortKey}
            options={SORT_OPTIONS}
            placeholder="Sort by"
            label="Sort"
            className="min-w-[200px]"
          />
        </div>

        {/* Bulk Selection Toolbar (floating — shows when items are selected) */}
        {selectedIds.size > 0 && (
          <div className="sticky top-4 z-30 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/90 px-4 py-3 shadow-lg backdrop-blur dark:border-blue-800 dark:bg-blue-950/70">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
              <Stack size={16} weight="bold" />
              {selectedIds.size} selected
            </span>
            <span className="text-xs text-blue-700/70 dark:text-blue-300/60">
              {bulkSelectedItems.length} item(s) across {new Set(bulkSelectedItems.map((i) => i.resourceType)).size} type(s)
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkRestoreOpen(true)}
                disabled={bulkRestoreMutation.isPending || bulkPurgeMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                <ArrowUUpLeft size={14} weight="bold" />
                Restore Selected
              </button>
              <button
                type="button"
                onClick={openBulkPurgeDialog}
                disabled={bulkRestoreMutation.isPending || bulkPurgeMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                <TrashSimple size={14} weight="bold" />
                Delete Forever
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkRestoreMutation.isPending || bulkPurgeMutation.isPending}
                className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-blue-900/30"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Bulk Results Summary (after a bulk operation completes) */}
        {bulkResults && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bulk results</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle size={12} weight="fill" /> Restored/Deleted: {bulkResults.succeeded}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                <XCircle size={12} weight="fill" /> Failed: {bulkResults.failed}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                Skipped: {bulkResults.skipped}
              </span>
              {bulkResults.failed > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFailureDetails((v) => !v)}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {showFailureDetails ? 'Hide' : 'View'} failures
                  <CaretDown size={12} className={showFailureDetails ? 'rotate-180' : ''} />
                </button>
              )}
            </div>
            {showFailureDetails && bulkResults.failed > 0 && (
              <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                {bulkResults.items
                  .filter((r) => r.status === 'failed')
                  .map((r) => (
                    <div key={`${r.resourceType}:${r.resourceId}`} className="flex items-start gap-2 text-xs">
                      <XCircle size={13} className="mt-0.5 flex-shrink-0 text-red-500" />
                      <div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          {RESOURCE_LABELS[r.resourceType] ?? r.resourceType} ({formatShortId(r.resourceId)})
                        </span>
                        <span className="ml-1 text-gray-500 dark:text-gray-400">{r.error}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <DataTable
          columns={columns}
          data={listData?.items ?? []}
          keyExtractor={(item) => `${item.resourceType}:${item.resourceId}`}
          onRowClick={(item) =>
            setSelected({ resourceType: item.resourceType, resourceId: item.resourceId })
          }
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          isLoading={isLoading}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={listData?.total ?? 0}
          onPageChange={setPage}
          emptyState={
            <EmptyState
              icon={<Trash size={40} weight="thin" />}
              title="No deleted items"
              description={
                hasActiveFilters
                  ? 'Try adjusting your search or filters.'
                  : 'Soft-deleted resources will appear here. Nothing has been permanently deleted.'
              }
            />
          }
        />

        {/* Restore Confirmation */}
        {restoreTarget && (
          <ConfirmDialog
            open={!!restoreTarget}
            onClose={() => {
              if (!restoreMutation.isPending) setRestoreTarget(null);
            }}
            onConfirm={() => handleRestore(restoreTarget)}
            title="Restore this item?"
            message={`"${restoreTarget.displayName ?? restoreTarget.resourceType}" will be returned to its exact pre-delete state, including its status and any related records.`}
            confirmLabel="Restore"
            cancelLabel="Cancel"
            variant="default"
            loading={restoreMutation.isPending}
          />
        )}

        {/* Bulk Restore Confirmation */}
        <ConfirmDialog
          open={bulkRestoreOpen}
          onClose={() => {
            if (!bulkRestoreMutation.isPending) setBulkRestoreOpen(false);
          }}
          onConfirm={handleBulkRestore}
          title="Restore selected items?"
          message={`${selectedIds.size} item(s) will be returned to their exact pre-delete state, including their status and related records.`}
          confirmLabel="Restore All"
          cancelLabel="Cancel"
          variant="default"
          loading={bulkRestoreMutation.isPending}
        />

        {/* Bulk Permanent Delete Confirmation (irreversible + mandatory reason) */}
        <ConfirmDialog
          open={bulkPurgeOpen}
          onClose={() => {
            if (!bulkPurgeMutation.isPending) setBulkPurgeOpen(false);
          }}
          onConfirm={handleBulkPurge}
          title="Permanently delete selected items?"
          message={`${selectedIds.size} item(s) and ALL of their files, images, and related records will be removed FOREVER. This action cannot be undone.`}
          confirmLabel="Delete Forever"
          cancelLabel="Cancel"
          variant="danger"
          loading={bulkPurgeMutation.isPending}
        >
          <div className="mt-4">
            <label
              htmlFor="bulk-purge-reason"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              Delete reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="bulk-purge-reason"
              value={bulkReason}
              onChange={(e) => {
                setBulkReason(e.target.value);
                if (bulkReasonError) setBulkReasonError(null);
              }}
              rows={2}
              placeholder="Why are these items being permanently removed? (recorded in audit log)"
              disabled={bulkPurgeMutation.isPending}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            {bulkReasonError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{bulkReasonError}</p>
            )}
          </div>
        </ConfirmDialog>

        {/* Detail Drawer */}
        {selected && (
          <TrashItemDrawer
            item={detailItem}
            isLoading={detailLoading}
            error={detailError}
            onClose={() => setSelected(null)}
            onRestore={(item) => setRestoreTarget(item)}
            onPurge={openPurgeDialog}
            actorName={actorName}
          />
        )}

        {/* Permanent Delete Confirmation (irreversible + mandatory reason) */}
        {purgeTarget && (
          <ConfirmDialog
            open={!!purgeTarget}
            onClose={() => {
              if (!purgeMutation.isPending) setPurgeTarget(null);
            }}
            onConfirm={() => handlePermanentDelete(purgeTarget)}
            title="Permanently delete this item?"
            message={`"${purgeTarget.displayName ?? purgeTarget.resourceType}" and all of its files, images, and related records will be removed FOREVER. This action cannot be undone.`}
            confirmLabel="Delete Forever"
            cancelLabel="Cancel"
            variant="danger"
            loading={purgeMutation.isPending}
          >
            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="purge-confirm-title"
                  className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  Type <span className="font-semibold text-red-600 dark:text-red-400">{(purgeTarget.displayName ?? purgeTarget.resourceId).trim()}</span> to confirm <span className="text-red-500">*</span>
                </label>
                <input
                  id="purge-confirm-title"
                  type="text"
                  value={purgeConfirmText}
                  onChange={(e) => {
                    setPurgeConfirmText(e.target.value);
                    if (purgeConfirmError) setPurgeConfirmError(null);
                  }}
                  placeholder="Type exact title to confirm"
                  disabled={purgeMutation.isPending}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                {purgeConfirmError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {purgeConfirmError}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="purge-reason"
                  className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  Delete reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="purge-reason"
                  value={purgeReason}
                  onChange={(e) => {
                    setPurgeReason(e.target.value);
                    if (purgeReasonError) setPurgeReasonError(null);
                  }}
                  rows={2}
                  placeholder="Why is this being permanently removed? (recorded in audit log)"
                  disabled={purgeMutation.isPending}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                {purgeReasonError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {purgeReasonError}
                  </p>
                )}
              </div>
            </div>
          </ConfirmDialog>
        )}
      </div>
    </PermissionGuard>
  );
}
