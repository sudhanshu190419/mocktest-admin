/**
 * Recording Query Keys
 *
 * Centralised React Query key factory for the Recorded Classes Module.
 * Using a factory pattern ensures key consistency across hooks and
 * enables fine-grained cache invalidation.
 *
 * @module hooks/recording/queryKeys
 */

export const recordingKeys = {
  /** Root key for all recording queries. */
  all: ['recordings'] as const,

  /** Keys for list queries. */
  lists: () => [...recordingKeys.all, 'list'] as const,

  /** Key for a specific list query with filters. */
  list: (filters: Record<string, unknown>) =>
    [...recordingKeys.lists(), filters] as const,

  /** Keys for detail queries. */
  details: () => [...recordingKeys.all, 'detail'] as const,

  /** Key for a specific recording detail query. */
  detail: (id: string) => [...recordingKeys.details(), id] as const,

  /** Key for recording status poll queries. */
  status: (id: string) => [...recordingKeys.all, 'status', id] as const,

  /** Key for playback URL queries. */
  playback: (id: string) => [...recordingKeys.all, 'playback', id] as const,

  /** Key for assignment queries. */
  assignments: (recordingId: string) =>
    [...recordingKeys.all, 'assignments', recordingId] as const,
};
