'use client';

import { cn } from '@/lib/utils';
import { CaretDown } from '@phosphor-icons/react';
import type { ImportedRow, ImportGroup, ImportGroupMode } from '@/types/bulkTimetableImport';

/**
 * Name-resolution maps built once from `ReferenceData` so groups (which only
 * carry IDs) can display human-readable names without any extra queries.
 */
export interface DisplayMaps {
  teacherName: Map<string, string>;
  subjectName: Map<string, string>;
  batchName: Map<string, string>;
  /** batchSubjectId → "Subject — Batch" (honors batch_subjects.name override). */
  batchSubjectLabel: Map<string, string>;
  chapterName: Map<string, string>;
  topicName: Map<string, string>;
}

/** isodow 1..7 labels — mirrors the admin timetable page / lesson planner. */
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

/** "2026-08-10" → "10 Aug 2026" (UTC — date-only input, no tz shift). */
function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const MODE_META: Record<ImportGroupMode, { label: string; className: string }> = {
  create: {
    label: 'New',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  },
  reuse: {
    label: 'Reuse',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  },
  extend: {
    label: 'Extend',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  },
};

interface BulkTimetableGroupCardProps {
  group: ImportGroup;
  /** The group's valid, non-duplicate rows (for per-date lesson display). */
  rows: ImportedRow[];
  displayMaps: DisplayMaps;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One timetable-schedule card. The header is a real button (`aria-expanded`)
 * so expand/collapse is keyboard accessible. Lesson rows use the same
 * `Chapter:` / `Topic:` / `Notes:` label+value language as LessonOccurrenceCard.
 */
export function BulkTimetableGroupCard({
  group,
  rows,
  displayMaps,
  expanded,
  onToggle,
}: BulkTimetableGroupCardProps) {
  const subjectBatch =
    displayMaps.batchSubjectLabel.get(group.batchSubjectId) ?? 'Subject — Batch';
  const teacher = displayMaps.teacherName.get(group.teacherId) ?? '—';
  const dayLabel = DAY_LABELS[(group.dayOfWeek - 1 + 7) % DAY_LABELS.length] ?? '—';
  const modeMeta = MODE_META[group.mode];
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full px-5 py-4 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset dark:hover:bg-gray-800/40"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {subjectBatch}
            </p>
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">{teacher}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-5',
                modeMeta.className,
              )}
            >
              {modeMeta.label}
            </span>
            <CaretDown
              size={16}
              className={cn('text-gray-400 transition-transform', expanded && 'rotate-180')}
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span>
            {dayLabel} · {formatTime(group.startTime)} – {formatTime(group.endTime)}
          </span>
          <span>
            {formatDate(group.validFrom)} → {formatDate(group.validUntil)}
          </span>
          <span>
            {group.lessonCount} lesson{group.lessonCount === 1 ? '' : 's'}
          </span>
        </div>
      </button>

      {expanded && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100 px-5 py-2 dark:divide-gray-800 dark:border-gray-800">
          {sortedRows.length === 0 ? (
            <li className="py-3 text-sm text-gray-500 dark:text-gray-400">No lessons in this group.</li>
          ) : (
            sortedRows.map((row) => {
              const chapterName = row.chapterId ? displayMaps.chapterName.get(row.chapterId) : null;
              const topicName = row.topicId ? displayMaps.topicName.get(row.topicId) : null;
              return (
                <li key={`${group.key}-${row.date}-${row.row}`} className="flex gap-3 py-2.5">
                  <div className="w-24 shrink-0 text-sm font-medium text-gray-700 dark:text-gray-200">
                    {formatDate(row.date)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                    {chapterName && (
                      <p className="text-gray-700 dark:text-gray-300">
                        <span className="font-medium text-gray-500 dark:text-gray-400">Chapter:</span>{' '}
                        {chapterName}
                      </p>
                    )}
                    {topicName && (
                      <p className="text-gray-700 dark:text-gray-300">
                        <span className="font-medium text-gray-500 dark:text-gray-400">Topic:</span>{' '}
                        {topicName}
                      </p>
                    )}
                    {row.notes && (
                      <p className="truncate text-gray-500 dark:text-gray-400" title={row.notes}>
                        <span className="font-medium text-gray-500 dark:text-gray-400">Notes:</span>{' '}
                        {row.notes}
                      </p>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
