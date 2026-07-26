/**
 * Recorded Classes Module Types
 *
 * Production-ready type definitions for the Recorded Classes module —
 * recordings, playback, and processing lifecycle.
 *
 * These types mirror the PostgreSQL schema exactly (see migration
 * 065_create_recordings_table.sql) and map snake_case database columns
 * to camelCase TypeScript properties.
 *
 * Dependencies:
 * - Consumed by recording service layer, React Query hooks, Redux slice,
 *   and UI components.
 * - Reuses shared types from src/types/academic.ts (ApiResponse,
 *   PaginatedResponse, PaginationParams, SortDirection).
 *
 * @module types/recording
 */

import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortDirection,
} from './academic';

// ─── Re-exports for consumer convenience ────────────────────────────────────

export type { ApiResponse, PaginatedResponse, PaginationParams, SortDirection };

// ═══════════════════════════════════════════════════════════════════════════
//  Enums
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lifecycle status of a recording.
 *
 * Mirrors the `recording_status` PostgreSQL enum.
 *
 * - `recording`:  LiveKit Egress is actively capturing the room.
 * - `processing': LiveKit is exporting the file to Cloudflare R2.
 * - `completed`:  File is in R2 and ready for student streaming.
 * - `failed`:     Processing encountered an error; teacher can retry.
 * - `partial':    Short clip (<30s) that may be incomplete.
 *
 * @see public.recordings.status column
 * @see supabase/migrations/065_create_recordings_table.sql
 */
export type RecordingStatus =
  | 'recording'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial';

/**
 * Discriminator for the source of a recording.
 *
 * Mirrors the `recording_type` PostgreSQL enum.
 *
 * - `live_class`:  Recording of a scheduled/instant live class session.
 * - `practice`:    Practice/demo recording not linked to a live class.
 * - `demo`:        System-generated demo recording.
 *
 * @see public.recordings.recording_type column
 */
export type RecordingType = 'live_class' | 'practice' | 'demo';

// ═══════════════════════════════════════════════════════════════════════════
//  Core Models
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Central store for all live class recording metadata.
 *
 * Each row represents one recording session captured via LiveKit Cloud
 * Egress and exported to Cloudflare R2. The status discriminator tracks
 * the processing lifecycle. Teachers manage their own recordings; students
 * can stream completed recordings from their batches.
 *
 * Mirrors the `recordings` table in PostgreSQL.
 *
 * @see supabase/migrations/065_create_recordings_table.sql
 */
export interface Recording {
  /** Primary key. */
  recordingId: string;
  /** Institute that owns this recording (FK → public.institutes). Denormalized for RLS. */
  instituteId: string;
  /** Teacher who owned the live class (FK → public.teacher_details). */
  teacherId: string;
  /** Source live class (FK → public.live_classes). NULL for standalone recordings. */
  classId: string | null;
  /** Display title. Minimum 3 characters. */
  title: string;
  /** Optional description or summary. */
  description: string | null;
  /** Recording type discriminator. */
  recordingType: RecordingType;
  /** Current processing status. */
  status: RecordingStatus;
  /** Total duration in seconds. NULL until processing completes. */
  durationSeconds: number | null;
  /** File size in bytes. NULL until processing completes. */
  fileSizeBytes: number | null;
  /** Cloudflare R2 bucket name. */
  storageBucket: string | null;
  /** Cloudflare R2 object key (path within the bucket). */
  storagePath: string | null;
  /** Cached signed URL for streaming. May expire — regenerate on demand. */
  playbackUrl: string | null;
  /** Thumbnail image URL. */
  thumbnailUrl: string | null;
  /** LiveKit Egress API identifier. */
  livekitEgressId: string | null;
  /** Human-readable error message if status is `failed`. */
  errorMessage: string | null;
  /** Number of retry attempts. */
  retryCount: number;
  /** Timestamp of the last retry attempt. */
  lastRetriedAt: string | null;
  /** Batch this recording is visible to. Denormalized for RLS. */
  batchId: string | null;
  /** Soft-delete flag. TRUE = hidden from students but visible to teacher. */
  isDeleted: boolean;
  /** Soft-delete timestamp. NULL = not deleted. */
  deletedAt: string | null;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. Trigger-maintained. */
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Extended Models (with resolved relations)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A recording with the teacher's display name resolved from profiles.
 *
 * Used by student-facing screens where the teacher name is displayed
 * alongside the recording.
 */
export interface RecordingWithTeacher extends Recording {
  /** Resolved teacher display name from profiles. */
  teacherName: string;
}

/**
 * A recording with resolved class metadata.
 *
 * Used by detail views where the source class name and batch name
 * are needed.
 */
export interface RecordingWithClass extends Recording {
  /** Resolved class title from live_classes. */
  className: string | null;
  /** Resolved batch name from batches. */
  batchName: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Input / Request Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Input required to start a new recording.
 */
export interface StartRecordingRequest {
  /** The live class to record. */
  classId: string;
  /** Display title for the recording. */
  title: string;
  /** Optional description. */
  description?: string | null;
  /** Recording type. Defaults to `live_class`. */
  recordingType?: RecordingType;
}

/**
 * Response returned when a recording is successfully started.
 */
export interface StartRecordingResponse {
  /** The newly created recording ID. */
  recordingId: string;
  /** Initial status (always `recording`). */
  status: RecordingStatus;
}

/**
 * Input required to stop an active recording.
 */
export interface StopRecordingRequest {
  /** The recording to stop. */
  recordingId: string;
}

/**
 * Input required to get a playback URL.
 */
export interface PlaybackUrlRequest {
  /** The recording to get a URL for. */
  recordingId: string;
}

/**
 * Response containing a playback URL.
 */
export interface PlaybackUrlResponse {
  /** Signed URL for streaming (short-lived, typically 5 minutes). */
  playbackUrl: string;
  /** Duration in seconds of the recording at the time of URL generation. */
  durationSeconds: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Filters & Sorting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filters available when querying the recordings list.
 *
 * By default, soft-deleted recordings (`isDeleted = true`) are excluded.
 * Set `includeDeleted: true` to include them (teacher/admin only).
 */
export interface RecordingFilters {
  /** Filter by processing status. */
  status?: RecordingStatus;
  /** Filter by recording type. */
  recordingType?: RecordingType;
  /** Filter by batch. Teacher-only filter — students always filtered by their own batches. */
  batchId?: string;
  /** Filter by teacher. Admin-only filter. */
  teacherId?: string;
  /** Filter by source class. */
  classId?: string;
  /** If true, includes soft-deleted recordings. */
  includeDeleted?: boolean;
  /** Searches across title and description (case-insensitive LIKE). */
  search?: string;
  /** Filter recordings created after this date (inclusive). */
  fromDate?: string;
  /** Filter recordings created before this date (inclusive). */
  toDate?: string;
  /** Filter by specific recording IDs. */
  ids?: string[];
}

/**
 * Sort options for recordings list queries.
 */
export interface RecordingSortOptions {
  sortBy?: 'title' | 'status' | 'durationSeconds' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Webhook Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Payload received from the LiveKit Egress webhook.
 *
 * Sent by LiveKit Cloud when an egress completes or fails.
 * This webhook is received by a Supabase Edge Function which
 * delegates to `RecordingService.handleWebhook()`.
 */
export interface RecordingWebhookPayload {
  /** LiveKit Egress API identifier. Used to match the recordings row. */
  livekitEgressId: string;
  /** Final status of the egress process. */
  status: 'completed' | 'failed';
  /** Total duration in seconds (only for completed). */
  durationSeconds?: number;
  /** File size in bytes (only for completed). */
  fileSizeBytes?: number;
  /** R2 object key where the recording file was exported (only for completed). */
  storagePath?: string;
  /** Signed URL for playback (only for completed). */
  playbackUrl?: string;
  /** Error message if status is `failed`. */
  errorMessage?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  List Response
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Paginated recordings list returned by the API.
 */
export interface RecordingListResponse {
  recordings: Recording[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Provider Interface Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result from starting a recording via the recording provider (LiveKit).
 */
export interface ProviderStartResult {
  /** LiveKit Egress API identifier. */
  egressId: string;
}

/**
 * Result from querying recording status via the provider.
 */
export interface ProviderStatusResult {
  /** Provider's idea of the current status. */
  status: 'active' | 'completed' | 'failed';
  /** Duration in seconds if available. */
  durationSeconds?: number;
  /** File size in bytes if available. */
  fileSizeBytes?: number;
}

/**
 * Contract for a recording provider (LiveKit Cloud, Self-Hosted, etc.).
 *
 * All provider implementations must satisfy this interface.
 * The active provider is registered at app bootstrap via
 * `setRecordingProvider()`.
 *
 * @see services/recording/recordingService.ts
 */
export interface IRecordingProvider {
  /** Start recording a LiveKit room. Returns the egress ID. */
  startRecording(roomName: string): Promise<ProviderStartResult>;

  /** Stop an active recording by its egress ID. */
  stopRecording(egressId: string): Promise<void>;

  /** Get the current status of an egress from the provider. */
  getRecordingStatus(egressId: string): Promise<ProviderStatusResult>;

  /** Generate a signed playback URL from the storage path. */
  getPlaybackUrl(storagePath: string): Promise<string>;
}
