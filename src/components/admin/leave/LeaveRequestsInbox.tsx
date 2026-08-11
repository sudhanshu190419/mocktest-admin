'use client';

/**
 * Admin Leave Requests Inbox (Phase 2D)
 *
 * Paginated, filterable review queue for `teacher_leave_requests`.
 *
 * - Filters: status, emergency, leave-period date range (overlap semantics).
 * - Priority: the service orders by `is_emergency desc, created_at desc`,
 *   so emergency requests surface first; the table also renders a prominent
 *   emergency badge per row.
 * - Pagination: `DataTable` built-in pager (`page` / `pageSize` /
 *   `totalCount` / `onPageChange`).
 * - Row click → `/admin/leave-requests/[leaveId]` (detail + resolution, 2E).
 *
 * All reads go through `useLeaveRequests` (RLS: institute-scoped). No writes
 * happen on this screen.
 *
 * @module components/admin/leave/LeaveRequestsInbox
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WarningCircle } from '@phosphor-icons/react';
import { useLeaveRequests } from '@/hooks/admin/useTeacherLeaveAdmin';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { LeaveStatusBadge, LeaveEmergencyBadge } from '@/components/ui/LeaveStatusBadge';
import { CATEGORY_LABELS, formatDateOnly, formatTimeAgo } from '@/utils/leaveFormat';
import type { LeaveRequestStatus, TeacherLeaveRequest } from '@/types/teacherLeave';

// ─── Options ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: '' | LeaveRequestStatus; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const EMERGENCY_OPTIONS = [
  { value: '', label: 'All Requests' },
  { value: 'emergency', label: 'Emergency only' },
  { value: 'normal', label: 'Normal only' },
];

// (Formatters + category labels + leave badges live in
//  @/utils/leaveFormat and @/components/ui/LeaveStatusBadge.)

// ─── Component ──────────────────────────────────────────────────────────────

export function LeaveRequestsInbox() {
  const router = useRouter();
  const [status, setStatus] = useState<'' | LeaveRequestStatus>('');
  const [emergency, setEmergency] = useState(''); // '' | 'emergency' | 'normal'
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const filters = useMemo(
    () => ({
      status: status || undefined,
      emergency:
        emergency === 'emergency' ? true : emergency === 'normal' ? false : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
    [status, emergency, fromDate, toDate],
  );

  const { data, isLoading, isError, refetch } = useLeaveRequests(filters, {
    page,
    pageSize,
  });

  const hasActiveFilters = !!(status || emergency || fromDate || toDate);

  const columns: Column<TeacherLeaveRequest>[] = useMemo(
    () => [
      {
        key: 'teacher',
        header: 'Teacher',
        render: (item) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {item.teacherName ?? 'Unknown teacher'}
            </p>
            {item.teacherDepartment && (
              <p className="truncate text-xs text-gray-400">{item.teacherDepartment}</p>
            )}
          </div>
        ),
      },
      {
        key: 'period',
        header: 'Leave Period',
        render: (item) => (
          <div className="whitespace-nowrap">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {formatDateOnly(item.startDate)}
            </p>
            <p className="text-xs text-gray-400">
              to {formatDateOnly(item.endDate)}
            </p>
          </div>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        render: (item) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {CATEGORY_LABELS[item.leaveCategory] ?? item.leaveCategory}
          </span>
        ),
      },
      {
        key: 'emergency',
        header: 'Priority',
        render: (item) => (item.isEmergency ? <LeaveEmergencyBadge /> : <span className="text-xs text-gray-400">Normal</span>),
      },
      {
        key: 'affected',
        header: 'Classes',
        render: (item) => (
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {item.affectedOccurrences}
            </p>
            {item.status === 'approved' && item.pendingResolutions > 0 && (
              <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {item.pendingResolutions} awaiting resolution
              </p>
            )}
            {item.status === 'approved' && item.pendingResolutions === 0 && (
              <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                All resolved
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <LeaveStatusBadge status={item.status} />,
      },
      {
        key: 'submitted',
        header: 'Submitted',
        render: (item) => (
          <span className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
            {formatTimeAgo(item.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const resetFilters = () => {
    setStatus('');
    setEmergency('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* ── Filter bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="w-44">
          <Select
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v as '' | LeaveRequestStatus);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
          />
        </div>
        <div className="w-44">
          <Select
            label="Priority"
            value={emergency}
            onChange={(v) => {
              setEmergency(v);
              setPage(1);
            }}
            options={EMERGENCY_OPTIONS}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            From
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            To
          </label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="rounded-lg border border-gray-200 px-3.5 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Clear filters
          </button>
        )}

        <p className="ml-auto hidden items-center gap-1.5 text-[11px] text-gray-400 md:flex">
          <WarningCircle size={12} className="text-rose-500" />
          Emergency requests are shown first
        </p>
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-6 w-24 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          keyExtractor={(item) => item.leaveId}
          onRowClick={(item) => router.push(`/admin/leave-requests/${item.leaveId}`)}
          isLoading={false}
          emptyState={
            isError ? (
              <EmptyState
                title="Could not load leave requests"
                description="Something went wrong while fetching the review queue."
                action={
                  <button
                    onClick={() => refetch()}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    Try again
                  </button>
                }
              />
            ) : (
              <EmptyState
                title="No leave requests found"
                description={
                  hasActiveFilters
                    ? 'Try adjusting your filters.'
                    : 'Teacher leave requests will appear here once submitted.'
                }
              />
            )
          }
          page={page}
          pageSize={pageSize}
          totalCount={data?.count ?? 0}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}


