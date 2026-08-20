/**
 * Teacher Leave Admin Service
 *
 * Phase 2B — admin-facing data layer for the leave-review + class-resolution
 * workflow.
 *
 * ## Authority
 *
 * Every write goes through the migration-115 SECURITY DEFINER RPCs
 * (`review_teacher_leave_request`, `resolve_class_with_substitute`,
 * `reschedule_class_occurrence`, `assign_recorded_class`,
 * `assign_mock_test_to_class`, `cancel_class_occurrence`,
 * `cancel_class_resolution`). The RPCs derive the caller's institute and
 * authorization from `auth.uid()`; the frontend passes only entity IDs.
 *
 * Reads are RLS-scoped through the authenticated client (institute-scoped
 * admin policies on `teacher_leave_requests`, `leave_request_occurrences`,
 * `class_resolution_events`). Reads are batched — never one query per
 * occurrence — using embedded PostgREST relations and `in()` filters.
 *
 * @module services/admin/teacherLeaveAdminService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import { leaveRequestErrorMessage } from '@/utils/teacherLeaveErrors';
import {
  mapClassResolutionRow,
  mapLeaveOccurrenceRow,
  mapResolutionResult,
  mapReviewLeaveResult,
  mapTeacherLeaveRequestRow,
} from '@/utils/teacherLeaveMappers';
import type {
  DbClassResolutionRow,
  DbLeaveOccurrenceRow,
  DbLeaveReviewResult,
  DbResolutionResult,
  DbTeacherLeaveRequestRow,
} from '@/utils/teacherLeaveMappers';
import type { ApiResponse, PaginatedResponse, PaginationParams } from '@/types/academic';
import type {
  CancelOccurrenceParams,
  CancelResolutionParams,
  LeaveRequestFilters,
  MockTestResolutionParams,
  RecordedResolutionParams,
  RescheduleResolutionParams,
  ResolutionResult,
  ReviewLeaveRequestParams,
  ReviewLeaveRequestResult,
  SubstituteResolutionParams,
  TeacherLeaveRequest,
  TeacherLeaveRequestDetail,
} from '@/types/teacherLeave';

// ═══════════════════════════════════════════════════════════════════════════
//  Selects (RLS-scoped; FK-hinted embeds follow the project convention)
// ═══════════════════════════════════════════════════════════════════════════

/** Request rows + joined teacher (teacher_details → profiles.name) + resolutions summary. */
const ADMIN_REQUEST_SELECT = `*,
  teacher:teacher_details!fk_teacher_leave_requests_teacher(
    teacher_id, department,
    profile:profiles!fk_teacher_details_profile(profile_id, name)
  ),
  resolutions:class_resolution_events!fk_cre_leave_request(status, resolution_type)`;

/** Occurrence rows + joined slot day/time and batch/subject names. */
const ADMIN_OCCURRENCE_SELECT = `*,
  slot:timetable_slots!fk_leave_request_occurrences_slot(
    timetable_slot_id, day_of_week, start_time, end_time, batch_subject_id,
    batch_subjects!fk_timetable_slots_batch_subject(
      batch_subject_id, batch_id, subject_id,
      batches!fk_batch_subjects_batch(name),
      subjects!fk_batch_subjects_subject(name)
    )
  )`;

/** Resolution rows + joined teacher/recording/mock-test/live-class display data. */
// The live recordings table (migration 005) has NO title column — migration
// 065's create-table-if-not-exists was a no-op. The display name is the source
// class title via recordings.class_id → live_classes (FK fk_recordings_class).
const ADMIN_RESOLUTION_SELECT = `*,
  prev_teacher:teacher_details!fk_cre_prev_teacher(
    teacher_id, profile:profiles!fk_teacher_details_profile(profile_id, name)
  ),
  new_teacher:teacher_details!fk_cre_new_teacher(
    teacher_id, profile:profiles!fk_teacher_details_profile(profile_id, name)
  ),
  resolved_by_profile:profiles!fk_cre_resolved_by(profile_id, name),
  recording:recordings!fk_cre_recording(
    recording_id, source_class:live_classes!fk_recordings_class(title)
  ),
  mock_test:mock_tests!fk_cre_mock_test(test_id, title),
  live_class:live_classes!fk_cre_class(class_id, status)`;

// ═══════════════════════════════════════════════════════════════════════════
//  Reads
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Paginated admin inbox (RLS: institute-scoped).
 *
 * Supports status / emergency / teacher / date-range filtering, newest-first
 * ordering with emergency requests ordered first (boolean `is_emergency`
 * desc puts `true` ahead).
 *
 * @param filters    - Optional LeaveRequestFilters.
 * @param pagination - Optional page/pageSize (default 1 / 20).
 */
export async function getLeaveRequests(
  filters: LeaveRequestFilters = {},
  pagination: PaginationParams = {},
): Promise<ApiResponse<PaginatedResponse<TeacherLeaveRequest>>> {
  try {
    const page = Math.max(1, pagination.page ?? 1);
    const pageSize = Math.max(1, pagination.pageSize ?? 20);

    let query = supabase
      .from('teacher_leave_requests')
      .select(ADMIN_REQUEST_SELECT, { count: 'exact' });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.emergency !== undefined) {
      query = query.eq('is_emergency', filters.emergency);
    }
    if (filters.teacherId) {
      validateUUID(filters.teacherId, 'filters.teacherId');
      query = query.eq('teacher_id', filters.teacherId);
    }
    if (filters.fromDate) {
      // Range overlap: request period ends on/after fromDate.
      query = query.gte('end_date', filters.fromDate);
    }
    if (filters.toDate) {
      // Range overlap: request period starts on/before toDate.
      query = query.lte('start_date', filters.toDate);
    }

    query = query
      .order('is_emergency', { ascending: false })
      .order('created_at', { ascending: false });

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = ((data as DbTeacherLeaveRequestRow[] | null) ?? []).map(
      mapTeacherLeaveRequestRow,
    );

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? items.length, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Full detail for one leave request (RLS: institute-scoped).
 *
 * Batched reads (no N+1, never one query per occurrence):
 *   1. request + teacher name
 *   2. occurrences + slot + batch/subject names
 *   3. resolution history + joined display data
 *   4. lesson plans for the involved (slot × date) pairs
 *   5. live classes for the involved slots in the request window
 *
 * @param leaveId - teacher_leave_requests.leave_id.
 */
export async function getLeaveRequestDetail(
  leaveId: string,
): Promise<ApiResponse<TeacherLeaveRequestDetail>> {
  try {
    validateUUID(leaveId, 'leaveId');

    // ── Batch 1: header + occurrences + resolutions (parallel) ──────
    const [requestRes, occurrencesRes, resolutionsRes] = await Promise.all([
      supabase
        .from('teacher_leave_requests')
        .select(ADMIN_REQUEST_SELECT)
        .eq('leave_id', leaveId)
        .single(),
      supabase
        .from('leave_request_occurrences')
        .select(ADMIN_OCCURRENCE_SELECT)
        .eq('leave_request_id', leaveId)
        .order('occurrence_date', { ascending: true }),
      supabase
        .from('class_resolution_events')
        .select(ADMIN_RESOLUTION_SELECT)
        .eq('leave_request_id', leaveId)
        .order('created_at', { ascending: true }),
    ]);

    if (requestRes.error) {
      return { success: false, error: extractErrorMessage(requestRes.error) };
    }
    if (occurrencesRes.error) {
      return { success: false, error: extractErrorMessage(occurrencesRes.error) };
    }
    if (resolutionsRes.error) {
      return { success: false, error: extractErrorMessage(resolutionsRes.error) };
    }

    const request = mapTeacherLeaveRequestRow(requestRes.data as DbTeacherLeaveRequestRow);
    const occurrences = ((occurrencesRes.data as DbLeaveOccurrenceRow[] | null) ?? []).map(
      mapLeaveOccurrenceRow,
    );
    const resolutions = ((resolutionsRes.data as DbClassResolutionRow[] | null) ?? []).map(
      mapClassResolutionRow,
    );

    // ── Batch 2: lesson plans + live classes (only when slots exist) ─
    const slotIds = [...new Set(occurrences.map((o) => o.timetableSlotId))];
    if (slotIds.length > 0) {
      const occurrenceDates = occurrences.map((o) => o.occurrenceDate);
      const windowStart = occurrences.reduce(
        (min, o) => (o.occurrenceDate < min ? o.occurrenceDate : min),
        occurrences[0].occurrenceDate,
      );
      const windowEnd = occurrences.reduce(
        (max, o) => (o.occurrenceDate > max ? o.occurrenceDate : max),
        occurrences[0].occurrenceDate,
      );

      const [lessonPlansRes, liveClassesRes] = await Promise.all([
        supabase
          .from('lesson_plans')
          .select(
            `timetable_slot_id, occurrence_date, chapter_id, topic_id, notes,
             chapter:chapters!fk_lesson_plans_chapter(name),
             topic:topics!fk_lesson_plans_topic(name)`,
          )
          .in('timetable_slot_id', slotIds)
          .in('occurrence_date', occurrenceDates),
        supabase
          .from('live_classes')
          .select('class_id, timetable_slot_id, scheduled_at, status')
          .in('timetable_slot_id', slotIds)
          .gte('scheduled_at', `${windowStart}T00:00:00Z`)
          .lte('scheduled_at', `${windowEnd}T23:59:59Z`),
      ]);

      if (lessonPlansRes.error) {
        return { success: false, error: extractErrorMessage(lessonPlansRes.error) };
      }
      if (liveClassesRes.error) {
        return { success: false, error: extractErrorMessage(liveClassesRes.error) };
      }

      const lessonPlanRows = (lessonPlansRes.data ?? []) as {
        timetable_slot_id: string;
        occurrence_date: string;
        chapter_id: string | null;
        topic_id: string | null;
        notes: string | null;
        chapter?: { name: string } | { name: string }[] | null;
        topic?: { name: string } | { name: string }[] | null;
      }[];
      const liveClassRows = (liveClassesRes.data ?? []) as {
        class_id: string;
        timetable_slot_id: string;
        scheduled_at: string;
        status: string;
      }[];

      const lessonPlanByKey = new Map<string, (typeof lessonPlanRows)[number]>();
      for (const lp of lessonPlanRows) {
        lessonPlanByKey.set(`${lp.timetable_slot_id}|${lp.occurrence_date}`, lp);
      }

      // live_classes are matched by slot + UTC calendar date of scheduled_at.
      // NOTE: institutes may use a custom timezone; classes between 00:00 and
      // ~05:30 IST (or equivalent offsets) can shift by one day in UTC. This
      // is a V1 display heuristic — resolution-level class_id matching remains
      // exact. See Risks in the Phase 2B report.
      const liveClassBySlotDate = new Map<string, (typeof liveClassRows)[number]>();
      for (const lc of liveClassRows) {
        liveClassBySlotDate.set(`${lc.timetable_slot_id}|${lc.scheduled_at.slice(0, 10)}`, lc);
      }

      const resolutionBySlotDate = new Map<string, (typeof resolutions)[number]>();
      for (const res of resolutions) {
        resolutionBySlotDate.set(`${res.timetableSlotId}|${res.occurrenceDate}`, res);
      }

      for (const occurrence of occurrences) {
        const lp = lessonPlanByKey.get(`${occurrence.timetableSlotId}|${occurrence.occurrenceDate}`);
        const lc = liveClassBySlotDate.get(`${occurrence.timetableSlotId}|${occurrence.occurrenceDate}`);
        const resolution = resolutionBySlotDate.get(
          `${occurrence.timetableSlotId}|${occurrence.occurrenceDate}`,
        );

        occurrence.chapterName = pickName(lp?.chapter) ?? null;
        occurrence.topicName = pickName(lp?.topic) ?? null;
        occurrence.lessonNotes = lp?.notes ?? null;
        // Exact resolution linkage takes precedence over the UTC-date heuristic
        // so a timezone shift can never discard the resolution's real class.
        occurrence.classId = lc?.class_id ?? resolution?.classId ?? null;
        occurrence.classStatus = lc?.status ?? resolution?.classStatus ?? null;
        occurrence.resolution = resolution ?? null;
      }
    }

    return { success: true, data: { request, occurrences, resolutions } };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Writes (migration-115 RPCs only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Approve or reject a pending leave request.
 *
 * @param params - leaveId + decision ('approve' | 'reject') + optional remarks.
 */
export async function reviewTeacherLeaveRequest(
  params: ReviewLeaveRequestParams,
): Promise<ApiResponse<ReviewLeaveRequestResult>> {
  try {
    validateUUID(params.leaveId, 'leaveId');

    const { data, error } = await supabase.rpc('review_teacher_leave_request', {
      p_leave_id: params.leaveId,
      p_decision: params.decision,
      p_remarks: params.remarks ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapReviewLeaveResult(data as DbLeaveReviewResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Resolve a pending occurrence by assigning a substitute teacher.
 *
 * @param params - resolutionId + teacherId + optional notes.
 */
export async function resolveWithSubstitute(
  params: SubstituteResolutionParams,
): Promise<ApiResponse<ResolutionResult>> {
  try {
    validateUUID(params.resolutionId, 'resolutionId');
    validateUUID(params.teacherId, 'teacherId');

    const { data, error } = await supabase.rpc('resolve_class_with_substitute', {
      p_resolution_id: params.resolutionId,
      p_teacher_id: params.teacherId,
      p_notes: params.notes ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapResolutionResult(data as DbResolutionResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Resolve a pending occurrence by rescheduling to a new date/time
 * (optionally with a different teacher).
 *
 * @param params - resolutionId + newDate (YYYY-MM-DD) + newStart/newEnd
 *                 ("HH:MM" or "HH:MM:SS") + optional newTeacherId.
 */
export async function rescheduleOccurrence(
  params: RescheduleResolutionParams,
): Promise<ApiResponse<ResolutionResult>> {
  try {
    validateUUID(params.resolutionId, 'resolutionId');
    if (params.newTeacherId) validateUUID(params.newTeacherId, 'newTeacherId');

    const { data, error } = await supabase.rpc('reschedule_class_occurrence', {
      p_resolution_id: params.resolutionId,
      p_new_date: params.newDate,
      p_new_start: params.newStart,
      p_new_end: params.newEnd,
      p_new_teacher: params.newTeacherId ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapResolutionResult(data as DbResolutionResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Resolve a pending occurrence by replacing the live class with a recording.
 *
 * @param params - resolutionId + recordingId + optional notes.
 */
export async function assignRecorded(
  params: RecordedResolutionParams,
): Promise<ApiResponse<ResolutionResult>> {
  try {
    validateUUID(params.resolutionId, 'resolutionId');
    validateUUID(params.recordingId, 'recordingId');

    const { data, error } = await supabase.rpc('assign_recorded_class', {
      p_resolution_id: params.resolutionId,
      p_recording_id: params.recordingId,
      p_notes: params.notes ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapResolutionResult(data as DbResolutionResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Resolve a pending occurrence by assigning a mock test instead of the class.
 *
 * @param params - resolutionId + testId + optional notes.
 */
export async function assignMockTest(
  params: MockTestResolutionParams,
): Promise<ApiResponse<ResolutionResult>> {
  try {
    validateUUID(params.resolutionId, 'resolutionId');
    validateUUID(params.testId, 'testId');

    const { data, error } = await supabase.rpc('assign_mock_test_to_class', {
      p_resolution_id: params.resolutionId,
      p_test_id: params.testId,
      p_notes: params.notes ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapResolutionResult(data as DbResolutionResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Cancel the affected class occurrence (never the recurring timetable).
 *
 * @param params - resolutionId + optional reason.
 */
export async function cancelOccurrence(
  params: CancelOccurrenceParams,
): Promise<ApiResponse<ResolutionResult>> {
  try {
    validateUUID(params.resolutionId, 'resolutionId');

    const { data, error } = await supabase.rpc('cancel_class_occurrence', {
      p_resolution_id: params.resolutionId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapResolutionResult(data as DbResolutionResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Supersede a PENDING resolution without touching the class (e.g. the admin
 * changes their mind before the class starts). Resolved resolutions must be
 * changed through the resolution RPCs, not this function.
 *
 * @param params - resolutionId + optional reason.
 */
export async function cancelResolution(
  params: CancelResolutionParams,
): Promise<ApiResponse<ResolutionResult>> {
  try {
    validateUUID(params.resolutionId, 'resolutionId');

    const { data, error } = await supabase.rpc('cancel_class_resolution', {
      p_resolution_id: params.resolutionId,
      p_reason: params.reason ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapResolutionResult(data as DbResolutionResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Unwrap a PostgREST to-one embed (object or 1-element array) → name|null. */
function pickName(value: { name: string } | { name: string }[] | null | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.name ?? null;
  return value?.name ?? null;
}

/** Service object (matches the `xxxAdminService` convention). */
export const teacherLeaveAdminService = {
  getLeaveRequests,
  getLeaveRequestDetail,
  reviewTeacherLeaveRequest,
  resolveWithSubstitute,
  rescheduleOccurrence,
  assignRecorded,
  assignMockTest,
  cancelOccurrence,
  cancelResolution,
};
