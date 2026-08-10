/**
 * Admin Lesson Planner Types
 *
 * Phase 2A — Lesson Planner service/data layer. Mirrors the `lesson_plans`
 * table added by migration 113 and the RPC return shapes of
 * `upsert_lesson_plan()` / `delete_lesson_plan()`.
 *
 * @module types/lessonPlan
 */

/**
 * A single lesson_plan row (migration 113) with chapter/topic names resolved.
 *
 * `chapterId` is the anchor; `topicId` is an optional refinement that, when
 * set, always belongs to `chapterId` (enforced by the DB integrity trigger).
 */
export interface LessonPlan {
  lessonPlanId: string;
  instituteId: string;
  /** FK → timetable_slots.timetable_slot_id. */
  timetableSlotId: string;
  /** Planned occurrence date (YYYY-MM-DD). */
  occurrenceDate: string;
  /** FK → chapters.chapter_id (nullable until a chapter is chosen). */
  chapterId: string | null;
  /** FK → topics.topic_id (nullable = chapter-only lesson). */
  topicId: string | null;
  /** Free-form admin note. */
  notes: string | null;
  /** Joined chapter display name (via chapters). */
  chapterName: string | null;
  /** Joined topic display name (via topics). */
  topicName: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * Inclusive date-range query for a single timetable slot.
 *
 * `from` / `to` are YYYY-MM-DD strings (the planner passes its month window).
 */
export interface LessonPlanRangeQuery {
  timetableSlotId: string;
  from: string;
  to: string;
}

/**
 * live_classes.status — mirrors the `live_class_status` enum (migration 002).
 */
export type LiveClassStatus = 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled';

/**
 * Input for `upsert_lesson_plan` (RPC params are p_-prefixed server-side).
 *
 * FULL-REPLACE SEMANTICS: the RPC's `ON CONFLICT DO UPDATE` overwrites
 * chapter/topic/notes with the values passed here. Omitted optional fields
 * (undefined/null) become NULL — so an edit must always send the complete
 * desired plan state (the editor always submits the full current values).
 */
export interface UpsertLessonPlanInput {
  timetableSlotId: string;
  /** Planned occurrence date (YYYY-MM-DD). */
  occurrenceDate: string;
  chapterId?: string | null;
  /** When set, must belong to `chapterId` (RPC + trigger enforce). */
  topicId?: string | null;
  notes?: string | null;
  /** Optional actor; omitted → the RPC derives auth.uid(). */
  createdBy?: string | null;
}

/** Input for `delete_lesson_plan`. */
export interface DeleteLessonPlanInput {
  timetableSlotId: string;
  occurrenceDate: string;
}

/**
 * RPC return of `upsert_lesson_plan` (jsonb, preserved verbatim).
 *
 * `success` is the RPC's own flag; `occurrencesUpdated` counts future
 * scheduled live_classes whose chapter/topic were propagated in the same
 * transaction (0 = the occurrence is not materialized yet).
 */
export interface UpsertLessonPlanResult {
  success: boolean;
  planUpserted: boolean;
  occurrencesUpdated: number;
}

/** RPC return of `delete_lesson_plan` (jsonb, preserved verbatim). */
export interface DeleteLessonPlanResult {
  success: boolean;
  planDeleted: number;
  occurrencesCleared: number;
}

/**
 * Minimal live_classes projection for a slot's date range — used to render
 * materialization + class-status indicators (scheduled/live/completed/
 * cancelled) in the planner without fetching historical data.
 */
export interface SlotClassStatus {
  classId: string;
  status: LiveClassStatus;
  /** ISO 8601 scheduled start (UTC timestamptz). */
  scheduledAt: string;
}

/**
 * Why a date is skipped by materialization.
 *
 * When a date is BOTH an institute holiday and inside an active teacher
 * leave, the materializer skips it either way; `getSlotSkips` labels it
 * `holiday` (institute-wide events take precedence over a single teacher's
 * leave).
 */
export type SkipKind = 'holiday' | 'teacher_leave';

/** Date-range skip query (`institute_holidays` + `teacher_leaves`, migration 108). */
export interface SlotSkipsQuery {
  instituteId: string;
  /** teacher_details.teacher_id of the slot's teacher. */
  teacherId: string;
  /** YYYY-MM-DD window start (inclusive). */
  from: string;
  /** YYYY-MM-DD window end (inclusive). */
  to: string;
}

/**
 * Per-date skip info for a slot's month window.
 *
 * `skippedDates` is the sorted, deduped union of institute holidays and
 * active teacher-leave dates within the requested range; `kinds` gives the
 * deterministic label per date (holiday wins when both apply).
 */
export interface SlotSkips {
  /** Sorted YYYY-MM-DD dates the backend will skip (holiday or leave). */
  skippedDates: string[];
  /** Deterministic label per skipped date (see `SkipKind`). */
  kinds: Record<string, SkipKind>;
}

/**
 * Batched query for the earliest future lesson plan per timetable slot.
 *
 * Consumed by the admin Timetable page to show the next planned lesson on
 * each recurring slot card (calendar + list) — the admin-side parity of the
 * teacher's per-class lesson display.
 */
export interface NextLessonPlansQuery {
  /** Visible timetable slot ids (bounded by the page's pagination). */
  slotIds: string[];
  /** YYYY-MM-DD — only plans on/after this date are considered. */
  from: string;
}

/**
 * The earliest future lesson plan of a timetable slot.
 *
 * `chapterName`/`topicName` are joined display names; a plan may be
 * chapter-only (topicName null). Keyed by `timetableSlotId` in the service
 * result so the page can look it up per slot without a second query.
 */
export interface NextPlannedLesson {
  /** FK → timetable_slots.timetable_slot_id. */
  timetableSlotId: string;
  /** Planned occurrence date (YYYY-MM-DD) of the earliest future plan. */
  occurrenceDate: string;
  chapterName: string | null;
  topicName: string | null;
}
