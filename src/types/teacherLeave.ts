/**
 * Teacher Leave + Class Resolution Types
 *
 * Phase 2B — shared contracts for the teacher leave-request and admin
 * class-resolution workflow. Mirrors migration 115 (teacher_leave_requests,
 * leave_request_occurrences, class_resolution_events) mapped to camelCase
 * frontend models.
 *
 * ## Authority
 *
 * Migration-115 SECURITY DEFINER RPCs are the ONLY write path and the ONLY
 * source of truth for:
 *   - affected slots / occurrences discovery
 *   - emergency classification (24-hour rule)
 *   - started / live / completed protection
 *   - teacher availability, timetable/batch/holiday/leave conflict checks
 *   - institute scoping + authorization
 *
 * The frontend never computes or sends `is_emergency`, availability, or any
 * authorization decision — it only passes entity IDs required by the RPC
 * contracts and exposes the RPC result/error.
 *
 * @module types/teacherLeave
 */

import type { PaginationParams } from './academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Enums / Unions (mirror migration-115 + migration-014 enums)
// ═══════════════════════════════════════════════════════════════════════════

/** `leave_status_type` (migration 014). */
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** `leave_category_type` (migration 014). */
export type LeaveCategory =
  | 'casual'
  | 'sick'
  | 'unpaid'
  | 'maternity_paternity'
  | 'compensatory';

/** `class_resolution_type` (migration 115). */
export type ResolutionType =
  | 'substitute_teacher'
  | 'reschedule'
  | 'recorded_class'
  | 'mock_test'
  | 'cancelled';

/** `resolution_status` (migration 115). */
export type ResolutionStatus = 'pending' | 'resolved' | 'cancelled';

// ═══════════════════════════════════════════════════════════════════════════
//  Models
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A teacher leave request row (`teacher_leave_requests`).
 *
 * DB snake_case columns are mapped to camelCase in the service layer. Joined
 * display fields (teacherName, occurrences, resolutions, pendingResolutions)
 * are populated from RLS-scoped embedded reads — never from direct writes.
 */
export interface TeacherLeaveRequest {
  /** leave_requests.leave_id (PK). */
  leaveId: string;
  /** teacher_details.teacher_id of the requesting teacher. */
  teacherId: string;
  instituteId: string;
  leaveCategory: LeaveCategory;
  /** Inclusive start date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive end date (YYYY-MM-DD). */
  endDate: string;
  reason: string | null;
  status: LeaveRequestStatus;
  /** Server-computed by submit_teacher_leave_request — never sent by the UI. */
  isEmergency: boolean;
  /** Interval string (e.g. "2 days 03:00:00") to the earliest affected class. */
  timeUntilClass: string | null;
  affectedOccurrences: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerRemarks: string | null;
  createdAt: string;
  updatedAt: string;

  // ── Joined display data (RLS-scoped reads) ──────────────────────────
  /** Teacher display name (profiles.name via teacher_details.profile_id). */
  teacherName: string | null;
  teacherDepartment: string | null;
  /** Count of still-pending class_resolution_events for this request. */
  pendingResolutions: number;
  /** Full occurrence rows (present on detail reads). */
  occurrences?: LeaveOccurrence[];
  /** Full resolution rows (present on detail reads). */
  resolutions?: ClassResolution[];
}

/**
 * One affected class occurrence (`leave_request_occurrences` + joined slot).
 *
 * `chapterName` / `topicName` / `lessonNotes` / `classId` / `classStatus` /
 * `resolution` are enriched by the admin detail service from batched reads
 * (lesson_plans + live_classes + class_resolution_events).
 */
export interface LeaveOccurrence {
  /** leave_request_occurrence_id (PK). */
  leaveRequestOccurrenceId: string;
  leaveRequestId: string;
  timetableSlotId: string;
  /** The affected calendar date (YYYY-MM-DD). */
  occurrenceDate: string;
  createdAt: string;

  // ── Joined slot display data ────────────────────────────────────────
  /** isodow 1..7 (1 = Monday). */
  dayOfWeek?: number;
  /** Wall-clock "HH:MM:SS" start. */
  startTime?: string | null;
  /** Wall-clock "HH:MM:SS" end. */
  endTime?: string | null;
  /** batch_subject id — scopes substitute/mock-test/recording pickers. */
  batchSubjectId?: string | null;
  batchId?: string | null;
  /** subject id — scopes the mock-test picker. */
  subjectId?: string | null;
  batchName?: string | null;
  subjectName?: string | null;

  // ── Enriched by the admin detail read ───────────────────────────────
  chapterName?: string | null;
  topicName?: string | null;
  lessonNotes?: string | null;
  classId?: string | null;
  classStatus?: string | null;
  /** The current class_resolution_events row anchored on (slot, date). */
  resolution?: ClassResolution | null;
}

/**
 * A class resolution event (`class_resolution_events` — append-only).
 *
 * One ACTIVE resolution per (timetable_slot_id, occurrence_date) is
 * guaranteed by the partial unique index in migration 115; the database is
 * the concurrency authority, not the UI.
 */
export interface ClassResolution {
  resolutionId: string;
  instituteId: string;
  leaveRequestId: string | null;
  timetableSlotId: string;
  occurrenceDate: string;
  /** The live_class anchored to this occurrence, when materialized. */
  classId: string | null;
  resolutionType: ResolutionType;
  status: ResolutionStatus;
  prevTeacherId: string | null;
  newTeacherId: string | null;
  newScheduledAt: string | null;
  newDurationMin: number | null;
  recordingId: string | null;
  mockTestId: string | null;
  reason: string | null;
  notes: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;

  // ── Joined display data (RLS-scoped reads) ──────────────────────────
  prevTeacherName: string | null;
  newTeacherName: string | null;
  recordingTitle: string | null;
  mockTestTitle: string | null;
  /** Title of the anchored live class (recordings source class). */
  className: string | null;
  classStatus: string | null;
  resolvedByName: string | null;
}

/**
 * Full detail assembly for one leave request: header + occurrences +
 * resolution history. Returned by the admin/teacher detail reads.
 */
export interface TeacherLeaveRequestDetail {
  request: TeacherLeaveRequest;
  occurrences: LeaveOccurrence[];
  resolutions: ClassResolution[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  Filters
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Admin inbox filters. Undefined = no filter applied.
 *
 * Date filtering is a range-overlap test against the request period
 * (end_date >= fromDate AND start_date <= toDate) — the request window
 * intersects the selected range.
 */
export interface LeaveRequestFilters {
  /** pending | approved | rejected | cancelled. */
  status?: LeaveRequestStatus;
  /** true = emergency only; false = non-emergency only; undefined = all. */
  emergency?: boolean;
  /** Filter by requesting teacher (teacher_details.teacher_id). */
  teacherId?: string;
  /** Only requests whose period ends on/after this date (YYYY-MM-DD). */
  fromDate?: string;
  /** Only requests whose period starts on/before this date (YYYY-MM-DD). */
  toDate?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RPC params + results (migration-115 contracts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * submit_teacher_leave_request(p_start, p_end, p_reason, p_category, p_slot_ids)
 *
 * Date-range based by design: the RPC discovers the teacher's own active
 * slots overlapping the range and enumerates affected occurrences. `slotIds`
 * is an optional refinement and may be null.
 */
export interface SubmitLeaveRequestParams {
  /** Inclusive start date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive end date (YYYY-MM-DD). */
  endDate: string;
  reason?: string | null;
  category?: LeaveCategory;
  /** Optional slot restriction. Null = all of the teacher's active slots. */
  slotIds?: string[] | null;
}

export interface SubmitLeaveRequestResult {
  success: boolean;
  leaveId: string;
  /** Server-computed. */
  isEmergency: boolean;
  affectedOccurrences: number;
  timeUntilClass: string | null;
}

/** cancel_teacher_leave_request(p_leave_id). */
export interface CancelLeaveRequestResult {
  success: boolean;
  leaveId: string;
  status: LeaveRequestStatus;
}

/** review_teacher_leave_request(p_leave_id, p_decision, p_remarks). */
export interface ReviewLeaveRequestParams {
  leaveId: string;
  decision: 'approve' | 'reject';
  remarks?: string | null;
}

export interface ReviewLeaveRequestResult {
  success: boolean;
  leaveId: string;
  status: LeaveRequestStatus;
}

/** resolve_class_with_substitute(p_resolution_id, p_teacher_id, p_notes). */
export interface SubstituteResolutionParams {
  resolutionId: string;
  teacherId: string;
  notes?: string | null;
}

/** reschedule_class_occurrence(p_resolution_id, p_new_date, p_new_start, p_new_end, p_new_teacher). */
export interface RescheduleResolutionParams {
  resolutionId: string;
  /** YYYY-MM-DD. */
  newDate: string;
  /** "HH:MM" or "HH:MM:SS". */
  newStart: string;
  /** "HH:MM" or "HH:MM:SS". */
  newEnd: string;
  /** Optional replacement teacher; null = keep the original. */
  newTeacherId?: string | null;
}

/** assign_recorded_class(p_resolution_id, p_recording_id, p_notes). */
export interface RecordedResolutionParams {
  resolutionId: string;
  recordingId: string;
  notes?: string | null;
}

/** assign_mock_test_to_class(p_resolution_id, p_test_id, p_notes). */
export interface MockTestResolutionParams {
  resolutionId: string;
  testId: string;
  notes?: string | null;
}

/** cancel_class_occurrence(p_resolution_id, p_reason). */
export interface CancelOccurrenceParams {
  resolutionId: string;
  reason?: string | null;
}

/** cancel_class_resolution(p_resolution_id, p_reason) — supersede a pending resolution. */
export interface CancelResolutionParams {
  resolutionId: string;
  reason?: string | null;
}

/**
 * Union of every resolution mutation a UI can invoke through the single
 * `useResolveClass` hook. `cancelled` = cancel the class occurrence;
 * `cancel_resolution` = supersede a pending resolution without touching
 * the class.
 */
export type ResolveClassInput =
  | ({ action: 'substitute_teacher' } & SubstituteResolutionParams)
  | ({ action: 'reschedule' } & RescheduleResolutionParams)
  | ({ action: 'recorded_class' } & RecordedResolutionParams)
  | ({ action: 'mock_test' } & MockTestResolutionParams)
  | ({ action: 'cancelled' } & CancelOccurrenceParams)
  | ({ action: 'cancel_resolution' } & CancelResolutionParams);

/**
 * Normalised result of any resolution RPC. Only the fields the RPC actually
 * returned are populated — the UI must never invent row-level data.
 */
export interface ResolutionResult {
  success: boolean;
  resolutionId: string;
  resolutionType?: ResolutionType;
  classId?: string | null;
  newScheduledAt?: string | null;
  recordingId?: string | null;
  testId?: string | null;
  status?: ResolutionStatus;
}

export type { PaginationParams };
