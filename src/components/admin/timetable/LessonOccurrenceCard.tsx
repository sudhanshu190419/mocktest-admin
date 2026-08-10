'use client';

import { cn } from '@/lib/utils';
import { NotePencil } from '@phosphor-icons/react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import type { LessonPlan, SkipKind, SlotClassStatus } from '@/types/lessonPlan';

/**
 * Per-axis data state for the occurrence list. The page derives this from the
 * React Query results so the card can distinguish "still loading" and "failed
 * to load" from a genuine empty result — e.g. a failed class-status query must
 * never be rendered as "Not generated".
 */
export type DataState = 'ok' | 'loading' | 'error';

/** isodow 1..7 labels (mirrors the admin timetable page). */
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "10:00:00" → "10:00 AM" (12-hour). */
function formatTime(value: string): string {
  if (!value) return '—';
  const parts = value.split(':');
  if (parts.length < 2) return value;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${suffix}`;
}

/** "2026-08-17" → "17 AUGUST" (UTC — date-only input, no local-tz shift). */
function formatDayDate(occurrenceDate: string): string {
  const d = new Date(`${occurrenceDate}T00:00:00.000Z`);
  return d
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'long', timeZone: 'UTC' })
    .toUpperCase();
}

/** Small non-StatusBadge pill for lesson/skip states (kept distinct from class status). */
function StatusChip({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5',
        className,
      )}
    >
      {label}
    </span>
  );
}

interface LessonOccurrenceCardProps {
  /** YYYY-MM-DD occurrence date (from the timetable rule). */
  occurrenceDate: string;
  /** isodow 1..7 for the "MONDAY · 17 AUGUST" label. */
  dayOfWeek: number;
  /** Wall-clock start time ("HH:MM:SS") from the slot. */
  startTime: string;
  /** Wall-clock end time ("HH:MM:SS") from the slot. */
  endTime: string;
  /** lesson_plans row for this date (null = no plan). */
  plan: LessonPlan | null;
  plansState: DataState;
  /** live_classes row for this date (null = not generated yet). */
  classStatus: SlotClassStatus | null;
  classesState: DataState;
  /** holiday | teacher_leave when this date is skipped (null = not skipped). */
  skipKind: SkipKind | null;
  skipsState: DataState;
  /** Whether the Add/Edit lesson action should be offered (computed by the page). */
  editable: boolean;
  /** Explanatory text for locked states ("" = no message needed). */
  lockedMessage: string | null;
  /** Phase 2C-3 will wire this to the lesson editor modal — it only passes the date. */
  onEdit: (occurrenceDate: string) => void;
}

/**
 * One occurrence card in the lesson planner.
 *
 * Keeps the three data sources separate — LESSON (lesson_plans), CLASS
 * (live_classes), SKIP (institute_holidays / teacher_leaves) — and combines
 * them only visually. Never merges them into a single artificial status.
 */
export function LessonOccurrenceCard({
  occurrenceDate,
  dayOfWeek,
  startTime,
  endTime,
  plan,
  plansState,
  classStatus,
  classesState,
  skipKind,
  skipsState,
  editable,
  lockedMessage,
  onEdit,
}: LessonOccurrenceCardProps) {
  const dayLabel = DAY_LABELS[(dayOfWeek - 1 + 7) % DAY_LABELS.length] ?? '—';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600">
      {/* Header: date/time + state badges */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {dayLabel} · {formatDayDate(occurrenceDate)}
          </p>
          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
            {formatTime(startTime)} – {formatTime(endTime)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* CLASS */}
          {classesState === 'loading' ? (
            <Skeleton className="h-5 w-20" />
          ) : classesState === 'error' ? (
            <StatusChip
              className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
              label="Class status unavailable"
            />
          ) : (
            <StatusBadge status={classStatus?.status ?? 'not_generated'} />
          )}

          {/* LESSON */}
          {plansState === 'loading' ? (
            <Skeleton className="h-5 w-16" />
          ) : plansState === 'error' ? (
            <StatusChip
              className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
              label="Lesson info unavailable"
            />
          ) : plan ? (
            <StatusChip
              className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
              label="Lesson: Planned"
            />
          ) : (
            <StatusChip
              className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
              label="Lesson: Not planned"
            />
          )}

          {/* SKIP */}
          {skipsState === 'error' ? (
            <StatusChip
              className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
              label="Skip info unavailable"
            />
          ) : skipKind === 'holiday' ? (
            <StatusChip
              className="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
              label="Holiday"
            />
          ) : skipKind === 'teacher_leave' ? (
            <StatusChip
              className="bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400"
              label="Teacher Leave"
            />
          ) : null}
        </div>
      </div>

      {/* Lesson body */}
      <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        {plansState === 'loading' ? (
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : plansState === 'error' ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Lesson info unavailable.</p>
        ) : plan ? (
          <div className="space-y-1 text-sm">
            {plan.chapterName && (
              <p className="text-gray-700 dark:text-gray-300">
                <span className="font-medium text-gray-500 dark:text-gray-400">Chapter:</span>{' '}
                {plan.chapterName}
              </p>
            )}
            {plan.topicName && (
              <p className="text-gray-700 dark:text-gray-300">
                <span className="font-medium text-gray-500 dark:text-gray-400">Topic:</span>{' '}
                {plan.topicName}
              </p>
            )}
            {plan.notes && (
              <p className="truncate text-gray-500 dark:text-gray-400" title={plan.notes}>
                <span className="font-medium text-gray-500 dark:text-gray-400">Notes:</span>{' '}
                {plan.notes}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">No lesson planned</p>
        )}
      </div>

      {/* Action / locked explanation */}
      <div className="mt-3 flex items-center justify-end">
        {classesState === 'loading' ? (
          <Skeleton className="h-8 w-28" />
        ) : editable ? (
          <button
            type="button"
            onClick={() => onEdit(occurrenceDate)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
          >
            <NotePencil size={14} />
            {plan ? 'Edit Lesson' : 'Add Lesson'}
          </button>
        ) : (
          lockedMessage && (
            <p className="text-right text-xs text-gray-400 dark:text-gray-500">{lockedMessage}</p>
          )
        )}
      </div>
    </div>
  );
}
