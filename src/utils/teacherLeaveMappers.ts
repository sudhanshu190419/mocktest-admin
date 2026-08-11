/**
 * Teacher Leave + Class Resolution — Pure DB Row Mappers
 *
 * Pure snake_case → camelCase mapping functions for migration-115 reads and
 * RPC results. Kept free of any Supabase import so they are unit-testable in
 * the Node vitest environment and shared by the teacher/admin services.
 *
 * @module utils/teacherLeaveMappers
 */

import type {
  CancelLeaveRequestResult,
  ClassResolution,
  LeaveCategory,
  LeaveOccurrence,
  LeaveRequestStatus,
  ResolutionResult,
  ResolutionStatus,
  ResolutionType,
  ReviewLeaveRequestResult,
  SubmitLeaveRequestResult,
  TeacherLeaveRequest,
} from '@/types/teacherLeave';

// ═══════════════════════════════════════════════════════════════════════════
//  Raw row shapes (snake_case, as returned by PostgREST with RLS applied)
// ═══════════════════════════════════════════════════════════════════════════

/** A to-one embedded relation — PostgREST may return an object or a 1-element array. */
type EmbeddedOne<T> = T | T[] | null | undefined;

/** teacher_leave_requests row + optional joined teacher/occurrences/resolutions. */
export interface DbTeacherLeaveRequestRow {
  leave_id: string;
  teacher_id: string;
  institute_id: string;
  leave_category: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  is_emergency: boolean | null;
  time_until_class: string | null;
  affected_occurrences: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_remarks: string | null;
  created_at: string;
  updated_at: string;
  /** Joined teacher (admin reads): teacher_details → profiles. */
  teacher?: {
    teacher_id: string;
    department?: string | null;
    profile?: EmbeddedOne<{ profile_id: string; name: string | null }>;
  } | null;
  /** Embedded occurrences (teacher detail read). */
  occurrences?: DbLeaveOccurrenceRow[] | null;
  /** Embedded resolutions (lite or full — see DbClassResolutionLite). */
  resolutions?: (DbClassResolutionRow | DbClassResolutionLite)[] | null;
}

/** Lite resolution projection used by list queries (counts only). */
export interface DbClassResolutionLite {
  status: string;
  resolution_type: string;
}

/** leave_request_occurrences row + joined timetable slot (batch/subject names). */
export interface DbLeaveOccurrenceRow {
  leave_request_occurrence_id: string;
  leave_request_id: string;
  timetable_slot_id: string;
  occurrence_date: string;
  created_at: string;
  slot?: {
    timetable_slot_id: string;
    day_of_week: number;
    start_time: string | null;
    end_time: string | null;
    batch_subject_id: string;
    batch_subjects?: {
      batch_subject_id: string;
      batch_id: string;
      subject_id: string;
      batches?: EmbeddedOne<{ name: string }>;
      subjects?: EmbeddedOne<{ name: string }>;
    } | null;
  } | null;
}

/** class_resolution_events row + optional joined display relations. */
export interface DbClassResolutionRow {
  resolution_id: string;
  institute_id: string;
  leave_request_id: string | null;
  timetable_slot_id: string;
  occurrence_date: string;
  class_id: string | null;
  resolution_type: string;
  status: string;
  prev_teacher_id: string | null;
  new_teacher_id: string | null;
  new_scheduled_at: string | null;
  new_duration_min: number | null;
  recording_id: string | null;
  mock_test_id: string | null;
  reason: string | null;
  notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  prev_teacher?: {
    teacher_id: string;
    profile?: EmbeddedOne<{ profile_id: string; name: string | null }>;
  } | null;
  new_teacher?: {
    teacher_id: string;
    profile?: EmbeddedOne<{ profile_id: string; name: string | null }>;
  } | null;
  /** Alias `resolved_by_profile` avoids the `resolved_by` column collision. */
  resolved_by_profile?: EmbeddedOne<{ profile_id: string; name: string | null }>;
  /** The live `recordings` table has no `title` column — display name comes
   * from the source class: recordings.class_id → live_classes.title. */
  recording?: {
    recording_id: string;
    source_class?: EmbeddedOne<{ title: string }>;
  } | null;
  mock_test?: { test_id: string; title: string } | null;
  live_class?: { class_id: string; status: string } | null;
}

/** Raw JSONB result of submit_teacher_leave_request. */
export interface DbSubmitLeaveResult {
  success: boolean;
  leave_id: string;
  is_emergency: boolean;
  affected_occurrences: number;
  time_until_class: string | null;
}

/** Raw JSONB result of cancel_teacher_leave_request / review_teacher_leave_request. */
export interface DbLeaveReviewResult {
  success: boolean;
  leave_id: string;
  status: string;
}

/** Raw JSONB result of any resolution RPC. */
export interface DbResolutionResult {
  success: boolean;
  resolution_id: string;
  type?: string;
  class_id?: string | null;
  new_scheduled_at?: string | null;
  recording_id?: string | null;
  test_id?: string | null;
  status?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Unwrap a PostgREST to-one relation (object or 1-element array) → object|null. */
export function pickOne<T>(value: EmbeddedOne<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Row mappers
// ═══════════════════════════════════════════════════════════════════════════

export function mapTeacherLeaveRequestRow(
  row: DbTeacherLeaveRequestRow,
): TeacherLeaveRequest {
  const teacherProfile = pickOne(row.teacher?.profile);
  const resolutions = row.resolutions ?? [];

  const fullResolutions = resolutions.some((r) => 'resolution_id' in r)
    ? (resolutions as DbClassResolutionRow[]).map(mapClassResolutionRow)
    : undefined;

  return {
    leaveId: row.leave_id,
    teacherId: row.teacher_id,
    instituteId: row.institute_id,
    leaveCategory: row.leave_category as LeaveCategory,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status as LeaveRequestStatus,
    isEmergency: row.is_emergency ?? false,
    timeUntilClass: row.time_until_class,
    affectedOccurrences: row.affected_occurrences ?? 0,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewerRemarks: row.reviewer_remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    teacherName: teacherProfile?.name ?? null,
    teacherDepartment: row.teacher?.department ?? null,
    pendingResolutions: resolutions.filter((r) => r.status === 'pending').length,
    occurrences: row.occurrences?.map(mapLeaveOccurrenceRow),
    resolutions: fullResolutions,
  };
}

export function mapLeaveOccurrenceRow(row: DbLeaveOccurrenceRow): LeaveOccurrence {
  const slot = row.slot;
  const batchSubject = slot?.batch_subjects;
  const batch = pickOne(batchSubject?.batches);
  const subject = pickOne(batchSubject?.subjects);

  return {
    leaveRequestOccurrenceId: row.leave_request_occurrence_id,
    leaveRequestId: row.leave_request_id,
    timetableSlotId: row.timetable_slot_id,
    occurrenceDate: row.occurrence_date,
    createdAt: row.created_at,
    dayOfWeek: slot?.day_of_week,
    startTime: slot?.start_time ?? null,
    endTime: slot?.end_time ?? null,
    batchSubjectId: batchSubject?.batch_subject_id ?? null,
    batchId: batchSubject?.batch_id ?? null,
    subjectId: batchSubject?.subject_id ?? null,
    batchName: batch?.name ?? null,
    subjectName: subject?.name ?? null,
  };
}

export function mapClassResolutionRow(row: DbClassResolutionRow): ClassResolution {
  const prevTeacherProfile = pickOne(row.prev_teacher?.profile);
  const newTeacherProfile = pickOne(row.new_teacher?.profile);
  const resolvedByProfile = pickOne(row.resolved_by_profile);

  return {
    resolutionId: row.resolution_id,
    instituteId: row.institute_id,
    leaveRequestId: row.leave_request_id,
    timetableSlotId: row.timetable_slot_id,
    occurrenceDate: row.occurrence_date,
    classId: row.class_id,
    resolutionType: row.resolution_type as ResolutionType,
    status: row.status as ResolutionStatus,
    prevTeacherId: row.prev_teacher_id,
    newTeacherId: row.new_teacher_id,
    newScheduledAt: row.new_scheduled_at,
    newDurationMin: row.new_duration_min,
    recordingId: row.recording_id,
    mockTestId: row.mock_test_id,
    reason: row.reason,
    notes: row.notes,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prevTeacherName: prevTeacherProfile?.name ?? null,
    newTeacherName: newTeacherProfile?.name ?? null,
    recordingTitle: pickOne(row.recording?.source_class)?.title ?? null,
    mockTestTitle: row.mock_test?.title ?? null,
    className: null, // anchored live-class title is surfaced via recordingTitle for recorded-class resolutions
    classStatus: row.live_class?.status ?? null,
    resolvedByName: resolvedByProfile?.name ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPC result mappers
// ═══════════════════════════════════════════════════════════════════════════

export function mapSubmitLeaveResult(row: DbSubmitLeaveResult): SubmitLeaveRequestResult {
  return {
    success: row.success,
    leaveId: row.leave_id,
    isEmergency: row.is_emergency,
    affectedOccurrences: row.affected_occurrences,
    timeUntilClass: row.time_until_class,
  };
}

export function mapCancelLeaveResult(row: DbLeaveReviewResult): CancelLeaveRequestResult {
  return {
    success: row.success,
    leaveId: row.leave_id,
    status: row.status as LeaveRequestStatus,
  };
}

export function mapReviewLeaveResult(row: DbLeaveReviewResult): ReviewLeaveRequestResult {
  return {
    success: row.success,
    leaveId: row.leave_id,
    status: row.status as LeaveRequestStatus,
  };
}

export function mapResolutionResult(row: DbResolutionResult): ResolutionResult {
  return {
    success: row.success,
    resolutionId: row.resolution_id,
    resolutionType: (row.type as ResolutionType | undefined),
    classId: row.class_id ?? null,
    newScheduledAt: row.new_scheduled_at ?? null,
    recordingId: row.recording_id ?? null,
    testId: row.test_id ?? null,
    status: (row.status as ResolutionStatus | undefined),
  };
}
