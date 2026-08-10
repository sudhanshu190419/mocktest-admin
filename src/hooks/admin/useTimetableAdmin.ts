/**
 * Admin Timetable Hooks
 *
 * React Query hooks wrapping the timetable admin service. Server state is
 * owned by React Query — no Redux for timetables.
 *
 * ## Exports
 *
 * | Hook                     | Type     | Description                              |
 * |--------------------------|----------|------------------------------------------|
 * | `useTimetableSlotList`   | Query    | Paginated, filterable timetable list     |
 * | `useCreateTimetableSlot` | Mutation | Create a slot (via create_timetable_slot)|
 * | `useUpdateTimetableSlot` | Mutation | Update a slot (via update_timetable_slot)|
 * | `useSetTimetableSlotStatus` | Mutation | active/paused/cancelled lifecycle      |
 *
 * @module hooks/admin/useTimetableAdmin
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import {
  getTimetableSlots,
  createTimetableSlot,
  updateTimetableSlot,
  setTimetableSlotStatus,
} from '@/services/admin/timetableAdminService';
import type {
  CreateTimetableSlotParams,
  TimetableFilters,
  TimetableSlot,
  TimetableSlotStatus,
  UpdateTimetableSlotParams,
} from '@/types/timetable';
import type { PaginatedResponse, PaginationParams } from '@/types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered timetable slot list (Monday-first weekly order).
 *
 * @param filters    - Optional institute/teacher/batch/status filters.
 * @param pagination - Optional page/pageSize.
 *
 * @example
 * const { data, isLoading } = useTimetableSlotList(
 *   { instituteId: 'uuid', status: 'active' },
 *   { page: 1, pageSize: 50 },
 * );
 */
export function useTimetableSlotList(
  filters?: TimetableFilters,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<TimetableSlot>>({
    queryKey: adminKeys.timetable.list(
      filters as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await getTimetableSlots(filters, undefined, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch timetable.');
      }
      return result.data!;
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new timetable slot (via create_timetable_slot RPC).
 *
 * On success, invalidates every timetable list query.
 *
 * @example
 * const { mutate, isPending } = useCreateTimetableSlot();
 * mutate({ instituteId, teacherId, batchSubjectId, dayOfWeek: 1, ... });
 */
export function useCreateTimetableSlot() {
  const queryClient = useQueryClient();

  return useMutation<string, Error, CreateTimetableSlotParams>({
    mutationFn: async (input) => {
      const result = await createTimetableSlot(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create timetable slot.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.timetable.lists() });
    },
  });
}

/** Input for the update mutation: RPC params + the slot's pre-edit state. */
export type UpdateTimetableSlotInput = UpdateTimetableSlotParams & {
  /** The slot as it existed before this edit — used to detect schedule-affecting changes. */
  previousSlot?: TimetableSlot | null;
};

/**
 * Update an existing timetable slot (via update_timetable_slot RPC).
 *
 * On success, invalidates all timetable list queries. When `previousSlot` is
 * provided and the edit is schedule-affecting, the service best-effort
 * reconciles generated occurrences (cancel stale future + regenerate).
 *
 * @example
 * const { mutate, isPending } = useUpdateTimetableSlot();
 * mutate({ timetableSlotId, teacherId, batchSubjectId, dayOfWeek: 2, ..., previousSlot });
 */
export function useUpdateTimetableSlot() {
  const queryClient = useQueryClient();

  return useMutation<null, Error, UpdateTimetableSlotInput>({
    mutationFn: async (input) => {
      const { previousSlot, ...params } = input;
      const result = await updateTimetableSlot(params, previousSlot ?? null);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update timetable slot.');
      }
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.timetable.lists() });
    },
  });
}

/**
 * Change a timetable slot's lifecycle status (via set_timetable_slot_status).
 *
 * On success, invalidates all timetable list queries.
 *
 * @example
 * const { mutate, isPending } = useSetTimetableSlotStatus();
 * mutate({ timetableSlotId, status: 'paused' });
 */
export function useSetTimetableSlotStatus() {
  const queryClient = useQueryClient();

  return useMutation<null, Error, { timetableSlotId: string; status: TimetableSlotStatus }>({
    mutationFn: async ({ timetableSlotId, status }) => {
      const result = await setTimetableSlotStatus(timetableSlotId, status);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update timetable status.');
      }
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.timetable.lists() });
    },
  });
}
