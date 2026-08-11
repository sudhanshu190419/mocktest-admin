/**
 * Teacher Leave Service
 *
 * Phase 2B — teacher-facing data layer for the leave-request workflow.
 *
 * ## Authority
 *
 * All writes go through the migration-115 SECURITY DEFINER RPCs
 * (`submit_teacher_leave_request`, `cancel_teacher_leave_request`), which
 * derive identity from `auth.uid()` — the frontend never sends identity or
 * authorization decisions. Reads use the authenticated client + RLS
 * (teachers see only their own requests/occurrences/resolutions).
 *
 * The RPC is authoritative for affected-slot discovery, occurrence
 * enumeration, emergency classification, and started/live/completed
 * protection. The frontend never calculates or sends `is_emergency`.
 *
 * @module services/teacher/teacherLeaveService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import { leaveRequestErrorMessage } from '@/utils/teacherLeaveErrors';
import {
  mapCancelLeaveResult,
  mapSubmitLeaveResult,
  mapTeacherLeaveRequestRow,
} from '@/utils/teacherLeaveMappers';
import type {
  DbLeaveReviewResult,
  DbSubmitLeaveResult,
  DbTeacherLeaveRequestRow,
} from '@/utils/teacherLeaveMappers';
import type { ApiResponse } from '@/types/academic';
import type {
  CancelLeaveRequestResult,
  SubmitLeaveRequestParams,
  SubmitLeaveRequestResult,
  TeacherLeaveRequest,
  TeacherLeaveRequestDetail,
} from '@/types/teacherLeave';

// ═══════════════════════════════════════════════════════════════════════════
//  Selects (RLS-scoped)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List projection: request + a LITE resolution embed (status/type) so the UI
 * can show "X of Y classes awaiting admin action" without fetching full
 * resolution history.
 */
const TEACHER_LIST_SELECT = `*,
  resolutions:class_resolution_events!fk_cre_leave_request(status, resolution_type)`;

/**
 * Detail projection: request + occurrences (with joined slot day/time and
 * batch/subject names) + full resolution rows.
 */
const TEACHER_DETAIL_SELECT = `*,
  occurrences:leave_request_occurrences!fk_leave_request_occurrences_request(
    leave_request_occurrence_id, leave_request_id, timetable_slot_id, occurrence_date, created_at,
    slot:timetable_slots!fk_leave_request_occurrences_slot(
      timetable_slot_id, day_of_week, start_time, end_time, batch_subject_id,
      batch_subjects!fk_timetable_slots_batch_subject(
        batch_subject_id, batch_id,
        batches!fk_batch_subjects_batch(name),
        subjects!fk_batch_subjects_subject(name)
      )
    )
  ),
  resolutions:class_resolution_events!fk_cre_leave_request(*)`;

// ═══════════════════════════════════════════════════════════════════════════
//  Reads
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the current teacher's own leave requests (RLS: own rows only),
 * newest first.
 *
 * @example
 * const { data } = await teacherLeaveService.getMyLeaveRequests();
 */
export async function getMyLeaveRequests(): Promise<ApiResponse<TeacherLeaveRequest[]>> {
  try {
    const { data, error } = await supabase
      .from('teacher_leave_requests')
      .select(TEACHER_LIST_SELECT)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return {
      success: true,
      data: (data ?? []).map((row) => mapTeacherLeaveRequestRow(row as DbTeacherLeaveRequestRow)),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch one of the teacher's own leave requests with its affected
 * occurrences and resolution rows (RLS: own rows only).
 *
 * @param leaveId - teacher_leave_requests.leave_id.
 *
 * @example
 * const { data } = await teacherLeaveService.getMyLeaveRequest('uuid');
 */
export async function getMyLeaveRequest(
  leaveId: string,
): Promise<ApiResponse<TeacherLeaveRequestDetail>> {
  try {
    validateUUID(leaveId, 'leaveId');

    const { data, error } = await supabase
      .from('teacher_leave_requests')
      .select(TEACHER_DETAIL_SELECT)
      .eq('leave_id', leaveId)
      .single();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const request = mapTeacherLeaveRequestRow(data as DbTeacherLeaveRequestRow);

    return {
      success: true,
      data: {
        request,
        occurrences: request.occurrences ?? [],
        resolutions: request.resolutions ?? [],
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Writes (migration-115 RPCs only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit a leave request for a date range.
 *
 * Date-range based by design (Phase 2A decision): the RPC discovers the
 * teacher's own active slots overlapping the range and enumerates the
 * affected occurrences. `slotIds` is an optional refinement and may be null.
 * The RPC computes `is_emergency` server-side.
 *
 * @param params - startDate/endDate (YYYY-MM-DD), optional reason/category/slotIds.
 */
export async function submitLeaveRequest(
  params: SubmitLeaveRequestParams,
): Promise<ApiResponse<SubmitLeaveRequestResult>> {
  try {
    validateUUIDRange(params.startDate, params.endDate);
    if (params.slotIds) {
      for (const id of params.slotIds) validateUUID(id, 'slotIds');
    }

    const { data, error } = await supabase.rpc('submit_teacher_leave_request', {
      p_start: params.startDate,
      p_end: params.endDate,
      p_reason: params.reason ?? null,
      p_category: params.category ?? 'casual',
      p_slot_ids: params.slotIds ?? null,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapSubmitLeaveResult(data as DbSubmitLeaveResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

/**
 * Cancel one of the teacher's OWN pending leave requests.
 *
 * @param leaveId - teacher_leave_requests.leave_id.
 */
export async function cancelLeaveRequest(
  leaveId: string,
): Promise<ApiResponse<CancelLeaveRequestResult>> {
  try {
    validateUUID(leaveId, 'leaveId');

    const { data, error } = await supabase.rpc('cancel_teacher_leave_request', {
      p_leave_id: leaveId,
    });

    if (error) {
      return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(error)) };
    }

    return { success: true, data: mapCancelLeaveResult(data as DbLeaveReviewResult) };
  } catch (err) {
    return { success: false, error: leaveRequestErrorMessage(extractErrorMessage(err)) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Validate YYYY-MM-DD date strings and enforce start <= end. */
function validateUUIDRange(startDate: string, endDate: string): void {
  const start = parseDateOnly(startDate, 'startDate');
  const end = parseDateOnly(endDate, 'endDate');
  if (end < start) {
    throw new Error('A valid leave date range (start <= end) is required.');
  }
}

/** Parse + validate a YYYY-MM-DD string; returns the comparable string. */
function parseDateOnly(value: string, fieldName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: expected YYYY-MM-DD.`);
  }
  return value;
}

/** Service object (matches the `teacherXxxService` convention). */
export const teacherLeaveService = {
  getMyLeaveRequests,
  getMyLeaveRequest,
  submitLeaveRequest,
  cancelLeaveRequest,
};
