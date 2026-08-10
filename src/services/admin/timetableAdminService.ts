/**
 * Admin Timetable Management Service
 *
 * Phase 2A — Admin Timetable UI. Manages recurring `timetable_slots`
 * (migration 108) in the Admin Dashboard.
 *
 * ## Architecture decisions
 *
 * 1. **RLS is respected.** Uses the anon key — all queries run as the
 *    authenticated admin. Migration 108 grants SELECT on timetable_slots
 *    only to super_admin / academic_admin scoped to their own institute
 *    (and teachers for their own slots). Finance admins, students, and
 *    unassigned teachers are denied at the RLS layer.
 *
 * 2. **All writes go through SECURITY DEFINER RPCs.** Migration 108 has NO
 *    INSERT/UPDATE/DELETE policies on timetable_slots — the only write path
 *    is the RPC transaction which enforces role, institute scope, teacher→
 *    batch-subject assignment, and teacher/batch conflict detection with
 *    advisory-lock serialization:
 *      - create_timetable_slot(...)          → returns slot id
 *      - update_timetable_slot(...)          → full-field update w/ conflicts
 *      - set_timetable_slot_status(...)      → active | paused | cancelled
 *    The service NEVER issues a direct table write.
 *
 * 3. **No materialization from the UI.** This phase proves admin → create →
 *    see. materialize_timetable_classes() is exercised separately (Phase 2B).
 *
 * @module services/admin/timetableAdminService
 */

import { supabase } from '@/config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '@/utils/supabase';
import { buildPaginatedResponse } from '@/utils/response';
import type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection } from '@/types/academic';
import type {
  CreateTimetableSlotParams,
  TimetableFilters,
  TimetableSlot,
  TimetableSlotStatus,
  UpdateTimetableSlotParams,
} from '@/types/timetable';

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Types
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
}

/** PostgREST select with teacher + batch + subject joins (via FK constraint hints). */
const TIMETABLE_SELECT = `*,
  teacher_details!fk_timetable_slots_teacher (
    teacher_id,
    profiles!fk_teacher_details_profile ( name )
  ),
  batch_subjects!fk_timetable_slots_batch_subject (
    batch_subject_id,
    batch_id,
    batches!fk_batch_subjects_batch ( name ),
    subjects!fk_batch_subjects_subject ( name )
  )`;

/** Maps camelCase sort keys to snake_case columns. */
const SORT_FIELD_MAP: Record<string, string> = {
  dayOfWeek: 'day_of_week',
  startTime: 'start_time',
  validFrom: 'valid_from',
  validUntil: 'valid_until',
  status: 'status',
  createdAt: 'created_at',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

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
    createdBy: db.created_by,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

/**
 * Maps known Postgres RPC exception messages to friendly admin-facing text.
 * Unknown messages pass through so debugging stays possible.
 */
function friendlyTimetableError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes('conflicting timetable slot')) {
    return 'This timetable conflicts with an existing active slot — the same teacher or batch already has a class on this day/time within an overlapping validity period.';
  }
  if (m.includes('not assigned to this batch-subject')) {
    return 'The selected teacher is not assigned to this batch-subject. Assign them first in Batch Management.';
  }
  if (m.includes('does not belong to this institute')) {
    return 'The selected batch-subject does not belong to your institute.';
  }
  if (m.includes('own institute')) {
    return 'Timetables can only be managed for your own institute.';
  }
  if (m.includes('only super admins or academic admins')) {
    return 'Only Super Admins and Academic Admins can manage timetables.';
  }
  if (m.includes('only admins can check')) {
    return 'Only admins can check timetable conflicts.';
  }
  if (m.includes('day_of_week must be between')) {
    return 'Day of week must be between Monday (1) and Sunday (7).';
  }
  if (m.includes('end_time must be after start_time')) {
    return 'End time must be after start time.';
  }
  if (m.includes('valid_until must be on or after')) {
    return 'Valid until must be on or after valid from.';
  }
  if (m.includes('a valid from/to date range')) {
    return 'A valid from/to date range is required.';
  }

  return message;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Best-effort automatic materialization (approved Option D, Part A)
// ═══════════════════════════════════════════════════════════════════════════
//
// After successful timetable mutations we trigger materialization so the
// teacher calendar gets its live_classes immediately. These helpers NEVER
// throw and NEVER change the mutation's own result — a materialization
// failure only logs (the daily cron `timetable-materialization-daily` from
// migration 110 recovers missed occurrences).

/** UTC date-only (YYYY-MM-DD). */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Best-effort: materialize ALL active slots of an institute for the next
 * 60 days via the existing `materialize_institute_timetable` RPC (108).
 * Never throws.
 */
async function bestEffortMaterializeInstitute(instituteId: string): Promise<void> {
  try {
    validateUUID(instituteId, 'instituteId');
    const from = dateOnly(new Date());
    const to = dateOnly(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));

    const { data, error } = await supabase.rpc('materialize_institute_timetable', {
      p_institute_id: instituteId,
      p_from_date: from,
      p_to_date: to,
    });

    if (error) {
      console.error('[TimetableMaterialization] materialize_institute_timetable failed:', error.message);
      return;
    }
    console.log(
      '[TimetableMaterialization] materialized', data ?? 0, 'classes for institute', instituteId,
    );
  } catch (err) {
    console.error('[TimetableMaterialization] best-effort materialization error:', err);
  }
}

/**
 * Best-effort: reconcile ONE slot via the `reconcile_timetable_slot` RPC
 * (migration 110) — cancels stale future scheduled occurrences and, when the
 * slot is active, re-materializes the next 60 days. Never throws.
 */
async function bestEffortReconcileSlot(timetableSlotId: string): Promise<void> {
  try {
    validateUUID(timetableSlotId, 'timetableSlotId');

    const { data, error } = await supabase.rpc('reconcile_timetable_slot', {
      p_slot_id: timetableSlotId,
    });

    if (error) {
      console.error('[TimetableMaterialization] reconcile_timetable_slot failed:', error.message);
      return;
    }
    console.log(
      '[TimetableMaterialization] reconciled slot', timetableSlotId, '=>', data ?? 0, 'classes affected',
    );
  } catch (err) {
    console.error('[TimetableMaterialization] best-effort reconcile error:', err);
  }
}

/**
 * True when an edit changes any field that affects generated occurrences.
 * Metadata-only edits (nothing here is metadata-only today, but the check
 * keeps future field additions safe) must NOT cancel + recreate future
 * classes unnecessarily.
 */
export function isScheduleAffectingEdit(
  previous: TimetableSlot,
  next: UpdateTimetableSlotParams,
): boolean {
  // DB `time` values are "HH:MM:SS"; form values are "HH:MM" — compare HH:MM.
  const norm = (t: string) => (t ?? '').slice(0, 5);

  return (
    previous.teacherId !== next.teacherId ||
    previous.batchSubjectId !== next.batchSubjectId ||
    previous.dayOfWeek !== next.dayOfWeek ||
    norm(previous.startTime) !== norm(next.startTime) ||
    norm(previous.endTime) !== norm(next.endTime) ||
    previous.validFrom !== next.validFrom ||
    previous.validUntil !== next.validUntil
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a paginated, filtered, sorted list of timetable slots with teacher,
 * batch, and subject names joined. Default sort: day_of_week ASC,
 * start_time ASC (i.e. a Monday-first weekly timetable).
 */
export async function getTimetableSlots(
  filters?: TimetableFilters,
  sort?: { sortBy?: string; sortDirection?: SortDirection },
  pagination?: PaginationParams,
): Promise<ApiResponse<PaginatedResponse<TimetableSlot>>> {
  try {
    let query = supabase
      .from('timetable_slots')
      .select(TIMETABLE_SELECT, { count: 'exact' });

    // ── Filters ──────────────────────────────────────────────────────
    if (filters?.instituteId) {
      validateUUID(filters.instituteId, 'instituteId');
      query = query.eq('institute_id', filters.instituteId);
    }
    if (filters?.teacherId) {
      validateUUID(filters.teacherId, 'teacherId');
      query = query.eq('teacher_id', filters.teacherId);
    }
    if (filters?.batchId) {
      validateUUID(filters.batchId, 'batchId');
      // Filter through the joined batch_subjects (PostgREST embedded filter).
      query = query.eq('batch_subjects.batch_id', filters.batchId);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    // ── Sort ─────────────────────────────────────────────────────────
    const sortBy = SORT_FIELD_MAP[sort?.sortBy ?? 'dayOfWeek'] ?? 'day_of_week';
    query = query.order(sortBy, { ascending: (sort?.sortDirection ?? 'asc') === 'asc' });
    // Secondary sort: start_time ASC keeps the timetable readable.
    if (sortBy !== 'start_time') {
      query = query.order('start_time', { ascending: true });
    }

    // ── Pagination ───────────────────────────────────────────────────
    const { page, pageSize, from, to } = buildPagination(pagination);
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const items = (data ?? []).map((row: DbTimetableSlot) => mapTimetableSlot(row));

    return {
      success: true,
      data: buildPaginatedResponse(items, count ?? 0, page, pageSize),
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Create an active timetable slot via the `create_timetable_slot` RPC.
 *
 * The RPC (SECURITY DEFINER, advisory-locked) validates admin role, institute
 * scope, teacher→batch-subject assignment, and teacher/batch conflicts in one
 * transaction — the database is authoritative. No direct table insert.
 *
 * @param params - institute + teacher + batch-subject + day/time + validity.
 * @returns The new timetable_slot_id on success.
 */
export async function createTimetableSlot(
  params: CreateTimetableSlotParams,
): Promise<ApiResponse<string>> {
  try {
    validateUUID(params.instituteId, 'instituteId');
    validateUUID(params.teacherId, 'teacherId');
    validateUUID(params.batchSubjectId, 'batchSubjectId');
    validateUUID(params.createdBy, 'createdBy');

    const { data, error } = await supabase.rpc('create_timetable_slot', {
      p_institute_id: params.instituteId,
      p_teacher_id: params.teacherId,
      p_batch_subject_id: params.batchSubjectId,
      p_day_of_week: params.dayOfWeek,
      p_start_time: params.startTime,
      p_end_time: params.endTime,
      p_valid_from: params.validFrom,
      p_valid_until: params.validUntil,
      p_created_by: params.createdBy,
    });

    if (error) {
      return { success: false, error: friendlyTimetableError(extractErrorMessage(error)) };
    }

    // ── Best-effort immediate materialization (approved Option D, Part A) ──
    // Never blocks or fails the create — the daily cron catch-up recovers.
    void bestEffortMaterializeInstitute(params.instituteId);

    return { success: true, data: (data as string) ?? '' };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update a timetable slot via the `update_timetable_slot` RPC.
 *
 * The RPC re-runs the full conflict detection (excluding the slot itself) and
 * validates the teacher→batch-subject assignment. No direct table update.
 *
 * @param params - slot id + full field set.
 */
export async function updateTimetableSlot(
  params: UpdateTimetableSlotParams,
  previousSlot?: TimetableSlot | null,
): Promise<ApiResponse<null>> {
  try {
    validateUUID(params.timetableSlotId, 'timetableSlotId');
    validateUUID(params.teacherId, 'teacherId');
    validateUUID(params.batchSubjectId, 'batchSubjectId');

    const { error } = await supabase.rpc('update_timetable_slot', {
      p_slot_id: params.timetableSlotId,
      p_teacher_id: params.teacherId,
      p_batch_subject_id: params.batchSubjectId,
      p_day_of_week: params.dayOfWeek,
      p_start_time: params.startTime,
      p_end_time: params.endTime,
      p_valid_from: params.validFrom,
      p_valid_until: params.validUntil,
    });

    if (error) {
      return { success: false, error: friendlyTimetableError(extractErrorMessage(error)) };
    }

    // ── Best-effort reconciliation (approved Option D, Part A) ────────────
    // Only schedule-affecting edits cancel + regenerate occurrences via
    // reconcile_timetable_slot (migration 110). Metadata-only edits leave
    // future classes untouched. Best-effort: never fails the update.
    if (!previousSlot || isScheduleAffectingEdit(previousSlot, params)) {
      void bestEffortReconcileSlot(params.timetableSlotId);
    }

    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Change a timetable slot's lifecycle status via `set_timetable_slot_status`.
 *
 * Soft lifecycle only — slots are never hard-deleted. active → paused |
 * cancelled; paused/cancelled slots never generate future classes.
 *
 * @param timetableSlotId - UUID of the slot.
 * @param status          - active | paused | cancelled.
 */
export async function setTimetableSlotStatus(
  timetableSlotId: string,
  status: TimetableSlotStatus,
): Promise<ApiResponse<null>> {
  try {
    validateUUID(timetableSlotId, 'timetableSlotId');

    const { error } = await supabase.rpc('set_timetable_slot_status', {
      p_slot_id: timetableSlotId,
      p_status: status,
    });

    if (error) {
      return { success: false, error: friendlyTimetableError(extractErrorMessage(error)) };
    }

    // ── Best-effort reconcile on lifecycle change ─────────────────────────
    // active       → cancels stale future + regenerates next 60 days
    // paused       → cancels future scheduled occurrences (nothing regenerated)
    // cancelled    → cancels future scheduled occurrences (history preserved)
    void bestEffortReconcileSlot(timetableSlotId);

    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
