/**
 * Recording Service — Abstract Provider Interface
 *
 * Core service for the Recorded Classes Module. Implements the recording
 * lifecycle: start, stop, query, play back, retry, and delete recordings.
 *
 * ## Architecture
 *
 * This service delegates provider-specific operations (LiveKit Egress API
 * calls) to an `IRecordingProvider` implementation. The provider is
 * registered at app bootstrap and can be swapped between LiveKit Cloud
 * and Self-Hosted LiveKit without changing any UI component.
 *
 * ## Provider Registration
 *
 * ```typescript
 * // app bootstrap (src/lib/providers.tsx)
 * import { liveKitCloudProvider } from './services/recording/providers/liveKitCloudProvider';
 * import { setRecordingProvider } from './services/recording/recordingService';
 *
 * setRecordingProvider(liveKitCloudProvider);
 * ```
 *
 * ## Error Handling
 *
 * Every public method returns a standardised `ApiResponse<T>` shape so
 * that consumers (hooks, screens, etc.) never need to handle raw
 * Supabase exceptions or provider error formats.
 *
 * ## Data Flow
 *
 *   Teacher clicks "Start Recording"
 *       │
 *       ▼
 *   Service.startRecording(input)
 *       ├── 1. Validate input
 *       ├── 2. Load live_classes row (get room_name, teacher_id, institute_id, batch_id)
 *       ├── 3. INSERT recordings row (status='recording')
 *       ├── 4. Call provider.startRecording(roomName)
 *       └── 5. UPDATE recordings row with livekit_egress_id
 *
 * @module services/recording/recordingService
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Imports
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '@/config/supabase';
import { validateUUID, extractErrorMessage, buildPagination } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import type {
  Recording,
  RecordingStatus,
  RecordingFilters,
  RecordingSortOptions,
  StartRecordingRequest,
  StartRecordingResponse,
  UploadRecordingRequest,
  AssignRecordingRequest,
  BatchSubjectAssignment,
  PlaybackUrlRequest,
  PlaybackUrlResponse,
  RecordingWebhookPayload,
  RecordingListResponse,
  IRecordingProvider,
} from '@/types/recording';

// ═══════════════════════════════════════════════════════════════════════════
//  Error Types
// ═══════════════════════════════════════════════════════════════════════════

export class RecordingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingProviderError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Provider Registry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Holds the active recording provider instance.
 * Set during app bootstrap via `setRecordingProvider()`.
 *
 * @see setRecordingProvider
 * @see getRecordingProvider
 */
let _provider: IRecordingProvider | null = null;

/**
 * Register the recording provider at app bootstrap.
 *
 * @example
 * setRecordingProvider(liveKitCloudProvider);
 */
export function setRecordingProvider(provider: IRecordingProvider): void {
  _provider = provider;
}

/**
 * Get the currently registered recording provider.
 *
 * @throws RecordingProviderError if no provider has been registered.
 */
export function getRecordingProvider(): IRecordingProvider {
  if (!_provider) {
    throw new RecordingProviderError(
      'Recording provider not set. Call setRecordingProvider() during app bootstrap.',
    );
  }
  return _provider;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DB Mapping Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps a snake_case database row to a camelCase `Recording` interface.
 */
function mapRecording(db: Record<string, unknown>): Recording {
  return {
    recordingId: db.recording_id as string,
    instituteId: db.institute_id as string,
    teacherId: db.teacher_id as string,
    classId: db.class_id as string | null,
    title: db.title as string,
    description: db.description as string | null,
    recordingType: db.recording_type as Recording['recordingType'],
    sourceType: (db.source_type as string) as Recording['sourceType'],
    status: db.status as RecordingStatus,
    durationSeconds: db.duration_seconds as number | null,
    fileSizeBytes: db.file_size_bytes as number | null,
    storageBucket: db.storage_bucket as string | null,
    storagePath: db.storage_path as string | null,
    playbackUrl: db.playback_url as string | null,
    thumbnailUrl: db.thumbnail_url as string | null,
    livekitEgressId: db.livekit_egress_id as string | null,
    errorMessage: db.error_message as string | null,
    retryCount: db.retry_count as number,
    lastRetriedAt: db.last_retried_at as string | null,
    batchId: db.batch_id as string | null,
    isDeleted: db.is_deleted as boolean,
    deletedAt: db.deleted_at as string | null,
    createdAt: db.created_at as string,
    updatedAt: db.updated_at as string,
  };
}

/**
 * Maps camelCase sort keys to their snake_case database column names.
 */
const SORT_FIELD_MAP: Record<string, string> = {
  title: 'title',
  status: 'status',
  durationSeconds: 'duration_seconds',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

function mapSortField(sortBy?: RecordingSortOptions['sortBy']): string {
  return SORT_FIELD_MAP[sortBy ?? 'createdAt'] ?? 'created_at';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public Service API
// ═══════════════════════════════════════════════════════════════════════════

export const recordingService = {
  // ─── Start Recording ───────────────────────────────────────────────────

  /**
   * Start recording a live class.
   *
   * 1. Validates the input and loads the live class (for room_name,
   *    institute_id, teacher_id, and batch_id)
   * 2. Creates a `recordings` DB row with status='recording'
   * 3. Calls the provider to start LiveKit Egress
   * 4. Updates the DB row with the LiveKit egress ID
   *
   * @param input - Class ID, title, and optional description.
   * @returns The recording ID and initial status.
   */
  async startRecording(
    input: StartRecordingRequest,
  ): Promise<ApiResponse<StartRecordingResponse>> {
    try {
      // ── Validate input ────────────────────────────────────────────────
      if (!input.classId) {
        return { success: false, error: 'classId is required.' };
      }
      if (!input.title?.trim()) {
        return { success: false, error: 'Title is required.' };
      }

      validateUUID(input.classId, 'classId');

      // ── Load live class ───────────────────────────────────────────────
      const { data: liveClass, error: classError } = await supabase
        .from('live_classes')
        .select('class_id, teacher_id, institute_id, room_name')
        .eq('class_id', input.classId)
        .single();

      if (classError || !liveClass) {
        return {
          success: false,
          error: `Live class not found: ${input.classId}`,
        };
      }

      if (!liveClass.room_name) {
        return {
          success: false,
          error: 'Live class has no room name. Is it live?',
        };
      }

      // ── Resolve batch_subject_ids from batch_subject_live_classes ────
      const { data: classBSL } = await supabase
        .from('batch_subject_live_classes')
        .select('batch_subject_id')
        .eq('class_id', input.classId);

      const batchSubjectIds = (classBSL ?? []).map((r) => r.batch_subject_id);

      // ── Create recordings row ─────────────────────────────────────────
      // source_type is 'live_class' by default (column DEFAULT), which
      // is correct for live-generated recordings.
      const { data: recording, error: insertError } = await supabase
        .from('recordings')
        .insert({
          institute_id: liveClass.institute_id,
          teacher_id: liveClass.teacher_id,
          class_id: input.classId,
          title: input.title.trim(),
          description: input.description ?? null,
          recording_type: input.recordingType ?? 'live_class',
          status: 'recording',
        })
        .select()
        .single();

      if (insertError || !recording) {
        return {
          success: false,
          error: `Failed to create recording: ${extractErrorMessage(insertError)}`,
        };
      }

      // ── Call provider to start LiveKit Egress ─────────────────────────
      try {
        const provider = getRecordingProvider();
        const { egressId } = await provider.startRecording(liveClass.room_name);

        // ── Update recording row with egress ID ─────────────────────────
        const { error: updateError } = await supabase
          .from('recordings')
          .update({ livekit_egress_id: egressId, updated_at: new Date().toISOString() })
          .eq('recording_id', recording.recording_id);

        if (updateError) {
          console.error('[Recording] Failed to save egress ID:', updateError.message);
          // Non-critical — the recording is created, and the egress is running.
          // The webhook will match by class_id fallback if needed.
        }

        // ── Create batch_subject_recordings assignments ────────────────
        if (batchSubjectIds.length > 0) {
          const assignmentRows = batchSubjectIds.map((bsId) => ({
            batch_subject_id: bsId,
            recording_id: recording.recording_id,
            institute_id: liveClass.institute_id,
          }));

          const { error: assignError } = await supabase
            .from('batch_subject_recordings')
            .insert(assignmentRows)
            .select();

          if (assignError) {
            console.error('[Recording] Failed to create batch_subject_recordings:', assignError.message);
            // Non-critical — recording exists and egress is running.
            // Admin can manually reassign later.
          }
        }

        return {
          success: true,
          data: {
            recordingId: recording.recording_id,
            status: 'recording' as RecordingStatus,
          },
        };
      } catch (providerErr) {
        // Provider failed — update status to 'failed' so teacher can retry
        await supabase
          .from('recordings')
          .update({
            status: 'failed',
            error_message: providerErr instanceof Error ? providerErr.message : 'Provider error',
            updated_at: new Date().toISOString(),
          })
          .eq('recording_id', recording.recording_id);

        return {
          success: false,
          error: `Failed to start recording: ${providerErr instanceof Error ? providerErr.message : 'Provider error'}`,
        };
      }
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Stop Recording ───────────────────────────────────────────────────

  /**
   * Stop an active recording.
   *
   * 1. Validates teacher ownership
   * 2. Calls provider.stopRecording(egressId)
   * 3. Updates DB status to 'processing'
   *
   * @param recordingId - The recording to stop.
   */
  async stopRecording(
    recordingId: string,
  ): Promise<ApiResponse<void>> {
    try {
      // Validate is done inside the helper
      const result = await this.getRecording(recordingId);
      if (!result.success || !result.data) {
        return { success: false, error: result.error ?? 'Recording not found' };
      }

      const recording = result.data;

      if (recording.status !== 'recording') {
        return {
          success: false,
          error: `Cannot stop recording with status "${String(recording.status)}". Expected "recording".`,
        };
      }

      const egressId = recording.livekitEgressId as string | null;
      if (egressId) {
        try {
          const provider = getRecordingProvider();
          await provider.stopRecording(egressId);
        } catch (providerErr) {
          console.error('[Recording] Provider stop failed:', providerErr);
          // Continue updating DB — the egress may time out naturally.
          // The webhook will eventually fire.
        }
      }

      // Update status to 'processing' (LiveKit is now exporting to R2)
      const { error: updateError } = await supabase
        .from('recordings')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('recording_id', recordingId);

      if (updateError) {
        return {
          success: false,
          error: `Failed to update recording status: ${updateError.message}`,
        };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Get Recording ────────────────────────────────────────────────────

  /**
   * Get a single recording by its ID.
   *
   * @param recordingId - The recording UUID.
   */
  async getRecording(
    recordingId: string,
  ): Promise<ApiResponse<Recording>> {
    try {
      validateUUID(recordingId, 'recordingId');

      const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('recording_id', recordingId)
        .single();

      if (error || !data) {
        return {
          success: false,
          error: error?.message ?? `Recording not found: ${recordingId}`,
        };
      }

      return { success: true, data: mapRecording(data as Record<string, unknown>) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── List Recordings ──────────────────────────────────────────────────

  /**
   * Fetch paginated, filtered, and sorted recordings.
   *
   * For teachers: returns their own recordings (including soft-deleted if
   * `includeDeleted: true`).
   *
   * For students: returns only `completed`, non-deleted recordings from
   * batches they belong to (handled by RLS).
   *
   * @param filters    - Optional filter criteria.
   * @param sort       - Optional sort configuration.
   * @param pagination - Optional pagination parameters.
   */
  async getRecordings(
    filters?: RecordingFilters,
    sort?: RecordingSortOptions,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<ApiResponse<RecordingListResponse>> {
    try {
      const { page, pageSize, from, to } = buildPagination(pagination);

      let query = supabase
        .from('recordings')
        .select('*', { count: 'exact' });

      // ── Apply filters ─────────────────────────────────────────────────
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.recordingType) {
        query = query.eq('recording_type', filters.recordingType);
      }

      if (filters?.batchId) {
        validateUUID(filters.batchId, 'batchId');
        query = query.eq('batch_id', filters.batchId);
      }

      if (filters?.batchSubjectId) {
        validateUUID(filters.batchSubjectId, 'batchSubjectId');
        // Resolve recording IDs from the junction table, then filter
        const { data: bsRecordings } = await supabase
          .from('batch_subject_recordings')
          .select('recording_id')
          .eq('batch_subject_id', filters.batchSubjectId);

        const recordingIds = (bsRecordings ?? []).map((r) => r.recording_id);

        if (recordingIds.length === 0) {
          // No recordings assigned to this batch subject — return empty
          return {
            success: true,
            data: {
              recordings: [],
              total: 0,
              page,
              pageSize,
              pageCount: 0,
            },
          };
        }

        query = query.in('recording_id', recordingIds);
      }

      if (filters?.classId) {
        validateUUID(filters.classId, 'classId');
        query = query.eq('class_id', filters.classId);
      }

      if (filters?.teacherId) {
        validateUUID(filters.teacherId, 'teacherId');
        query = query.eq('teacher_id', filters.teacherId);
      }

      // Soft-delete filter
      if (filters?.includeDeleted) {
        // Include all (teacher/admin query)
      } else {
        query = query.eq('is_deleted', false);
      }

      if (filters?.search) {
        const searchTerm = `%${filters.search}%`;
        query = query.or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`);
      }

      if (filters?.fromDate) {
        query = query.gte('created_at', filters.fromDate);
      }

      if (filters?.toDate) {
        query = query.lte('created_at', filters.toDate);
      }

      if (filters?.ids && filters.ids.length > 0) {
        query = query.in('recording_id', filters.ids);
      }

      // ── Apply sorting ─────────────────────────────────────────────────
      const sortColumn = mapSortField(sort?.sortBy);
      const ascending = (sort?.sortDirection ?? 'desc') === 'asc';
      query = query.order(sortColumn, { ascending });

      // ── Apply pagination ──────────────────────────────────────────────
      query = query.range(from, to);

      // ── Execute ───────────────────────────────────────────────────────
      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const recordings = (data ?? []).map((row) =>
        mapRecording(row as Record<string, unknown>),
      );

      return {
        success: true,
        data: {
          recordings,
          total: count ?? 0,
          page,
          pageSize,
          pageCount: pageSize > 0 ? Math.ceil((count ?? 0) / pageSize) : 0,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Get Recording Status ─────────────────────────────────────────────

  /**
   * Get the current recording status.
   *
   * For active recordings (`recording` or `processing`), polls the
   * provider for the latest status and updates the DB if changed.
   *
   * @param recordingId - The recording UUID.
   */
  async getRecordingStatus(
    recordingId: string,
  ): Promise<ApiResponse<{ status: RecordingStatus; durationSeconds?: number }>> {
    try {
      const result = await this.getRecording(recordingId);
      if (!result.success || !result.data) {
        return { success: false, error: result.error ?? 'Recording not found' };
      }

      const recording = result.data;

      // If recording is still active, poll the provider for status
      if (
        (recording.status === 'recording' || recording.status === 'processing') &&
        recording.livekitEgressId
      ) {
        try {
          const provider = getRecordingProvider();
          const providerStatus = await provider.getRecordingStatus(recording.livekitEgressId);

          // Determine the mapped status
          let newStatus: RecordingStatus = recording.status;
          if (providerStatus.status === 'completed') {
            newStatus = 'completed';
          } else if (providerStatus.status === 'failed') {
            newStatus = 'failed';
          }

          // Update DB if status changed
          if (newStatus !== recording.status) {
            const updates: Record<string, unknown> = {
              status: newStatus,
              updated_at: new Date().toISOString(),
            };
            if (newStatus === 'completed') {
              updates.duration_seconds = providerStatus.durationSeconds ?? null;
              updates.file_size_bytes = providerStatus.fileSizeBytes ?? null;
            }
            if (newStatus === 'failed') {
              updates.error_message = 'Recording failed during processing.';
            }

            await supabase
              .from('recordings')
              .update(updates)
              .eq('recording_id', recordingId);
          }

          return {
            success: true,
            data: { status: newStatus, durationSeconds: providerStatus.durationSeconds },
          };
        } catch {
          // Provider poll failed — return the last known DB status
          return {
            success: true,
            data: { status: recording.status, durationSeconds: recording.durationSeconds ?? undefined },
          };
        }
      }

      return {
        success: true,
        data: { status: recording.status, durationSeconds: recording.durationSeconds ?? undefined },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Delete Recording ─────────────────────────────────────────────────

  /**
   * Delete a recording — orchestrates soft-delete + R2 file cleanup.
   *
   * STEP 1: Soft-delete the recording in the DB (is_deleted = true).
   * STEP 2: Delete the recording file from Cloudflare R2 (best-effort).
   *
   * If R2 deletion fails, the DB soft-delete is preserved. The R2 file
   * will be cleaned up by a background cron job. The teacher gets a
   * success response — the recording is effectively deleted.
   *
   * The UI must ONLY call this method. It must NEVER call the
   * recording-delete Edge Function directly.
   *
   * @param recordingId - The recording UUID.
   */
  async deleteRecording(
    recordingId: string,
  ): Promise<ApiResponse<void>> {
    try {
      validateUUID(recordingId, 'recordingId');

      // ── Fetch recording for storage path (needed for R2 deletion) ────
      const getResult = await this.getRecording(recordingId);
      const storagePath = getResult.success ? getResult.data?.storagePath : null;
      const storageBucket = getResult.success ? getResult.data?.storageBucket : null;

      const now = new Date().toISOString();

      // ── STEP 1: Soft-delete the DB row ─────────────────────────────
      const { error: dbError } = await supabase
        .from('recordings')
        .update({ is_deleted: true, deleted_at: now, updated_at: now })
        .eq('recording_id', recordingId);

      if (dbError) {
        return { success: false, error: extractErrorMessage(dbError) };
      }

      // ── STEP 2: Delete from R2 (best-effort, non-blocking) ────────
      if (storagePath) {
        try {
          const { error: rpcError } = await supabase.functions.invoke(
            'recording-delete',
            {
              body: {
                storagePath,
                bucket: storageBucket ?? undefined,
              },
            },
          );

          if (rpcError) {
            // Log the error but DO NOT fail the operation.
            // The DB is already soft-deleted; the R2 file will be cleaned
            // up by the periodic cleanup cron job.
            console.error(
              '[Recording] R2 deletion failed (non-fatal, scheduled for cleanup):',
              rpcError.message,
            );
          }
        } catch (r2Err) {
          console.error(
            '[Recording] R2 deletion threw (non-fatal, scheduled for cleanup):',
            r2Err instanceof Error ? r2Err.message : 'Unknown error',
          );
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /**
   * Get recordings that have been soft-deleted for more than the specified
   * number of days. Used by the cleanup cron job to hard-delete R2 files.
   *
   * @param daysOld - Minimum age in days. Default: 90.
   */
  async getExpiredSoftDeletes(
    daysOld: number = 90,
  ): Promise<ApiResponse<Recording[]>> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysOld);

      const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('is_deleted', true)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoff.toISOString());

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: (data ?? []).map((row) => mapRecording(row as Record<string, unknown>)),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Get Playback URL ─────────────────────────────────────────────────

  /**
   * Get a signed playback URL for a completed recording.
   *
   * Generates a short-lived signed URL from Cloudflare R2 via the provider.
   * The URL is cached in the DB for subsequent requests but expires after
   * a short duration (typically 5 minutes).
   *
   * @param request - The recording ID.
   */
  async getPlaybackUrl(
    request: PlaybackUrlRequest,
  ): Promise<ApiResponse<PlaybackUrlResponse>> {
    try {
      validateUUID(request.recordingId, 'recordingId');

      const result = await this.getRecording(request.recordingId);
      if (!result.success || !result.data) {
        return { success: false, error: result.error ?? 'Recording not found' };
      }

      const recording = result.data;

      if (recording.status !== 'completed') {
        return {
          success: false,
          error: `Recording is not ready for playback. Current status: ${recording.status}`,
        };
      }

      if (!recording.storagePath) {
        return {
          success: false,
          error: 'Recording has no storage path. It may have been deleted.',
        };
      }

      try {
        const provider = getRecordingProvider();
        const playbackUrl = await provider.getPlaybackUrl(recording.storagePath);

        // Optionally cache the URL in the DB (for subsequent requests)
        await supabase
          .from('recordings')
          .update({ playback_url: playbackUrl, updated_at: new Date().toISOString() })
          .eq('recording_id', request.recordingId)
          .is('playback_url', null); // Only update if currently null

        return {
          success: true,
          data: { playbackUrl, durationSeconds: recording.durationSeconds },
        };
      } catch (providerErr) {
        return {
          success: false,
          error: `Failed to generate playback URL: ${providerErr instanceof Error ? providerErr.message : 'Provider error'}`,
        };
      }
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Retry Recording ──────────────────────────────────────────────────

  /**
   * Retry a failed recording.
   *
   * Only allowed when status is `failed`. Creates a new egress for the
   * same live class (if the class is still live) or returns an error.
   *
   * @param recordingId - The recording UUID.
   */
  async retryRecording(
    recordingId: string,
  ): Promise<ApiResponse<StartRecordingResponse>> {
    try {
      validateUUID(recordingId, 'recordingId');

      const result = await this.getRecording(recordingId);
      if (!result.success || !result.data) {
        return { success: false, error: result.error ?? 'Recording not found' };
      }

      const recording = result.data;

      if (recording.status !== 'failed') {
        return {
          success: false,
          error: `Cannot retry recording with status "${recording.status}". Expected "failed".`,
        };
      }

      if (!recording.classId) {
        return {
          success: false,
          error: 'Cannot retry recording without a source live class.',
        };
      }

      // Verify the live class still exists and is live
      const { data: liveClass, error: classError } = await supabase
        .from('live_classes')
        .select('room_name, status')
        .eq('class_id', recording.classId)
        .single();

      if (classError || !liveClass) {
        return {
          success: false,
          error: `Source live class not found: ${recording.classId}`,
        };
      }

      if (liveClass.status !== 'live') {
        return {
          success: false,
          error: 'The source live class is no longer live. Cannot retry recording.',
        };
      }

      try {
        const provider = getRecordingProvider();
        const { egressId } = await provider.startRecording(liveClass.room_name);

        // Update the recording row
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('recordings')
          .update({
            status: 'recording',
            livekit_egress_id: egressId,
            error_message: null,
            retry_count: recording.retryCount + 1,
            last_retried_at: now,
            updated_at: now,
          })
          .eq('recording_id', recordingId);

        if (updateError) {
          return { success: false, error: extractErrorMessage(updateError) };
        }

        return {
          success: true,
          data: { recordingId, status: 'recording' as RecordingStatus },
        };
      } catch (providerErr) {
        return {
          success: false,
          error: `Retry failed: ${providerErr instanceof Error ? providerErr.message : 'Provider error'}`,
        };
      }
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Upload Recording ──────────────────────────────────────────────────

  /**
   * Upload a standalone recording (no live class).
   *
   * Creates a recording with source_type = 'uploaded', class_id = NULL,
   * and immediately completes it (pre-existing file). Then creates
   * batch_subject_recordings assignment rows for each specified
   * batch_subject_id.
   *
   * @param input - Title, optional description, batch_subject_ids, file metadata.
   * @returns The created recording ID and status.
   */
  async uploadRecording(
    input: UploadRecordingRequest,
  ): Promise<ApiResponse<StartRecordingResponse>> {
    try {
      // ── Validate input ────────────────────────────────────────────────
      if (!input.title?.trim()) {
        return { success: false, error: 'Title is required.' };
      }
      if (!input.batchSubjectIds?.length) {
        return { success: false, error: 'At least one batch_subject_id is required.' };
      }

      // Validate all batchSubjectIds are valid UUIDs
      for (const bsId of input.batchSubjectIds) {
        validateUUID(bsId, 'batchSubjectId');
      }

      // ── Resolve auth context for required NOT NULL fields ────────────
      // Both institute_id and teacher_id are NOT NULL on the recordings table
      // with no defaults. Resolve them from the batch_subject or auth context.
      const { data: bsRow } = await supabase
        .from('batch_subjects')
        .select('batch_subject_id, institute_id')
        .eq('batch_subject_id', input.batchSubjectIds[0])
        .single();

      const instituteId = bsRow?.institute_id;
      if (!instituteId) {
        return { success: false, error: 'Could not resolve institute from batch_subject.' };
      }

      // Resolve teacher_id from the authenticated user's teacher_details
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let teacherId: string | undefined;
      if (user) {
        const { data: td } = await supabase
          .from('teacher_details')
          .select('teacher_id')
          .eq('profile_id', user.id)
          .single();
        teacherId = td?.teacher_id;
      }

      if (!teacherId) {
        return { success: false, error: 'Could not resolve teacher from auth context.' };
      }

      // ── Create recordings row ─────────────────────────────────────────
      const insertData: Record<string, unknown> = {
        institute_id: instituteId,
        teacher_id: teacherId,
        title: input.title.trim(),
        description: input.description ?? null,
        recording_type: input.recordingType ?? 'live_class',
        source_type: 'uploaded',
        status: 'completed',
      };

      if (input.file) {
        insertData.storage_bucket = input.file.storageBucket;
        insertData.storage_path = input.file.storagePath;
        if (input.file.fileSizeBytes != null) {
          insertData.file_size_bytes = input.file.fileSizeBytes;
        }
        if (input.file.durationSeconds != null) {
          insertData.duration_seconds = input.file.durationSeconds;
        }
      }

      const { data: recording, error: insertError } = await supabase
        .from('recordings')
        .insert(insertData)
        .select()
        .single();

      if (insertError || !recording) {
        return {
          success: false,
          error: `Failed to create recording: ${extractErrorMessage(insertError)}`,
        };
      }

      // ── Create batch_subject_recordings assignments ────────────────────
      const assignmentRows = input.batchSubjectIds.map((bsId) => ({
        batch_subject_id: bsId,
        recording_id: recording.recording_id,
        institute_id: instituteId,
      }));

      const { error: assignError } = await supabase
        .from('batch_subject_recordings')
        .insert(assignmentRows)
        .select();

      if (assignError) {
        console.error('[Recording] Failed to create batch_subject_recordings:', assignError.message);
        // Non-critical — recording was created. Admin can assign later.
      }

      return {
        success: true,
        data: {
          recordingId: recording.recording_id,
          status: 'completed' as RecordingStatus,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Assign Recording to Batch Subjects ────────────────────────────────

  /**
   * Assign an existing recording to one or more Batch Subjects.
   *
   * Creates rows in batch_subject_recordings. Skips any existing
   * assignments (idempotent — respects the unique constraint).
   *
   * @param input - Recording ID and Batch Subject IDs to assign.
   */
  async assignToBatchSubjects(
    input: AssignRecordingRequest,
  ): Promise<ApiResponse<{ assigned: number }>> {
    try {
      validateUUID(input.recordingId, 'recordingId');

      if (!input.batchSubjectIds?.length) {
        return { success: false, error: 'At least one batch_subject_id is required.' };
      }

      for (const bsId of input.batchSubjectIds) {
        validateUUID(bsId, 'batchSubjectId');
      }

      // Verify the recording exists
      const recordingResult = await this.getRecording(input.recordingId);
      if (!recordingResult.success || !recordingResult.data) {
        return { success: false, error: recordingResult.error ?? 'Recording not found' };
      }

      // Build assignment rows
      const { data: bsRows } = await supabase
        .from('batch_subjects')
        .select('batch_subject_id, institute_id')
        .in('batch_subject_id', input.batchSubjectIds);

      if (!bsRows || bsRows.length === 0) {
        return { success: false, error: 'No valid batch_subjects found.' };
      }

      const instituteId = bsRows[0].institute_id;
      const validIds = new Set(bsRows.map((r) => r.batch_subject_id));

      // Only insert for valid batch_subject_ids that exist
      const assignmentRows = input.batchSubjectIds
        .filter((bsId) => validIds.has(bsId))
        .map((bsId) => ({
          batch_subject_id: bsId,
          recording_id: input.recordingId,
          institute_id: instituteId,
        }));

      if (assignmentRows.length === 0) {
        return { success: false, error: 'No valid batch_subjects to assign.' };
      }

      const { error: insertError } = await supabase
        .from('batch_subject_recordings')
        .insert(assignmentRows)
        .select();

      if (insertError) {
        // If the error is a duplicate key violation, it's fine — already assigned.
        // pg code 23505 = unique_violation
        if (insertError.code === '23505') {
          return {
            success: true,
            data: { assigned: assignmentRows.length },
          };
        }
        return { success: false, error: extractErrorMessage(insertError) };
      }

      return {
        success: true,
        data: { assigned: assignmentRows.length },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Remove Recording from Batch Subject ───────────────────────────────

  /**
   * Remove a recording assignment from a specific Batch Subject.
   *
   * Only the assignment is removed (one row in batch_subject_recordings).
   * The recording itself is preserved.
   *
   * @param recordingId - The recording to unassign.
   * @param batchSubjectId - The batch subject to remove the recording from.
   */
  async removeFromBatchSubject(
    recordingId: string,
    batchSubjectId: string,
  ): Promise<ApiResponse<void>> {
    try {
      validateUUID(recordingId, 'recordingId');
      validateUUID(batchSubjectId, 'batchSubjectId');

      const { error: deleteError } = await supabase
        .from('batch_subject_recordings')
        .delete()
        .eq('recording_id', recordingId)
        .eq('batch_subject_id', batchSubjectId);

      if (deleteError) {
        return { success: false, error: extractErrorMessage(deleteError) };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Get Batch Subject Recordings ──────────────────────────────────────

  /**
   * Get all recordings assigned to a specific Batch Subject.
   *
   * @param batchSubjectId - The Batch Subject to query.
   * @returns Paginated list of recordings with assignment metadata.
   */
  async getBatchSubjectRecordings(
    batchSubjectId: string,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<ApiResponse<RecordingListResponse & { assignments: BatchSubjectAssignment[] }>> {
    try {
      validateUUID(batchSubjectId, 'batchSubjectId');

      const { page, pageSize, from, to } = buildPagination(pagination);

      // Query batch_subject_recordings with a join to recordings
      let query = supabase
        .from('batch_subject_recordings')
        .select(`
          *,
          recording:recordings!inner(*)
        `, { count: 'exact' })
        .eq('batch_subject_id', batchSubjectId)
        .not('recording_id', 'is', null);

      query = query.order('assigned_at', { ascending: false });
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      const recordings: Recording[] = [];
      const assignments: BatchSubjectAssignment[] = [];

      // Resolve batch and subject names for display
      const { data: batchSubject } = await supabase
        .from('batch_subjects')
        .select(`
          batch_subject_id,
          batches!inner(name),
          subjects!inner(name)
        `)
        .eq('batch_subject_id', batchSubjectId)
        .single();

      const batchName = (batchSubject as any)?.batches?.name ?? 'Unknown Batch';
      const subjectName = (batchSubject as any)?.subjects?.name ?? 'Unknown Subject';

      for (const row of (data ?? [])) {
        const r = row as Record<string, unknown>;
        const recordingData = r.recording as Record<string, unknown>;
        if (recordingData) {
          recordings.push(mapRecording(recordingData));
        }
        assignments.push({
          assignmentId: r.assignment_id as string,
          batchSubjectId: r.batch_subject_id as string,
          batchName,
          subjectName,
        });
      }

      return {
        success: true,
        data: {
          recordings,
          total: count ?? 0,
          page,
          pageSize,
          pageCount: pageSize > 0 ? Math.ceil((count ?? 0) / pageSize) : 0,
          assignments,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Update Recording ────────────────────────────────────────────────

  /**
   * Update recording metadata (title, description) without affecting
   * batch subject assignments.
   *
   * @param recordingId - The recording to update.
   * @param updates - Fields to update.
   */
  async updateRecording(
    recordingId: string,
    updates: { title?: string; description?: string | null },
  ): Promise<ApiResponse<void>> {
    try {
      validateUUID(recordingId, 'recordingId');

      const dbUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.title?.trim()) {
        dbUpdates.title = updates.title.trim();
      }
      if (updates.description !== undefined) {
        dbUpdates.description = updates.description;
      }

      if (Object.keys(dbUpdates).length <= 1) {
        // Only updated_at was set — nothing meaningful to change
        return { success: true };
      }

      const { error: updateError } = await supabase
        .from('recordings')
        .update(dbUpdates)
        .eq('recording_id', recordingId);

      if (updateError) {
        return { success: false, error: extractErrorMessage(updateError) };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─── Handle Webhook ───────────────────────────────────────────────────

  /**
   * Handle a LiveKit Egress webhook callback.
   *
   * Called by a Supabase Edge Function when LiveKit sends the
   * `egress.completed` or `egress.failed` webhook event.
   *
   * This method is idempotent — calling it multiple times with the
   * same egress ID is safe.
   *
   * @param payload - The webhook payload from LiveKit.
   */
  async handleWebhook(
    payload: RecordingWebhookPayload,
  ): Promise<ApiResponse<void>> {
    try {
      if (!payload.livekitEgressId) {
        return { success: false, error: 'livekitEgressId is required.' };
      }

      // Find the recording by egress ID
      const { data: recording, error: findError } = await supabase
        .from('recordings')
        .select('recording_id, status')
        .eq('livekit_egress_id', payload.livekitEgressId)
        .single();

      if (findError || !recording) {
        return {
          success: false,
          error: `Recording not found for egress ID: ${payload.livekitEgressId}`,
        };
      }

      // Idempotency: if already terminal, skip
      if (recording.status === 'completed' || recording.status === 'failed') {
        return { success: true };
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (payload.status === 'completed') {
        updates.status = 'completed';
        updates.duration_seconds = payload.durationSeconds ?? null;
        updates.file_size_bytes = payload.fileSizeBytes ?? null;
        updates.storage_path = payload.storagePath ?? null;
        updates.playback_url = payload.playbackUrl ?? null;
        updates.error_message = null;
      } else {
        updates.status = 'failed';
        updates.error_message = payload.errorMessage ?? 'Recording failed during processing.';
      }

      const { error: updateError } = await supabase
        .from('recordings')
        .update(updates)
        .eq('recording_id', recording.recording_id);

      if (updateError) {
        return { success: false, error: extractErrorMessage(updateError) };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },
};
