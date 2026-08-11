'use client';

/**
 * Resolution Dialog (Phase 2F)
 *
 * One dialog for resolving ONE affected class occurrence. The admin picks an
 * action, the action reveals its form, and confirmation submits through
 * `useResolveClass` → the matching migration-115 RPC.
 *
 * ## Occurrence-level by design
 *
 * Resolving is per-occurrence — never per-request. Each occurrence carries
 * its own pending `class_resolution_events` row; this dialog operates on the
 * one the admin clicked.
 *
 * ## Authority
 *
 * The dialog requires only the fields each RPC needs. Whether an action is
 * actually allowed (started/live/completed protection, conflicts, teacher
 * availability, holiday/leave, institute scope) is decided exclusively by
 * migration 115; RPC errors are surfaced verbatim (mapped to friendly text
 * in the service layer).
 *
 * ## Structure
 *
 * ResolutionDialog
 *   ├── SubstituteTeacherForm
 *   ├── RescheduleForm
 *   ├── RecordedClassForm
 *   ├── MockTestForm
 *   └── CancelClassForm
 *
 * @module components/admin/leave/ResolutionDialog
 */

import { useCallback, useEffect, useState } from 'react';
import { CircleNotch, PresentationChart, WarningCircle, X } from '@phosphor-icons/react';
import { useResolveClass } from '@/hooks/admin/useTeacherLeaveAdmin';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/utils';
import { formatDateOnly, formatSlotTime, SLOT_DAY_LABELS } from '@/utils/leaveFormat';
import {
  CancelClassForm,
  MockTestForm,
  RecordedClassForm,
  RescheduleForm,
  RESOLUTION_OPTIONS,
  SubstituteTeacherForm,
} from './ResolutionForms';
import type { LeaveOccurrence, ResolveClassInput } from '@/types/teacherLeave';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ResolutionDialogProps {
  /** The occurrence being resolved (null = dialog closed). */
  occurrence: LeaveOccurrence | null;
  /** Pending class_resolution_events row for this occurrence. */
  resolutionId: string | null;
  /** Institute of the request (scopes the substitute/mock-test pickers). */
  instituteId: string;
  onClose: () => void;
}

type ResolutionAction = (typeof RESOLUTION_OPTIONS)[number]['action'];

// ─── Component ──────────────────────────────────────────────────────────────

export function ResolutionDialog({
  occurrence,
  resolutionId,
  instituteId,
  onClose,
}: ResolutionDialogProps) {
  const [action, setAction] = useState<ResolutionAction | null>(null);
  const [payload, setPayload] = useState<ResolveClassInput | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { mutate, isPending, isError, error } = useResolveClass();

  const isOpen = !!occurrence && !!resolutionId;

  const handleClose = useCallback(() => {
    if (isPending) return;
    setConfirming(false);
    onClose();
  }, [isPending, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleClose]);

  if (!occurrence || !resolutionId) return null;

  // Narrow for the closures below (TS widens props inside functions).
  const occ = occurrence;
  const rid = resolutionId;

  function handleConfirm() {
    if (!payload) return;
    mutate(payload, {
      onSuccess: () => {
        setConfirming(false);
        onClose();
      },
      onError: () => setConfirming(false),
    });
  }

  /** Selecting a different action must clear the previous form's payload
   * immediately — otherwise the Resolve button could submit the OLD action
   * until the newly mounted form emits its payload (stale-payload race). */
  function selectAction(next: ResolutionAction) {
    setPayload(null);
    setAction(next);
  }

  function renderForm() {
    const base = { resolutionId: rid, occurrence: occ, onPayloadChange: setPayload };
    switch (action) {
      case 'substitute_teacher':
        return <SubstituteTeacherForm {...base} instituteId={instituteId} />;
      case 'reschedule':
        return <RescheduleForm {...base} instituteId={instituteId} />;
      case 'recorded_class':
        return <RecordedClassForm {...base} />;
      case 'mock_test':
        return <MockTestForm {...base} />;
      case 'cancelled':
        return <CancelClassForm {...base} />;
      default:
        return null;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white shadow-2xl overflow-hidden animate-slideUp dark:border-gray-700 dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <PresentationChart size={22} weight="fill" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Resolve Class</h3>
              <p className="text-xs text-blue-200">
                {occurrence.batchName ?? 'Unknown batch'} → {occurrence.subjectName ?? 'Unknown subject'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isPending}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-6">
          {/* Occurrence context */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-800/40">
            <span className="font-bold text-gray-900 dark:text-gray-100">
              {SLOT_DAY_LABELS[occurrence.dayOfWeek ?? 0] ?? '—'}
            </span>
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
              {formatDateOnly(occurrence.occurrenceDate)} · {formatSlotTime(occurrence.startTime)} –{' '}
              {formatSlotTime(occurrence.endTime)}
            </span>
            {occurrence.chapterName && (
              <span className="text-xs text-indigo-600 dark:text-indigo-400">
                {occurrence.chapterName}
                {occurrence.topicName && <span className="text-gray-400"> · {occurrence.topicName}</span>}
              </span>
            )}
          </div>

          {/* Action picker (step 1) */}
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              What should happen?
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RESOLUTION_OPTIONS.map((opt) => {
                const selected = action === opt.action;
                return (
                  <button
                    key={opt.action}
                    type="button"
                    onClick={() => selectAction(opt.action)}
                    disabled={isPending}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                      selected
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100 dark:border-blue-500 dark:bg-blue-900/20'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                      isPending && 'opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                        selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
                      )}
                    >
                      {opt.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-gray-900 dark:text-gray-100">
                        {opt.label}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">
                        {opt.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active form (step 2) */}
          {action && (
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              {renderForm()}
            </div>
          )}

          {/* Mutation error (RPC is authoritative — surface its answer) */}
          {isError && error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
              <span>{error.message}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-700">
          <button
            onClick={handleClose}
            disabled={isPending}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => setConfirming(true)}
            disabled={!payload || isPending}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-40"
          >
            {isPending ? (
              <>
                <CircleNotch size={16} className="animate-spin" />
                Resolving…
              </>
            ) : (
              'Resolve Class'
            )}
          </button>
        </div>

        {/* Confirmation */}
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          onConfirm={handleConfirm}
          title="Resolve this class?"
          message={`Apply the ${action === 'cancelled' ? 'cancellation' : 'resolution'} for ${formatDateOnly(occurrence.occurrenceDate)}? Students and teachers are notified once applied.`}
          confirmLabel="Yes, Resolve"
          cancelLabel="Go Back"
          variant="default"
          loading={isPending}
        />
      </div>
    </div>
  );
}
