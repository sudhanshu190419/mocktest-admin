/**
 * Admin Lesson Planner Hooks
 *
 * Phase 2A — React Query hooks wrapping the lesson-plan admin service.
 * Server state is owned by React Query — no Redux for lesson plans.
 *
 * ## Exports
 *
 * | Hook                     | Type     | Description                                 |
 * |--------------------------|----------|---------------------------------------------|
 * | `useLessonPlans`         | Query    | Lesson plans for a slot × date range        |
 * | `useUpsertLessonPlan`    | Mutation | Upsert a plan (via upsert_lesson_plan)      |
 * | `useDeleteLessonPlan`    | Mutation | Delete a plan (via delete_lesson_plan)      |
 *
 * Mutations invalidate `adminKeys.lessonPlans.lists()` on success — the
 * server is the source of truth, so no optimistic updates are used.
 *
 * @module hooks/admin/useLessonPlans
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import {
  deleteLessonPlan,
  getLessonPlans,
  getNextLessonPlans,
  getSlotClassStatuses,
  getSlotSkips,
  resolveSlotSubject,
  upsertLessonPlan,
} from '@/services/admin/lessonPlanAdminService';
import type {
  DeleteLessonPlanInput,
  DeleteLessonPlanResult,
  LessonPlan,
  LessonPlanRangeQuery,
  NextPlannedLesson,
  SlotClassStatus,
  SlotSkips,
  SlotSkipsQuery,
  UpsertLessonPlanInput,
  UpsertLessonPlanResult,
} from '@/types/lessonPlan';

/** Server-side data staleness for lesson-plan queries. */
const LESSON_PLANS_STALE_TIME = 5 * 60 * 1000;

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch lesson plans for one timetable slot within an inclusive date range.
 *
 * @param query - `{ timetableSlotId, from, to }` (from/to are YYYY-MM-DD).
 *
 * @example
 * const { data, isLoading } = useLessonPlans({
 *   timetableSlotId: 'uuid',
 *   from: '2026-08-01',
 *   to: '2026-08-31',
 * });
 */
export function useLessonPlans(query: LessonPlanRangeQuery) {
  const enabled = Boolean(query.timetableSlotId && query.from && query.to);

  return useQuery<LessonPlan[]>({
    queryKey: adminKeys.lessonPlans.list(query.timetableSlotId, query.from, query.to),
    enabled,
    staleTime: LESSON_PLANS_STALE_TIME,
    queryFn: async () => {
      const result = await getLessonPlans(query);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch lesson plans.');
      }
      return result.data!;
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Fetch the materialized `live_classes` status projection for a slot's date
 * range (class_id, status, scheduled_at) — enough to render class-status
 * indicators in the planner.
 *
 * @example
 * const { data } = useSlotClassStatuses({
 *   timetableSlotId: 'uuid',
 *   from: '2026-08-01',
 *   to: '2026-08-31',
 * });
 */
export function useSlotClassStatuses(query: LessonPlanRangeQuery) {
  const enabled = Boolean(query.timetableSlotId && query.from && query.to);

  return useQuery<SlotClassStatus[]>({
    queryKey: adminKeys.lessonPlans.classStatuses.list(
      query.timetableSlotId,
      query.from,
      query.to,
    ),
    enabled,
    staleTime: LESSON_PLANS_STALE_TIME,
    queryFn: async () => {
      const result = await getSlotClassStatuses(query);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch class statuses.');
      }
      return result.data!;
    },
  });
}

/**
 * Resolve the `subject_id` for a `batch_subjects` row — scopes the chapter
 * picker without letting the admin re-select a subject.
 *
 * @param batchSubjectId - `batch_subjects.batch_subject_id`.
 * @example
 * const { data: subjectId } = useSlotSubject(slot.batchSubjectId);
 */
export function useSlotSubject(batchSubjectId: string | null | undefined) {
  return useQuery<string>({
    queryKey: adminKeys.lessonPlans.subject(batchSubjectId ?? undefined),
    enabled: Boolean(batchSubjectId),
    staleTime: LESSON_PLANS_STALE_TIME,
    queryFn: async () => {
      const result = await resolveSlotSubject(batchSubjectId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to resolve the slot subject.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch the dates in a slot's month window that materialization will skip
 * (institute holidays + active teacher leaves for the slot's teacher).
 *
 * @example
 * const { data: skips } = useSlotSkips({
 *   instituteId: slot.instituteId,
 *   teacherId: slot.teacherId,
 *   from: '2026-08-01',
 *   to: '2026-08-31',
 * });
 */
export function useSlotSkips(query: SlotSkipsQuery) {
  const enabled = Boolean(
    query.instituteId && query.teacherId && query.from && query.to,
  );

  return useQuery<SlotSkips>({
    queryKey: adminKeys.lessonPlans.skips.list(
      query.instituteId,
      query.teacherId,
      query.from,
      query.to,
    ),
    enabled,
    staleTime: LESSON_PLANS_STALE_TIME,
    queryFn: async () => {
      const result = await getSlotSkips(query);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch holiday/leave information.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch the earliest future lesson plan per timetable slot (batched) —
 * powers the "Next lesson" badge on the admin Timetable page.
 *
 * @param slotIds - visible timetable slot ids (empty → query disabled).
 * @param from    - YYYY-MM-DD; only plans on/after this date are considered.
 * @example
 * const { data: nextBySlot } = useNextLessonPlans(slotIds, todayIso);
 */
export function useNextLessonPlans(slotIds: string[], from?: string) {
  const enabled = slotIds.length > 0 && Boolean(from);

  return useQuery<Record<string, NextPlannedLesson>>({
    queryKey: adminKeys.lessonPlans.next.list(slotIds, from),
    enabled,
    staleTime: LESSON_PLANS_STALE_TIME,
    queryFn: async () => {
      const result = await getNextLessonPlans({ slotIds, from: from! });
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch next lesson plans.');
      }
      return result.data!;
    },
  });
}

/**
 * Create or update a lesson plan (via `upsert_lesson_plan`).
 *
 * No optimistic updates — on success every lesson-plan range query AND the
 * admin Timetable's next-lesson badge query are invalidated and refetched
 * from the authoritative server state.
 *
 * @example
 * const { mutate, isPending } = useUpsertLessonPlan();
 * mutate({ timetableSlotId, occurrenceDate: '2026-08-17', chapterId, topicId });
 */
export function useUpsertLessonPlan() {
  const queryClient = useQueryClient();

  return useMutation<UpsertLessonPlanResult, Error, UpsertLessonPlanInput>({
    mutationFn: async (input) => {
      const result = await upsertLessonPlan(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to save lesson plan.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.lessonPlans.lists() });
      queryClient.invalidateQueries({ queryKey: adminKeys.lessonPlans.next.all() });
    },
  });
}

/**
 * Delete a lesson plan (via `delete_lesson_plan`).
 *
 * No optimistic updates — on success every lesson-plan range query AND the
 * admin Timetable's next-lesson badge query are invalidated and refetched.
 *
 * @example
 * const { mutate, isPending } = useDeleteLessonPlan();
 * mutate({ timetableSlotId, occurrenceDate: '2026-08-17' });
 */
export function useDeleteLessonPlan() {
  const queryClient = useQueryClient();

  return useMutation<DeleteLessonPlanResult, Error, DeleteLessonPlanInput>({
    mutationFn: async (input) => {
      const result = await deleteLessonPlan(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete lesson plan.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.lessonPlans.lists() });
      queryClient.invalidateQueries({ queryKey: adminKeys.lessonPlans.next.all() });
    },
  });
}
