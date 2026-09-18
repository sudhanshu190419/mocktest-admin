/**
 * Student Recording Playback Manager
 *
 * Dedicated manager and utilities for managing short-lived presigned playback URLs,
 * calculating expiration and proactive refresh schedules, detecting 403 / token
 * expiration playback errors, and safely swapping player sources without
 * losing the student's playback position.
 *
 * Architecture & Security:
 *   - Playback URLs are temporary Cloudflare R2 presigned URLs (TTL ~5 minutes).
 *   - URLs stay in memory only (never saved to localStorage, sessionStorage, or DB).
 *   - Proactive refresh fires 45 seconds before expiration.
 *   - Reactive refresh intercepts 403/Forbidden playback errors (max 1 retry).
 *   - Single-flight controller prevents concurrent duplicate requests.
 *
 * @module services/student/studentRecordingPlaybackManager
 */

import {
  getStudentPlaybackUrl,
  type StudentPlaybackUrlResult,
} from './studentRecordingWebService';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Default fallback duration for presigned URLs if backend omits expiresAt (5 minutes). */
export const DEFAULT_PRESIGNED_TTL_SECONDS = 300;

/** Proactive refresh buffer (refresh 45 seconds before the URL expires). */
export const PROACTIVE_REFRESH_THRESHOLD_SECONDS = 45;

/** Minimum refresh delay in milliseconds to prevent rapid re-fetching loops. */
export const MIN_REFRESH_DELAY_MS = 5000;

// ═══════════════════════════════════════════════════════════════════════════
//  Expiry & Timing Calculations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Checks if a playback URL is expired or expiring within the specified threshold.
 *
 * @param expiresAt        - ISO 8601 string from backend response.
 * @param fetchedAt        - Timestamp (ms) when URL was received by client.
 * @param thresholdSeconds - Lead time in seconds before expiration. Defaults to 45.
 */
export function isUrlExpiredOrExpiringSoon(
  expiresAt?: string | null,
  fetchedAt?: number,
  thresholdSeconds = PROACTIVE_REFRESH_THRESHOLD_SECONDS,
): boolean {
  const now = Date.now();

  if (expiresAt) {
    const expiryTime = new Date(expiresAt).getTime();
    if (isFinite(expiryTime) && expiryTime > 0) {
      return now >= expiryTime - thresholdSeconds * 1000;
    }
  }

  if (fetchedAt && fetchedAt > 0) {
    const elapsedSeconds = (now - fetchedAt) / 1000;
    return elapsedSeconds >= DEFAULT_PRESIGNED_TTL_SECONDS - thresholdSeconds;
  }

  return false;
}

/**
 * Calculates the delay in milliseconds until proactive refresh should occur.
 *
 * @param expiresAt        - ISO 8601 string from backend response.
 * @param fetchedAt        - Timestamp (ms) when URL was received.
 * @param thresholdSeconds - Lead time in seconds before expiration. Defaults to 45.
 *
 * @returns Milliseconds to wait before executing refresh (minimum 5000ms).
 */
export function calculateRefreshDelayMs(
  expiresAt?: string | null,
  fetchedAt?: number,
  thresholdSeconds = PROACTIVE_REFRESH_THRESHOLD_SECONDS,
): number {
  const now = Date.now();

  if (expiresAt) {
    const expiryTime = new Date(expiresAt).getTime();
    if (isFinite(expiryTime) && expiryTime > 0) {
      const targetTime = expiryTime - thresholdSeconds * 1000;
      return Math.max(MIN_REFRESH_DELAY_MS, targetTime - now);
    }
  }

  const baseFetchedAt = fetchedAt && fetchedAt > 0 ? fetchedAt : now;
  const targetTime = baseFetchedAt + (DEFAULT_PRESIGNED_TTL_SECONDS - thresholdSeconds) * 1000;
  return Math.max(MIN_REFRESH_DELAY_MS, targetTime - now);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Error Classification Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determines whether a video player error is consistent with an expired or unauthorized presigned URL.
 *
 * Checks HTTP status codes (401/403), AWS/R2 error substrings, MediaError codes,
 * and timestamp expiration.
 *
 * @param error     - The error event or error object emitted by HTML5 video or network request.
 * @param expiresAt - The current URL's expiration timestamp.
 * @param fetchedAt - Timestamp when the current URL was obtained.
 */
export function isPlaybackExpiryError(
  error: unknown,
  expiresAt?: string | null,
  fetchedAt?: number,
): boolean {
  // 1. If timestamp is already expired, any playback failure is treated as expiration
  if (isUrlExpiredOrExpiringSoon(expiresAt, fetchedAt, 0)) {
    return true;
  }

  if (!error) return false;

  // 2. Check MediaError object (standard HTML5 video error)
  if (typeof error === 'object' && error !== null) {
    const mediaErr = error as { code?: number; message?: string; target?: { error?: { code?: number } } };
    const code = mediaErr.code ?? mediaErr.target?.error?.code;

    // MEDIA_ERR_NETWORK (2) or MEDIA_ERR_SRC_NOT_SUPPORTED (4) often occur when 403 Forbidden is returned
    if (code === 2 || code === 4) {
      // If we are close to expiry (e.g. within 60s) or past fetched TTL
      if (isUrlExpiredOrExpiringSoon(expiresAt, fetchedAt, 30)) {
        return true;
      }
    }
  }

  // 3. Check for explicit error strings / codes
  let errorStr = '';
  try {
    if (typeof error === 'string') {
      errorStr = error.toLowerCase();
    } else if (error instanceof Error) {
      errorStr = (error.message + ' ' + (error.stack || '')).toLowerCase();
    } else {
      errorStr = JSON.stringify(error).toLowerCase();
    }
  } catch {
    errorStr = String(error).toLowerCase();
  }

  const expiryKeywords = [
    '403',
    '401',
    'forbidden',
    'unauthorized',
    'access denied',
    'accessdenied',
    'expired',
    'signature',
    'requesttimetooskewed',
    'signaturedoesnotmatch',
    'http 403',
    'http 401',
    'token expired',
    'token has expired',
  ];

  for (const keyword of expiryKeywords) {
    if (errorStr.includes(keyword)) {
      return true;
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Single-Flight Refresh Controller
// ═══════════════════════════════════════════════════════════════════════════

export interface RefreshResult {
  data: StudentPlaybackUrlResult | null;
  generation: number;
  error: string | null;
}

/**
 * Controller to ensure single-flight requests and prevent race conditions
 * when multiple triggers (timer, visibility change, network reconnect, 403 error)
 * request a refreshed URL simultaneously.
 */
export class StudentPlaybackRefreshController {
  private inFlightPromise: Promise<{ data: StudentPlaybackUrlResult | null; error: string | null }> | null = null;
  private currentGeneration = 0;

  /**
   * Request a fresh signed URL for the recording.
   * If a refresh is already in progress, shares the active promise.
   * Discards stale out-of-order responses using generation counters.
   */
  async refresh(recordingId: string): Promise<RefreshResult> {
    const generation = ++this.currentGeneration;

    if (this.inFlightPromise) {
      const result = await this.inFlightPromise;
      return {
        data: result.data,
        generation: this.currentGeneration,
        error: result.error,
      };
    }

    this.inFlightPromise = (async () => {
      try {
        return await getStudentPlaybackUrl(recordingId);
      } finally {
        this.inFlightPromise = null;
      }
    })();

    const result = await this.inFlightPromise;
    return {
      data: result.data,
      generation: this.currentGeneration,
      error: result.error,
    };
  }

  /**
   * Check if a response generation is still the latest generation.
   */
  isLatest(generation: number): boolean {
    return generation === this.currentGeneration;
  }

  /**
   * Reset the controller state.
   */
  reset(): void {
    this.inFlightPromise = null;
    this.currentGeneration = 0;
  }
}
