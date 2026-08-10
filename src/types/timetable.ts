/**
 * Timetable Types
 *
 * Institute-owned recurring teaching schedule (Phase 1 database foundation —
 * migration 108). A timetable slot is a RECURRING RULE, not a single class:
 *
 *   "Physics / JEE Batch A / Teacher Rahul / Monday 10:00–11:00 / valid 1 Apr
 *    2026 → 31 Mar 2027"
 *
 * Occurrences are materialized into the EXISTING `live_classes` table via
 * `materialize_timetable_classes()` (not part of this UI phase).
 *
 * Mirrors the `timetable_slots` table created in migration 108:
 *   - enum timetable_slot_status: active | paused | cancelled
 *   - day_of_week uses PostgreSQL isodow (1 = Monday … 7 = Sunday)
 *   - start_time/end_time are wall-clock `time` values interpreted in the
 *     institute's timezone (institutes.timezone, default Asia/Kolkata)
 *   - ALL writes go through SECURITY DEFINER RPCs:
 *       create_timetable_slot, update_timetable_slot, set_timetable_slot_status
 *
 * @module types/timetable
 */

/** Lifecycle of a timetable slot (`timetable_slot_status` enum from migration 108). */
export type TimetableSlotStatus = 'active' | 'paused' | 'cancelled';

/** Day of week in PostgreSQL isodow semantics (1 = Monday … 7 = Sunday). */
export type TimetableDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A timetable slot row (camelCase, consumer-facing, with joined names). */
export interface TimetableSlot {
  timetableSlotId: string;
  instituteId: string;
  /** teacher_details.teacher_id (FK). */
  teacherId: string;
  /** Joined teacher display name (teacher_details → profiles.name). */
  teacherName: string | null;
  /** batch_subjects.batch_subject_id (FK) — encodes batch + subject together. */
  batchSubjectId: string;
  /** Joined batch id (via batch_subjects.batch_id). */
  batchId: string | null;
  /** Joined batch name. */
  batchName: string | null;
  /** Joined subject name (via batch_subjects.subjects.name). */
  subjectName: string | null;
  /** isodow 1..7 (1 = Monday). */
  dayOfWeek: number;
  /** Wall-clock start time, "HH:MM:SS" from the DB. */
  startTime: string;
  /** Wall-clock end time, "HH:MM:SS" from the DB. */
  endTime: string;
  /** Validity window start (YYYY-MM-DD). */
  validFrom: string;
  /** Validity window end (YYYY-MM-DD). */
  validUntil: string;
  status: TimetableSlotStatus;
  /**
   * Joined institute IANA timezone (`institutes.timezone`, default
   * "Asia/Kolkata"). Optional — set by the lesson planner's slot resolution;
   * other mappers may omit it. Fall back to the project default when null.
   */
  instituteTimezone?: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Filters for the admin timetable slot list. */
export interface TimetableFilters {
  instituteId?: string;
  /** Filter by teacher (teacher_details.teacher_id). */
  teacherId?: string;
  /** Filter by batch (batch_subjects.batch_id). */
  batchId?: string;
  status?: TimetableSlotStatus;
}

/** Input for creating a timetable slot via create_timetable_slot RPC. */
export interface CreateTimetableSlotParams {
  instituteId: string;
  /** teacher_details.teacher_id of the assigned teacher. */
  teacherId: string;
  /** batch_subjects.batch_subject_id (encodes batch + subject). */
  batchSubjectId: string;
  /** isodow 1..7 (1 = Monday). */
  dayOfWeek: number;
  /** "HH:MM" wall-clock start time in the institute timezone. */
  startTime: string;
  /** "HH:MM" wall-clock end time in the institute timezone. */
  endTime: string;
  /** "YYYY-MM-DD". */
  validFrom: string;
  /** "YYYY-MM-DD". */
  validUntil: string;
  /** profiles.profile_id of the acting admin. */
  createdBy: string;
}

/** Input for updating a timetable slot via update_timetable_slot RPC. */
export interface UpdateTimetableSlotParams {
  timetableSlotId: string;
  teacherId: string;
  batchSubjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string;
}
