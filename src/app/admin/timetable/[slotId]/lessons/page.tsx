'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/config/supabase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { LessonPlannerHeader } from '@/components/admin/timetable/LessonPlannerHeader';
import { LessonMonthNavigator } from '@/components/admin/timetable/LessonMonthNavigator';
import {
  LessonOccurrenceList,
  type PreparedOccurrence,
} from '@/components/admin/timetable/LessonOccurrenceList';
import { LessonEditorModal } from '@/components/admin/timetable/LessonEditorModal';
import { type DataState } from '@/components/admin/timetable/LessonOccurrenceCard';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ArrowLeft, CalendarBlank } from '@phosphor-icons/react';
import {
  useLessonPlans,
  useSlotClassStatuses,
  useSlotSkips,
} from '@/hooks/admin/useLessonPlans';
import { generateOccurrenceDates, toOccurrenceDate } from '@/utils/lessonOccurrences';
import type { TimetableSlot, TimetableSlotStatus } from '@/types/timetable';
import type { LessonPlan, SkipKind, SlotClassStatus } from '@/types/lessonPlan';

// ═══════════════════════════════════════════════════════════════════════════
//  Slot resolution (Phase 2B)
//
//  The timetable admin service (timetableAdminService.ts) only exposes a
//  paginated slot LIST (TimetableFilters has no id filter) and is frozen for
//  this phase, so the page resolves the single slot with a direct PostgREST
//  query using the same embed + mapping as the admin service. This keeps the
//  route working purely off the authenticated admin's RLS boundary — the
//  slot row is only visible if the caller may read it in their institute.
// ═══════════════════════════════════════════════════════════════════════════

/** Raw snake_case shape of a `timetable_slots` row (with joins). */
interface DbTimetableSlot {
  timetable_slot_id: string;
  institute_id: string;
  teacher_id: string;
  batch_subject_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_until: string;
  status: TimetableSlotStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  teacher_details?: {
    teacher_id: string;
    profiles?: { name: string } | { name: string }[] | null;
  } | null;
  batch_subjects?: {
    batch_subject_id: string;
    batch_id: string;
    batches?: { name: string } | { name: string }[] | null;
    subjects?: { name: string } | { name: string }[] | null;
  } | null;
  institutes?: { timezone: string | null } | { timezone: string | null }[] | null;
}

/** PostgREST select with teacher + batch + subject joins (FK constraint hints). */
const SLOT_SELECT = `*,
  teacher_details!fk_timetable_slots_teacher (
    teacher_id,
    profiles!fk_teacher_details_profile ( name )
  ),
  batch_subjects!fk_timetable_slots_batch_subject (
    batch_subject_id,
    batch_id,
    batches!fk_batch_subjects_batch ( name ),
    subjects!fk_batch_subjects_subject ( name )
  ),
  institutes!fk_timetable_slots_institute ( timezone )`;

/** Unwrap a possibly-array joined relation into an object (PostgREST to-one). */
function pick<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Converts a raw snake_case DB row into a camelCase `TimetableSlot`. */
function mapTimetableSlot(db: DbTimetableSlot): TimetableSlot {
  const teacher = pick(db.teacher_details);
  const teacherProfile = pick(teacher?.profiles);
  const batchSubject = pick(db.batch_subjects);
  const batch = pick(batchSubject?.batches);
  const subject = pick(batchSubject?.subjects);
  const institute = pick(db.institutes);

  return {
    timetableSlotId: db.timetable_slot_id,
    instituteId: db.institute_id,
    teacherId: db.teacher_id,
    teacherName: teacherProfile?.name ?? null,
    batchSubjectId: db.batch_subject_id,
    batchId: batchSubject?.batch_id ?? null,
    batchName: batch?.name ?? null,
    subjectName: subject?.name ?? null,
    dayOfWeek: db.day_of_week,
    startTime: db.start_time,
    endTime: db.end_time,
    validFrom: db.valid_from,
    validUntil: db.valid_until,
    status: db.status,
    // Institute IANA timezone (defaults match institutes.timezone) — used by
    // Phase 2C to map a class's scheduled_at to its occurrence date.
    instituteTimezone: institute?.timezone || 'Asia/Kolkata',
    createdBy: db.created_by,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// ─── Date helpers (no external date library — matches the admin timetable page) ───

/** First day of the month containing `d`. */
function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Add months to a date (clamped to the first of the resulting month). */
function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

/** "YYYY-MM-DD" for a local date (used for range keys in Phase 2C). */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Editability (Phase 2C analysis §H — migration 113 is the authority)
//
//  The lesson_plans row is always writable for admins, but migration 113 only
//  propagates to FUTURE scheduled live_classes (status='scheduled' AND
//  scheduled_at > now()). Live/completed/cancelled/started classes and
//  skipped dates are therefore read-only in the UI.
// ═══════════════════════════════════════════════════════════════════════════

function computeEditState(
  occurrenceDate: string,
  classStatus: SlotClassStatus | null,
  skipKind: SkipKind | null,
  classesState: DataState,
  todayISO: string,
): { editable: boolean; lockedMessage: string | null } {
  if (classesState === 'error') {
    return { editable: false, lockedMessage: 'Class status could not be loaded — please refresh.' };
  }
  if (skipKind === 'holiday') {
    return { editable: false, lockedMessage: 'Holiday — no class will be generated.' };
  }
  if (skipKind === 'teacher_leave') {
    return { editable: false, lockedMessage: 'Teacher leave — no class will be generated.' };
  }
  if (classStatus) {
    switch (classStatus.status) {
      case 'live':
        return { editable: false, lockedMessage: 'Class is live — lesson cannot be changed.' };
      case 'completed':
        return { editable: false, lockedMessage: 'Class is completed — historical record.' };
      case 'cancelled':
        return { editable: false, lockedMessage: 'Class was cancelled.' };
      case 'scheduled':
        if (new Date(classStatus.scheduledAt).getTime() <= Date.now()) {
          return {
            editable: false,
            lockedMessage: 'Class has already started — topic cannot be changed.',
          };
        }
        return { editable: true, lockedMessage: null };
      default:
        // Unknown/edge statuses (e.g. draft) default to locked — only known
        // editable states are ever offered.
        return { editable: false, lockedMessage: 'Lesson cannot be changed for this class.' };
    }
  }
  // No materialized class yet — editable only for today/future occurrences.
  if (occurrenceDate < todayISO) {
    return { editable: false, lockedMessage: 'Past date — this occurrence has passed.' };
  }
  return { editable: true, lockedMessage: null };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminLessonPlannerPage() {
  const params = useParams<{ slotId: string }>();
  const slotId = params?.slotId ?? '';
  const { instituteId } = useAuth();

  // ── Month navigation state (owned here so Phase 2C can consume the range) ─
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(new Date()));

  const handlePrevMonth = useCallback(() => setMonthAnchor((m) => addMonths(m, -1)), []);
  const handleNextMonth = useCallback(() => setMonthAnchor((m) => addMonths(m, 1)), []);
  const handleToday = useCallback(() => setMonthAnchor(firstOfMonth(new Date())), []);

  // ── Lesson editor + feedback state (Phase 2C-3) ─────────────────────────
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  /** Inclusive YYYY-MM-DD range for the displayed month — consumed by Phase 2C. */
  const monthRange = useMemo(() => {
    const last = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
    return { from: toISODate(monthAnchor), to: toISODate(last) };
  }, [monthAnchor]);

  // ── Slot resolution ─────────────────────────────────────────────────────
  const {
    data: slot,
    isLoading,
    isError,
    error,
  } = useQuery<TimetableSlot | null>({
    queryKey: ['admin', 'timetable', 'slot', slotId],
    enabled: Boolean(slotId),
    queryFn: async () => {
      let query = supabase
        .from('timetable_slots')
        .select(SLOT_SELECT)
        .eq('timetable_slot_id', slotId);

      // Defense in depth: bind to the authenticated admin's institute. RLS
      // already enforces this; the explicit filter mirrors the admin list page.
      if (instituteId) {
        query = query.eq('institute_id', instituteId);
      }

      const { data, error: queryError } = await query.maybeSingle();

      if (queryError) {
        throw new Error(queryError.message);
      }
      if (!data) {
        return null;
      }

      return mapTimetableSlot(data as DbTimetableSlot);
    },
  });

  const slotMissing = !isLoading && !isError && !slot;

  // ── Month-scoped planner data (Phase 2C-2) ──────────────────────────────
  const lessonPlansQuery = useLessonPlans({
    timetableSlotId: slotId,
    from: monthRange.from,
    to: monthRange.to,
  });
  const classStatusesQuery = useSlotClassStatuses({
    timetableSlotId: slotId,
    from: monthRange.from,
    to: monthRange.to,
  });
  const skipsQuery = useSlotSkips({
    instituteId: slot?.instituteId ?? '',
    teacherId: slot?.teacherId ?? '',
    from: monthRange.from,
    to: monthRange.to,
  });

  const plansState: DataState = lessonPlansQuery.isLoading
    ? 'loading'
    : lessonPlansQuery.isError
      ? 'error'
      : 'ok';
  const classesState: DataState = classStatusesQuery.isLoading
    ? 'loading'
    : classStatusesQuery.isError
      ? 'error'
      : 'ok';
  const skipsState: DataState = skipsQuery.isLoading
    ? 'loading'
    : skipsQuery.isError
      ? 'error'
      : 'ok';

  /** Locally generated occurrence dates for the displayed month. */
  const occurrences = useMemo(
    () =>
      slot
        ? generateOccurrenceDates(
            slot.dayOfWeek,
            slot.validFrom,
            slot.validUntil,
            monthRange.from,
            monthRange.to,
          )
        : [],
    [slot, monthRange],
  );

  /** Join the three data sources + compute editability per occurrence. */
  const preparedOccurrences = useMemo<PreparedOccurrence[]>(() => {
    if (!slot) return [];

    const todayISO = toOccurrenceDate(new Date().toISOString(), slot.instituteTimezone);

    const planByDate = new Map<string, LessonPlan>();
    for (const plan of lessonPlansQuery.data ?? []) {
      planByDate.set(plan.occurrenceDate, plan);
    }

    const classByDate = new Map<string, SlotClassStatus>();
    for (const cls of classStatusesQuery.data ?? []) {
      const date = toOccurrenceDate(cls.scheduledAt, slot.instituteTimezone);
      if (date) classByDate.set(date, cls);
    }

    const skipKindByDate = skipsQuery.data?.kinds ?? {};

    return occurrences.map((occurrenceDate) => {
      const plan = planByDate.get(occurrenceDate) ?? null;
      const classStatus = classByDate.get(occurrenceDate) ?? null;
      const skipKind = skipKindByDate[occurrenceDate] ?? null;
      const { editable, lockedMessage } = computeEditState(
        occurrenceDate,
        classStatus,
        skipKind,
        classesState,
        todayISO,
      );
      return { occurrenceDate, plan, classStatus, skipKind, editable, lockedMessage };
    });
  }, [
    slot,
    occurrences,
    lessonPlansQuery.data,
    classStatusesQuery.data,
    skipsQuery.data,
    classesState,
  ]);

  const handleEditLesson = useCallback((occurrenceDate: string) => {
    setEditingDate(occurrenceDate);
  }, []);

  /** Existing plan for the occurrence being edited (prefill for the modal). */
  const editingPlan = useMemo(
    () =>
      editingDate
        ? (preparedOccurrences.find((o) => o.occurrenceDate === editingDate)?.plan ?? null)
        : null,
    [editingDate, preparedOccurrences],
  );

  // ── Shared back-to-timetable affordance ──────────────────────────────────
  const backToTimetable = (
    <Link
      href="/admin/timetable"
      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      <ArrowLeft size={16} />
      Back to Timetable
    </Link>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lesson Plan"
        description="Plan chapters and topics for each occurrence of this recurring timetable slot."
        breadcrumbs={[
          { label: 'Timetable', href: '/admin/timetable' },
          { label: 'Lesson Plan' },
        ]}
      />

      {isLoading && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <Skeleton className="mb-3 h-6 w-64" />
            <Skeleton className="mb-2 h-4 w-48" />
            <Skeleton className="mb-2 h-4 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {slotMissing && (
        <EmptyState
          icon={<CalendarBlank size={32} />}
          title="Timetable slot not found"
          description="This timetable slot does not exist or is outside your institute's scope."
          action={backToTimetable}
        />
      )}

      {isError && (
        <EmptyState
          icon={<CalendarBlank size={32} />}
          title="Failed to load timetable"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
          action={backToTimetable}
        />
      )}

      {!isLoading && !isError && slot && (
        <>
          <LessonPlannerHeader slot={slot} />

          <LessonMonthNavigator
            month={monthAnchor}
            onPrev={handlePrevMonth}
            onNext={handleNextMonth}
            onToday={handleToday}
          />

          <LessonOccurrenceList
            slot={slot}
            occurrences={preparedOccurrences}
            plansState={plansState}
            classesState={classesState}
            skipsState={skipsState}
            onEdit={handleEditLesson}
          />

          {editingDate && (
            <LessonEditorModal
              slot={slot}
              occurrenceDate={editingDate}
              plan={editingPlan}
              onClose={() => setEditingDate(null)}
              onSaved={(message) => {
                setEditingDate(null);
                showToast('success', message);
              }}
            />
          )}
        </>
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
    </div>
  );
}
