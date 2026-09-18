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
  useCreateTeacher,
} from '@/hooks/admin/useTeacherLifecycle';
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
  UserPlus,
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

const FORM_DEPARTMENT_OPTIONS = [
  { value: 'Physics & Applied Mechanics', label: 'Physics & Applied Mechanics' },
  { value: 'Organic & Physical Chemistry', label: 'Organic & Physical Chemistry' },
  { value: 'Pure & Applied Mathematics', label: 'Pure & Applied Mathematics' },
  { value: 'Biological Sciences (NEET)', label: 'Biological Sciences (NEET)' },
  { value: 'Computer Science & AI', label: 'Computer Science & AI' },
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
  // ── Permissions ───────────────────────────────────────────────────────
  const { isSuperAdmin } = usePermissions();

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

  // ── Create Teacher State ─────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: '',
    phone: '',
    password: '',
    email: '',
    facultyId: '',
    department: '',
    designation: '',
  });
  const [createFormError, setCreateFormError] = useState<string | null>(null);

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
  const createTeacherMutation = useCreateTeacher();

  // ── Create Teacher Submission ────────────────────────────────────────
  const handleCreateSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setCreateFormError(null);

    if (!createForm.fullName.trim()) {
      setCreateFormError('Full name is required.');
      return;
    }
    if (!createForm.phone.trim()) {
      setCreateFormError('Phone number is required.');
      return;
    }
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    if (!phoneRegex.test(createForm.phone.trim())) {
      setCreateFormError('Please enter a valid phone number with country code (e.g. +919876543210).');
      return;
    }
    if (!createForm.password || createForm.password.length < 6) {
      setCreateFormError('Password must be at least 6 characters.');
      return;
    }
    if (createForm.email.trim() && !/^\S+@\S+\.\S+$/.test(createForm.email.trim())) {
      setCreateFormError('Please enter a valid email address.');
      return;
    }
    if (!createForm.facultyId.trim()) {
      setCreateFormError('Faculty ID is required.');
      return;
    }
    if (!createForm.department.trim()) {
      setCreateFormError('Department is required.');
      return;
    }

    try {
      const res = await createTeacherMutation.mutateAsync({
        fullName: createForm.fullName.trim(),
        phone: createForm.phone.trim(),
        password: createForm.password,
        email: createForm.email.trim() || undefined,
        facultyId: createForm.facultyId.trim(),
        department: createForm.department.trim(),
        designation: createForm.designation.trim() || 'Faculty',
      });

      if (!res.success) {
        setCreateFormError(res.error ?? 'Failed to create teacher account.');
        return;
      }

      setActionSuccess(`Teacher ${res.data?.fullName || createForm.fullName.trim()} created successfully.`);
      setActionError(null);
      clearFeedback();
      setCreateOpen(false);
      setCreateForm({
        fullName: '',
        phone: '',
        password: '',
        email: '',
        facultyId: '',
        department: '',
        designation: '',
      });
      setCreateFormError(null);
    } catch (err: any) {
      setCreateFormError(err?.message || 'An unexpected error occurred.');
    }
  };

  // ── Action Handlers ──────────────────────────────────────────────────
  const executeSingleAction = async (
    type: 'approve' | 'reject' | 'suspend' | 'activate' | 'deactivate',
    teacher: TeacherListItem,
  ) => {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      let result;
      switch (type) {
        case 'approve':
          result = await approveMutation.mutateAsync(teacher.profileId);
          break;
        case 'reject':
          result = await rejectMutation.mutateAsync(teacher.profileId);
          break;
        case 'suspend':
          result = await suspendMutation.mutateAsync(teacher.profileId);
          break;
        case 'activate':
          result = await activateMutation.mutateAsync(teacher.profileId);
          break;
        case 'deactivate':
          result = await deactivateMutation.mutateAsync(teacher.profileId);
          break;
      }

      if (result && !result.success) {
        setActionError(result.error ?? `Failed to ${type} teacher.`);
      } else {
        const actionLabels: Record<string, string> = {
          approve: 'approved',
          reject: 'rejected',
          suspend: 'suspended',
          activate: 'activated',
          deactivate: 'deactivated',
        };
        setActionSuccess(`Teacher "${teacher.name}" ${actionLabels[type] ?? 'updated'} successfully.`);
      }
    } catch (err: any) {
      setActionError(err?.message ?? `An error occurred while attempting to ${type} teacher.`);
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  };

  const executeBulkAction = async (type: 'approve' | 'reject' | 'suspend' | 'activate') => {
    if (selectedIds.size === 0) return;

    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    const ids = Array.from(selectedIds);

    try {
      let result;
      switch (type) {
        case 'approve':
          result = await bulkApproveMutation.mutateAsync(ids);
          break;
        case 'reject':
          result = await bulkRejectMutation.mutateAsync(ids);
          break;
        case 'suspend':
          result = await bulkSuspendMutation.mutateAsync(ids);
          break;
        case 'activate':
          result = await bulkActivateMutation.mutateAsync(ids);
          break;
      }

      if (result && !result.success) {
        setActionError(result.error ?? `Bulk ${type} operation failed.`);
      } else {
        const actionLabels: Record<string, string> = {
          approve: 'approved',
          reject: 'rejected',
          suspend: 'suspended',
          activate: 'activated',
        };
        setActionSuccess(`${ids.length} teachers ${actionLabels[type] ?? 'updated'} successfully.`);
        setSelectedIds(new Set());
      }
    } catch (err: any) {
      setActionError(err?.message ?? `An error occurred during bulk ${type}.`);
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  };

  const handleConfirm = () => {
    if (!confirmAction) return;

    if (confirmAction.bulk) {
      executeBulkAction(confirmAction.type as 'approve' | 'reject' | 'suspend' | 'activate');
    } else if (confirmAction.teacher) {
      executeSingleAction(confirmAction.type, confirmAction.teacher);
    }
  };

  // ── Confirmation Dialog Config ───────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;

    const { type, teacher, bulk } = confirmAction;
    const count = bulk ? selectedIds.size : 1;
    const name = teacher ? teacher.name : `${count} teachers`;

    switch (type) {
      case 'approve':
        return {
          title: bulk ? `Approve ${count} Teachers?` : `Approve ${name}?`,
          message: bulk
            ? `Are you sure you want to approve ${count} selected teachers? They will be granted full access to the portal.`
            : `Are you sure you want to approve ${name}? They will be able to log in and access faculty features.`,
          confirmLabel: 'Approve',
          variant: 'default' as const,
        };
      case 'reject':
        return {
          title: bulk ? `Reject ${count} Teachers?` : `Reject ${name}?`,
          message: bulk
            ? `Are you sure you want to reject ${count} selected teachers? Their accounts will be marked as rejected.`
            : `Are you sure you want to reject ${name}? They will not be able to access the portal.`,
          confirmLabel: 'Reject',
          variant: 'danger' as const,
        };
      case 'suspend':
        return {
          title: bulk ? `Suspend ${count} Teachers?` : `Suspend ${name}?`,
          message: bulk
            ? `Are you sure you want to suspend ${count} selected teachers? Their access will be temporarily revoked.`
            : `Are you sure you want to suspend ${name}? They will temporarily lose access to the portal.`,
          confirmLabel: 'Suspend',
          variant: 'danger' as const,
        };
      case 'activate':
        return {
          title: bulk ? `Activate ${count} Teachers?` : `Activate ${name}?`,
          message: bulk
            ? `Are you sure you want to activate ${count} selected teachers? Their full access will be restored.`
            : `Are you sure you want to activate ${name}? Their portal access will be restored.`,
          confirmLabel: 'Activate',
          variant: 'default' as const,
        };
      case 'deactivate':
        return {
          title: `Deactivate ${name}?`,
          message: `Are you sure you want to deactivate ${name}? Their account will be set to inactive.`,
          confirmLabel: 'Deactivate',
          variant: 'danger' as const,
        };
      default:
        return null;
    }
  }, [confirmAction, selectedIds.size]);

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<TeacherListItem>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Teacher',
        render: (item) => (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {getInitials(item.name)}
            </div>
            <div className="min-w-0">
              <Link
                href={`/admin/teachers/${item.profileId}`}
                className="font-medium text-gray-900 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
              >
                {item.name}
              </Link>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {item.email || item.phone || 'No contact info'}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: 'department',
        header: 'Department',
        render: (item) => (
          <div className="text-sm text-gray-700 dark:text-gray-300">
            {item.department || '—'}
            {item.designation && (
              <span className="block text-xs text-gray-400 dark:text-gray-500">
                {item.designation}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'accountStatus',
        header: 'Status',
        render: (item) => (
          <StatusBadge status={item.accountStatus} />
        ),
      },
      {
        key: 'createdAt',
        header: 'Registered',
        render: (item) => (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span>{formatDate(item.createdAt)}</span>
            <span className="block text-xs text-gray-400 dark:text-gray-500">
              {formatTimeAgo(item.createdAt)}
            </span>
          </div>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (item) => {
          const { accountStatus } = item;

          return (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {accountStatus === 'pending' && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmAction({
                        type: 'approve',
                        teacher: item,
                        status: 'approved',
                      })
                    }
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                    title="Approve registration"
                  >
                    <UserCheck size={14} weight="bold" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmAction({
                        type: 'reject',
                        teacher: item,
                        status: 'rejected',
                      })
                    }
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50"
                    title="Reject registration"
                  >
                    <UserMinus size={14} weight="bold" />
                    Reject
                  </button>
                </>
              )}

              {accountStatus === 'approved' && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmAction({
                        type: 'suspend',
                        teacher: item,
                        status: 'suspended',
                      })
                    }
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-40 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
                    title="Suspend account"
                  >
                    <Prohibit size={14} weight="bold" />
                    Suspend
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmAction({
                        type: 'deactivate',
                        teacher: item,
                        status: 'inactive',
                      })
                    }
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="Deactivate account"
                  >
                    <Power size={14} weight="bold" />
                    Deactivate
                  </button>
                </>
              )}

              {accountStatus === 'suspended' && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({
                      type: 'activate',
                      teacher: item,
                      status: 'approved',
                    })
                  }
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                  title="Reactivate account"
                >
                  <UserCheck size={14} weight="bold" />
                  Reactivate
                </button>
              )}

              {accountStatus === 'inactive' && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({
                      type: 'activate',
                      teacher: item,
                      status: 'approved',
                    })
                  }
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                  title="Re-enable account"
                >
                  <Power size={14} weight="bold" />
                  Activate
                </button>
              )}

              {accountStatus === 'rejected' && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({
                      type: 'activate',
                      teacher: item,
                      status: 'approved',
                    })
                  }
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                  title="Reconsider & approve"
                >
                  <UserCheck size={14} weight="bold" />
                  Approve
                </button>
              )}

              <Link
                href={`/admin/teachers/${item.profileId}`}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                View
              </Link>
            </div>
          );
        },
      },
    ],
    [actionLoading],
  );

  // ── Summary Cards Data ───────────────────────────────────────────────
  const summaryCards = useMemo(
    () => [
      {
        label: 'Total Teachers',
        value: counts?.total ?? 0,
        icon: <Users size={20} weight="duotone" />,
        color: 'gray' as const,
      },
      {
        label: 'Pending Approval',
        value: counts?.pending ?? 0,
        icon: <Clock size={20} weight="duotone" />,
        color: 'amber' as const,
      },
      {
        label: 'Approved',
        value: counts?.approved ?? 0,
        icon: <UserCheck size={20} weight="duotone" />,
        color: 'emerald' as const,
      },
      {
        label: 'Suspended',
        value: counts?.suspended ?? 0,
        icon: <Prohibit size={20} weight="duotone" />,
        color: 'indigo' as const,
      },
      {
        label: 'Inactive',
        value: counts?.inactive ?? 0,
        icon: <Power size={20} weight="duotone" />,
        color: 'gray' as const,
      },
      {
        label: 'Rejected',
        value: counts?.rejected ?? 0,
        icon: <UserMinus size={20} weight="duotone" />,
        color: 'rose' as const,
      },
    ],
    [counts],
  );

  // ── Bulk Actions Available for Current Selection ─────────────────────
  const bulkActionOptions = useMemo(() => {
    if (selectedIds.size === 0) return null;

    return [
      { type: 'approve' as const, label: 'Approve Selected', variant: 'emerald' },
      { type: 'reject' as const, label: 'Reject Selected', variant: 'rose' },
      { type: 'suspend' as const, label: 'Suspend Selected', variant: 'indigo' },
      { type: 'activate' as const, label: 'Activate Selected', variant: 'emerald' },
    ];
  }, [selectedIds.size]);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title="Teacher Management"
        description="Review teacher registrations, manage approvals, and oversee faculty access."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Teachers' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => {
                  setCreateForm({
                    fullName: '',
                    phone: '',
                    password: '',
                    email: '',
                    facultyId: '',
                    department: '',
                    designation: '',
                  });
                  setCreateFormError(null);
                  setCreateOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-purple-700 dark:bg-purple-600 dark:hover:bg-purple-500"
              >
                <UserPlus size={16} weight="bold" />
                Add Teacher
              </button>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              title="Refresh teacher list"
            >
              <ArrowsClockwise
                size={16}
                className={isLoading ? 'animate-spin' : ''}
              />
              Refresh
            </button>
          </div>
        }
      />

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

      {/* ════════════════════════════════════════════════════════════════
          Create Teacher Modal (Super Admin Only)
         ════════════════════════════════════════════════════════════════ */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              if (!createTeacherMutation.isPending) setCreateOpen(false);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="pb-3 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Add Teacher
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Creates the authentication account, profile, and teacher details with approved access in one step. The teacher can log in immediately.
              </p>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, fullName: e.target.value }))}
                  placeholder="e.g. Dr. Ramesh Gupta"
                  disabled={createTeacherMutation.isPending}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Phone (with country code) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={createForm.phone}
                    onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+919876543210"
                    disabled={createTeacherMutation.isPending}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Email (optional)
                  </label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="ramesh@institute.com"
                    disabled={createTeacherMutation.isPending}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Password (min 6 characters) *
                </label>
                <input
                  type="password"
                  required
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  disabled={createTeacherMutation.isPending}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Faculty ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.facultyId}
                    onChange={(e) => setCreateForm((f) => ({ ...f, facultyId: e.target.value }))}
                    placeholder="e.g. FAC-PHY-001"
                    disabled={createTeacherMutation.isPending}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Designation (optional)
                  </label>
                  <input
                    type="text"
                    value={createForm.designation}
                    onChange={(e) => setCreateForm((f) => ({ ...f, designation: e.target.value }))}
                    placeholder="e.g. Senior Faculty"
                    disabled={createTeacherMutation.isPending}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Department *
                </label>
                <Select
                  value={createForm.department}
                  onChange={(v) => setCreateForm((f) => ({ ...f, department: v }))}
                  options={FORM_DEPARTMENT_OPTIONS}
                  placeholder="Select department"
                  className="w-full"
                />
              </div>

              {createFormError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                  <XCircle size={16} className="mt-0.5 flex-shrink-0 text-red-600" weight="fill" />
                  <p className="text-xs font-medium text-red-700 dark:text-red-300">{createFormError}</p>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={createTeacherMutation.isPending}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createTeacherMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                  {createTeacherMutation.isPending ? (
                    <CircleNotch size={14} className="animate-spin" />
                  ) : (
                    <UserPlus size={14} weight="bold" />
                  )}
                  {createTeacherMutation.isPending ? 'Creating...' : 'Create Teacher'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
