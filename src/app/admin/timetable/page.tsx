'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  useTimetableSlotList,
  useSetTimetableSlotStatus,
} from '@/hooks/admin/useTimetableAdmin';
import { useNextLessonPlans } from '@/hooks/admin/useLessonPlans';
import { toOccurrenceDate } from '@/utils/lessonOccurrences';
import { useBSTAvailableTeachers } from '@/hooks/admin/useBatchSubjectTeacherAssignment';
import { useBatches } from '@/hooks/academic/useBatches';
import { TimetableFormModal } from '@/components/admin/timetable/TimetableFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Select';
import {
  Plus,
  PencilSimple,
  Pause,
  Play,
  XCircle,
  CalendarBlank,
  List,
  CaretLeft,
  CaretRight,
  CalendarDots,
  NotePencil,
} from '@phosphor-icons/react';
import type { TimetableSlot, TimetableSlotStatus } from '@/types/timetable';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** "10:00:00" → "10:00 AM" (12-hour, minutes-only when on the hour is still shown). */
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Monday of the current week as a Date (used for calendar headers). */
function mondayOfWeek(base: Date): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminTimetablePage() {
  const { instituteId } = useAuth();

  // ── View + filters ──────────────────────────────────────────────────
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [weekAnchor, setWeekAnchor] = useState(() => mondayOfWeek(new Date()));
  const [teacherFilter, setTeacherFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  // 100/page so the calendar view (which has no pagination controls) shows
  // the full timetable; the list view still paginates via the DataTable.
  const pageSize = 100;

  // ── Modal / dialog state ────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimetableSlot | null>(null);
  const [modalSession, setModalSession] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<TimetableSlot | null>(null);

  // ── Feedback state (toast pattern from admin pages) ─────────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Filter data sources ─────────────────────────────────────────────
  const { data: teachersData } = useBSTAvailableTeachers(instituteId ?? '');
  const teacherOptions = useMemo(
    () => (teachersData ?? []).map((t) => ({ value: t.teacherId, label: t.teacherName })),
    [teachersData],
  );

  const { data: batchesData } = useBatches(
    instituteId ? { instituteId, includeDeleted: false } : undefined,
    undefined,
    { page: 1, pageSize: 100 },
  );
  const batchOptions = useMemo(
    () => (batchesData?.data ?? []).map((b) => ({ value: b.batchId, label: b.name })),
    [batchesData],
  );

  // ── Data fetching ───────────────────────────────────────────────────
  const filters = useMemo(
    () => ({
      instituteId: instituteId ?? undefined,
      teacherId: teacherFilter || undefined,
      batchId: batchFilter || undefined,
      status: (statusFilter || undefined) as TimetableSlotStatus | undefined,
    }),
    [instituteId, teacherFilter, batchFilter, statusFilter],
  );

  const { data, isLoading } = useTimetableSlotList(filters, { page, pageSize });
  const slots = useMemo(() => data?.data ?? [], [data]);

  // ── Next planned lesson per slot (admin-side parity of the teacher's
  //    per-class lesson display) ────────────────────────────────────────
  // "Today" is the INSTITUTE-local date (fallback Asia/Kolkata), never the
  // admin's browser clock — consistent with the lesson planner's timezone
  // convention (toOccurrenceDate mirrors migration 113's tz cast).
  const todayIso = useMemo(
    () => toOccurrenceDate(new Date().toISOString(), slots[0]?.instituteTimezone),
    [slots],
  );
  const slotIds = useMemo(() => slots.map((s) => s.timetableSlotId), [slots]);
  const { data: nextBySlot } = useNextLessonPlans(slotIds, todayIso);

  const statusMutation = useSetTimetableSlotStatus();
  const router = useRouter();

  // ── Actions ─────────────────────────────────────────────────────────
  const openLessonPlan = useCallback(
    (slot: TimetableSlot) => {
      router.push(`/admin/timetable/${slot.timetableSlotId}/lessons`);
    },
    [router],
  );
  const openCreate = useCallback(() => {
    setEditingSlot(null);
    setModalSession((s) => s + 1);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((slot: TimetableSlot) => {
    setEditingSlot(slot);
    setModalSession((s) => s + 1);
    setModalOpen(true);
  }, []);

  const handleStatusChange = useCallback(
    (slot: TimetableSlot, status: TimetableSlotStatus, successMsg: string) => {
      statusMutation.mutate(
        { timetableSlotId: slot.timetableSlotId, status },
        {
          onSuccess: () => showToast('success', successMsg),
          onError: (err) => showToast('error', err.message),
        },
      );
    },
    [statusMutation, showToast],
  );

  const handleCancelConfirm = useCallback(() => {
    if (!cancelTarget) return;
    const target = cancelTarget;
    statusMutation.mutate(
      { timetableSlotId: target.timetableSlotId, status: 'cancelled' },
      {
        onSuccess: () => {
          showToast('success', `Timetable for ${target.batchName ?? 'batch'} cancelled. No future classes will be generated.`);
          setCancelTarget(null);
        },
        onError: (err) => {
          showToast('error', err.message);
          setCancelTarget(null);
        },
      },
    );
  }, [cancelTarget, statusMutation, showToast]);

  const handleFilterChange = useCallback((setter: (val: string) => void, value: string) => {
    setter(value);
    setPage(1);
  }, []);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i)),
    [weekAnchor],
  );

  // Slots grouped by day_of_week for the calendar (all slots, filtered).
  const slotsByDay = useMemo(() => {
    const map = new Map<number, TimetableSlot[]>();
    for (const s of slots) {
      const list = map.get(s.dayOfWeek) ?? [];
      list.push(s);
      map.set(s.dayOfWeek, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return map;
  }, [slots]);

  // ── Table columns ───────────────────────────────────────────────────
  const columns = useMemo<Column<TimetableSlot>[]>(
    () => [
      {
        key: 'day',
        header: 'Day',
        render: (item) => (
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {DAY_LABELS[(item.dayOfWeek - 1 + 7) % 7]}
          </span>
        ),
      },
      {
        key: 'time',
        header: 'Time',
        render: (item) => (
          <span className="text-gray-600 dark:text-gray-400">
            {formatTime(item.startTime)} – {formatTime(item.endTime)}
          </span>
        ),
      },
      {
        key: 'subject',
        header: 'Subject',
        render: (item) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {item.subjectName ?? '—'}
          </span>
        ),
      },
      {
        key: 'batch',
        header: 'Batch',
        render: (item) => <span className="text-gray-700 dark:text-gray-300">{item.batchName ?? '—'}</span>,
      },
      {
        key: 'teacher',
        header: 'Teacher',
        render: (item) => <span className="text-gray-700 dark:text-gray-300">{item.teacherName ?? '—'}</span>,
      },
      {
        key: 'nextLesson',
        header: 'Next Lesson',
        render: (item) => {
          // Only active slots generate classes — paused/cancelled slots must
          // not imply an upcoming lesson.
          const next = item.status === 'active' ? nextBySlot?.[item.timetableSlotId] : undefined;
          return next ? (
            <span
              className="text-sm font-medium text-indigo-600 dark:text-indigo-400"
              title={`${next.occurrenceDate}${next.topicName ? ` · ${next.topicName}` : ''}`}
            >
              {next.chapterName ?? '—'}
              {next.topicName && <span className="text-indigo-500 dark:text-indigo-400/70"> · {next.topicName}</span>}
            </span>
          ) : (
            <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
          );
        },
      },
      {
        key: 'validity',
        header: 'Valid',
        render: (item) => (
          <span className="text-gray-600 dark:text-gray-400">
            {formatDate(item.validFrom)} → {formatDate(item.validUntil)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <StatusBadge status={item.status} />,
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (item) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Lesson Plan"
              onClick={(e) => {
                e.stopPropagation();
                openLessonPlan(item);
              }}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400"
            >
              <NotePencil size={16} />
            </button>
            <button
              type="button"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(item);
              }}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
            >
              <PencilSimple size={16} />
            </button>
            {item.status === 'active' ? (
              <button
                type="button"
                title="Pause"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStatusChange(item, 'paused', `Timetable paused. No future classes will be generated.`);
                }}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
              >
                <Pause size={16} />
              </button>
            ) : (
              item.status === 'paused' && (
                <button
                  type="button"
                  title="Activate"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStatusChange(item, 'active', `Timetable reactivated. Future classes will be generated again.`);
                  }}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400"
                >
                  <Play size={16} />
                </button>
              )
            )}
            {item.status !== 'cancelled' && (
              <button
                type="button"
                title="Cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  setCancelTarget(item);
                }}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
              >
                <XCircle size={16} />
              </button>
            )}
          </div>
        ),
      },
    ],
    [handleStatusChange, openEdit, openLessonPlan, nextBySlot],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Timetable"
        description="Manage recurring teaching schedules for teachers and batches."
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <Plus size={16} />
            Create Timetable
          </button>
        }
      />

      {/* Toolbar: view toggle + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'calendar'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <CalendarDots size={15} />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'list'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <List size={15} />
            List
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={teacherFilter}
            onChange={(v) => handleFilterChange(setTeacherFilter, v)}
            options={teacherOptions}
            placeholder="All Teachers"
            className="w-44"
          />
          <Select
            value={batchFilter}
            onChange={(v) => handleFilterChange(setBatchFilter, v)}
            options={batchOptions}
            placeholder="All Batches"
            className="w-44"
          />
          <Select
            value={statusFilter}
            onChange={(v) => handleFilterChange(setStatusFilter, v)}
            options={STATUS_OPTIONS}
            placeholder="All Statuses"
            className="w-40"
          />
        </div>
      </div>

      {/* ── Calendar view (weekly) ─────────────────────────────────── */}
      {view === 'calendar' && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
          {/* Week navigation */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWeekAnchor((w) => addDays(w, -7))}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                title="Previous week"
              >
                <CaretLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setWeekAnchor(() => mondayOfWeek(new Date()))}
                className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                This week
              </button>
              <button
                type="button"
                onClick={() => setWeekAnchor((w) => addDays(w, 7))}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                title="Next week"
              >
                <CaretRight size={16} />
              </button>
            </div>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {weekDates[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} –{' '}
              {weekDates[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className="hidden items-center gap-1.5 text-xs text-gray-400 sm:inline-flex">
              <CalendarBlank size={14} />
              Weekly recurring slots
            </span>
          </div>

          {/* Day columns */}
          <div className="grid grid-cols-1 gap-px overflow-x-auto bg-gray-100 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 dark:bg-gray-800">
            {DAY_LABELS.map((day, i) => {
              const dayNum = i + 1;
              const daySlots = slotsByDay.get(dayNum) ?? [];
              const isToday =
                weekDates[i].toDateString() === new Date().toDateString();
              return (
                <div key={day} className="min-h-[140px] bg-white p-3 dark:bg-gray-900">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {day}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        isToday
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {weekDates[i].getDate()}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {daySlots.map((slot) => (
                      <div
                        key={slot.timetableSlotId}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEdit(slot)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openEdit(slot);
                          }
                        }}
                        title="Edit timetable"
                        className="block w-full cursor-pointer rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700 dark:hover:bg-blue-900/20"
                      >
                        <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                          {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                        </p>
                        <p className="mt-0.5 truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                          {slot.subjectName ?? '—'}
                        </p>
                        <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                          {slot.batchName ?? '—'} · {slot.teacherName ?? '—'}
                        </p>
                        {(() => {
                          // Only active slots generate classes — paused/
                          // cancelled slots must not imply an upcoming lesson.
                          const next = slot.status === 'active' ? nextBySlot?.[slot.timetableSlotId] : undefined;
                          return next ? (
                            <p
                              className="mt-0.5 truncate text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
                              title={`${next.occurrenceDate} · ${next.chapterName ?? ''}${next.topicName ? ` · ${next.topicName}` : ''}`}
                            >
                              Next: {next.chapterName ?? '—'}
                              {next.topicName && (
                                <span className="font-normal text-indigo-500 dark:text-indigo-400/70">
                                  {' '}· {next.topicName}
                                </span>
                              )}
                            </p>
                          ) : null;
                        })()}
                        <div className="mt-1.5 flex items-center justify-between gap-1">
                          <StatusBadge status={slot.status} />
                          <Link
                            href={`/admin/timetable/${slot.timetableSlotId}/lessons`}
                            onClick={(e) => e.stopPropagation()}
                            title="Plan lessons for this slot"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                          >
                            <NotePencil size={12} />
                            Lessons
                          </Link>
                        </div>
                      </div>
                    ))}
                    {daySlots.length === 0 && (
                      <p className="text-[11px] text-gray-300 dark:text-gray-600">No slots</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── List view ───────────────────────────────────────────────── */}
      {view === 'list' && (
        <DataTable
          columns={columns}
          data={slots}
          keyExtractor={(item) => item.timetableSlotId}
          isLoading={isLoading}
          totalCount={data?.count ?? 0}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          emptyState={
            <EmptyState
              icon={<CalendarBlank size={32} />}
              title="No timetable slots found"
              description={
                teacherFilter || batchFilter || statusFilter
                  ? 'Try adjusting the filters, or create a new timetable slot.'
                  : 'Create your first recurring teaching slot to start building the institute timetable.'
              }
              action={
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
                >
                  <Plus size={16} />
                  Create Timetable
                </button>
              }
            />
          }
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg animate-[fadeIn_200ms_ease-out] ${
            toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
        >
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}

      {/* Create / Edit modal */}
      {modalOpen && (
        <TimetableFormModal
          key={modalSession}
          open={modalOpen}
          mode={editingSlot ? 'edit' : 'create'}
          slot={editingSlot}
          onClose={() => setModalOpen(false)}
          onSuccess={() =>
            showToast('success', editingSlot ? 'Timetable updated successfully.' : 'Timetable created successfully.')
          }
        />
      )}

      {/* Cancel confirmation */}
      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelConfirm}
        title="Cancel timetable?"
        message={`"${cancelTarget?.subjectName ?? ''} — ${cancelTarget?.batchName ?? 'batch'}" will stop generating future classes. Existing materialized classes are unaffected.`}
        confirmLabel="Cancel Timetable"
        loading={statusMutation.isPending}
        variant="warning"
      />
    </div>
  );
}
