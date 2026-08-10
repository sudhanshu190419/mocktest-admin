'use client';

/**
 * Teacher Timetable Page (Phase 2B)
 *
 * Read-only teacher calendar. Shows ONLY the current teacher's:
 *
 *   1. Recurring timetable rules   → `timetable_slots` (RLS: own slots only)
 *   2. Actual class occurrences    → `live_classes` in the visible week
 *                                    (timetable-materialized OR manually
 *                                    scheduled — both are plain live_classes)
 *
 * There are deliberately NO admin controls (no create/edit/delete timetable,
 * no institute selector). Starting a class reuses the EXISTING
 * `LiveStudioView` → `startScheduledClass` → LiveKit flow — no second
 * live-class implementation.
 *
 * @module app/teacher/timetable
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarBlank,
  CalendarDots,
  CaretLeft,
  CaretRight,
  CircleNotch,
  Clock,
  List,
  PlayCircle,
  SquaresFour,
  VideoCamera,
  XCircle,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ClassCard, type ClassAction } from '@/components/scheduling/ClassCard';
import { EditScheduledClassDialog } from '@/components/scheduling/EditScheduledClassDialog';
import { LiveStudioView } from '@/components/live-studio/LiveStudioView';
import { teacherLiveClassService, type LiveClassListItem } from '@/services/teacherLiveClassService';
import {
  useTeacherClassesInRange,
  useTeacherTimetableSlots,
} from '@/hooks/teacher/useTeacherTimetable';
import type { TimetableSlot, TimetableSlotStatus } from '@/types/timetable';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOT_DAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Monday 00:00:00 (local) of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const diff = (date.getDay() + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  return date;
}

/** The 7 dates (Mon→Sun) of the week starting at `weekStart`. */
function buildWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** "10:00 AM – 11:00 AM" from a scheduled_at + duration. */
function formatTimeRange(scheduledAt: string, durationMin: number): string {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** Formats a DB `time` value ("10:00:00") as "10:00 AM". */
function formatSlotTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return formatTime(date);
}

/** Formats a YYYY-MM-DD value as "11 Aug 2026". */
function formatDateOnly(isoDate: string): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Start-window state mirroring the server rule in
 * `start_scheduled_live_class()` (UX only — the RPC remains authoritative).
 */
function getStartWindowState(scheduledAt: string, durationMin: number): 'open' | 'not-open' | 'expired' {
  const start = new Date(scheduledAt).getTime();
  if (Number.isNaN(start)) return 'open';
  const EARLY_WINDOW_MS = 10 * 60 * 1000; // 10 min before scheduled_at
  const LATE_GRACE_MS = 15 * 60 * 1000;   // 15 min after duration
  const now = Date.now();
  if (now < start - EARLY_WINDOW_MS) return 'not-open';
  if (now > start + durationMin * 60_000 + LATE_GRACE_MS) return 'expired';
  return 'open';
}

function formatWeekLabel(start: Date, end: Date): string {
  const s = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const e = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${s} – ${e}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Compact status pill styles mirroring ClassCard's status config. */
function classStatusConfig(status: LiveClassListItem['status']) {
  switch (status) {
    case 'live':
      return { label: 'LIVE', bg: 'bg-green-50 text-green-700 border border-green-200', dot: 'bg-green-500 animate-pulse' };
    case 'scheduled':
      return { label: 'Scheduled', bg: 'bg-blue-50 text-blue-700 border border-blue-200', dot: 'bg-blue-500' };
    case 'completed':
      return { label: 'Completed', bg: 'bg-gray-50 text-gray-600 border border-gray-200', dot: 'bg-gray-400' };
    case 'cancelled':
      return { label: 'Cancelled', bg: 'bg-red-50 text-red-600 border border-red-200', dot: 'bg-red-400' };
    default:
      return { label: status, bg: 'bg-gray-50 text-gray-600 border border-gray-200', dot: 'bg-gray-400' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════

export default function TeacherTimetablePage() {
  const { teacherProfile } = useAuth();
  const teacherId = teacherProfile?.id;
  const queryClient = useQueryClient();

  // ── Week navigation ─────────────────────────────────────────────────
  const [visibleWeek, setVisibleWeek] = useState<Date>(() => startOfWeek(new Date()));
  const [view, setView] = useState<'week' | 'list'>('week');

  // ── LiveStudio integration (reuses the existing start-class flow) ───
  const [launchingClassId, setLaunchingClassId] = useState<string | null>(null);
  const [rejoinClassId, setRejoinClassId] = useState<string | null>(null);

  // ── Edit / cancel (parity with the existing Live Classes page) ──────
  const [editClassId, setEditClassId] = useState<string | null>(null);
  const [cancelClassId, setCancelClassId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const weekStart = useMemo(() => startOfWeek(visibleWeek), [visibleWeek]);
  const weekDays = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const fromIso = useMemo(() => weekStart.toISOString(), [weekStart]);
  const toIso = useMemo(() => {
    // Sunday 23:59:59.999 local — setDate-based so DST transitions stay correct.
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }, [weekStart]);

  // ── Data ────────────────────────────────────────────────────────────
  const slotsQuery = useTeacherTimetableSlots(teacherId);
  const classesQuery = useTeacherClassesInRange(teacherId, fromIso, toIso);

  // Stabilised references so the memo below never depends on fresh arrays.
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const slots = useMemo(() => slotsQuery.data ?? [], [slotsQuery.data]);

  /** Classes grouped by local weekday (index 0 = Monday … 6 = Sunday). */
  const classesByDay = useMemo(() => {
    const map: LiveClassListItem[][] = Array.from({ length: 7 }, () => []);
    for (const c of classes) {
      const idx = (new Date(c.scheduledAt).getDay() + 6) % 7;
      map[idx].push(c);
    }
    for (const day of map) {
      day.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    }
    return map;
  }, [classes]);

  // ── Refetch helpers ─────────────────────────────────────────────────
  const refreshClasses = useCallback(() => {
    if (!teacherId) return;
    // Prefix invalidation covers every week window for this teacher.
    queryClient.invalidateQueries({ queryKey: ['teacher-timetable', 'classes', teacherId] });
  }, [queryClient, teacherId]);

  // ── Actions (identical to the existing Live Classes page) ───────────
  const handleAction = useCallback((action: ClassAction) => {
    switch (action.type) {
      case 'start':
        setLaunchingClassId(action.classId);
        break;
      case 'rejoin':
        setRejoinClassId(action.classId);
        break;
      case 'edit':
        setEditClassId(action.classId);
        break;
      case 'cancel':
        setCancelClassId(action.classId);
        break;
      case 'view':
        break;
    }
  }, []);

  /** Calendar pill click — Start (scheduled) / Rejoin (live). */
  const handlePillAction = useCallback((item: LiveClassListItem) => {
    if (item.status === 'scheduled') setLaunchingClassId(item.classId);
    else if (item.status === 'live') setRejoinClassId(item.classId);
  }, []);

  const confirmCancel = useCallback(async () => {
    if (!cancelClassId || !teacherId) return;
    setCancelling(true);
    try {
      await teacherLiveClassService.cancelScheduledClass(cancelClassId, teacherId);
      setCancelClassId(null);
      refreshClasses();
    } finally {
      setCancelling(false);
    }
  }, [cancelClassId, teacherId, refreshClasses]);

  // ── Loading / empty states ──────────────────────────────────────────
  const loading = classesQuery.isLoading || slotsQuery.isLoading;
  const today = new Date();

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">My Timetable</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Classes assigned to you — scheduled by the institute timetable
          </p>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          <button
            onClick={() => setView('week')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-all',
              view === 'week' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <SquaresFour size={15} weight={view === 'week' ? 'fill' : 'regular'} />
            Week
          </button>
          <button
            onClick={() => setView('list')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-all',
              view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <List size={15} weight={view === 'list' ? 'fill' : 'regular'} />
            List
          </button>
        </div>
      </div>

      {/* ── Week navigator ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVisibleWeek((prev) => addDays(prev, -7))}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            aria-label="Previous week"
          >
            <CaretLeft size={16} />
          </button>
          <button
            onClick={() => setVisibleWeek(startOfWeek(new Date()))}
            className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Today
          </button>
          <button
            onClick={() => setVisibleWeek((prev) => addDays(prev, 7))}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            aria-label="Next week"
          >
            <CaretRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <CalendarBlank size={16} className="text-blue-600" />
          {formatWeekLabel(weekDays[0], weekDays[6])}
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500" /> Scheduled
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" /> Live
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gray-400" /> Completed
          </span>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <CircleNotch size={36} className="animate-spin text-blue-600" />
          <p className="text-sm text-gray-500 font-medium">Loading your timetable...</p>
        </div>
      ) : (
        <>
          {/* ── Week calendar view ────────────────────────────────── */}
          {view === 'week' && (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="grid min-w-[980px] grid-cols-7 divide-x divide-gray-100">
                {weekDays.map((day, idx) => {
                  const isToday = isSameLocalDay(day, today);
                  const dayClasses = classesByDay[idx];
                  return (
                    <div key={day.toISOString()} className="min-h-[320px] bg-white">
                      {/* Day header */}
                      <div
                        className={cn(
                          'flex flex-col items-center gap-0.5 border-b border-gray-100 px-2 py-3',
                          isToday ? 'bg-blue-50/70' : 'bg-gray-50/50',
                        )}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                          {DAY_LABELS[idx]}
                        </span>
                        <span
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold',
                            isToday ? 'bg-blue-600 text-white' : 'text-gray-800',
                          )}
                        >
                          {day.getDate()}
                        </span>
                      </div>

                      {/* Day content */}
                      <div className="flex flex-col gap-2 p-2">
                        {dayClasses.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-gray-200 px-2 py-6 text-center">
                            <p className="text-[11px] text-gray-300 font-medium">No classes</p>
                          </div>
                        ) : (
                          dayClasses.map((item) => (
                            <ClassPill key={item.classId} item={item} onAction={handlePillAction} />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── List view ──────────────────────────────────────────── */}
          {view === 'list' && (
            <div>
              {classes.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
                  <CalendarBlank size={32} className="text-gray-300 mb-3" />
                  <h4 className="text-base font-bold text-gray-700 mb-1">No classes this week</h4>
                  <p className="text-sm text-gray-400 max-w-sm">
                    Materialized timetable classes and manually scheduled classes for this week will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {classes.map((item) => (
                    <ClassCard key={item.classId} item={item} onAction={handleAction} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Recurring timetable (the rules behind the classes) ─── */}
          <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
              <CalendarDots size={18} className="text-blue-600" />
              <h3 className="text-base font-bold text-gray-900">Your Recurring Timetable</h3>
              <span className="ml-auto text-xs text-gray-400">
                Set by the institute · weekly schedule
              </span>
            </div>

            {slots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CalendarDots size={30} className="text-gray-300 mb-2" />
                <p className="text-sm font-medium text-gray-600">No recurring timetable assigned yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Once the institute schedules your classes, your weekly slots will appear here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {slots.map((slot) => (
                  <RecurringSlotRow key={slot.timetableSlotId} slot={slot} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* ── Start / Rejoin class (existing LiveStudioView flow) ────── */}
      <LiveStudioView
        isOpen={!!launchingClassId || !!rejoinClassId}
        onClose={() => {
          setLaunchingClassId(null);
          setRejoinClassId(null);
          refreshClasses();
        }}
        scheduledClassId={launchingClassId ?? undefined}
        rejoinClassId={rejoinClassId ?? undefined}
        onLiveClassStarted={refreshClasses}
      />

      {/* ── Edit scheduled class (parity with Live Classes page) ───── */}
      {editClassId && (
        <EditScheduledClassDialog
          isOpen={!!editClassId}
          onClose={() => setEditClassId(null)}
          teacherId={teacherId ?? ''}
          classId={editClassId}
          onUpdated={refreshClasses}
        />
      )}

      {/* ── Cancel confirmation ───────────────────────────────────── */}
      {cancelClassId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mx-auto">
              <XCircle size={24} className="text-red-500" />
            </div>
            <h3 className="text-center text-lg font-bold text-gray-900 mb-1">Cancel Class?</h3>
            <p className="text-center text-sm text-gray-500 mb-6">
              This action cannot be undone. Students will be notified if the class is cancelled.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelClassId(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Keep Class
              </button>
              <button
                onClick={confirmCancel}
                disabled={cancelling}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cancelling ? (
                  <>
                    <CircleNotch size={16} className="animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Yes, Cancel'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sub-components
// ═══════════════════════════════════════════════════════════════════════════

/** Compact calendar cell for one class occurrence. */
function ClassPill({
  item,
  onAction,
}: {
  item: LiveClassListItem;
  onAction: (item: LiveClassListItem) => void;
}) {
  const cfg = classStatusConfig(item.status);
  const startWindow = getStartWindowState(item.scheduledAt, item.durationMin);
  const canStart = item.status === 'scheduled' && startWindow === 'open';
  const startNotOpen = item.status === 'scheduled' && startWindow === 'not-open';
  const startExpired = item.status === 'scheduled' && startWindow === 'expired';
  const interactive = canStart || item.status === 'live';
  const firstBS = item.assignedBatchSubjects?.[0];

  return (
    <button
      type="button"
      onClick={() => interactive && onAction(item)}
      disabled={!interactive}
      className={cn(
        'group w-full rounded-xl p-2.5 text-left transition-all',
        cfg.bg,
        interactive && 'cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] font-bold text-gray-600">
          {formatTimeRange(item.scheduledAt, item.durationMin)}
        </span>
        <span className="flex items-center gap-1 text-[10px] font-extrabold">
          <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
          {cfg.label}
        </span>
      </div>

      <p className="mt-1.5 truncate text-xs font-bold text-gray-900" title={item.title}>
        {item.title}
      </p>

      {firstBS ? (
        <p className="mt-0.5 truncate text-[11px] text-gray-600">
          {firstBS.batchName} <span className="text-gray-400">→</span> {firstBS.subjectName}
        </p>
      ) : (
        <p className="mt-0.5 truncate text-[11px] text-gray-600">{item.batchName || 'Unassigned'}</p>
      )}

      {/* Planned lesson (chapter/topic from the admin lesson plan) */}
      {item.chapterName && (
        <p
          className="mt-1 truncate text-[11px] font-semibold text-indigo-700 dark:text-indigo-300"
          title={`${item.chapterName}${item.topicName ? ` — ${item.topicName}` : ''}`}
        >
          {item.chapterName}
          {item.topicName && <span className="font-normal text-indigo-500 dark:text-indigo-400"> · {item.topicName}</span>}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        {canStart && (
          <span className="flex items-center gap-1 rounded-lg bg-green-600 px-2 py-1 text-[10px] font-bold text-white">
            <PlayCircle size={12} weight="fill" />
            Go Live
          </span>
        )}
        {startNotOpen && (
          <span className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
            <Clock size={11} />
            Starts {formatTime(new Date(item.scheduledAt))}
          </span>
        )}
        {startExpired && (
          <span className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-semibold text-gray-500">
            <Clock size={11} />
            Window expired
          </span>
        )}
        {item.status === 'live' && (
          <span className="flex items-center gap-1 rounded-lg bg-green-600 px-2 py-1 text-[10px] font-bold text-white animate-pulse">
            <VideoCamera size={12} weight="fill" />
            Rejoin
          </span>
        )}
        {!interactive && !startNotOpen && !startExpired && (
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <Clock size={11} />
            {item.durationMin} min
          </span>
        )}
      </div>
    </button>
  );
}

/** One row of the teacher's recurring weekly schedule. */
function RecurringSlotRow({ slot }: { slot: TimetableSlot }) {
  const slotStatusLabel: Record<TimetableSlotStatus, string> = {
    active: 'Active',
    paused: 'Paused',
    cancelled: 'Cancelled',
  };

  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50/70">
      {/* Day + time */}
      <div className="w-44 shrink-0">
        <p className="text-sm font-bold text-gray-800">{SLOT_DAY_LABELS[slot.dayOfWeek] ?? '—'}</p>
        <p className="font-mono text-xs text-gray-500">
          {formatSlotTime(slot.startTime)} – {formatSlotTime(slot.endTime)}
        </p>
      </div>

      {/* Batch → Subject */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-800">
          {slot.batchName ?? 'Unknown batch'}
          <span className="text-gray-400 mx-1.5">→</span>
          {slot.subjectName ?? 'Unknown subject'}
        </p>
        <p className="text-xs text-gray-400">
          Valid {formatDateOnly(slot.validFrom)} – {formatDateOnly(slot.validUntil)}
        </p>
      </div>

      {/* Status */}
      <div className="shrink-0">
        <StatusBadge status={slot.status} />
        {slot.status !== 'active' && (
          <p className="mt-0.5 text-[10px] text-gray-400">{slotStatusLabel[slot.status]} — no new classes</p>
        )}
      </div>
    </li>
  );
}
