/**
 * Admin Demo Class Hooks
 *
 * React Query hooks wrapping the demo class admin service. Server state is
 * owned by React Query — no Redux for demo classes.
 *
 * ## Exports
 *
 * | Hook                  | Type     | Description                                |
 * |-----------------------|----------|--------------------------------------------|
 * | `useDemoClassList`    | Query    | Paginated, filterable demo class list      |
 * | `useCreateDemoClass`  | Mutation | Create a demo (video upload + draft row)   |
 * | `useUpdateDemoClass`  | Mutation | Update metadata / replace video/thumbnail  |
 * | `usePublishDemoClass` | Mutation | Publish (draft/archived → published)       |
 * | `useArchiveDemoClass` | Mutation | Archive (published → archived)             |
 *
 * @module hooks/admin/useDemoClassAdmin
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import {
  getDemoClasses,
  createDemoClass,
  updateDemoClass,
  publishDemoClass,
  archiveDemoClass,
} from '@/services/admin/demoClassAdminService';
import type {
  DemoClass,
  DemoClassFilters,
  CreateDemoClassParams,
  UpdateDemoClassParams,
} from '@/types/demoClass';
import type { PaginatedResponse, PaginationParams } from '@/types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered demo class list (newest first).
 *
 * @param filters    - Optional institute/stream/status/search filters.
 * @param pagination - Optional page/pageSize (defaults page 1, pageSize 20).
 *
 * @example
 * const { data, isLoading } = useDemoClassList(
 *   { instituteId: 'uuid', status: 'published' },
 *   { page: 1, pageSize: 15 },
 * );
 */
export function useDemoClassList(
  filters?: DemoClassFilters,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<DemoClass>>({
    queryKey: adminKeys.demoClasses.list(filters as Record<string, unknown>, pagination),
    queryFn: async () => {
      const result = await getDemoClasses(
        filters,
        { sortBy: 'createdAt', sortDirection: 'desc' },
        pagination,
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch demo classes.');
      }
      return result.data!;
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new demo class (uploads the video, creates a DRAFT row).
 *
 * On success, invalidates every demo class list query.
 *
 * @example
 * const { mutate, isPending } = useCreateDemoClass();
 * mutate({ instituteId, streamId, title, file, createdBy, ... });
 */
export function useCreateDemoClass() {
  const queryClient = useQueryClient();

  return useMutation<DemoClass, Error, CreateDemoClassParams>({
    mutationFn: async (input) => {
      const result = await createDemoClass(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create demo class.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.demoClasses.lists() });
    },
  });
}

/**
 * Update an existing demo class (metadata and/or video/thumbnail swap).
 *
 * On success, invalidates the affected detail query and all list queries.
 *
 * @example
 * const { mutate, isPending } = useUpdateDemoClass();
 * mutate({ demoClassId, input: { title: 'JEE 2026 Demo' } });
 */
export function useUpdateDemoClass() {
  const queryClient = useQueryClient();

  return useMutation<DemoClass, Error, { demoClassId: string; input: UpdateDemoClassParams }>({
    mutationFn: async ({ demoClassId, input }) => {
      const result = await updateDemoClass(demoClassId, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update demo class.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.demoClasses.detail(variables.demoClassId) });
      queryClient.invalidateQueries({ queryKey: adminKeys.demoClasses.lists() });
    },
  });
}

/**
 * Publish a demo class (draft/archived → published, sets published_at).
 *
 * On success, invalidates the detail and list queries.
 *
 * @example
 * const { mutate, isPending } = usePublishDemoClass();
 * mutate(demoClassId);
 */
export function usePublishDemoClass() {
  const queryClient = useQueryClient();

  return useMutation<DemoClass, Error, string>({
    mutationFn: async (demoClassId) => {
      const result = await publishDemoClass(demoClassId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish demo class.');
      }
      return result.data!;
    },
    onSuccess: (_data, demoClassId) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.demoClasses.detail(demoClassId) });
      queryClient.invalidateQueries({ queryKey: adminKeys.demoClasses.lists() });
    },
  });
}

/**
 * Archive a published demo class (published → archived, published_at kept).
 *
 * On success, invalidates the detail and list queries.
 *
 * @example
 * const { mutate, isPending } = useArchiveDemoClass();
 * mutate(demoClassId);
 */
export function useArchiveDemoClass() {
  const queryClient = useQueryClient();

  return useMutation<DemoClass, Error, string>({
    mutationFn: async (demoClassId) => {
      const result = await archiveDemoClass(demoClassId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to archive demo class.');
      }
      return result.data!;
    },
    onSuccess: (_data, demoClassId) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.demoClasses.detail(demoClassId) });
      queryClient.invalidateQueries({ queryKey: adminKeys.demoClasses.lists() });
    },
  });
}
