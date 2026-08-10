/**
 * Teacher Timetable Service
 *
 * Phase 2B — Teacher Timetable/Calendar. Read-only teacher-facing access to
 * the institute timetable (migration 108).
 *
 * ## Data model (authoritative)
 *
 *   timetable_slots  ──(batch_subject_id)──▶  batch_subjects  ──▶ batch + subject
 *        │                                        ▲
 *        │  materialize_timetable_classes()       │  batch_subject_live_classes
 *        ▼                                        │
 *   live_classes ─────────────────────────────────┘  (the actual class occurrence)
 *
 * The teacher does NOT write timetable_slots — migration 108 has no
 * INSERT/UPDATE/DELETE policies for teachers, and the SECURITY DEFINER RPCs
 * (create/update/set_status) reject non-admins. Teachers are limited to:
 *
 *   - SELECT own timetable_slots  (RLS: teacher_id = get_my_teacher_id())
 *   - SELECT own live_classes     (existing live-class RLS)
 *
 * All reads use the authenticated client (never the service role). The
 * calendar therefore distinguishes:
 *
 *   1. Recurring timetable information → timetable_slots (the rule)
 *   2. Actual generated occurrences      → live_classes (the materialized class)
 *
 * Batch/subject names are resolved through batch_subject_live_classes →
 * batch_subjects (NOT live_classes.subject_id — the deployed table has no
 * such column).
 *
 * @module services/teacher/teacherTimetableService
 */

import { supabase } from '@/config/supabase';
import {
  teacherLiveClassService,
  type LiveClassListItem,
} from '@/services/teacherLiveClassService';
import type { TimetableSlot, TimetableSlotStatus } from '@/types/timetable';

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Types
// ═══════════════════════════════════════════════════════════════════════════

/** Raw snake_case shape of a `timetable_slots` row with the batch_subject join. */
interface DbTeacherTimetableSlot {
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
  batch_subjects?: {
    batch_subject_id: string;
    batch_id: string;
    batches?: { name: string } | { name: string }[] | null;
    subjects?: { name: string } | { name: string }[] | null;
  } | null;
}

/**
 * PostgREST select for a teacher's own slots with batch + subject names.
 *
 * `teacher_details` is intentionally omitted — a teacher only ever sees their
 * OWN slots (RLS), so showing the teacher name is redundant and would add an
 * unnecessary join. The FK-hinted batch_subjects embed mirrors the admin
 * service and is safe for teachers (read policies on batch_subjects /
 * batches / subjects exist via migrations 021 / 066 / 082).
 */
const TEACHER_SLOT_SELECT = `*,
  batch_subjects!fk_timetable_slots_batch_subject (
    batch_subject_id,
    batch_id,
    batches!fk_batch_subjects_batch ( name ),
    subjects!fk_batch_subjects_subject ( name )
  )`;

/** Unwrap a possibly-array joined relation into an object (PostgREST to-one). */
function pick<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Converts a raw snake_case slot row into the consumer-facing TimetableSlot. */
function mapTeacherTimetableSlot(db: DbTeacherTimetableSlot): TimetableSlot {
  const batchSubject = pick(db.batch_subjects);
  const batch = pick(batchSubject?.batches);
  const subject = pick(batchSubject?.subjects);

  return {
    timetableSlotId: db.timetable_slot_id,
    instituteId: db.institute_id,
    teacherId: db.teacher_id,
    // Teacher name is deliberately null — the teacher only sees their own slots.
    teacherName: null,
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
    createdBy: db.created_by,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the authenticated teacher's recurring timetable slots.
 *
 * RLS restricts the query to `teacher_id = get_my_teacher_id()` — the explicit
 * `.eq('teacher_id', ...)` filter is defense-in-depth only. Sorted Monday-first
 * by day_of_week then start_time for a readable weekly schedule.
 *
 * @param teacherId - teacher_details.teacher_id of the current teacher.
 * @returns A flat list of the teacher's slots (empty on error — never throws).
 */
export async function getTeacherTimetableSlots(
  teacherId: string,
): Promise<TimetableSlot[]> {
  const { data, error } = await supabase
    .from('timetable_slots')
    .select(TEACHER_SLOT_SELECT)
    .eq('teacher_id', teacherId)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  if (error || !data) {
    console.error('[TeacherTimetable] Failed to fetch timetable slots:', error?.message);
    return [];
  }

  return (data as DbTeacherTimetableSlot[]).map(mapTeacherTimetableSlot);
}

/**
 * Fetch the teacher's ACTUAL classes (all statuses) inside an ISO date range.
 *
 * This is the materialized-occurrence source for the calendar. It reuses the
 * existing `teacherLiveClassService.getTeacherClasses()` enrichment path —
 * batch/subject names are resolved via batch_subject_live_classes →
 * batch_subjects, and every generated class behaves exactly like a manually
 * scheduled one.
 *
 * @param teacherId - teacher_details.teacher_id of the current teacher.
 * @param fromIso   - inclusive window start (ISO 8601, e.g. Monday 00:00 local).
 * @param toIso     - inclusive window end (ISO 8601, e.g. Sunday 23:59:59 local).
 * @returns Enriched class items, newest first (empty on error — never throws).
 */
export async function getTeacherClassesInRange(
  teacherId: string,
  fromIso: string,
  toIso: string,
): Promise<LiveClassListItem[]> {
  const result = await teacherLiveClassService.getTeacherClasses(teacherId, {
    fromDate: fromIso,
    toDate: toIso,
    // Only real calendar statuses — a 'draft' live class is never shown.
    status: ['scheduled', 'live', 'completed', 'cancelled'],
    // A week view rarely exceeds this; keeps the window query single-page.
    pageSize: 200,
  });

  return result.classes;
}
