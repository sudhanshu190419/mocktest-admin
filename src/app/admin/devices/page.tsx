'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchBar } from '@/components/ui/SearchBar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PermissionGuard } from '@/components/admin/PermissionGuard';
import {
  usePendingDevices,
  useApprovedDevices,
  useApproveDevice,
  useRejectDevice,
  useRevokeDevice,
} from '@/hooks/admin/useTrustedDevices';
import { useAdminUsers } from '@/hooks/admin/useAdminManagement';
import type { TrustedDevice } from '@/services/security/trustedDeviceService';
import type { AdminUser } from '@/types/adminRoles';
import { useAuth } from '@/context/AuthContext';
import {
  Devices,
  DeviceMobile,
  LockSimple,
  CheckCircle,
  XCircle,
  Prohibit,
  ArrowsClockwise,
  Clock,
  ShieldCheck,
  ShieldWarning,
  CircleNotch,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants & Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Admin role → display label (mirrors admin-management page). */
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  academic_admin: 'Academic Admin',
  finance_admin: 'Finance Admin',
};

/** Status chip styling. */
const STATUS_STYLES: Record<string, string> = {
  pending:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800',
  approved:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-800',
  rejected:
    'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-400 dark:ring-red-800',
  revoked:
    'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:ring-rose-800',
  expired:
    'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700',
  inactive:
    'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700',
};

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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Resolve the display role label for a device owner (approved role wins). */
function resolveOwnerRoleLabel(owner?: AdminUser): string {
  if (!owner) return 'Admin';
  const approved = owner.roles?.find((r) => r.accessStatus === 'approved');
  if (approved) return ROLE_LABELS[approved.adminRole] ?? 'Admin';
  return 'Admin';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function TrustedDevicesPage() {
  const { instituteId } = useAuth();

  // ── Tab & Search State ────────────────────────────────────────────────
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ── Action State ──────────────────────────────────────────────────────
  type ConfirmAction = { type: 'approve' | 'revoke'; device: TrustedDevice } | null;
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [rejectTarget, setRejectTarget] = useState<TrustedDevice | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── Feedback State (toast pattern from admin batches page) ────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Debounced search ──────────────────────────────────────────────────
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }, []);

  // ── Data Fetching ─────────────────────────────────────────────────────
  const { data: pendingDevices, isLoading: pendingLoading, isError: pendingError, error: pendingErr, refetch: refetchPending } =
    usePendingDevices();
  const { data: approvedDevices, isLoading: approvedLoading, isError: approvedError, error: approvedErr, refetch: refetchApproved } =
    useApprovedDevices();

  // Resolve owner names/roles — device owners are always admins, so the
  // admin users list provides the display metadata (name, email, role).
  const { data: adminUsers } = useAdminUsers(instituteId, undefined);
  const ownerMap = useMemo(() => {
    const map = new Map<string, AdminUser>();
    (adminUsers ?? []).forEach((u) => map.set(u.profileId, u));
    return map;
  }, [adminUsers]);

  const devices = tab === 'pending' ? pendingDevices : approvedDevices;
  const isLoading = tab === 'pending' ? pendingLoading : approvedLoading;
  const isError = tab === 'pending' ? pendingError : approvedError;
  const error = tab === 'pending' ? pendingErr : approvedErr;
  const refetch = tab === 'pending' ? refetchPending : refetchApproved;

  // Client-side search filter (lists are small — server pagination is
  // unnecessary for the device queue).
  const filteredDevices = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return devices ?? [];
    return (devices ?? []).filter((d) => {
      const owner = ownerMap.get(d.profileId);
      const ownerName = owner?.name?.toLowerCase() ?? '';
      const ownerEmail = owner?.email?.toLowerCase() ?? '';
      const deviceName = d.deviceName.toLowerCase();
      return (
        deviceName.includes(q) ||
        ownerName.includes(q) ||
        ownerEmail.includes(q) ||
        d.profileId.toLowerCase().includes(q)
      );
    });
  }, [devices, debouncedSearch, ownerMap]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const approveMutation = useApproveDevice();
  const rejectMutation = useRejectDevice();
  const revokeMutation = useRevokeDevice();

  const handleApprove = useCallback(
    async (device: TrustedDevice) => {
      const result = await approveMutation.mutateAsync(device.deviceId);
      if (result.success) {
        showToast(`Device "${device.deviceName}" approved.`, 'success');
        setConfirmAction(null);
      } else {
        // Keep the dialog open so the reviewer can retry.
        showToast(result.error ?? 'Could not approve the device.', 'error');
      }
    },
    [approveMutation, showToast],
  );

  const handleReject = useCallback(
    async (device: TrustedDevice) => {
      const result = await rejectMutation.mutateAsync({
        deviceId: device.deviceId,
        reason: rejectReason.trim() || undefined,
      });
      if (result.success) {
        showToast(`Device "${device.deviceName}" rejected.`, 'success');
        setRejectTarget(null);
        setRejectReason('');
      } else {
        // Keep the modal open so the reviewer can retry.
        showToast(result.error ?? 'Could not reject the device.', 'error');
      }
    },
    [rejectMutation, rejectReason, showToast],
  );

  const handleRevoke = useCallback(
    async (device: TrustedDevice) => {
      const result = await revokeMutation.mutateAsync(device.deviceId);
      if (result.success) {
        showToast(`Device "${device.deviceName}" revoked.`, 'success');
        setConfirmAction(null);
      } else {
        // Keep the dialog open so the reviewer can retry.
        showToast(result.error ?? 'Could not revoke the device.', 'error');
      }
    },
    [revokeMutation, showToast],
  );

  // ── Table Columns ─────────────────────────────────────────────────────
  const columns: Column<TrustedDevice>[] = useMemo(
    () => [
      {
        key: 'device',
        header: 'Device',
        render: (item) => (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <DeviceMobile size={18} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className="max-w-[200px] truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.deviceName || 'Unknown device'}
              </p>
              {item.userAgent && (
                <p className="max-w-[220px] truncate text-[11px] text-gray-400">
                  {item.userAgent}
                </p>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'owner',
        header: 'Owner',
        render: (item) => {
          const owner = ownerMap.get(item.profileId);
          const name = owner?.name ?? 'Unknown admin';
          return (
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-[9px] font-bold text-white">
                {getInitials(name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                  {name}
                </p>
                {owner?.email && (
                  <p className="max-w-[160px] truncate text-[10px] text-gray-400">
                    {owner.email}
                  </p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        key: 'role',
        header: 'Role',
        render: (item) => {
          const owner = ownerMap.get(item.profileId);
          return (
            <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
              <ShieldCheck size={12} />
              {resolveOwnerRoleLabel(owner)}
            </span>
          );
        },
      },
      {
        key: 'requestedAt',
        header: 'Requested',
        className: 'w-40',
        render: (item) => (
          <span className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
            {formatDateTime(item.requestedAt)}
          </span>
        ),
      },
      {
        key: 'lastUsedAt',
        header: 'Last Used',
        className: 'w-40',
        render: (item) => (
          <span className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
            {formatDateTime(item.lastUsedAt)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${
              STATUS_STYLES[item.status] ?? STATUS_STYLES.inactive
            }`}
          >
            {item.status}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        className: 'w-56',
        render: (item) => (
          <div className="flex items-center gap-2">
            {tab === 'pending' ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmAction({ type: 'approve', device: item });
                  }}
                  disabled={approveMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                >
                  <CheckCircle size={13} />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRejectReason('');
                    setRejectTarget(item);
                  }}
                  disabled={rejectMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                >
                  <XCircle size={13} />
                  Reject
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmAction({ type: 'revoke', device: item });
                }}
                disabled={revokeMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50"
              >
                <Prohibit size={13} />
                Revoke
              </button>
            )}
          </div>
        ),
      },
    ],
    [ownerMap, tab, approveMutation.isPending, rejectMutation.isPending, revokeMutation.isPending],
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
              Only Super Admins can manage trusted devices.
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          title="Trusted Devices"
          description="Review and manage device approval requests from Academic and Finance Admins. Approving a new device automatically revokes the previous one."
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Trusted Devices' },
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

        {/* Summary Chips */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
              <Clock size={22} weight="duotone" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {pendingDevices?.length ?? 0}
              </p>
              <p className="text-xs font-medium text-gray-500">Pending Approvals</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <ShieldCheck size={22} weight="duotone" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {approvedDevices?.length ?? 0}
              </p>
              <p className="text-xs font-medium text-gray-500">Approved Devices</p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <Devices size={22} weight="duotone" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {(pendingDevices?.length ?? 0) + (approvedDevices?.length ?? 0)}
              </p>
              <p className="text-xs font-medium text-gray-500">Total Devices</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'pending'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <Clock size={15} />
            Pending Requests
            {pendingDevices && pendingDevices.length > 0 && (
              <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {pendingDevices.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('approved')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'approved'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <ShieldCheck size={15} />
            Approved Devices
          </button>
        </div>

        {/* Search */}
        <div className="max-w-md">
          <SearchBar
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search device, owner name or email..."
            className="w-full"
          />
        </div>

        {/* Error State */}
        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
            <div className="flex items-center gap-3">
              <XCircle size={20} className="flex-shrink-0 text-red-600" weight="fill" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  Failed to load devices
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

        {/* Table */}
        <DataTable
          columns={columns}
          data={filteredDevices}
          keyExtractor={(item) => item.deviceId}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              icon={
                tab === 'pending' ? (
                  <ShieldWarning size={40} weight="thin" />
                ) : (
                  <ShieldCheck size={40} weight="thin" />
                )
              }
              title={
                tab === 'pending'
                  ? 'No pending approvals'
                  : 'No approved devices yet'
              }
              description={
                debouncedSearch
                  ? 'No devices match your search.'
                  : tab === 'pending'
                    ? 'When an Academic or Finance Admin logs in from a new device, the approval request will appear here.'
                    : 'Approved devices will appear here once you approve a pending request.'
              }
            />
          }
        />

        {/* Confirm Approve / Revoke Dialog */}
        <ConfirmDialog
          open={confirmAction !== null}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => {
            if (!confirmAction) return;
            if (confirmAction.type === 'approve') {
              void handleApprove(confirmAction.device);
            } else {
              void handleRevoke(confirmAction.device);
            }
          }}
          title={
            confirmAction?.type === 'approve' ? 'Approve device?' : 'Revoke device?'
          }
          message={
            confirmAction?.type === 'approve'
              ? `Approve "${confirmAction?.device.deviceName}"? This grants the owner immediate admin access from this device and automatically revokes any previously approved device.`
              : `Revoke "${confirmAction?.device.deviceName}"? The owner will lose access from this device until a new request is approved.`
          }
          confirmLabel={confirmAction?.type === 'approve' ? 'Approve' : 'Revoke'}
          variant={confirmAction?.type === 'approve' ? 'default' : 'danger'}
          loading={
            approveMutation.isPending || revokeMutation.isPending
          }
        />

        {/* Reject Reason Modal */}
        {rejectTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setRejectTarget(null)}
            />
            <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
                  <XCircle size={20} weight="duotone" className="text-red-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Reject device request
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Reject "{rejectTarget.deviceName}"? You can add a reason the owner will see.
                  </p>
                </div>
              </div>

              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional) — e.g. 'Unrecognized device, contact support.'"
                rows={3}
                className="mt-4 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              />

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  disabled={rejectMutation.isPending}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleReject(rejectTarget)}
                  disabled={rejectMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {rejectMutation.isPending ? (
                    <CircleNotch size={15} className="animate-spin" />
                  ) : (
                    <XCircle size={15} />
                  )}
                  Reject Device
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-[60]">
            <div
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg ${
                toast.type === 'success'
                  ? 'border-emerald-200 bg-white text-emerald-700 dark:border-emerald-800 dark:bg-gray-900 dark:text-emerald-400'
                  : 'border-red-200 bg-white text-red-700 dark:border-red-800 dark:bg-gray-900 dark:text-red-400'
              }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle size={18} weight="fill" />
              ) : (
                <XCircle size={18} weight="fill" />
              )}
              <span className="text-sm font-medium">{toast.message}</span>
            </div>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}
