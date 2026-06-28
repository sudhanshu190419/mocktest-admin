/**
 * Stream Hooks
 *
 * React Query hooks wrapping the streamService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook              | Type     | Description                              |
 * |-------------------|----------|------------------------------------------|
 * | `useStreams`      | Query    | Paginated, filterable stream list        |
 * | `useStream`       | Query    | Single stream by ID                      |
 * | `useCreateStream` | Mutation | Create a new stream                      |
 * | `useUpdateStream` | Mutation | Update an existing stream                |
 * | `useDeleteStream` | Mutation | Delete a stream                          |
 *
 * @module hooks/academic/useStreams
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { academicKeys } from './queryKeys';
import {
  getStreams,
  getStreamById,
  createStream,
  updateStream,
  deleteStream,
} from '../../services/academic/streamService';
import type {
  CreateStreamInput,
  PaginatedResponse,
  PaginationParams,
  Stream,
  StreamFilters,
  StreamSortOptions,
  UpdateStreamInput,
} from '../../types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of streams.
 *
 * @param filters   - Optional filter criteria.
 * @param sort      - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading, error, refetch } = useStreams(
 *   { instituteId: 'uuid', isActive: true },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 *   { page: 1, pageSize: 10 },
 * );
 *
 * if (data) {
 *   console.log(data.data);   // Stream[]
 *   console.log(data.count);  // total rows
 * }
 */
export function useStreams(
  filters?: StreamFilters,
  sort?: StreamSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Stream>>({
    queryKey: academicKeys.streams.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getStreams(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch streams.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single stream by its ID.
 *
 * The query is disabled when `streamId` is falsy, making it safe to pass
 * an optional value from navigation params or parent state.
 *
 * @param streamId - The UUID of the stream to retrieve.
 *
 * @example
 * const { data: stream, isLoading } = useStream(streamId);
 */
export function useStream(streamId: string | undefined | null) {
  return useQuery<Stream>({
    queryKey: academicKeys.streams.detail(streamId!),
    queryFn: async () => {
      const result = await getStreamById(streamId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch stream.');
      }
      return result.data!;
    },
    enabled: !!streamId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new stream.
 *
 * On success, invalidates all stream list queries so the new stream
 * appears in list views.
 *
 * @example
 * const { mutate, isPending } = useCreateStream();
 *
 * const handleCreate = () => {
 *   mutate(
 *     { instituteId: 'uuid', name: 'NEET', code: 'NEET' },
 *     { onSuccess: () => { /* navigate or show toast *\/ } },
 *   );
 * };
 */
export function useCreateStream() {
  const queryClient = useQueryClient();

  return useMutation<Stream, Error, CreateStreamInput>({
    mutationFn: async (input) => {
      const result = await createStream(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create stream.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: academicKeys.streams.lists() });
    },
  });
}

/**
 * Update an existing stream.
 *
 * On success, invalidates both the affected detail query and all list
 * queries to ensure consistency.
 *
 * @example
 * const { mutate, isPending } = useUpdateStream();
 *
 * const handleUpdate = () => {
 *   mutate(
 *     { id: streamId, input: { name: 'NEET UG' } },
 *     { onSuccess: () => { /* ... *\/ } },
 *   );
 * };
 */
export function useUpdateStream() {
  const queryClient = useQueryClient();

  return useMutation<Stream, Error, { id: string; input: UpdateStreamInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateStream(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update stream.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: academicKeys.streams.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.streams.lists() });
    },
  });
}

/**
 * Delete a stream.
 *
 * On success, invalidates all stream list queries. The detail cache is
 * also cleared since the entity no longer exists.
 *
 * @example
 * const { mutate, isPending } = useDeleteStream();
 *
 * const handleDelete = () => {
 *   mutate(streamId, {
 *     onSuccess: () => { /* navigate away *\/ },
 *   });
 * };
 */
export function useDeleteStream() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteStream(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete stream.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: academicKeys.streams.detail(id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.streams.lists() });
    },
  });
}
