'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { PermissionGuard } from '@/components/admin/PermissionGuard';
import { AuditSummaryCards } from '@/components/admin/audit/AuditSummaryCards';
import { AuditActionBadge } from '@/components/admin/audit/AuditActionBadge';
import { AuditDetailDrawer } from '@/components/admin/audit/AuditDetailDrawer';
import { useAuditLogs, useAuditLogSummary, useAuditLogDetail } from '@/hooks/admin/useAuditLogs';
import { useAdminUsers } from '@/hooks/admin/useAdminManagement';
import type { AuditLogEntry } from '@/services/admin/auditLogService';
import { useAuth } from '@/context/AuthContext';
import {
  ListMagnifyingGlass,
  ArrowsClockwise,
  LockSimple,
  XCircle,
  Eye,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Filterable action list. Values mirror the audit_action_type enum. */
const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'soft_delete', label: 'Soft Delete' },
  { value: 'restore', label: 'Restore' },
  { value: 'publish', label: 'Publish' },
  { value: 'unpublish', label: 'Unpublish' },
  { value: 'approve', label: 'Approve' },
  { value: 'reject', label: 'Reject' },
  { value: 'grant', label: 'Grant' },
  { value: 'revoke', label: 'Revoke' },
  { value: 'suspend', label: 'Suspend' },
  { value: 'reactivate', label: 'Reactivate' },
  { value: 'assign', label: 'Assign' },
  { value: 'unassign', label: 'Unassign' },
  { value: 'submit', label: 'Submit' },
  { value: 'archive', label: 'Archive' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
];

/** Resource type filter options — common audited entities. */
const RESOURCE_OPTIONS = [
  { value: '', label: 'All Resources' },
  { value: 'admin_roles', label: 'Admin Roles' },
  { value: 'profiles', label: 'Profiles' },
  { value: 'questions', label: 'Questions' },
  { value: 'mock_tests', label: 'Mock Tests' },
  { value: 'content', label: 'Content' },
  { value: 'batch_subjects', label: 'Batch Subjects' },
  { value: 'batch_subject_teachers', label: 'Subject Teachers' },
  { value: 'batch_subject_mock_tests', label: 'Subject Mock Tests' },
  { value: 'batch_subject_contents', label: 'Subject Content' },
  { value: 'batch_subject_recordings', label: 'Subject Recordings' },
  { value: 'recordings', label: 'Recordings' },
  { value: 'approval_requests', label: 'Approval Requests' },
];

const OUTCOME_OPTIONS = [
  { value: '', label: 'All Outcomes' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
];

const PAGE_SIZE = 20;

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

function formatResourceLabel(resourceType: string): string {
  return resourceType.replace(/_/g, ' ');
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AuditLogsPage() {
  const { instituteId } = useAuth();

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortKey, setSortKey] = useState('newest');
  const [page, setPage] = useState(1);

  // ── Detail Drawer State ──────────────────────────────────────────────
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // ── Debounced search (avoid query on every keystroke) ────────────────
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  }, []);

  // ── Data Fetching ────────────────────────────────────────────────────
  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      action: actionFilter || undefined,
      resourceType: resourceFilter || undefined,
      outcome: outcomeFilter || undefined,
      profileId: actorFilter || undefined,
      fromDate: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
      toDate: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
    }),
    [debouncedSearch, actionFilter, resourceFilter, outcomeFilter, actorFilter, fromDate, toDate],
  );

  const sort = useMemo(
    () => ({ sortDirection: sortKey === 'oldest' ? ('asc' as const) : ('desc' as const) }),
    [sortKey],
  );

  const pagination = useMemo(() => ({ page, pageSize: PAGE_SIZE }), [page]);

  const { data: listData, isLoading, isError, error, refetch } = useAuditLogs(
    instituteId,
    filters,
    sort,
    pagination,
  );
  const { data: summary } = useAuditLogSummary(instituteId);
  const { data: detailEntry, isLoading: detailLoading } = useAuditLogDetail(selectedLogId);

  // Actor options for the "performed by" filter (admin users of the institute).
  const { data: adminUsers } = useAdminUsers(instituteId, undefined);
  const actorOptions = useMemo(
    () => [
      { value: '', label: 'All Actors' },
      ...(adminUsers ?? []).map((u) => ({ value: u.profileId, label: u.name })),
    ],
    [adminUsers],
  );

  // Reset to page 1 whenever a filter changes.
  const resetToPageOne = useCallback(() => setPage(1), []);
  const onFilterChange = useCallback(
    (setter: (v: string) => void) => (v: string) => {
      setter(v);
      resetToPageOne();
    },
    [resetToPageOne],
  );

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<AuditLogEntry>[] = useMemo(
    () => [
      {
        key: 'performedAt',
        header: 'Time',
        className: 'w-40',
        render: (item) => (
          <span className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
            {formatDateTime(item.performedAt)}
          </span>
        ),
      },
      {
        key: 'action',
        header: 'Action',
        render: (item) => <AuditActionBadge action={item.action} />,
      },
      {
        key: 'resourceType',
        header: 'Resource',
        render: (item) => (
          <div className="max-w-[180px]">
            <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
              {formatResourceLabel(item.resourceType)}
            </p>
            {item.resourceId && (
              <p className="font-mono text-[10px] text-gray-400">
                {formatShortId(item.resourceId)}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'actor',
        header: 'Performed By',
        render: (item) => (
          <div className="flex items-center gap-2">
            {item.actorName ? (
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-[9px] font-bold text-white">
                {getInitials(item.actorName)}
              </div>
            ) : (
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-[9px] font-bold text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                S
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                {item.actorName ?? 'System'}
              </p>
              {item.actorRoleDisplay && (
                <p className="text-[10px] text-gray-400">{item.actorRoleDisplay}</p>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'outcome',
        header: 'Outcome',
        render: (item) => (
          <span
            className={
              item.outcome === 'failure'
                ? 'inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            }
          >
            <span
              className={
                item.outcome === 'failure'
                  ? 'h-1.5 w-1.5 rounded-full bg-red-500'
                  : 'h-1.5 w-1.5 rounded-full bg-emerald-500'
              }
            />
            {item.outcome === 'failure' ? 'Failure' : 'Success'}
          </span>
        ),
      },
      {
        key: 'instituteName',
        header: 'Institute',
        render: (item) => (
          <span className="max-w-[140px] truncate text-xs text-gray-600 dark:text-gray-400">
            {item.instituteName ?? '—'}
          </span>
        ),
      },
      {
        key: 'view',
        header: '',
        className: 'w-14',
        render: () => (
          <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20">
            <Eye size={12} />
            View
          </span>
        ),
      },
    ],
    [],
  );

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <PermissionGuard
      permission="viewAuditLogs"
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
            <LockSimple size={36} className="mx-auto text-gray-400" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Access Restricted
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Only Super Admins can view audit logs.
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          title="Audit Logs"
          description="Browse every recorded action across the platform. Logs are immutable and read-only."
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Audit Logs' },
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
        <AuditSummaryCards data={summary} />

        {/* Error State */}
        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
            <div className="flex items-center gap-3">
              <XCircle size={20} className="flex-shrink-0 text-red-600" weight="fill" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  Failed to load audit logs
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
            placeholder="Search resource, ID or metadata..."
            className="min-w-[200px] flex-1"
          />
          <Select
            value={actionFilter}
            onChange={onFilterChange(setActionFilter)}
            options={ACTION_OPTIONS}
            placeholder="All Actions"
            label="Action"
            className="min-w-[150px]"
          />
          <Select
            value={resourceFilter}
            onChange={onFilterChange(setResourceFilter)}
            options={RESOURCE_OPTIONS}
            placeholder="All Resources"
            label="Resource"
            className="min-w-[160px]"
          />
          <Select
            value={outcomeFilter}
            onChange={onFilterChange(setOutcomeFilter)}
            options={OUTCOME_OPTIONS}
            placeholder="All Outcomes"
            label="Outcome"
            className="min-w-[140px]"
          />
          <Select
            value={actorFilter}
            onChange={onFilterChange(setActorFilter)}
            options={actorOptions}
            placeholder="All Actors"
            label="Performed By"
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
            className="min-w-[150px]"
          />
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={listData?.data ?? []}
          keyExtractor={(item) => item.logId}
          onRowClick={(item) => setSelectedLogId(item.logId)}
          isLoading={isLoading}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={listData?.count ?? 0}
          onPageChange={setPage}
          emptyState={
            <EmptyState
              icon={<ListMagnifyingGlass size={40} weight="thin" />}
              title="No audit events found"
              description={
                debouncedSearch ||
                actionFilter ||
                resourceFilter ||
                outcomeFilter ||
                actorFilter ||
                fromDate ||
                toDate
                  ? 'Try adjusting your search or filters.'
                  : 'Audit events will appear here as actions are performed across the platform.'
              }
            />
          }
        />

        {/* Detail Drawer */}
        {selectedLogId && (
          <AuditDetailDrawer
            entry={detailEntry}
            isLoading={detailLoading}
            onClose={() => setSelectedLogId(null)}
          />
        )}
      </div>
    </PermissionGuard>
  );
}
