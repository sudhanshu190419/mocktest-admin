'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { PermissionGuard } from '@/components/admin/PermissionGuard';
import { useAuth } from '@/context/AuthContext';
import {
  useAdminUsers,
  useCreateAdmin,
  useSuspendAdminRole,
  useReactivateAdminRole,
  useRevokeAdminRole,
} from '@/hooks/admin/useAdminManagement';
import type {
  AdminUser,
  AdminRole,
  AdminAccessStatus,
  CreateAdminInput,
} from '@/types/adminRoles';
import {
  UsersThree,
  UserPlus,
  Prohibit,
  ArrowsClockwise,
  CheckCircle,
  XCircle,
  CircleNotch,
  ShieldCheck,
  LockSimple,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const ROLE_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'academic_admin', label: 'Academic Admin' },
  { value: 'finance_admin', label: 'Finance Admin' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'revoked', label: 'Revoked' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'recently-updated', label: 'Recently Updated' },
];

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  academic_admin: 'Academic Admin',
  finance_admin: 'Finance Admin',
};

const STATUS_LABELS: Record<AdminAccessStatus, string> = {
  approved: 'Approved',
  pending: 'Pending',
  suspended: 'Suspended',
  revoked: 'Revoked',
};

const ROLE_CHIP_CLASSES: Record<AdminRole, string> = {
  super_admin:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  academic_admin:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  finance_admin:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

const STATUS_CHIP_CLASSES: Record<AdminAccessStatus, string> = {
  approved:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  pending:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  suspended:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  revoked:
    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(isoString: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Most recent updated_at across all role assignments. */
function lastUpdatedAt(user: AdminUser): number {
  let max = new Date(user.createdAt).getTime();
  for (const role of user.roles) {
    const t = new Date(role.updatedAt).getTime();
    if (t > max) max = t;
  }
  return max;
}

/** Most recent access_granted_at across all role assignments. */
function lastGrantedOn(user: AdminUser): string | null {
  let latest: string | null = null;
  for (const role of user.roles) {
    if (role.accessGrantedAt && (!latest || role.accessGrantedAt > latest)) {
      latest = role.accessGrantedAt;
    }
  }
  return latest;
}

type ConfirmAction = {
  type: 'suspend' | 'reactivate' | 'revoke';
  adminRoleId: string;
  adminName: string;
  roleLabel: string;
};

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminManagementPage() {
  const { teacherProfile, instituteId } = useAuth();
  const currentUserId = teacherProfile?.id ?? null;

  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('newest');

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(value), 400);
  }, []);

  // ── Feedback State (toast pattern from admin batches subjects page) ──
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Create Admin Dialog State ────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    email: string;
    phone: string;
    password: string;
    adminRole: Exclude<AdminRole, 'super_admin'>;
  }>({ name: '', email: '', phone: '', password: '', adminRole: 'academic_admin' });
  const [formError, setFormError] = useState<string | null>(null);

  // ── Confirmation Dialog State ────────────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);

  // ── Data Fetching ────────────────────────────────────────────────────
  const { data: users, isLoading, isError, error, refetch } = useAdminUsers(
    instituteId,
    debouncedSearch || undefined,
  );

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const createAdminMutation = useCreateAdmin();
  const suspendMutation = useSuspendAdminRole();
  const reactivateMutation = useReactivateAdminRole();
  const revokeMutation = useRevokeAdminRole();

  // ── Filtered + Sorted List (client-side) ─────────────────────────────
  const visibleUsers = useMemo(() => {
    let list = users ?? [];

    if (roleFilter !== 'all') {
      list = list.filter((u) =>
        u.roles.some((r) => r.adminRole === (roleFilter as AdminRole)),
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter((u) =>
        u.roles.some((r) => r.accessStatus === (statusFilter as AdminAccessStatus)),
      );
    }

    const sorted = [...list];
    switch (sortKey) {
      case 'oldest':
        sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case 'recently-updated':
        sorted.sort((a, b) => lastUpdatedAt(b) - lastUpdatedAt(a));
        break;
      default: // newest
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return sorted;
  }, [users, roleFilter, statusFilter, sortKey]);

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(
    (action: ConfirmAction) => {
      setPendingRoleId(action.adminRoleId);

      const run = async () => {
        const mutation =
          action.type === 'suspend'
            ? suspendMutation
            : action.type === 'reactivate'
              ? reactivateMutation
              : revokeMutation;

        const result = await mutation.mutateAsync(action.adminRoleId);
        if (result.success) {
          const verb =
            action.type === 'suspend'
              ? 'suspended'
              : action.type === 'reactivate'
                ? 'reactivated'
                : 'revoked';
          showToast(`"${action.adminName}" (${action.roleLabel}) ${verb} successfully.`, 'success');
        } else {
          showToast(result.error ?? `Failed to ${action.type} admin role.`, 'error');
        }
        setConfirmAction(null);
        setPendingRoleId(null);
      };

      run().catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : 'An unexpected error occurred.', 'error');
        setConfirmAction(null);
        setPendingRoleId(null);
      });
    },
    [suspendMutation, reactivateMutation, revokeMutation, showToast],
  );

  // ── Create Admin Submit ──────────────────────────────────────────────
  const handleCreateSubmit = useCallback(() => {
    setFormError(null);

    if (!form.name.trim()) {
      setFormError('Full name is required.');
      return;
    }
    if (!form.phone.trim()) {
      setFormError('Phone number is required.');
      return;
    }
    if (!/^\+[1-9]\d{6,14}$/.test(form.phone.trim())) {
      setFormError('Enter a valid phone with country code (e.g. +919876543210).');
      return;
    }
    if (form.password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }

    const payload: CreateAdminInput = {
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim(),
      password: form.password,
      adminRole: form.adminRole,
    };

    createAdminMutation.mutate(payload, {
      onSuccess: (result) => {
        if (result.success) {
          showToast(`Admin "${payload.name}" created successfully.`, 'success');
          setCreateOpen(false);
          setForm({ name: '', email: '', phone: '', password: '', adminRole: 'academic_admin' });
        } else {
          setFormError(result.error ?? 'Failed to create admin.');
        }
      },
      onError: (err) => {
        setFormError(err.message);
      },
    });
  }, [form, createAdminMutation, showToast]);

  // ── Confirm Dialog Configuration ────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type, adminName, roleLabel } = confirmAction;
    switch (type) {
      case 'suspend':
        return {
          title: 'Suspend Admin',
          message: `Are you sure you want to suspend "${adminName}" (${roleLabel})? They will lose all admin permissions until reactivated.`,
          confirmLabel: 'Suspend Admin',
          variant: 'warning' as const,
        };
      case 'reactivate':
        return {
          title: 'Reactivate Admin',
          message: `Are you sure you want to reactivate "${adminName}" (${roleLabel})? Their permissions will be restored immediately.`,
          confirmLabel: 'Reactivate',
          variant: 'default' as const,
        };
      case 'revoke':
        return {
          title: 'Revoke Admin',
          message: `Are you sure you want to revoke "${adminName}" (${roleLabel})? The profile is preserved but this role's access is permanently removed.`,
          confirmLabel: 'Revoke Role',
          variant: 'danger' as const,
        };
      default:
        return null;
    }
  }, [confirmAction]);

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<AdminUser>[] = useMemo(
    () => [
      {
        key: 'avatar',
        header: '',
        className: 'w-10',
        render: (item) => (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-[10px] font-bold text-white">
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
            {!item.isActive && (
              <p className="text-[11px] text-gray-400">Inactive account</p>
            )}
          </div>
        ),
      },
      {
        key: 'email',
        header: 'Email',
        render: (item) => (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {item.email || '—'}
          </span>
        ),
      },
      {
        key: 'phone',
        header: 'Phone',
        render: (item) => (
          <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
            {item.phone ?? '—'}
          </span>
        ),
      },
      {
        key: 'roles',
        header: 'Admin Role',
        render: (item) => (
          <div className="flex flex-col gap-1">
            {item.roles.length === 0 && (
              <span className="text-xs text-gray-400">No roles</span>
            )}
            {item.roles.map((role) => (
              <span
                key={role.adminRoleId}
                className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${ROLE_CHIP_CLASSES[role.adminRole]}`}
              >
                <ShieldCheck size={11} weight="fill" />
                {ROLE_LABELS[role.adminRole]}
              </span>
            ))}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Access Status',
        render: (item) => (
          <div className="flex flex-col gap-1">
            {item.roles.map((role) => (
              <span
                key={role.adminRoleId}
                className={`inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP_CLASSES[role.accessStatus]}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {STATUS_LABELS[role.accessStatus]}
              </span>
            ))}
          </div>
        ),
      },
      {
        key: 'instituteName',
        header: 'Institute',
        render: (item) => (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {item.instituteName ?? '—'}
          </span>
        ),
      },
      {
        key: 'grantedByName',
        header: 'Granted By',
        render: (item) => (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {item.grantedByName ?? 'System backfill'}
          </span>
        ),
      },
      {
        key: 'grantedOn',
        header: 'Granted On',
        render: (item) => (
          <span className="text-xs text-gray-500">{formatDate(lastGrantedOn(item))}</span>
        ),
      },
      {
        key: 'lastUpdated',
        header: 'Last Updated',
        render: (item) => (
          <span className="text-xs text-gray-500">
            {formatDate(new Date(lastUpdatedAt(item)).toISOString())}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        className: 'w-44',
        render: (item) => (
          <div className="flex flex-col gap-1">
            {item.roles.length === 0 && <span className="text-xs text-gray-400">—</span>}
            {item.roles.map((role) => {
              const isSelfSuperAdmin =
                role.profileId === currentUserId && role.adminRole === 'super_admin';
              const busy = pendingRoleId === role.adminRoleId;

              return (
                <div key={role.adminRoleId} className="flex items-center gap-1">
                  {role.accessStatus === 'approved' && (
                    <button
                      type="button"
                      disabled={busy || isSelfSuperAdmin}
                      title={
                        isSelfSuperAdmin
                          ? 'You cannot modify your own super admin role'
                          : 'Suspend this admin role'
                      }
                      onClick={() =>
                        setConfirmAction({
                          type: 'suspend',
                          adminRoleId: role.adminRoleId,
                          adminName: item.name,
                          roleLabel: ROLE_LABELS[role.adminRole],
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-orange-400 dark:hover:bg-orange-900/20"
                    >
                      {busy ? <CircleNotch size={10} className="animate-spin" /> : <Prohibit size={10} />}
                      Suspend
                    </button>
                  )}
                  {(role.accessStatus === 'suspended' || role.accessStatus === 'pending') && (
                    <button
                      type="button"
                      disabled={busy || isSelfSuperAdmin}
                      onClick={() =>
                        setConfirmAction({
                          type: 'reactivate',
                          adminRoleId: role.adminRoleId,
                          adminName: item.name,
                          roleLabel: ROLE_LABELS[role.adminRole],
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                    >
                      {busy ? <CircleNotch size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                      {role.accessStatus === 'pending' ? 'Approve' : 'Reactivate'}
                    </button>
                  )}
                  {role.accessStatus !== 'revoked' && (
                    <button
                      type="button"
                      disabled={busy || isSelfSuperAdmin}
                      onClick={() =>
                        setConfirmAction({
                          type: 'revoke',
                          adminRoleId: role.adminRoleId,
                          adminName: item.name,
                          roleLabel: ROLE_LABELS[role.adminRole],
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-900/20"
                    >
                      {busy ? <CircleNotch size={10} className="animate-spin" /> : <XCircle size={10} />}
                      Revoke
                    </button>
                  )}
                  {isSelfSuperAdmin && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] text-gray-400"
                      title="Your own active super admin role cannot be modified here"
                    >
                      <LockSimple size={10} /> You
                    </span>
                  )}
                  {role.accessStatus === 'revoked' && !isSelfSuperAdmin && (
                    <span className="text-[11px] text-gray-400">—</span>
                  )}
                </div>
              );
            })}
          </div>
        ),
      },
    ],
    [currentUserId, pendingRoleId],
  );

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <PermissionGuard
      permission="manageAdmins"
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
            <LockSimple size={36} className="mx-auto text-gray-400" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Access Restricted
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Only Super Admins can manage administrator accounts.
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          title="Admin Management"
          description="View and manage administrator accounts across your institute."
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Admin Management' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ArrowsClockwise size={14} className={isLoading ? 'animate-spin' : ''} />
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setCreateOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-purple-700"
              >
                <UserPlus size={14} weight="bold" />
                Create Admin
              </button>
            </div>
          }
        />

        {/* Error State */}
        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
            <div className="flex items-center gap-3">
              <XCircle size={20} className="flex-shrink-0 text-red-600" weight="fill" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  Failed to load admin users
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

        {/* Filters Bar */}
        <div className="flex flex-wrap items-end gap-3">
          <SearchBar
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search by name, email or phone..."
            className="min-w-[200px] flex-1"
          />
          <Select
            value={roleFilter}
            onChange={setRoleFilter}
            options={ROLE_OPTIONS}
            placeholder="All Roles"
            label="Role"
            className="min-w-[150px]"
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
            placeholder="All Statuses"
            label="Status"
            className="min-w-[150px]"
          />
          <Select
            value={sortKey}
            onChange={setSortKey}
            options={SORT_OPTIONS}
            placeholder="Sort by"
            label="Sort"
            className="min-w-[150px]"
          />
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-xl ${
              toast.type === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle size={18} weight="fill" />
            ) : (
              <XCircle size={18} weight="fill" />
            )}
            {toast.message}
          </div>
        )}

        {/* Table */}
        <DataTable
          columns={columns}
          data={visibleUsers}
          keyExtractor={(item) => item.profileId}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              icon={<UsersThree size={40} weight="thin" />}
              title="No admins found"
              description={
                debouncedSearch || roleFilter !== 'all' || statusFilter !== 'all'
                  ? 'Try adjusting your search or filters.'
                  : 'Admins will appear here once created.'
              }
            />
          }
        />

        {/* Confirmation Dialog */}
        {confirmDialogConfig && (
          <ConfirmDialog
            open={!!confirmAction}
            onClose={() => {
              if (!pendingRoleId) setConfirmAction(null);
            }}
            onConfirm={() => confirmAction && executeAction(confirmAction)}
            title={confirmDialogConfig.title}
            message={confirmDialogConfig.message}
            confirmLabel={confirmDialogConfig.confirmLabel}
            variant={confirmDialogConfig.variant}
            loading={!!pendingRoleId}
          />
        )}

        {/* Create Admin Dialog */}
        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => {
                if (!createAdminMutation.isPending) setCreateOpen(false);
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            >
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Create Admin
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Creates the authentication account, profile and an approved admin role in one
                step. The account is immediately usable with phone-first login — no OTP needed.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Priya Sharma"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="priya@institute.com"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Phone (with country code) *
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+919876543210"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Password (min 6 characters) *
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Admin Role *
                  </label>
                  <Select
                    value={form.adminRole}
                    onChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        adminRole: v as Exclude<AdminRole, 'super_admin'>,
                      }))
                    }
                    options={[
                      { value: 'academic_admin', label: 'Academic Admin' },
                      { value: 'finance_admin', label: 'Finance Admin' },
                    ]}
                    placeholder="Select role"
                    className="w-full"
                  />
                </div>

                {formError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                    <XCircle size={16} className="mt-0.5 flex-shrink-0 text-red-600" weight="fill" />
                    <p className="text-xs font-medium text-red-700 dark:text-red-300">{formError}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={createAdminMutation.isPending}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateSubmit}
                  disabled={createAdminMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                  {createAdminMutation.isPending ? (
                    <CircleNotch size={14} className="animate-spin" />
                  ) : (
                    <UserPlus size={14} weight="bold" />
                  )}
                  {createAdminMutation.isPending ? 'Creating...' : 'Create Admin'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}
