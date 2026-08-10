'use client';

import { StatusBadge } from '@/components/ui/StatusBadge';
import type { TimetableSlot } from '@/types/timetable';
import { CalendarBlank, Clock, User } from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Lesson Planner Header (Phase 2B)
//
//  Slot summary card for the lesson planner: Subject — Batch, teacher, day ·
//  time range, validity window, and the timetable status badge. Pure display
//  — no lesson editing controls yet (those arrive in Phase 2C/2D).
// ═══════════════════════════════════════════════════════════════════════════

/** isodow (1 = Monday … 7 = Sunday) labels — mirrors the admin timetable page. */
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

/** "2026-08-01" → "01 Aug 2026". */
function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

interface LessonPlannerHeaderProps {
  slot: TimetableSlot;
}

export function LessonPlannerHeader({ slot }: LessonPlannerHeaderProps) {
  const dayLabel = DAY_LABELS[(slot.dayOfWeek - 1 + 7) % DAY_LABELS.length] ?? '—';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {slot.subjectName ?? 'Subject'} — {slot.batchName ?? 'Batch'}
          </h2>
          <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
            <p className="flex items-center gap-1.5">
              <User size={15} className="shrink-0 text-gray-400" />
              <span className="truncate">
                Teacher: {slot.teacherName ?? '—'}
              </span>
            </p>
            <p className="flex items-center gap-1.5">
              <Clock size={15} className="shrink-0 text-gray-400" />
              <span className="truncate">
                {dayLabel} · {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
              </span>
            </p>
            <p className="flex items-center gap-1.5">
              <CalendarBlank size={15} className="shrink-0 text-gray-400" />
              <span className="truncate">
                {formatDate(slot.validFrom)} – {formatDate(slot.validUntil)}
              </span>
            </p>
          </div>
        </div>
        <StatusBadge status={slot.status} />
      </div>
    </div>
  );
}
