/**
 * Student Recording Progress Web Service
 *
 * Provides queries and persistence for student viewing history on recorded classes.
 * Backed by public.student_viewing_history:
 *   - resource_type = 'live_class'
 *   - resource_id = recording_id (UUID)
 *   - last_position_seconds = integer (playback progress in seconds)
 *   - is_completed = boolean
 *   - viewed_at = timestamptz
 *
 * Security Rule:
 *   - Student identity is derived authoritatively from the Supabase auth session
 *     or passed from trusted service-layer composition (never trusted from UI params).
 *   - Supabase query errors are returned explicitly and NEVER converted into empty progress.
 *
 * @module services/student/studentRecordingProgressWebService
 */

import { supabase } from '@/config/supabase';
import { resolveCurrentStudentId, isUuidString } from './studentCourseWebService';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

export interface StudentRecordingProgress {
  recordingId: string;
  lastPositionSeconds: number;
  isCompleted: boolean;
  watchedPercentage: number;
  lastWatchedAt: string | null;
}

export interface FetchRecordingProgressOptions {
  /** Optional pre-resolved studentId for internal service composition */
  studentId?: string | null;
  /** Optional auth userId to resolve student_details */
  userId?: string;
  /** Optional map of recordingId -> durationSeconds to calculate watched percentage */
  durationsMap?: Map<string, number>;
}

/**
 * Strongly-typed representation of rows from public.student_viewing_history
 */
export interface ViewingHistoryRow {
  resource_id: string;
  last_position_seconds: number | null;
  is_completed: boolean | null;
  viewed_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely clamps a percentage value between 0 and 100.
 */
export function clampPercentage(val: number): number {
  if (!isFinite(val) || isNaN(val)) return 0;
  return Math.min(100, Math.max(0, Math.round(val)));
}

/**
 * Calculates watched percentage given current position and total duration.
 */
export function calculateWatchedPercentage(
  positionSeconds: number,
  durationSeconds: number,
): number {
  if (!isFinite(positionSeconds) || !isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  const raw = (positionSeconds / durationSeconds) * 100;
  return clampPercentage(raw);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Read Operations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * BATCHED query for student viewing history across multiple recording IDs.
 * Single bounded query — prevents N+1 lookups.
 *
 * @param recordingIds - Array of recording UUIDs visible to the student.
 * @param options      - Optional studentId, userId, or durationsMap.
 *
 * @returns Result object with data map on success, or error string on failure.
 */
export async function fetchBatchRecordingProgress(
  recordingIds: string[],
  options?: FetchRecordingProgressOptions,
): Promise<{ data: Map<string, StudentRecordingProgress> | null; error: string | null }> {
  if (!recordingIds || recordingIds.length === 0) {
    return { data: new Map<string, StudentRecordingProgress>(), error: null };
  }

  const validRecordingIds = recordingIds.filter(isUuidString);
  if (validRecordingIds.length === 0) {
    return { data: new Map<string, StudentRecordingProgress>(), error: null };
  }

  try {
    let studentId = options?.studentId;
    if (!studentId || !isUuidString(studentId)) {
      studentId = await resolveCurrentStudentId(options?.userId);
    }

    if (!studentId) {
      return { data: null, error: 'Student authentication required to load viewing progress.' };
    }

    const { data, error } = await supabase
      .from('student_viewing_history')
      .select('resource_id, last_position_seconds, is_completed, viewed_at')
      .eq('student_id', studentId)
      .eq('resource_type', 'live_class')
      .in('resource_id', validRecordingIds);

    if (error) {
      console.warn('[studentRecordingProgressWebService] Database error fetching progress:', error);
      return { data: null, error: error.message || 'Failed to query student viewing history.' };
    }

    const progressMap = new Map<string, StudentRecordingProgress>();
    const rows = (data as ViewingHistoryRow[] | null) ?? [];

    for (const row of rows) {
      if (!row.resource_id) continue;
      const recordingId = row.resource_id;
      const position = Math.max(0, row.last_position_seconds ?? 0);
      const duration = options?.durationsMap?.get(recordingId) ?? 0;
      const watchedPercentage = calculateWatchedPercentage(position, duration);

      progressMap.set(recordingId, {
        recordingId,
        lastPositionSeconds: position,
        isCompleted: !!row.is_completed,
        watchedPercentage,
        lastWatchedAt: row.viewed_at ?? null,
      });
    }

    return { data: progressMap, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error fetching viewing history.';
    console.warn('[studentRecordingProgressWebService] Unexpected error in fetchBatchRecordingProgress:', err);
    return { data: null, error: message };
  }
}

/**
 * Fetch viewing progress for a single recording.
 *
 * @param recordingId     - UUID of the recording.
 * @param durationSeconds - Total duration of the recording in seconds.
 * @param options         - Optional studentId or auth userId.
 *
 * @returns Result object with progress (or null if not watched yet) on success, or error string on failure.
 */
export async function fetchSingleRecordingProgress(
  recordingId: string,
  durationSeconds = 0,
  options?: { studentId?: string | null; userId?: string; keepalive?: boolean },
): Promise<{ data: StudentRecordingProgress | null; error: string | null }> {
  if (!recordingId || !isUuidString(recordingId)) {
    return { data: null, error: 'Invalid recording ID format.' };
  }

  try {
    let studentId = options?.studentId;
    if (!studentId || !isUuidString(studentId)) {
      studentId = await resolveCurrentStudentId(options?.userId);
    }

    if (!studentId) {
      return { data: null, error: 'Student authentication required to load viewing progress.' };
    }

    const { data, error } = await supabase
      .from('student_viewing_history')
      .select('resource_id, last_position_seconds, is_completed, viewed_at')
      .eq('student_id', studentId)
      .eq('resource_type', 'live_class')
      .eq('resource_id', recordingId)
      .maybeSingle();

    if (error) {
      console.warn('[studentRecordingProgressWebService] Database error in fetchSingleRecordingProgress:', error);
      return { data: null, error: error.message || 'Failed to query recording progress.' };
    }

    if (!data) {
      return { data: null, error: null };
    }

    const row = data as ViewingHistoryRow;
    const position = Math.max(0, row.last_position_seconds ?? 0);
    const watchedPercentage = calculateWatchedPercentage(position, durationSeconds);

    return {
      data: {
        recordingId,
        lastPositionSeconds: position,
        isCompleted: !!row.is_completed,
        watchedPercentage,
        lastWatchedAt: row.viewed_at ?? null,
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error fetching single progress.';
    console.warn('[studentRecordingProgressWebService] Unexpected error in fetchSingleRecordingProgress:', err);
    return { data: null, error: message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Write / Persistence Operations (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save or update playback progress for a live class recording.
 *
 * Auto-marks completed when playback position reaches >= 90% of duration.
 *
 * @param recordingId     - UUID of the recording.
 * @param positionSeconds - Current playback position in seconds.
 * @param durationSeconds - Total duration of the recording in seconds.
 * @param isCompleted     - Optional explicit completed flag.
 * @param options         - Optional pre-resolved studentId or auth userId.
 *
 * @returns Result object with success boolean or error string.
 */
export async function saveStudentRecordingProgress(
  recordingId: string,
  positionSeconds: number,
  durationSeconds: number,
  isCompleted = false,
  options?: { studentId?: string | null; userId?: string; keepalive?: boolean },
): Promise<{ success: boolean; error: string | null }> {
  if (!recordingId || !isUuidString(recordingId)) {
    return { success: false, error: 'Invalid recording ID format.' };
  }

  try {
    let studentId = options?.studentId;
    if (!studentId || !isUuidString(studentId)) {
      studentId = await resolveCurrentStudentId(options?.userId);
    }

    if (!studentId) {
      return { success: false, error: 'Student authentication required to save progress.' };
    }

    const safeDuration = Math.max(0, isFinite(durationSeconds) ? durationSeconds : 0);
    const maxBound = safeDuration > 0 ? safeDuration : Math.max(0, positionSeconds);
    const safePosition = Math.max(0, Math.min(positionSeconds, maxBound));

    // Auto-complete if explicit or reached 90% of duration
    const isDone = isCompleted || (safeDuration > 0 && safePosition >= safeDuration * 0.9);

    const { error } = await supabase
      .from('student_viewing_history')
      .upsert(
        {
          student_id: studentId,
          resource_type: 'live_class',
          resource_id: recordingId,
          last_position_seconds: Math.floor(safePosition),
          is_completed: isDone,
          viewed_at: new Date().toISOString(),
        },
        {
          onConflict: 'student_id,resource_type,resource_id',
        },
      );

    if (error) {
      console.warn('[studentRecordingProgressWebService] Upsert error saving progress:', error);
      return { success: false, error: error.message || 'Failed to save recording progress.' };
    }

    return { success: true, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error saving viewing progress.';
    console.warn('[studentRecordingProgressWebService] Unexpected error in saveStudentRecordingProgress:', err);
    return { success: false, error: message };
  }
}

/**
 * Mark a live class recording as 100% completed in student_viewing_history.
 */
export async function markStudentRecordingCompleted(
  recordingId: string,
  durationSeconds: number,
  options?: { studentId?: string | null; userId?: string },
): Promise<{ success: boolean; error: string | null }> {
  const safeDuration = Math.max(0, isFinite(durationSeconds) ? durationSeconds : 0);
  return saveStudentRecordingProgress(recordingId, safeDuration, safeDuration, true, options);
}
