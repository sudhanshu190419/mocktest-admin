'use client';

/**
 * Leave Request Modal
 *
 * Phase 2C — teacher leave-request creation.
 *
 * ## Design (Phase 2A approved)
 *
 * Date-range based: the migration-115 RPC (`submit_teacher_leave_request`)
 * discovers the teacher's own active slots overlapping the range and
 * enumerates the affected occurrences. This modal shows a DISPLAY-ONLY
 * preview computed from the teacher's own timetable slots +
 * `generateOccurrenceDates` (identical math to the RPC), but the RPC remains
 * authoritative for:
 *   - affected slots / occurrences
 *   - emergency classification (24-hour rule)
 *   - started / live / completed protection
 *
 * The frontend NEVER computes or sends `is_emergency`. The emergency hint
 * below is purely informational; the server response's `isEmergency` is what
 * the UI displays after submission.
 *
 * @module components/teacher/leave/LeaveRequestModal
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CalendarBlank,
  CalendarX,
  CheckCircle,
  CircleNotch,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { useTeacherTimetableSlots } from '@/hooks/teacher/useTeacherTimetable';
import { useSubmitLeaveRequest } from '@/hooks/teacher/useTeacherLeave';
import { generateOccurrenceDates } from '@/utils/lessonOccurrences';
import { Select } from '@/components/ui/Select';
import type { LeaveCategory, SubmitLeaveRequestResult } from '@/types/teacherLeave';
import type { TimetableSlot } from '@/types/timetable';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface LeaveRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful submit (parent list refreshes via query cache). */
  onSubmitted?: () => void;
  /** Optional prefill (YYYY-MM-DD) — e.g. from the teacher timetable week. */
  defaultFrom?: string;
  /** Optional prefill (YYYY-MM-DD). */
  defaultTo?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOT_DAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const CATEGORY_OPTIONS: { value: LeaveCategory; label: string }[] = [
  { value: 'casual', label: 'Casual Leave' },
  { value: 'sick', label: 'Sick Leave' },
  { value: 'unpaid', label: 'Unpaid Leave' },
  { value: 'maternity_paternity', label: 'Maternity / Paternity' },
  { value: 'compensatory', label: 'Compensatory Off' },
];

/** YYYY-MM-DD from LOCAL date components (no UTC shift). */
function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "2026-08-10" → "10 Aug 2026". */
function formatDateOnly(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "10:00:00" → "10:00 AM". */
function formatSlotTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** First day of the week for a date's label ("Mon 10 Aug"). */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return DAY_LABELS[new Date(y, m - 1, d).getDay() === 0 ? 6 : new Date(y, m - 1, d).getDay() - 1];
}

interface PreviewGroup {
  slot: TimetableSlot;
  dates: string[];
}

/**
 * Informational emergency hint — the server classifies emergency status.
 *
 * Returns true when the earliest affected class starts within 24h. Module-
 * level (not a hook) so the `Date.now()` read stays outside a memo/render
 * purity lint scope; it is a display-only heuristic, never authoritative.
 */
function isLikelyEmergency(previewGroups: PreviewGroup[]): boolean {
  if (previewGroups.length === 0) return false;
  let earliest: { date: string; startTime: string } | null = null;
  for (const g of previewGroups) {
    for (const d of g.dates) {
      if (!earliest || d < earliest.date) {
        earliest = { date: d, startTime: g.slot.startTime };
      }
    }
  }
  if (!earliest) return false;
  const [h = 0, m = 0] = earliest.startTime.split(':').map(Number);
  const at = new Date(
    `${earliest.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`,
  ).getTime();
  return at - Date.now() < 24 * 60 * 60 * 1000;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LeaveRequestModal({
  isOpen,
  onClose,
  onSubmitted,
  defaultFrom,
  defaultTo,
}: LeaveRequestModalProps) {
  const { teacherProfile } = useAuth();
  const teacherId = teacherProfile?.id;

  // ── Form state ──────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(defaultFrom ?? toLocalISODate(new Date()));
  const [endDate, setEndDate] = useState(defaultTo ?? toLocalISODate(new Date()));
  const [category, setCategory] = useState<LeaveCategory>('casual');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitLeaveRequestResult | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────
  const { data: slots = [], isLoading: slotsLoading } = useTeacherTimetableSlots(teacherId);
  const activeSlots = useMemo(
    () => slots.filter((s) => s.status === 'active'),
    [slots],
  );

  const { mutate, isPending } = useSubmitLeaveRequest();

  // ── Display-only preview (same math as the RPC's discovery loop) ─────
  // `today` is computed in the render body (not inside the memo) so the
  // memo stays pure; it only drives display-only past-date styling.
  const today = toLocalISODate(new Date());
  const previewGroups = useMemo<PreviewGroup[]>(() => {
    if (!startDate || !endDate || startDate > endDate) return [];
    const groups: PreviewGroup[] = [];

    for (const slot of activeSlots) {
      const dates = generateOccurrenceDates(
        slot.dayOfWeek,
        slot.validFrom,
        slot.validUntil,
        startDate,
        endDate,
      );
      if (dates.length === 0) continue;
      groups.push({ slot, dates });
    }

    return groups.sort((a, b) => {
      const dayDiff = a.slot.dayOfWeek - b.slot.dayOfWeek;
      return dayDiff !== 0 ? dayDiff : a.slot.startTime.localeCompare(b.slot.startTime);
    });
  }, [activeSlots, startDate, endDate]);

  const hasPastDates = previewGroups.some((g) => g.dates.some((d) => d < today));

  const emergencyHint = isLikelyEmergency(previewGroups);

  // ── Submit ───────────────────────────────────────────────────────────
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError('Please choose a start and end date.');
      return;
    }
    if (startDate > endDate) {
      setError('The start date must be on or before the end date.');
      return;
    }

    mutate(
      { startDate, endDate, category, reason: reason.trim() || null },
      {
        onSuccess: (result) => {
          setSubmitResult(result);
          onSubmitted?.();
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  const handleClose = useCallback(() => {
    if (isPending) return;
    setError(null);
    setSubmitResult(null);
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

  if (!isOpen) return null;

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
              <CalendarX size={22} weight="fill" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Request Leave</h3>
              <p className="text-xs text-blue-200">Cover your upcoming classes</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {submitResult ? (
          /* ── Success (server-authoritative result) ─────────────────── */
          <div className="p-6 space-y-4">
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle size={30} weight="fill" className="text-emerald-600" />
              </div>
              <h4 className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-100">
                Leave request submitted
              </h4>
              <p className="mt-1 text-sm text-gray-500">
                Your request is pending academic admin review.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center dark:border-gray-700 dark:bg-gray-800/40">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {submitResult.affectedOccurrences}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  Classes affected
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center dark:border-gray-700 dark:bg-gray-800/40">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatDateOnly(startDate)} → {formatDateOnly(endDate)}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  Leave period
                </p>
              </div>
              <div
                className={`rounded-xl border p-3 text-center ${
                  submitResult.isEmergency
                    ? 'border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20'
                    : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                }`}
              >
                <p
                  className={`text-sm font-bold ${
                    submitResult.isEmergency ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {submitResult.isEmergency ? 'Emergency request' : 'Normal request'}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  Server classification
                </p>
              </div>
            </div>

            {submitResult.timeUntilClass && (
              <p className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">
                First affected class starts in approximately{' '}
                <span className="font-semibold">{humanizeInterval(submitResult.timeUntilClass)}</span>.
              </p>
            )}

            <div className="flex justify-end border-t border-gray-100 pt-4 dark:border-gray-700">
              <button
                onClick={handleClose}
                className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Form ───────────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="space-y-5 p-6 max-h-[72vh] overflow-y-auto">
            {/* Date range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  From <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  min={today}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  To <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={today}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  required
                />
              </div>
            </div>

            {/* Category */}
            <div>
              <Select
                label="Leave category"
                value={category}
                onChange={(v) => setCategory(v as LeaveCategory)}
                options={CATEGORY_OPTIONS}
                placeholder="Select category"
              />
            </div>

            {/* Reason */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Reason <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Brief reason for your leave"
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            {/* Display-only affected-classes preview */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <CalendarBlank size={14} className="text-blue-600" />
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Affected classes (preview)
                </p>
              </div>

              {slotsLoading ? (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-200 py-6 text-sm text-gray-400">
                  <CircleNotch size={16} className="mr-2 animate-spin text-blue-600" />
                  Loading your timetable...
                </div>
              ) : previewGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-400 dark:border-gray-700">
                  No upcoming classes were found for the selected dates. The system only covers
                  your active recurring classes.
                </div>
              ) : (
                <div className="space-y-2">
                  {previewGroups.map((g) => (
                    <div
                      key={g.slot.timetableSlotId}
                      className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="font-bold text-gray-900 dark:text-gray-100">
                          {g.slot.batchName ?? 'Unknown batch'}
                          <span className="mx-1 text-gray-400">→</span>
                          {g.slot.subjectName ?? 'Unknown subject'}
                        </span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {SLOT_DAY_LABELS[g.slot.dayOfWeek] ?? '—'} ·{' '}
                          {formatSlotTime(g.slot.startTime)} – {formatSlotTime(g.slot.endTime)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {g.dates.map((d) => (
                          <span
                            key={d}
                            className={`inline-flex items-center rounded-lg px-2 py-1 font-mono text-[11px] font-semibold ${
                              d < today
                                ? 'bg-gray-200 text-gray-400 line-through dark:bg-gray-700'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            }`}
                          >
                            {dayLabel(d)} {formatDateOnly(d)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}

                  {hasPastDates && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Some dates are in the past — the system will reject leave covering classes
                      that have already started.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Informational emergency hint (never authoritative) */}
            {emergencyHint && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
                <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
                <span>
                  This request is likely to be classified as{' '}
                  <strong>emergency</strong> (less than 24 hours before the first class). It will
                  still be submitted — an admin is notified immediately.
                </span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5 dark:border-gray-700">
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <CircleNotch size={18} className="animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Leave Request'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** "1 day 02:00:00" → "1 day 2 hours". Best-effort humanisation. */
function humanizeInterval(interval: string): string {
  const match = /(?:(\d+) days?)?\s*(?:(\d+):)?(\d+):(\d+)/.exec(interval);
  if (!match) return interval;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (parts.length === 0) return 'a few minutes';
  return parts.join(' ');
}
