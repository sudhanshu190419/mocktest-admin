/**
 * Bulk Timetable Import Hooks
 *
 * Phase 2 — React Query hooks wrapping the bulk-import service.
 *
 * ## Exports
 *
 * | Hook                        | Type     | Description                                     |
 * |-----------------------------|----------|-------------------------------------------------|
 * | `useBulkImportReferenceData`| Query    | Institute-scoped reference data for validation  |
 * | `useImportBulkTimetable`    | Mutation | Execute the validated import (bulk RPC 114)     |
 *
 * The parser (`parseImportFile`) and validator (`buildImportPreview`) are
 * PURE and are called from the Phase 3 UI component directly — they are not
 * server state and do not belong in React Query.
 *
 * @module hooks/admin/useBulkTimetableImport
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import {
  fetchBulkImportReferenceData,
  importBulkTimetable,
} from '@/services/admin/bulkTimetableImportService';
import type { BulkImportPayload, BulkImportRpcResult, ReferenceData } from '@/types/bulkTimetableImport';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch all master data the import validator needs for an institute.
 *
 * Fetched ONCE per institute (staleTime 5 min) and consumed by the pure
 * `buildImportPreview` call in the import modal.
 *
 * @param instituteId - The authenticated admin's institute.
 *
 * @example
 * const { data: reference, isLoading } = useBulkImportReferenceData(instituteId);
 */
export function useBulkImportReferenceData(instituteId?: string | null) {
  return useQuery<ReferenceData>({
    queryKey: adminKeys.bulkImport.reference(instituteId),
    queryFn: async () => {
      if (!instituteId) throw new Error('Institute is required.');
      const result = await fetchBulkImportReferenceData(instituteId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch import reference data.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Execute a validated bulk timetable import via `bulk_import_timetable`.
 *
 * On success, invalidates every timetable list and lesson-plan query so the
 * admin timetable and lesson planner reflect the imported slots/plans.
 *
 * @example
 * const { mutate, isPending, data } = useImportBulkTimetable();
 * mutate({ instituteId, payload });
 */
export function useImportBulkTimetable() {
  const queryClient = useQueryClient();

  return useMutation<BulkImportRpcResult, Error, { instituteId: string; payload: BulkImportPayload }>({
    mutationFn: async ({ instituteId, payload }) => {
      const result = await importBulkTimetable(instituteId, payload);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to import timetable.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.timetable.lists() });
      queryClient.invalidateQueries({ queryKey: adminKeys.lessonPlans.all() });
    },
  });
}
