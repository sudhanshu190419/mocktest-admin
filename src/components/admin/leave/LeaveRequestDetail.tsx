'use client';

/**
 * Admin Leave Request Detail (Phase 2E)
 *
 * Full review surface for ONE teacher leave request:
 *
 *   - Request summary card (teacher, period, category, reason, status,
 *     emergency, review metadata, pending-resolution progress).
 *   - Affected occurrences (batch → subject, date/time, chapter/topic,
 *     class status, and the current resolution chip when one exists).
 *   - Approve / Reject actions (pending requests only) with optional
 *     remarks, through `review_teacher_leave_request`.
 *   - Per-occurrence RESOLVE action (Phase 2F): each occurrence with a
 *     pending resolution opens `ResolutionDialog` (substitute / reschedule /
 *     recorded / mock test / cancel) via `useResolveClass`.
 *
 * All writes go through migration-115 RPCs via `useReviewLeaveRequest`; all
 * reads are RLS-scoped through `useLeaveRequestDetail`.
 *
 * @module components/admin/leave/LeaveRequestDetail
 */

import { useState } from 'react';
import {
  CalendarBlank,
  CheckCircle,
  CircleNotch,
  Clock,
  IdentificationCard,
  SlidersHorizontal,
  XCircle,
} from '@phosphor-icons/react';
import {
  useLeaveRequestDetail,
  useReviewLeaveRequest,
} from '@/hooks/admin/useTeacherLeaveAdmin';
import { ResolutionDialog } from '@/components/admin/leave/ResolutionDialog';
import { LeaveStatusBadge, LeaveEmergencyBadge } from '@/components/ui/LeaveStatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import { CATEGORY_LABELS, SLOT_DAY_LABELS, formatDateOnly, formatSlotTime, formatTimeAgo } from '@/utils/leaveFormat';
import type { ClassResolution, LeaveOccurrence } from '@/types/teacherLeave';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface LeaveRequestDetailProps {
  leaveId: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LeaveRequestDetail({ leaveId }: LeaveRequestDetailProps) {
  const { data, isLoading, isError, refetch } = useLeaveRequestDetail(leaveId);

  const reviewMutation = useReviewLeaveRequest();
  const [remarks, setRemarks] = useState('');
  const [confirmDecision, setConfirmDecision] = useState<'approve' | 'reject' | null>(null);
  const reviewError = reviewMutation.isError ? reviewMutation.error.message : null;

  // Occurrence-level resolution state (Phase 2F).
  const [resolving, setResolving] = useState<{
    occurrence: LeaveOccurrence;
    resolutionId: string;
  } | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={<IdentificationCard size={36} weight="thin" />}
        title="Could not load this leave request"
        description="It may not exist, or you may not have access to it in this institute."
        action={
          <button
            onClick={() => refetch()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Try again
          </button>
        }
      />
    );
  }

  const { request, occurrences } = data;
  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const allResolved =
    isApproved && request.affectedOccurrences > 0 && request.pendingResolutions === 0;

  function confirmReview() {
    if (!confirmDecision) return;
    reviewMutation.mutate(
      { leaveId, decision: confirmDecision, remarks: remarks.trim() || null },
      {
        // Reset the dialog + remarks only on success — keep the admin's
        // input if the RPC rejects so they can fix and retry.
        onSuccess: () => {
          setConfirmDecision(null);
          setRemarks('');
        },
        onError: () => setConfirmDecision(null),
      },
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Request summary ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Leave Request</h3>
          <LeaveStatusBadge status={request.status} />
          {request.isEmergency && <LeaveEmergencyBadge />}
          <span className="ml-auto text-xs text-gray-400">Submitted {formatTimeAgo(request.createdAt)}</span>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Teacher">
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {request.teacherName ?? 'Unknown teacher'}
            </p>
            {request.teacherDepartment && (
              <p className="text-xs text-gray-400">{request.teacherDepartment}</p>
            )}
          </Field>

          <Field label="Leave period">
            <p className="font-medium text-gray-800 dark:text-gray-200">
              {formatDateOnly(request.startDate)} → {formatDateOnly(request.endDate)}
            </p>
            <p className="text-xs text-gray-400">{request.affectedOccurrences} affected class(es)</p>
          </Field>

          <Field label="Category">
            <p className="font-medium text-gray-800 dark:text-gray-200">
              {CATEGORY_LABELS[request.leaveCategory] ?? request.leaveCategory}
            </p>
          </Field>

          <Field label="Reason" wide>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {request.reason ?? 'No reason provided'}
            </p>
          </Field>

          {request.status === 'approved' && (
            <Field label="Resolution progress">
              {allResolved ? (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle size={15} weight="fill" />
                  All classes resolved
                </p>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
                  <Clock size={15} />
                  {request.pendingResolutions} of {request.affectedOccurrences} awaiting resolution
                </p>
              )}
            </Field>
          )}

          {(request.status === 'rejected' || request.status === 'approved') && request.reviewedAt && (
            <Field label={request.status === 'approved' ? 'Approved' : 'Rejected'}>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {request.reviewedAt ? formatTimeAgo(request.reviewedAt) : '—'}
              </p>
              {request.reviewerRemarks && (
                <p className="text-xs italic text-gray-400">“{request.reviewerRemarks}”</p>
              )}
            </Field>
          )}
        </div>
      </section>

      {/* ── Affected occurrences ───────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <CalendarBlank size={17} className="text-blue-600" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Affected Classes</h3>
          <span className="ml-auto text-xs text-gray-400">{occurrences.length} occurrence(s)</span>
        </div>

        {occurrences.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-gray-400">No affected occurrences recorded.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {occurrences.map((occ) => (
              <OccurrenceRow
                key={occ.leaveRequestOccurrenceId}
                occurrence={occ}
                resolution={occ.resolution ?? null}
                onResolve={
                  occ.resolution?.status === 'pending'
                    ? () => setResolving({ occurrence: occ, resolutionId: occ.resolution!.resolutionId })
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Approve / reject (pending only) ────────────────────────── */}
      {isPending && (
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-700">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Review Decision</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Approving creates the operational leave record and one pending resolution per
              affected class (resolved in Phase 2F). Rejecting closes the request.
            </p>
          </div>

          <div className="space-y-3 px-5 py-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Remarks <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Notes for the teacher or the record…"
              className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />

            {/* Mutation error (e.g. request already handled / permission) */}
            {reviewError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {reviewError}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setConfirmDecision('approve')}
                disabled={reviewMutation.isPending}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {reviewMutation.isPending ? (
                  <CircleNotch size={16} className="animate-spin" />
                ) : (
                  <CheckCircle size={16} weight="fill" />
                )}
                Approve Leave
              </button>
              <button
                onClick={() => setConfirmDecision('reject')}
                disabled={reviewMutation.isPending}
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
              >
                <XCircle size={16} weight="fill" />
                Reject Request
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Review confirmation ────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmDecision !== null}
        onClose={() => setConfirmDecision(null)}
        onConfirm={confirmReview}
        title={confirmDecision === 'approve' ? 'Approve leave request?' : 'Reject leave request?'}
        message={
          confirmDecision === 'approve'
            ? 'The leave will be recorded and pending resolutions will be created for each affected class. You can then resolve them individually.'
            : 'The request will be closed and the teacher will be notified. This cannot be undone.'
        }
        confirmLabel={confirmDecision === 'approve' ? 'Yes, Approve' : 'Yes, Reject'}
        cancelLabel="Go Back"
        variant={confirmDecision === 'approve' ? 'default' : 'danger'}
        loading={reviewMutation.isPending}
      />

      {/* ── Occurrence resolution dialog (Phase 2F) ─────────────────── */}
      {/* Keyed by occurrence so internal form state resets per occurrence. */}
      <ResolutionDialog
        key={resolving?.occurrence.leaveRequestOccurrenceId ?? 'closed'}
        occurrence={resolving?.occurrence ?? null}
        resolutionId={resolving?.resolutionId ?? null}
        instituteId={request.instituteId}
        onClose={() => setResolving(null)}
      />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn(wide && 'sm:col-span-2 lg:col-span-3')}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function OccurrenceRow({
  occurrence,
  resolution,
  onResolve,
}: {
  occurrence: LeaveOccurrence;
  resolution: ClassResolution | null;
  /** Provided when this occurrence has a pending resolution the admin can act on. */
  onResolve?: () => void;
}) {
  const classStatusCfg = classStatusConfig(occurrence.classStatus);

  return (
    <li className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      {/* Date block */}
      <div className="flex shrink-0 items-center gap-3 sm:w-40">
        <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20">
          <span className="text-sm font-extrabold leading-none text-blue-700 dark:text-blue-300">
            {dayNumber(occurrence.occurrenceDate)}
          </span>
          <span className="text-[10px] font-bold uppercase text-blue-500 dark:text-blue-400">
            {monthShort(occurrence.occurrenceDate)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {SLOT_DAY_LABELS[occurrence.dayOfWeek ?? 0] ?? '—'}
          </p>
          <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
            {formatSlotTime(occurrence.startTime)} – {formatSlotTime(occurrence.endTime)}
          </p>
        </div>
      </div>

      {/* Batch → Subject + lesson */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
          {occurrence.batchName ?? 'Unknown batch'}
          <span className="mx-1.5 text-gray-400">→</span>
          {occurrence.subjectName ?? 'Unknown subject'}
        </p>
        {(occurrence.chapterName || occurrence.topicName) && (
          <p className="mt-0.5 truncate text-xs text-indigo-600 dark:text-indigo-400">
            {occurrence.chapterName}
            {occurrence.topicName && <span className="text-gray-400"> · {occurrence.topicName}</span>}
          </p>
        )}
      </div>

      {/* Class status + resolution chip */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {occurrence.classStatus && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
              classStatusCfg.cls,
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', classStatusCfg.dot)} />
            {classStatusCfg.label}
          </span>
        )}
        {resolution && <ResolutionChip resolution={resolution} />}
        {onResolve && (
          <button
            type="button"
            onClick={onResolve}
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40"
          >
            <SlidersHorizontal size={12} weight="bold" />
            Resolve
          </button>
        )}
      </div>
    </li>
  );
}

function ResolutionChip({ resolution }: { resolution: ClassResolution }) {
  if (resolution.status === 'cancelled') {
    return <Chip label="Resolution cancelled" cls="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" />;
  }
  if (resolution.status === 'pending') {
    return <Chip label="Awaiting resolution" cls="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" />;
  }

  const cfg = RESOLUTION_META[resolution.resolutionType];
  return <Chip label={cfg?.label ?? resolution.resolutionType} cls={cfg?.cls ?? ''} />;
}

const RESOLUTION_META: Record<string, { label: string; cls: string }> = {
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

function Chip({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold', cls)}>
      {label}
    </span>
  );
}

function dayNumber(iso: string): string {
  return iso.slice(8, 10).replace(/^0/, '') || '—';
}

function monthShort(iso: string): string {
  const m = Number(iso.slice(5, 7));
  if (!m) return '—';
  return new Date(2000, m - 1, 1).toLocaleString('en-IN', { month: 'short' });
}

/** Compact status pill for the anchored live class (if materialized). */
function classStatusConfig(status: string | null | undefined) {
  switch (status) {
    case 'live':
      return { label: 'LIVE', cls: 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400', dot: 'bg-green-500 animate-pulse' };
    case 'scheduled':
      return { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400', dot: 'bg-blue-500' };
    case 'completed':
      return { label: 'Completed', cls: 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-400', dot: 'bg-gray-400' };
    case 'cancelled':
      return { label: 'Cancelled', cls: 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-900/20 dark:text-red-400', dot: 'bg-red-400' };
    default:
      return { label: status ?? '—', cls: 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-400', dot: 'bg-gray-400' };
  }
}

