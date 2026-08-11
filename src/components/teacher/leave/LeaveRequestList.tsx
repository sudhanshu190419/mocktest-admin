'use client';

/**
 * Leave Request List + Card
 *
 * Phase 2C — the teacher's own leave-request history.
 *
 * Each card shows the leave period, category, reason, status, emergency
 * badge, review metadata, and resolution progress ("X of Y classes awaiting
 * admin action"). Cards expand to reveal the affected occurrences (fetched
 * on demand via `useMyLeaveRequest`). Pending requests can be cancelled by
 * the teacher (migration-115 RPC only).
 *
 * All reads are RLS-scoped to the current teacher; all writes go through
 * the migration-115 RPCs.
 *
 * @module components/teacher/leave/LeaveRequestList
 */

import { useState } from 'react';
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import {
  useCancelLeaveRequest,
  useMyLeaveRequest,
  useMyLeaveRequests,
} from '@/hooks/teacher/useTeacherLeave';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LeaveStatusBadge } from '@/components/ui/LeaveStatusBadge';
import { CATEGORY_LABELS, SLOT_DAY_LABELS, formatDateOnly, formatSlotTime, formatTimeAgo } from '@/utils/leaveFormat';
import { cn } from '@/lib/utils';
import type { TeacherLeaveRequest } from '@/types/teacherLeave';

// (Badges + formatters + label maps live in @/components/ui/LeaveStatusBadge
//  and @/utils/leaveFormat — shared with the admin inbox.)

// ─── List ───────────────────────────────────────────────────────────────────

export function LeaveRequestList() {
  const { data: requests, isLoading, isError, refetch } = useMyLeaveRequests();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
          >
            <Skeleton className="mb-2 h-3 w-28" />
            <Skeleton className="mb-2 h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-red-200 bg-white py-14 text-center dark:border-red-800 dark:bg-gray-900">
        <XCircle size={30} className="text-red-400" />
        <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Could not load your leave requests.
        </p>
        <button
          onClick={() => refetch()}
          className="mt-4 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!requests || requests.length === 0) {
    return (
      <EmptyState
        title="No leave requests yet"
        description="Submit a leave request and it will appear here with its status and admin decisions."
      />
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <LeaveRequestCard key={request.leaveId} request={request} />
      ))}
    </div>
  );
}

// ─── Card (own hooks: expandable detail + cancel) ───────────────────────────

function LeaveRequestCard({ request }: { request: TeacherLeaveRequest }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: detail, isLoading: detailLoading } = useMyLeaveRequest(
    expanded ? request.leaveId : null,
  );
  const cancelMutation = useCancelLeaveRequest();

  const canCancel = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const awaiting = request.pendingResolutions;
  const allResolved = isApproved && request.affectedOccurrences > 0 && awaiting === 0;

  const occurrences = detail?.occurrences ?? [];

  function confirmCancelRequest() {
    cancelMutation.mutate(request.leaveId, {
      onSettled: () => setConfirmCancel(false),
    });
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4"
        aria-expanded={expanded}
      >
        <div className="flex flex-wrap items-center gap-2">
          <LeaveStatusBadge status={request.status} />
          {request.isEmergency && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400">
              <WarningCircle size={11} weight="fill" />
              Emergency
            </span>
          )}
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {formatDateOnly(request.startDate)} → {formatDateOnly(request.endDate)}
          </span>
          <span className="text-xs text-gray-400">
            {CATEGORY_LABELS[request.leaveCategory] ?? request.leaveCategory} · submitted{' '}
            {formatTimeAgo(request.createdAt)}
          </span>
          <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
            {expanded ? (
              <>
                Hide classes <CaretDown size={13} />
              </>
            ) : (
              <>
                View classes <CaretRight size={13} />
              </>
            )}
          </span>
        </div>

        {/* Reason */}
        {request.reason && (
          <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">{request.reason}</p>
        )}

        {/* Review metadata */}
        {(request.status === 'rejected' || request.status === 'approved') && request.reviewedAt && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {request.status === 'approved' ? 'Approved' : 'Rejected'} {formatTimeAgo(request.reviewedAt)}
            {request.reviewerRemarks ? ` — ${request.reviewerRemarks}` : ''}
          </p>
        )}

        {/* Resolution progress (approved requests) */}
        {isApproved && (
          <div className="mt-2.5">
            {allResolved ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                <CheckCircle size={13} weight="fill" />
                All {request.affectedOccurrences} class{request.affectedOccurrences === 1 ? '' : 'es'} resolved
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                <Clock size={13} />
                {awaiting} of {request.affectedOccurrences} class
                {request.affectedOccurrences === 1 ? '' : 'es'} awaiting admin action
              </span>
            )}
          </div>
        )}
      </button>

      {/* Expanded: affected occurrences */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-700">
          {detailLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
              <CircleNotch size={16} className="animate-spin text-blue-600" />
              Loading affected classes...
            </div>
          ) : occurrences.length === 0 ? (
            <p className="py-2 text-sm text-gray-400">No occurrence details available.</p>
          ) : (
            <div className="space-y-2">
              {occurrences.map((occ) => (
                <div
                  key={occ.leaveRequestOccurrenceId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm dark:bg-gray-800/40"
                >
                  <span className="font-mono text-xs font-bold text-gray-700 dark:text-gray-300">
                    {formatDateOnly(occ.occurrenceDate)}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {SLOT_DAY_LABELS[occ.dayOfWeek ?? 0] ?? '—'} · {formatSlotTime(occ.startTime)} –{' '}
                    {formatSlotTime(occ.endTime)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-gray-100">
                    {occ.batchName ?? 'Unknown batch'}
                    <span className="mx-1 text-gray-400">→</span>
                    {occ.subjectName ?? 'Unknown subject'}
                  </span>
                  {occ.resolution && (
                    <ResolutionChip type={occ.resolution.resolutionType} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cancel pending (bottom-right action) */}
      {canCancel && (
        <div className="flex justify-end border-t border-gray-100 px-5 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            disabled={cancelMutation.isPending}
            className="rounded-xl border border-red-200 px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Request'}
          </button>
        </div>
      )}

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={confirmCancelRequest}
        title="Cancel leave request?"
        message={`This will withdraw your pending leave request for ${formatDateOnly(request.startDate)} → ${formatDateOnly(request.endDate)}.`}
        confirmLabel="Yes, Cancel Request"
        cancelLabel="Keep Request"
        variant="danger"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}

/** Compact chip for the resolution applied to one occurrence. */
function ResolutionChip({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    substitute_teacher: {
      label: 'Substitute teacher',
      cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
    },
    reschedule: {
      label: 'Rescheduled',
      cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300',
    },
    recorded_class: {
      label: 'Recorded class',
      cls: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
    },
    mock_test: {
      label: 'Mock test',
      cls: 'bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300',
    },
    cancelled: {
      label: 'Class cancelled',
      cls: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
    },
  };
  const cfg = map[type] ?? { label: type, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold', cfg.cls)}>
      {cfg.label}
    </span>
  );
}
