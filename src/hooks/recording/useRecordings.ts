'use client';

/**
 * React Query Hooks — Recorded Classes Module
 *
 * Provides query and mutation hooks for all recording operations.
 * Follows the existing project hook patterns:
 * - `useXxx` for queries (GET)
 * - `useCreateXxx` / `useUpdateXxx` / `useDeleteXxx` for mutations
 *
 * Auto-polls recording status when the recording is still active
 * (`recording` or `processing`).
 *
 * @module hooks/recording/useRecordings
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/config/supabase';
import { recordingService } from '@/services/recording/recordingService';
import { recordingKeys } from './queryKeys';
import type {
  Recording,
  RecordingFilters,
  RecordingSortOptions,
  StartRecordingRequest,
  RecordingListResponse,
  BatchSubjectAssignment,
} from '@/types/recording';
import type { PaginationParams, ApiResponse } from '@/types/academic';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries (GET)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch a paginated, filtered list of recordings.
 *
 * @param filters    - Optional filter criteria (status, batchId, search, etc.).
 * @param sort       - Optional sort configuration.
 * @param pagination - Optional pagination parameters.
 *
 * @example
 * const { data, isLoading } = useRecordings(
 *   { status: 'completed', batchId: batchId },
 *   { sortBy: 'createdAt', sortDirection: 'desc' },
 *   { page: 1, pageSize: 12 },
 * );
 */
export function useRecordings(
  filters?: RecordingFilters,
  sort?: RecordingSortOptions,
  pagination?: PaginationParams,
) {
  return useQuery<ApiResponse<RecordingListResponse>>({
    queryKey: recordingKeys.list({
      filters: filters ?? {},
      sort: sort ?? {},
      pagination: pagination ?? {},
    }),
    queryFn: () => recordingService.getRecordings(filters, sort, pagination),
    staleTime: 30 * 1000, // 30s — same as other list queries in the project
  });
}

/**
 * Fetch a single recording by its ID.
 *
 * @param recordingId - The recording UUID. Query is disabled when null/undefined.
 *
 * @example
 * const { data: recording } = useRecording(recordingId);
 */
export function useRecording(recordingId: string | undefined | null) {
  return useQuery<ApiResponse<Recording>>({
    queryKey: recordingKeys.detail(recordingId ?? ''),
    queryFn: () => recordingService.getRecording(recordingId!),
    enabled: !!recordingId,
  });
}

/**
 * Poll the recording status.
 *
 * Automatically refetches every 5 seconds while the recording is
 * in a non-terminal state (`recording` or `processing`). Stops
 * polling when status reaches `completed`, `failed`, or `partial`.
 *
 * @param recordingId - The recording UUID. Query is disabled when null/undefined.
 *
 * @example
 * const { data: status } = useRecordingStatus(recordingId);
 * // => { status: 'processing', durationSeconds: undefined }
 */
export function useRecordingStatus(recordingId: string | undefined | null) {
  return useQuery<ApiResponse<{ status: string; durationSeconds?: number }>>({
    queryKey: recordingKeys.status(recordingId ?? ''),
    queryFn: () => recordingService.getRecordingStatus(recordingId!),
    enabled: !!recordingId,
    refetchInterval: (query) => {
      const data = query.state.data?.data;
      // Poll every 5s while recording is active
      if (data && (data.status === 'recording' || data.status === 'processing')) {
        return 5000;
      }
      // Terminal state or error — stop polling
      return false;
    },
    staleTime: 0, // Always refetch during active recording
  });
}

/**
 * Get a signed playback URL for a recording.
 *
 * The URL is short-lived (5 minutes) and should be refreshed on expiry.
 *
 * @param recordingId - The recording UUID. Query is disabled when null/undefined.
 *
 * @example
 * const { data: playback } = usePlaybackUrl(recordingId);
 * // => { playbackUrl: 'https://...' }
 */
export function usePlaybackUrl(recordingId: string | undefined | null) {
  return useQuery<ApiResponse<{ playbackUrl: string; durationSeconds: number | null }>>({
    queryKey: recordingKeys.playback(recordingId ?? ''),
    queryFn: () => recordingService.getPlaybackUrl({ recordingId: recordingId! }),
    enabled: !!recordingId,
    staleTime: 1000 * 60 * 4, // 4 minutes — slightly less than the 5-min signed URL expiry
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations (POST, PUT, DELETE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start recording a live class.
 *
 * @example
 * const { mutate: startRecording, isPending } = useStartRecording();
 * startRecording({ classId: '...', title: 'Thermodynamics Lecture' });
 */
export function useStartRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: StartRecordingRequest) =>
      recordingService.startRecording(input),
    onSuccess: () => {
      // Invalidate all recording lists — a new recording has been created
      queryClient.invalidateQueries({ queryKey: recordingKeys.lists() });
    },
  });
}

/**
 * Stop an active recording.
 *
 * @example
 * const { mutate: stopRecording } = useStopRecording();
 * stopRecording('recording-uuid');
 */
export function useStopRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recordingId: string) =>
      recordingService.stopRecording(recordingId),
    onSuccess: (_data, recordingId) => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.detail(recordingId) });
      queryClient.invalidateQueries({ queryKey: recordingKeys.status(recordingId) });
    },
  });
}

/**
 * Soft-delete a recording.
 *
 * @example
 * const { mutate: deleteRecording } = useDeleteRecording();
 * deleteRecording('recording-uuid');
 */
export function useDeleteRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recordingId: string) =>
      recordingService.deleteRecording(recordingId),
    onSuccess: (_data, recordingId) => {
      // Invalidate lists and the detail view
      queryClient.invalidateQueries({ queryKey: recordingKeys.lists() });
      queryClient.invalidateQueries({ queryKey: recordingKeys.detail(recordingId) });
    },
  });
}

/**
 * Retry a failed recording.
 *
 * Only valid for recordings with status `failed`. The source live class
 * must still be live for the retry to succeed.
 *
 * @example
 * const { mutate: retryRecording, isPending } = useRetryRecording();
 * retryRecording('failed-recording-uuid');
 */
export function useRetryRecording() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recordingId: string) =>
      recordingService.retryRecording(recordingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.lists() });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Assignments Query
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the batch subject assignments for a specific recording.
 *
 * Queries batch_subject_recordings with joins to resolve batch and
 * subject display names.
 *
 * @param recordingId - The recording UUID.
 *
 * @example
 * const { data: assignments } = useRecordingAssignments(recordingId);
 * // => [{ assignmentId, batchSubjectId, batchName, subjectName }, ...]
 */
export function useRecordingAssignments(recordingId: string | undefined | null) {
  return useQuery<ApiResponse<BatchSubjectAssignment[]>>({
    queryKey: recordingKeys.assignments(recordingId ?? ''),
    queryFn: async () => {
      if (!recordingId) {
        return { success: true, data: [] };
      }

      const { data, error } = await supabase
        .from('batch_subject_recordings')
        .select(`
          assignment_id,
          batch_subject_id,
          batch_subjects!inner (
            batch_subject_id,
            batches!inner (
              name
            ),
            subjects!inner (
              name
            )
          )
        `)
        .eq('recording_id', recordingId);

      if (error) {
        return { success: false, error: error.message };
      }

      const assignments: BatchSubjectAssignment[] = (data ?? []).map(
        (row: any) => ({
          assignmentId: row.assignment_id,
          batchSubjectId: row.batch_subject_id,
          batchName: row.batch_subjects?.batches?.name ?? 'Unknown Batch',
          subjectName: row.batch_subjects?.subjects?.name ?? 'Unknown Subject',
        }),
      );

      return { success: true, data: assignments };
    },
    enabled: !!recordingId,
    staleTime: 30 * 1000,
  });
}
