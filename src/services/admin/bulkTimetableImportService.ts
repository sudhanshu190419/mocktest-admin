/**
 * Bulk Timetable Import — Service
 *
 * Phase 2 — database-facing operations for the one-file timetable import.
 *
 * ## Architecture
 *
 * 1. **RLS is respected.** Uses the anon key — every query runs as the
 *    authenticated admin. `fetchBulkImportReferenceData` is institute-scoped
 *    by the caller's own institute (never an arbitrary value from the file).
 *
 * 2. **ONE batched reference phase.** All master data (teachers, batches,
 *    streams, subjects, batch_subjects, assignments, chapters, topics,
 *    existing slots/plans, holidays, leaves, timezone) is fetched with a
 *    handful of PARALLEL queries and handed to the pure validator as
 *    in-memory maps. There is never a per-row database request.
 *
 * 3. **The only write path is the approved RPC.** `importBulkTimetable`
 *    calls `public.bulk_import_timetable(...)` (migration 114) — the
 *    SECURITY DEFINER, atomic, re-validating entry point. No direct table
 *    writes, no service-role client, no RLS bypass.
 *
 * 4. **No spreadsheet parsing here.** Parsing lives in
 *    `src/utils/bulkTimetableParser.ts`; validation in
 *    `src/utils/bulkTimetableValidator.ts`. This service only fetches
 *    reference data and executes the final import RPC.
 *
 * @module services/admin/bulkTimetableImportService
 */

import { supabase } from '@/config/supabase';
import { validateUUID, extractErrorMessage } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import type {
  BulkImportPayload,
  BulkImportRpcResult,
  ReferenceData,
  ReferenceTeacher,
} from '@/types/bulkTimetableImport';

// ═══════════════════════════════════════════════════════════════════════════
//  Reference-data fetch (ONE batched phase — no N+1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch every reference dataset the validator needs for the admin's
 * institute, in a single parallel batch.
 *
 * @param instituteId - The authenticated admin's institute (never from the file).
 * @returns `ApiResponse<ReferenceData>` — resolved arrays for the validator.
 */
export async function fetchBulkImportReferenceData(
  instituteId: string,
): Promise<ApiResponse<ReferenceData>> {
  try {
    validateUUID(instituteId, 'instituteId');

    // ── Phase 1 (parallel): independent reference datasets ───────────────
    // Institutes/teachers/streams/batches/batch_subjects/assignments/slots/
    // plans/holidays/leaves have no inter-dependencies — fetched together.
    interface DbTeacherRow {
      profile_id: string;
      email: string | null;
      phone: string | null;
      name: string | null;
      institute_id: string;
      teacher_details: { teacher_id: string } | { teacher_id: string }[] | null;
    }
    interface DbStreamRow {
      stream_id: string; institute_id: string; name: string; code: string;
    }
    interface DbBatchRow {
      batch_id: string; institute_id: string; stream_id: string;
      name: string; batch_code: string; status: string;
    }
    interface DbBatchSubjectRow {
      batch_subject_id: string; batch_id: string; subject_id: string;
      institute_id: string; name: string | null;
    }
    interface DbAssignmentRow {
      batch_subject_id: string; teacher_id: string;
    }
    interface DbSlotRow {
      timetable_slot_id: string; teacher_id: string; batch_subject_id: string;
      day_of_week: number; start_time: string; end_time: string;
      valid_from: string; valid_until: string; status: string;
    }
    interface DbPlanRow {
      timetable_slot_id: string; occurrence_date: string;
    }
    interface DbLeaveRow {
      teacher_id: string; start_date: string; end_date: string;
    }

    const [
      instituteRes,
      teacherRes,
      streamRes,
      batchRes,
      bsRes,
      assignRes,
      slotRes,
      planRes,
      holidayRes,
      leaveRes,
    ] = await Promise.all([
      supabase.from('institutes').select('timezone').eq('institute_id', instituteId).maybeSingle(),
      supabase
        .from('profiles')
        .select(
          `profile_id, email, name, phone, institute_id,
           teacher_details!fk_teacher_details_profile ( teacher_id )`,
        )
        .eq('role', 'teacher')
        .eq('institute_id', instituteId),
      supabase.from('streams').select('stream_id, institute_id, name, code').eq('institute_id', instituteId),
      supabase
        .from('batches')
        .select('batch_id, institute_id, stream_id, name, batch_code, status')
        .eq('institute_id', instituteId)
        .is('deleted_at', null),
      supabase
        .from('batch_subjects')
        .select('batch_subject_id, batch_id, subject_id, institute_id, name')
        .eq('institute_id', instituteId),
      supabase
        .from('batch_subject_teachers')
        .select('batch_subject_id, teacher_id')
        .eq('institute_id', instituteId),
      supabase
        .from('timetable_slots')
        .select('timetable_slot_id, teacher_id, batch_subject_id, day_of_week, start_time, end_time, valid_from, valid_until, status')
        .eq('institute_id', instituteId),
      supabase.from('lesson_plans').select('timetable_slot_id, occurrence_date').eq('institute_id', instituteId),
      supabase.from('institute_holidays').select('holiday_date').eq('institute_id', instituteId),
      supabase
        .from('teacher_leaves')
        .select('teacher_id, start_date, end_date')
        .eq('institute_id', instituteId)
        .eq('status', 'active'),
    ]);

    if (teacherRes.error) throw new Error(extractErrorMessage(teacherRes.error));
    if (streamRes.error) throw new Error(extractErrorMessage(streamRes.error));
    if (batchRes.error) throw new Error(extractErrorMessage(batchRes.error));
    if (bsRes.error) throw new Error(extractErrorMessage(bsRes.error));
    if (assignRes.error) throw new Error(extractErrorMessage(assignRes.error));
    if (slotRes.error) throw new Error(extractErrorMessage(slotRes.error));
    if (planRes.error) throw new Error(extractErrorMessage(planRes.error));
    if (holidayRes.error) throw new Error(extractErrorMessage(holidayRes.error));
    if (leaveRes.error) throw new Error(extractErrorMessage(leaveRes.error));

    // ── 1. Institute timezone (default Asia/Kolkata per migration 108) ──
    const timezone = (instituteRes.data?.timezone as string | undefined) ?? 'Asia/Kolkata';

    // ── 2. Teachers (profiles role=teacher joined with teacher_details) ──
    const teachers: ReferenceTeacher[] = [];
    for (const row of (teacherRes.data ?? []) as DbTeacherRow[]) {
      const details = row.teacher_details;
      const detail = Array.isArray(details) ? details[0] : details;
      if (!detail) continue;
      teachers.push({
        teacherId: detail.teacher_id,
        profileId: row.profile_id,
        email: row.email ?? null,
        phone: row.phone ?? null,
        name: row.name,
        instituteId: row.institute_id,
      });
    }

    // ── 3. Streams → subjects (subjects belong to streams) ──────────────
    const streams = (streamRes.data ?? []).map((row: DbStreamRow) => ({
      streamId: row.stream_id,
      instituteId: row.institute_id,
      name: row.name,
      code: row.code,
    }));
    const streamIds = streams.map((s) => s.streamId);

    interface DbSubjectRow {
      subject_id: string; stream_id: string; name: string; code: string;
    }
    let subjectRows: DbSubjectRow[] = [];
    if (streamIds.length) {
      const { data, error } = await supabase
        .from('subjects')
        .select('subject_id, stream_id, name, code')
        .in('stream_id', streamIds);
      if (error) throw new Error(extractErrorMessage(error));
      subjectRows = (data ?? []) as DbSubjectRow[];
    }
    const subjects = subjectRows.map((row: DbSubjectRow) => ({
      subjectId: row.subject_id,
      streamId: row.stream_id,
      name: row.name,
      code: row.code,
    }));
    const subjectIds = subjects.map((s) => s.subjectId);

    // ── 4. Batches ──────────────────────────────────────────────────────
    const batches = (batchRes.data ?? []).map((row: DbBatchRow) => ({
      batchId: row.batch_id,
      instituteId: row.institute_id,
      streamId: row.stream_id,
      name: row.name,
      batchCode: row.batch_code,
      status: row.status,
    }));

    // ── 5. batch_subjects + assignments (batch_subject_teachers) ────────
    const batchSubjects = (bsRes.data ?? []).map((row: DbBatchSubjectRow) => ({
      batchSubjectId: row.batch_subject_id,
      batchId: row.batch_id,
      subjectId: row.subject_id,
      instituteId: row.institute_id,
      name: row.name,
    }));

    const assignments = (assignRes.data ?? []).map((row: DbAssignmentRow) => ({
      batchSubjectId: row.batch_subject_id,
      teacherId: row.teacher_id,
    }));

    // ── 6. Chapters → topics (scoped to the institute's subjects) ───────
    interface DbChapterRow {
      chapter_id: string; subject_id: string; name: string;
    }
    let chapterRows: DbChapterRow[] = [];
    if (subjectIds.length) {
      const { data, error } = await supabase
        .from('chapters')
        .select('chapter_id, subject_id, name')
        .in('subject_id', subjectIds)
        .is('deleted_at', null);
      if (error) throw new Error(extractErrorMessage(error));
      chapterRows = (data ?? []) as DbChapterRow[];
    }
    const chapters = chapterRows.map((row: DbChapterRow) => ({
      chapterId: row.chapter_id,
      subjectId: row.subject_id,
      name: row.name,
    }));
    const chapterIds = chapters.map((c) => c.chapterId);

    interface DbTopicRow {
      topic_id: string; chapter_id: string; name: string;
    }
    let topicRows: DbTopicRow[] = [];
    if (chapterIds.length) {
      const { data, error } = await supabase
        .from('topics')
        .select('topic_id, chapter_id, name')
        .in('chapter_id', chapterIds)
        .is('deleted_at', null);
      if (error) throw new Error(extractErrorMessage(error));
      topicRows = (data ?? []) as DbTopicRow[];
    }
    const topics = topicRows.map((row: DbTopicRow) => ({
      topicId: row.topic_id,
      chapterId: row.chapter_id,
      name: row.name,
    }));

    // ── 7. Existing timetable slots + lesson plans (reuse/update counts) ──
    const existingSlots = (slotRes.data ?? []).map((row: DbSlotRow) => ({
      timetableSlotId: row.timetable_slot_id,
      teacherId: row.teacher_id,
      batchSubjectId: row.batch_subject_id,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      status: row.status,
    }));

    // Only active/paused slots can be reused — scope the plan lookup to
    // those slot ids (cancelled/completed slot plans can never be updated
    // by an import, so excluding them changes no counts).
    const reusableSlotIds = existingSlots
      .filter((s) => s.status === 'active' || s.status === 'paused')
      .map((s) => s.timetableSlotId);
    const allPlans = (planRes.data ?? []) as DbPlanRow[];
    const existingPlans = (reusableSlotIds.length
      ? allPlans.filter((p) => reusableSlotIds.includes(p.timetable_slot_id))
      : []
    ).map((row: DbPlanRow) => ({
      timetableSlotId: row.timetable_slot_id,
      occurrenceDate: row.occurrence_date,
    }));

    // ── 8. Holidays + teacher leaves (warnings) ─────────────────────────
    const holidays = (holidayRes.data ?? []).map((r: { holiday_date: string }) => r.holiday_date);

    const teacherLeaves = (leaveRes.data ?? []).map((row: DbLeaveRow) => ({
      teacherId: row.teacher_id,
      startDate: row.start_date,
      endDate: row.end_date,
    }));

    return {
      success: true,
      data: {
        instituteId,
        timezone,
        teachers,
        batches,
        streams,
        subjects,
        batchSubjects,
        assignments,
        chapters,
        topics,
        existingSlots,
        existingPlans,
        holidays,
        teacherLeaves,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Import execution (the ONLY database write — via the approved RPC)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps known `bulk_import_timetable` exception messages to friendly text.
 * Unknown messages pass through so debugging stays possible.
 */
function friendlyBulkImportError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes('only super admins or academic admins')) {
    return 'Only Super Admins and Academic Admins can import timetables.';
  }
  if (m.includes('own institute')) {
    return 'Imports can only be run for your own institute.';
  }
  if (m.includes('duplicate slot key')) {
    return 'The import contains a duplicate timetable entry.';
  }
  if (m.includes('not assigned to this batch-subject')) {
    return 'A teacher in the file is not assigned to their batch-subject.';
  }
  if (m.includes('does not belong to the subject') || m.includes('belongs to the subject')) {
    return 'A chapter in the file does not belong to the subject of its timetable slot.';
  }
  if (m.includes('does not belong to the selected chapter')) {
    return 'A topic in the file does not belong to its chapter.';
  }
  if (m.includes('conflict') || m.includes('already has')) {
    return 'The import conflicts with an existing timetable slot.';
  }
  if (m.includes('weekday') || m.includes('day of week')) {
    return 'A lesson date does not fall on the timetable slot\'s weekday.';
  }
  if (m.includes('validity')) {
    return 'A lesson date falls outside its timetable slot\'s validity period.';
  }
  if (m.includes('live or completed') || m.includes('cannot be modified')) {
    return 'The import tries to change a class that has already started or completed.';
  }
  if (m.includes('maximum of 5000')) {
    return 'The import exceeds the 5,000 entry limit.';
  }

  return message;
}

/**
 * Execute the validated import via `public.bulk_import_timetable`.
 *
 * The RPC is SECURITY DEFINER, atomic, and re-validates everything (roles,
 * institute binding, assignments, chapter→subject, topic→chapter, conflicts,
 * history-freeze) — a failure at any row rolls back the ENTIRE import.
 *
 * @param instituteId - The authenticated admin's institute.
 * @param payload     - The validator-produced p_slots + p_plans.
 * @returns `ApiResponse<BulkImportRpcResult>` with the RPC's counts.
 */
export async function importBulkTimetable(
  instituteId: string,
  payload: BulkImportPayload,
): Promise<ApiResponse<BulkImportRpcResult>> {
  try {
    validateUUID(instituteId, 'instituteId');
    if (!Array.isArray(payload.slots) || !Array.isArray(payload.plans)) {
      throw new Error('A valid import payload is required.');
    }

    const { data, error } = await supabase.rpc('bulk_import_timetable', {
      p_institute_id: instituteId,
      p_slots: payload.slots,
      p_plans: payload.plans,
    });

    if (error) {
      return { success: false, error: friendlyBulkImportError(extractErrorMessage(error)) };
    }

    return { success: true, data: data as BulkImportRpcResult };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
