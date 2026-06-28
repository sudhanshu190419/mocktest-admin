/**
 * Topic Hooks
 *
 * React Query hooks wrapping the topicService API calls.
 * Provides cached queries and mutations with automatic cache invalidation.
 *
 * ## Exports
 *
 * | Hook             | Type     | Description                            |
 * |------------------|----------|----------------------------------------|
 * | `useTopics`      | Query    | Paginated, filterable topic list       |
 * | `useTopic`       | Query    | Single topic by ID                     |
 * | `useCreateTopic` | Mutation | Create a new topic                     |
 * | `useUpdateTopic` | Mutation | Update an existing topic               |
 * | `useDeleteTopic` | Mutation | Delete a topic                         |
 *
 * @module hooks/academic/useTopics
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { academicKeys } from './queryKeys';
import {
  getTopics,
  getTopicById,
  createTopic,
  updateTopic,
  deleteTopic,
} from '../../services/academic/topicService';
import type {
  CreateTopicInput,
  PaginatedResponse,
  PaginationParams,
  Topic,
  TopicFilters,
  TopicSortOptions,
  UpdateTopicInput,
} from '../../types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Fetch a paginated, filtered, and sorted list of topics.
 *
 * @param filters   - Optional filter criteria.
 * @param sort      - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useTopics(
 *   { chapterId: 'uuid', search: 'newton' },
 *   { sortBy: 'displayOrder', sortDirection: 'asc' },
 * );
 */
export function useTopics(
  filters?: TopicFilters,
  sort?: TopicSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<PaginatedResponse<Topic>>({
    queryKey: academicKeys.topics.list(filters, sort, pagination),
    queryFn: async () => {
      const result = await getTopics(filters, sort, pagination);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch topics.');
      }
      return result.data!;
    },
  });
}

/**
 * Fetch a single topic by its ID.
 *
 * The query is disabled when `topicId` is falsy.
 *
 * @param topicId - The UUID of the topic to retrieve.
 */
export function useTopic(topicId: string | undefined | null) {
  return useQuery<Topic>({
    queryKey: academicKeys.topics.detail(topicId!),
    queryFn: async () => {
      const result = await getTopicById(topicId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch topic.');
      }
      return result.data!;
    },
    enabled: !!topicId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new topic.
 *
 * On success, invalidates all topic list queries.
 */
export function useCreateTopic() {
  const queryClient = useQueryClient();

  return useMutation<Topic, Error, CreateTopicInput>({
    mutationFn: async (input) => {
      const result = await createTopic(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create topic.');
      }
      return result.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: academicKeys.topics.lists() });
    },
  });
}

/**
 * Update an existing topic.
 *
 * On success, invalidates both the affected detail query and all list queries.
 */
export function useUpdateTopic() {
  const queryClient = useQueryClient();

  return useMutation<Topic, Error, { id: string; input: UpdateTopicInput }>({
    mutationFn: async ({ id, input }) => {
      const result = await updateTopic(id, input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update topic.');
      }
      return result.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: academicKeys.topics.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.topics.lists() });
    },
  });
}

/**
 * Delete a topic.
 *
 * On success, removes the detail cache entry and invalidates all list queries.
 */
export function useDeleteTopic() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteTopic(id);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete topic.');
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: academicKeys.topics.detail(id) });
      queryClient.invalidateQueries({ queryKey: academicKeys.topics.lists() });
    },
  });
}
