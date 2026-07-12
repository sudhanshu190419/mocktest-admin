'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  useTeacherLifecycleCounts,
  useTeacherList,
  useApproveTeacher,
  useRejectTeacher,
  useSuspendTeacher,
  useActivateTeacher,
  useDeactivateTeacher,
  useBulkApproveTeachers,
  useBulkRejectTeachers,
  useBulkSuspendTeachers,
  useBulkActivateTeachers,
} from '@/hooks/admin/useTeacherLifecycle';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import {
  Users,
  UserCheck,
  UserMinus,
  Prohibit,
  Power,
  Clock,
  ArrowsClockwise,
  CheckCircle,
  XCircle,
  CircleNotch,
} from '@phosphor-icons/react';
import { teacherLifecycleService, type TeacherListItem } from '@/services/admin/teacherLifecycleService';
import type { AccountStatus } from '@/types/auth';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive', label: 'Inactive' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'name_asc', label: 'Name (A-Z)' },
  { value: 'name_desc', label: 'Name (Z-A)' },
  { value: 'accountStatus_asc', label: 'Status (A-Z)' },
  { value: 'accountStatus_desc', label: 'Status (Z-A)' },
];

const DEPARTMENT_OPTIONS = [
  { value: '', label: 'All Departments' },
  { value: 'Physics & Applied Mechanics', label: 'Physics' },
  { value: 'Organic & Physical Chemistry', label: 'Chemistry' },
  { value: 'Pure & Applied Mathematics', label: 'Mathematics' },
  { value: 'Biological Sciences (NEET)', label: 'Biology' },
  { value: 'Computer Science & AI', label: 'Computer Science' },
  { value: 'General Science', label: 'General Science' },
];

const STATUS_COLOR_MAP: Record<string, 'amber' | 'emerald' | 'rose' | 'indigo' | 'gray'> = {
  pending: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  suspended: 'indigo',
  inactive: 'gray',
};

const STATUS_ICON_MAP: Record<string, React.ReactNode> = {
  pending: <Clock size={20} weight="duotone" />,
  approved: <UserCheck size={20} weight="duotone" />,
  rejected: <UserMinus size={20} weight="duotone" />,
  suspended: <Prohibit size={20} weight="duotone" />,
  inactive: <Power size={20} weight="duotone" />,
};

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

function getSortValue(sortKey: string): { sortBy: 'name' | 'createdAt' | 'accountStatus'; sortDirection: 'asc' | 'desc' } {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as any, sortDirection: dir ?? 'desc' };
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

export default function TeacherManagementPage() {
  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
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

  // ── Selection & Confirmation State ───────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject' | 'suspend' | 'activate' | 'deactivate';
    teacher: TeacherListItem | null;
    bulk?: boolean;
    status?: AccountStatus;
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

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useTeacherLifecycleCounts();

  const {
    data: teacherList,
    isLoading: listLoading,
    isError,
    error,
    refetch: refetchList,
  } = useTeacherList(
    {
      status: statusFilter || undefined,
      department: departmentFilter || undefined,
      search: debouncedSearch || undefined,
    },
    sort,
    { page, pageSize },
  );

  const isLoading = countsLoading || listLoading;

  const handleRefresh = useCallback(() => {
    refetchCounts();
    refetchList();
  }, [refetchCounts, refetchList]);

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const approveMutation = useApproveTeacher();
  const rejectMutation = useRejectTeacher();
  const suspendMutation = useSuspendTeacher();
  const activateMutation = useActivateTeacher();
  const deactivateMutation = useDeactivateTeacher();
  const bulkApproveMutation = useBulkApproveTeachers();
  const bulkRejectMutation = useBulkRejectTeachers();
  const bulkSuspendMutation = useBulkSuspendTeachers();
  const bulkActivateMutation = useBulkActivateTeachers();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (
    action: 'approve' | 'reject' | 'suspend' | 'activate' | 'deactivate',
    teacher?: TeacherListItem | null,
    bulk?: boolean,
  ) => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      if (bulk) {
        const profileIds = Array.from(selectedIds);

        // Use existing bulk mutations for supported statuses,
        // call service directly for deactivate (no dedicated hook)
        let result;
        switch (action) {
          case 'approve':
            result = await bulkApproveMutation.mutateAsync(profileIds);
            break;
          case 'reject':
            result = await bulkRejectMutation.mutateAsync(profileIds);
            break;
          case 'suspend':
            result = await bulkSuspendMutation.mutateAsync(profileIds);
            break;
          case 'activate':
            result = await bulkActivateMutation.mutateAsync(profileIds);
            break;
          default:
            // deactivate — call service directly (no dedicated hook per user's
            // instruction to use ONLY the explicitly listed hooks)
            result = await teacherLifecycleService.bulkUpdateStatus(profileIds, 'inactive');
            break;
        }

        if (!result.success) {
          setActionError(result.error ?? 'Action failed. Please try again.');
          return;
        }
        const count = profileIds.length;
        setActionSuccess(`${count} teacher${count > 1 ? 's' : ''} ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'suspend' ? 'suspended' : action === 'activate' ? 'activated' : 'deactivated'} successfully`);
        setSelectedIds(new Set());
      } else {
        const singleMutation = action === 'approve'
          ? approveMutation
          : action === 'reject'
            ? rejectMutation
            : action === 'suspend'
              ? suspendMutation
              : action === 'activate'
                ? activateMutation
                : deactivateMutation;
        const result = await singleMutation.mutateAsync(teacher!.profileId);
        if (!result.success) {
          setActionError(result.error ?? 'Action failed. Please try again.');
          return;
        }
        setActionSuccess(`${teacher!.name} ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'suspend' ? 'suspended' : action === 'activate' ? 'activated' : 'deactivated'} successfully`);
      }
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [
    selectedIds,
    approveMutation,
    rejectMutation,
    suspendMutation,
    activateMutation,
    deactivateMutation,
    bulkApproveMutation,
    bulkRejectMutation,
    bulkSuspendMutation,
    bulkActivateMutation,
    clearFeedback,
  ]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type, confirmAction.teacher, confirmAction.bulk);
  }, [confirmAction, executeAction]);

  // Determine which bulk actions are available based on selected items
  const bulkActionOptions = useMemo(() => {
    if (selectedIds.size === 0 || !teacherList?.data) return null;

    let hasPending = false;
    let hasApproved = false;
    let hasSuspended = false;
    let hasInactive = false;
    let hasRejected = false;

    for (const t of teacherList.data) {
      if (!selectedIds.has(t.profileId)) continue;
      switch (t.accountStatus) {
        case 'pending': hasPending = true; break;
        case 'approved': hasApproved = true; break;
        case 'suspended': hasSuspended = true; break;
        case 'inactive': hasInactive = true; break;
        case 'rejected': hasRejected = true; break;
      }
    }

    // Only show bulk actions if ALL selected items have the same status
    const totalFlags = [hasPending, hasApproved, hasSuspended, hasInactive, hasRejected].filter(Boolean).length;
    if (totalFlags !== 1) return null;

    if (hasPending) {
      return [
        { type: 'approve' as const, label: 'Approve Selected', variant: 'emerald' as const },
        { type: 'reject' as const, label: 'Reject Selected', variant: 'rose' as const },
      ];
    }
    if (hasApproved) {
      return [
        { type: 'suspend' as const, label: 'Suspend Selected', variant: 'indigo' as const },
        { type: 'deactivate' as const, label: 'Deactivate Selected', variant: 'gray' as const },
      ];
    }
    if (hasSuspended || hasInactive) {
      return [
        { type: 'activate' as const, label: 'Activate Selected', variant: 'emerald' as const },
      ];
    }
    return null;
  }, [selectedIds, teacherList?.data]);

  // ── Confirm Dialog Configuration ─────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type, teacher, bulk } = confirmAction;
    const name = teacher?.name ?? 'this teacher';
    const count = bulk ? selectedIds.size : 1;
    const label = bulk ? `${count} selected teacher${count > 1 ? 's' : ''}` : name;

    switch (type) {
      case 'approve':
        return {
          title: bulk ? `Approve ${count} Teachers` : 'Approve Teacher',
          message: `Are you sure you want to approve ${label}? They will gain immediate access to the teacher dashboard.`,
          confirmLabel: bulk ? `Approve ${count} Teachers` : 'Approve Teacher',
          variant: 'default' as const,
        };
      case 'reject':
        return {
          title: bulk ? `Reject ${count} Teachers` : 'Reject Teacher',
          message: `Are you sure you want to reject ${label}? They will be notified and cannot access the teacher dashboard.`,
          confirmLabel: bulk ? `Reject ${count} Teachers` : 'Reject Teacher',
          variant: 'danger' as const,
        };
      case 'suspend':
        return {
          title: bulk ? `Suspend ${count} Teachers` : 'Suspend Teacher',
          message: `Are you sure you want to suspend ${label}? They will lose access until reactivated.`,
          confirmLabel: bulk ? `Suspend ${count} Teachers` : 'Suspend Teacher',
          variant: 'warning' as const,
        };
      case 'deactivate':
        return {
          title: bulk ? `Deactivate ${count} Teachers` : 'Deactivate Teacher',
          message: `Are you sure you want to deactivate ${label}? Their profile will be set to inactive.`,
          confirmLabel: bulk ? `Deactivate ${count} Teachers` : 'Deactivate Teacher',
          variant: 'warning' as const,
        };
      case 'activate':
        return {
          title: bulk ? `Activate ${count} Teachers` : 'Activate Teacher',
          message: `Are you sure you want to activate ${label}? They will regain access to the teacher dashboard.`,
          confirmLabel: bulk ? `Activate ${count} Teachers` : 'Activate Teacher',
          variant: 'default' as const,
        };
      default:
        return null;
    }
  }, [confirmAction, selectedIds.size]);

  // ── Summary Cards ────────────────────────────────────────────────────
  const summaryCards = useMemo(() => {
    if (!counts) return [];
    return [
      { label: 'Total Teachers', value: counts.total, color: 'blue' as const, icon: <Users size={20} weight="duotone" /> },
      { label: 'Pending', value: counts.pending, color: 'amber' as const, icon: STATUS_ICON_MAP.pending },
      { label: 'Approved', value: counts.approved, color: 'emerald' as const, icon: STATUS_ICON_MAP.approved },
      { label: 'Rejected', value: counts.rejected, color: 'rose' as const, icon: STATUS_ICON_MAP.rejected },
      { label: 'Suspended', value: counts.suspended, color: 'indigo' as const, icon: STATUS_ICON_MAP.suspended },
      { label: 'Inactive', value: counts.inactive, color: 'gray' as const, icon: STATUS_ICON_MAP.inactive },
    ];
  }, [counts]);

  // ── Table Columns ────────────────────────────────────────────────────
  // Define outside component to avoid re-creation, but needs access to actions
  const columns: Column<TeacherListItem>[] = useMemo(() => [
    {
      key: 'avatar',
      header: '',
      className: 'w-10',
      render: (item) => (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[10px] font-bold text-white">
          {getInitials(item.name)}
        </div>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (item) => (
        <div>
          <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
          {item.email && (
            <p className="text-[11px] text-gray-400">{item.email}</p>
          )}
        </div>
      ),
    },
    {
      key: 'teacherId',
      header: 'Faculty ID',
      className: 'text-xs text-gray-500',
      render: (item) => (
        <span className="font-mono text-xs">{item.teacherId ? item.teacherId.slice(0, 8) : '—'}</span>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      sortable: true,
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.department ?? '—'}
        </span>
      ),
    },
    {
      key: 'accountStatus',
      header: 'Status',
      sortable: true,
      render: (item) => (
        <StatusBadge status={item.accountStatus} showDot={true} />
      ),
    },
    {
      key: 'createdAt',
      header: 'Joined',
      sortable: true,
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
          {/* View — navigates to detail page */}
          <Link
            href={`/admin/teachers/${_item.profileId}`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20"
          >
            View
          </Link>

          {/* Action buttons with loading indicators */}
          {_item.accountStatus === 'pending' && (
            <>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'approve', teacher: _item })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.teacher?.profileId === _item.profileId && confirmAction?.type === 'approve' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Approve
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'reject', teacher: _item })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
              >
                {actionLoading && confirmAction?.teacher?.profileId === _item.profileId && confirmAction?.type === 'reject' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Reject
              </button>
            </>
          )}
          {_item.accountStatus === 'approved' && (
            <>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'suspend', teacher: _item })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-40 dark:hover:bg-orange-900/20"
              >
                {actionLoading && confirmAction?.teacher?.profileId === _item.profileId && confirmAction?.type === 'suspend' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Suspend
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'deactivate', teacher: _item })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-gray-800/30"
              >
                {actionLoading && confirmAction?.teacher?.profileId === _item.profileId && confirmAction?.type === 'deactivate' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Deactivate
              </button>
            </>
          )}
          {(_item.accountStatus === 'suspended' || _item.accountStatus === 'inactive') && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'activate', teacher: _item })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
            >
              {actionLoading && confirmAction?.teacher?.profileId === _item.profileId && confirmAction?.type === 'activate' ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : null}
              Activate
            </button>
          )}
          {_item.accountStatus === 'rejected' && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'approve', teacher: _item })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
            >
              {actionLoading && confirmAction?.teacher?.profileId === _item.profileId && confirmAction?.type === 'approve' ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : null}
              Approve
            </button>
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
        title="Teacher Management"
        description="Manage teachers across their complete lifecycle."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Teacher Management' },
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
                Failed to load teacher data
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
          Filters Bar
         ════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search by name or email..."
          className="min-w-[200px] flex-1"
        />
        <Select
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          options={STATUS_OPTIONS}
          placeholder="All Statuses"
          label="Status"
          className="min-w-[150px]"
        />
        <Select
          value={departmentFilter}
          onChange={(v) => { setDepartmentFilter(v); setPage(1); }}
          options={DEPARTMENT_OPTIONS}
          placeholder="All Departments"
          label="Department"
          className="min-w-[160px]"
        />
        <Select
          value={sortKey}
          onChange={(v) => { setSortKey(v); setPage(1); }}
          options={SORT_OPTIONS}
          placeholder="Sort by"
          label="Sort"
          className="min-w-[150px]"
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Bulk Action Bar
         ════════════════════════════════════════════════════════════════ */}
      {selectedIds.size > 0 && bulkActionOptions && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {selectedIds.size} selected
          </span>
          <div className="flex flex-wrap gap-2">
            {bulkActionOptions.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() =>
                  setConfirmAction({
                    type: opt.type,
                    teacher: null,
                    bulk: true,
                  })
                }
                disabled={actionLoading}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                  opt.variant === 'emerald'
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : opt.variant === 'rose'
                      ? 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400'
                      : opt.variant === 'indigo'
                        ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800/30 dark:text-gray-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Clear selection
            </button>
          </div>
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
          Teacher Table
         ════════════════════════════════════════════════════════════════ */}
      <DataTable
        columns={columns}
        data={teacherList?.data ?? []}
        keyExtractor={(item) => item.profileId}
        isLoading={listLoading}
        emptyState={
          <EmptyState
            icon={<Users size={40} weight="thin" />}
            title="No teachers found"
            description={
              debouncedSearch || statusFilter || departmentFilter
                ? 'Try adjusting your search or filters.'
                : 'Teachers will appear here once they register.'
            }
          />
        }
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        page={page}
        pageSize={pageSize}
        totalCount={teacherList?.count ?? 0}
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
