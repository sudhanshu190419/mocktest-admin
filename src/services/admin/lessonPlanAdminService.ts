/**
 * Admin Lesson Planner Service
 *
 * Phase 2A — data layer for the Admin Lesson Planner UI. Manages
 * `lesson_plans` (migration 113) — the planned chapter/topic per
 * occurrence date of a recurring timetable slot.
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** Uses the anon key — all queries run as the
 *    authenticated admin. Migration 113 grants SELECT on lesson_plans to
 *    super_admin / academic_admin scoped to their own institute (and
 *    teachers for their own slots). Finance admins, students, and
 *    unassigned teachers are denied at the RLS layer.
 *
 * 2. **All writes go through SECURITY DEFINER RPCs.** Migration 113 exposes
 *    exactly two write paths — `upsert_lesson_plan(...)` and
 *    `delete_lesson_plan(...)` — which enforce role, institute scope, and
 *    topic→chapter consistency server-side and propagate the change to the
 *    matching future scheduled live_class in the same transaction. The
 *    service NEVER issues a direct lesson_plans write.
 *
 * 3. **No UI coupling.** This module is read by `useLessonPlans.ts` only;
 *    the planner page consumes the hooks, never this service directly.
 *
 * @module services/admin/lessonPlanAdminService
 */

import { supabase } from '@/config/supabase';
import { validateUUID, extractErrorMessage } from '@/utils/supabase';
import { expandDateRange } from '@/utils/lessonOccurrences';
import type { ApiResponse } from '@/types/academic';
import type {
  DeleteLessonPlanInput,
  DeleteLessonPlanResult,
  LessonPlan,
  LessonPlanRangeQuery,
  LiveClassStatus,
  NextLessonPlansQuery,
  NextPlannedLesson,
  SkipKind,
  SlotClassStatus,
  SlotSkips,
  SlotSkipsQuery,
  UpsertLessonPlanInput,
  UpsertLessonPlanResult,
} from '@/types/lessonPlan';

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Types
// ═══════════════════════════════════════════════════════════════════════════

/** Raw snake_case shape of a `lesson_plans` row (with chapter/topic joins). */
interface DbLessonPlan {
  lesson_plan_id: string;
  institute_id: string;
  timetable_slot_id: string;
  occurrence_date: string;
  chapter_id: string | null;
  topic_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  chapters?: { chapter_id: string; name: string } | { chapter_id: string; name: string }[] | null;
  topics?: { topic_id: string; name: string } | { topic_id: string; name: string }[] | null;
}

/** Raw snake_case shape of a `live_classes` row (status projection only). */
interface DbSlotClass {
  class_id: string;
  /** PostgREST serializes the `live_class_status` enum as its label string. */
  status: LiveClassStatus;
  scheduled_at: string;
}

/**
 * PostgREST select for lesson_plans with chapter + topic names (via the FK
 * constraint hints from migration 113).
 */
const LESSON_PLAN_SELECT = `*,
  chapters!fk_lesson_plans_chapter ( chapter_id, name ),
  topics!fk_lesson_plans_topic ( topic_id, name )`;

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Unwrap a possibly-array joined relation into an object (PostgREST to-one). */
function pick<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Converts a raw snake_case DB row into a camelCase `LessonPlan`. */
function mapLessonPlan(db: DbLessonPlan): LessonPlan {
  const chapter = pick(db.chapters);
  const topic = pick(db.topics);

  return {
    lessonPlanId: db.lesson_plan_id,
    instituteId: db.institute_id,
    timetableSlotId: db.timetable_slot_id,
    occurrenceDate: db.occurrence_date,
    chapterId: db.chapter_id,
    topicId: db.topic_id,
    notes: db.notes,
    chapterName: chapter?.name ?? null,
    topicName: topic?.name ?? null,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    createdBy: db.created_by,
    updatedBy: db.updated_by,
  };
}

/** Converts a raw snake_case live_classes row into a `SlotClassStatus`. */
function mapSlotClassStatus(db: DbSlotClass): SlotClassStatus {
  return {
    classId: db.class_id,
    status: db.status,
    scheduledAt: db.scheduled_at,
  };
}

/**
 * Maps known Postgres RPC exception messages to friendly admin-facing text.
 * Unknown messages pass through so debugging stays possible.
 */
function friendlyLessonPlanError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes('only admins or the service role can manage lesson plans')) {
    return 'Only Super Admins and Academic Admins can manage lesson plans.';
  }
  if (m.includes('own institute')) {
    return 'Lesson plans can only be managed for your own institute.';
  }
  if (m.includes('timetable slot not found')) {
    return 'This timetable slot no longer exists.';
  }
  if (m.includes('a timetable slot id and occurrence date are required')) {
    return 'A timetable slot and occurrence date are required.';
  }
  if (m.includes('does not belong to the selected chapter') || m.includes('does not belong to chapter')) {
    return 'The selected topic does not belong to the selected chapter.';
  }
  if (m.includes('topic') && m.includes('does not exist')) {
    return 'The selected topic no longer exists.';
  }

  return message;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch lesson plans for one timetable slot within an inclusive date range.
 *
 * @param query - `{ timetableSlotId, from, to }` (from/to are YYYY-MM-DD).
 * @returns `ApiResponse<LessonPlan[]>` sorted by occurrence date ascending.
 */
export async function getLessonPlans(
  query: LessonPlanRangeQuery,
): Promise<ApiResponse<LessonPlan[]>> {
  try {
    validateUUID(query.timetableSlotId, 'timetableSlotId');
    if (!query.from || !query.to) {
      throw new Error('A from/to date range is required.');
    }

    const { data, error } = await supabase
      .from('lesson_plans')
      .select(LESSON_PLAN_SELECT)
      .eq('timetable_slot_id', query.timetableSlotId)
      .gte('occurrence_date', query.from)
      .lte('occurrence_date', query.to)
      .order('occurrence_date', { ascending: true });

    if (error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(error)) };
    }

    return {
      success: true,
      data: (data ?? []).map((row: DbLessonPlan) => mapLessonPlan(row)),
    };
  } catch (err) {
    return { success: false, error: friendlyLessonPlanError(extractErrorMessage(err)) };
  }
}

/**
 * Fetch the materialized `live_classes` status projection for one slot within
 * a date range — enough to render "generated / scheduled / live / completed /
 * cancelled" indicators in the planner.
 *
 * The window is widened by one day on each side (UTC) so a consumer joining
 * on the institute-local date (institutes.timezone, default Asia/Kolkata)
 * never misses a boundary row; a single slot has at most a handful of rows
 * per month, so this stays a bounded, index-backed lookup.
 *
 * @param query - `{ timetableSlotId, from, to }` (from/to are YYYY-MM-DD).
 * @returns `ApiResponse<SlotClassStatus[]>`.
 */
export async function getSlotClassStatuses(
  query: LessonPlanRangeQuery,
): Promise<ApiResponse<SlotClassStatus[]>> {
  try {
    validateUUID(query.timetableSlotId, 'timetableSlotId');
    if (!query.from || !query.to) {
      throw new Error('A from/to date range is required.');
    }

    // Inclusive UTC day window, widened ±1 day to absorb institute-timezone
    // boundary classes. `lt` on the exclusive end avoids `.999` fuzz.
    const fromIso = `${query.from}T00:00:00.000Z`;
    const toIso = `${query.to}T00:00:00.000Z`;
    const widenedFrom = new Date(new Date(fromIso).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const widenedToExclusive = new Date(
      new Date(toIso).getTime() + 2 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await supabase
      .from('live_classes')
      .select('class_id, status, scheduled_at')
      .eq('timetable_slot_id', query.timetableSlotId)
      .gte('scheduled_at', widenedFrom)
      .lt('scheduled_at', widenedToExclusive)
      .order('scheduled_at', { ascending: true });

    if (error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(error)) };
    }

    return {
      success: true,
      data: (data ?? []).map((row: DbSlotClass) => mapSlotClassStatus(row)),
    };
  } catch (err) {
    return { success: false, error: friendlyLessonPlanError(extractErrorMessage(err)) };
  }
}

/**
 * Fetch the dates on which a slot's occurrence will be skipped by
 * materialization — institute holidays and active teacher leaves within the
 * requested range (migration 108 tables).
 *
 * Mirrors the materializer's skip rule (migration 109): a date is skipped
 * when `institute_holidays` contains it OR an `active` `teacher_leaves` row
 * covers it. Active-leave ranges are expanded into per-date entries clamped
 * to the requested window.
 *
 * Precedence (documented): when a date is both a holiday and inside a leave,
 * it is labelled `holiday` — the materializer skips on either condition, so
 * the label only affects the UI badge, not class generation.
 *
 * @param query - `{ instituteId, teacherId, from, to }` (from/to YYYY-MM-DD).
 * @returns `ApiResponse<SlotSkips>`.
 */
export async function getSlotSkips(
  query: SlotSkipsQuery,
): Promise<ApiResponse<SlotSkips>> {
  try {
    validateUUID(query.instituteId, 'instituteId');
    validateUUID(query.teacherId, 'teacherId');
    if (!query.from || !query.to) {
      throw new Error('A from/to date range is required.');
    }

    const [holidaysRes, leavesRes] = await Promise.all([
      supabase
        .from('institute_holidays')
        .select('holiday_date')
        .eq('institute_id', query.instituteId)
        .gte('holiday_date', query.from)
        .lte('holiday_date', query.to),
      supabase
        .from('teacher_leaves')
        .select('start_date, end_date')
        .eq('institute_id', query.instituteId)
        .eq('teacher_id', query.teacherId)
        .eq('status', 'active')
        .lte('start_date', query.to)
        .gte('end_date', query.from),
    ]);

    if (holidaysRes.error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(holidaysRes.error)) };
    }
    if (leavesRes.error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(leavesRes.error)) };
    }

    const holidays = [...new Set((holidaysRes.data ?? []).map((r) => r.holiday_date))].sort();

    const leaves = new Set<string>();
    for (const leave of leavesRes.data ?? []) {
      const start = leave.start_date > query.from ? leave.start_date : query.from;
      const end = leave.end_date < query.to ? leave.end_date : query.to;
      for (const date of expandDateRange(start, end)) {
        leaves.add(date);
      }
    }
    const leavesSorted = [...leaves].sort();

    const skippedDates = [...new Set([...holidays, ...leavesSorted])].sort();
    const kinds: Record<string, SkipKind> = {};
    for (const date of skippedDates) {
      // Documented precedence: institute holiday wins over teacher leave.
      kinds[date] = holidays.includes(date) ? 'holiday' : 'teacher_leave';
    }

    return { success: true, data: { skippedDates, kinds } };
  } catch (err) {
    return { success: false, error: friendlyLessonPlanError(extractErrorMessage(err)) };
  }
}

/**
 * Fetch the earliest future lesson plan per timetable slot (one batched
 * query for all visible slots).
 *
 * Powers the "Next lesson" badge on the admin Timetable page — the
 * admin-side parity of the teacher's per-class lesson display. RLS scopes
 * the rows to the caller's institute; the visible slot ids scope it to the
 * current page. The result is a `Record<timetableSlotId, NextPlannedLesson>`
 * where each entry is the plan with the smallest occurrence_date ≥ `from`.
 *
 * No `limit` is applied: with the page's bounded slot list the query stays
 * small, and correctness (the earliest future plan per slot) is preserved
 * regardless of how far ahead plans are written.
 *
 * @param query - `{ slotIds, from }` (from is YYYY-MM-DD, inclusive).
 * @returns `ApiResponse<Record<string, NextPlannedLesson>>`.
 */
export async function getNextLessonPlans(
  query: NextLessonPlansQuery,
): Promise<ApiResponse<Record<string, NextPlannedLesson>>> {
  try {
    if (!Array.isArray(query.slotIds) || query.slotIds.length === 0) {
      throw new Error('At least one timetable slot is required.');
    }
    for (const id of query.slotIds) {
      validateUUID(id, 'timetableSlotId');
    }
    if (!query.from) {
      throw new Error('A from date is required.');
    }

    const { data, error } = await supabase
      .from('lesson_plans')
      .select(LESSON_PLAN_SELECT)
      .in('timetable_slot_id', query.slotIds)
      .gte('occurrence_date', query.from)
      .order('occurrence_date', { ascending: true });

    if (error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(error)) };
    }

    const nextBySlot: Record<string, NextPlannedLesson> = {};
    for (const row of data ?? []) {
      const slotId = row.timetable_slot_id;
      // Rows are ordered by occurrence_date ascending — the first row seen
      // for a slot is that slot's earliest future plan.
      if (nextBySlot[slotId]) continue;
      const plan = mapLessonPlan(row as DbLessonPlan);
      nextBySlot[slotId] = {
        timetableSlotId: slotId,
        occurrenceDate: plan.occurrenceDate,
        chapterName: plan.chapterName,
        topicName: plan.topicName,
      };
    }

    return { success: true, data: nextBySlot };
  } catch (err) {
    return { success: false, error: friendlyLessonPlanError(extractErrorMessage(err)) };
  }
}

/**
 * Resolve the `subject_id` for a `batch_subjects` row. The planner needs the
 * slot's subject to scope the chapter/topic pickers (subject is never
 * re-selected by the admin).
 *
 * @param batchSubjectId - `batch_subjects.batch_subject_id`.
 * @returns `ApiResponse<string>` — the subject_id on success.
 */
export async function resolveSlotSubject(
  batchSubjectId: string,
): Promise<ApiResponse<string>> {
  try {
    validateUUID(batchSubjectId, 'batchSubjectId');

    const { data, error } = await supabase
      .from('batch_subjects')
      .select('subject_id')
      .eq('batch_subject_id', batchSubjectId)
      .maybeSingle();

    if (error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(error)) };
    }
    if (!data) {
      return { success: false, error: 'Batch subject not found.' };
    }

    return { success: true, data: data.subject_id };
  } catch (err) {
    return { success: false, error: friendlyLessonPlanError(extractErrorMessage(err)) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations (SECURITY DEFINER RPCs — migration 113)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create or update one lesson plan (idempotent per slot + occurrence date)
 * via `upsert_lesson_plan`. The RPC atomically propagates chapter/topic to
 * the matching future scheduled live_class (status = 'scheduled' AND
 * scheduled_at > now()); live/completed/cancelled classes are never
 * rewritten.
 *
 * @param input - RPC params (p_*-prefixed server-side). FULL-REPLACE
 *          semantics: the RPC overwrites chapter/topic/notes, so callers
 *          must send the complete desired plan state (omitted fields become
 *          NULL).
 * @returns `ApiResponse<UpsertLessonPlanResult>` preserving the RPC's
 *          `success / planUpserted / occurrencesUpdated` fields.
 */
export async function upsertLessonPlan(
  input: UpsertLessonPlanInput,
): Promise<ApiResponse<UpsertLessonPlanResult>> {
  try {
    validateUUID(input.timetableSlotId, 'timetableSlotId');
    if (input.chapterId) validateUUID(input.chapterId, 'chapterId');
    if (input.topicId) validateUUID(input.topicId, 'topicId');
    if (!input.occurrenceDate) {
      throw new Error('An occurrence date is required.');
    }

    const params: Record<string, unknown> = {
      p_timetable_slot_id: input.timetableSlotId,
      p_occurrence_date: input.occurrenceDate,
    };
    if (input.chapterId !== undefined && input.chapterId !== null) {
      params.p_chapter_id = input.chapterId;
    }
    if (input.topicId !== undefined && input.topicId !== null) {
      params.p_topic_id = input.topicId;
    }
    if (input.notes !== undefined && input.notes !== null) {
      params.p_notes = input.notes;
    }
    if (input.createdBy !== undefined && input.createdBy !== null) {
      params.p_created_by = input.createdBy;
    }

    const { data, error } = await supabase.rpc('upsert_lesson_plan', params);

    if (error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(error)) };
    }

    return { success: true, data: data as UpsertLessonPlanResult };
  } catch (err) {
    return { success: false, error: friendlyLessonPlanError(extractErrorMessage(err)) };
  }
}

/**
 * Delete one lesson plan via `delete_lesson_plan`. The RPC clears
 * chapter/topic on the matching future scheduled live_class only; history
 * is never rewritten.
 *
 * @param input - `{ timetableSlotId, occurrenceDate }`.
 * @returns `ApiResponse<DeleteLessonPlanResult>` preserving the RPC's
 *          `success / planDeleted / occurrencesCleared` fields.
 */
export async function deleteLessonPlan(
  input: DeleteLessonPlanInput,
): Promise<ApiResponse<DeleteLessonPlanResult>> {
  try {
    validateUUID(input.timetableSlotId, 'timetableSlotId');
    if (!input.occurrenceDate) {
      throw new Error('An occurrence date is required.');
    }

    const { data, error } = await supabase.rpc('delete_lesson_plan', {
      p_timetable_slot_id: input.timetableSlotId,
      p_occurrence_date: input.occurrenceDate,
    });

    if (error) {
      return { success: false, error: friendlyLessonPlanError(extractErrorMessage(error)) };
    }

    return { success: true, data: data as DeleteLessonPlanResult };
  } catch (err) {
    return { success: false, error: friendlyLessonPlanError(extractErrorMessage(err)) };
  }
}
