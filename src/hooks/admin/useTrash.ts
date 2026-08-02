/**
 * Recycle Bin Hooks
 *
 * React Query hooks for the admin Recycle Bin (super admin only).
 *
 * Wraps the Phase 8C `trashService` backend:
 *   - `useTrashList`        → trashService.listDeleted(filters, sort, pagination)
 *   - `useTrashItem`        → trashService.getDeletedItem(resourceType, resourceId)
 *   - `useRestoreTrashItem` → trashService.restore(resourceType, resourceId)
 *   - `usePermanentDeleteTrashItem` → trashService.permanentlyDelete(resourceType, resourceId, reason)
 *   - `useBulkRestoreTrashItems`    → trashService.bulkRestore(items)
 *   - `useBulkPermanentDeleteTrashItems` → trashService.bulkPermanentlyDelete(items, reason)
 *
 * Follows the exact same pattern as hooks/admin/useBatchManagement.ts and
 * hooks/admin/useAuditLogs.ts.
 *
 * ## Exports
 *
 * | Hook                           | Description                                     |
 * |--------------------------------|-------------------------------------------------|
 * | `useTrashList`                 | Paginated, filtered, sorted Recycle Bin list    |
 * | `useTrashItem`                 | Single deleted item detail (for detail panel)   |
 * | `useRestoreTrashItem`          | Restore a soft-deleted resource                 |
 * | `usePermanentDeleteTrashItem`  | Permanently delete a soft-deleted resource      |
 * | `useBulkRestoreTrashItems`     | Bulk restore (independent per item)             |
 * | `useBulkPermanentDeleteTrashItems` | Bulk permanent delete (independent per item) |
 *
 * @module hooks/admin/useTrash
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { trashService } from '@/services/admin/trashService';
import type {
  TrashListFilters,
  TrashSortOptions,
  TrashListParams,
  TrashResourceType,
  BulkItemRef,
} from '@/services/admin/trashService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the paginated, filtered, sorted Recycle Bin listing.
 *
 * @param filters    - Optional filter criteria (resourceTypes, search, deletedBy, date range).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters (page, pageSize).
 *
 * Cache key: `['admin', 'trash', 'list', filters, sort, pagination]`
 * Stale time: 30 seconds (the bin changes whenever anything is deleted/restored)
 */
export function useTrashList(
  filters?: TrashListFilters,
  sort?: TrashSortOptions,
  pagination?: TrashListParams,
) {
  return useQuery({
    queryKey: adminKeys.trash.list(
      filters as Record<string, unknown> | undefined,
      sort as Record<string, unknown> | undefined,
      pagination as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const result = await trashService.listDeleted(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch Recycle Bin.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch a single soft-deleted item (for the detail panel).
 *
 * @param resourceType - The resource type (e.g. 'questions').
 * @param resourceId   - The primary key of the deleted row.
 *
 * Cache key: `['admin', 'trash', 'detail', resourceType, resourceId]`
 * Stale time: 30 seconds
 */
export function useTrashItem(resourceType: TrashResourceType | null, resourceId: string | null) {
  return useQuery({
    queryKey: adminKeys.trash.detail(resourceType ?? '', resourceId ?? ''),
    queryFn: async () => {
      const result = await trashService.getDeletedItem(resourceType!, resourceId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch deleted item.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    enabled: !!resourceType && !!resourceId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Restore a soft-deleted resource.
 *
 * On success invalidates the trash list + detail caches so the restored item
 * disappears immediately from the Recycle Bin.
 */
export function useRestoreTrashItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      resourceType,
      resourceId,
    }: {
      resourceType: TrashResourceType;
      resourceId: string;
    }) => trashService.restore(resourceType, resourceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.trash.all() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Permanently delete a soft-deleted resource (Recycle Bin purge).
 *
 * IRREVERSIBLE — removes the DB row, child rows, and associated storage
 * files. On success invalidates the trash list + detail caches so the item
 * disappears immediately from the Recycle Bin.
 */
export function usePermanentDeleteTrashItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      resourceType,
      resourceId,
      reason,
    }: {
      resourceType: TrashResourceType;
      resourceId: string;
      reason?: string;
    }) => trashService.permanentlyDelete(resourceType, resourceId, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.trash.all() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Bulk restore multiple soft-deleted resources.
 *
 * Executes every item independently (Promise.allSettled) — one failure never
 * stops the rest. On completion invalidates the trash + dashboard caches so
 * restored items disappear immediately.
 */
export function useBulkRestoreTrashItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (items: BulkItemRef[]) => trashService.bulkRestore(items),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.trash.all() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}

/**
 * Bulk permanent delete multiple soft-deleted resources.
 *
 * IRREVERSIBLE — executes every item independently (Promise.allSettled) with
 * a shared mandatory reason. On completion invalidates the trash + dashboard
 * caches so purged items disappear immediately.
 */
export function useBulkPermanentDeleteTrashItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ items, reason }: { items: BulkItemRef[]; reason: string }) =>
      trashService.bulkPermanentlyDelete(items, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.trash.all() }),
        queryClient.invalidateQueries({ queryKey: adminKeys.dashboard.all() }),
      ]);
    },
  });
}
