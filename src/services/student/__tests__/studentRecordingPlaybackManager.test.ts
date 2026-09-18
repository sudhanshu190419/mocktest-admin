import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isUrlExpiredOrExpiringSoon,
  calculateRefreshDelayMs,
  isPlaybackExpiryError,
  StudentPlaybackRefreshController,
  DEFAULT_PRESIGNED_TTL_SECONDS,
  PROACTIVE_REFRESH_THRESHOLD_SECONDS,
  MIN_REFRESH_DELAY_MS,
} from '../studentRecordingPlaybackManager';
import * as webService from '../studentRecordingWebService';

// Mock studentRecordingWebService
vi.mock('../studentRecordingWebService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../studentRecordingWebService')>();
  return {
    ...actual,
    getStudentPlaybackUrl: vi.fn(),
  };
});

describe('studentRecordingPlaybackManager', () => {
  const REC_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isUrlExpiredOrExpiringSoon', () => {
    it('returns true when expiresAt is already in the past', () => {
      const pastTime = new Date(Date.now() - 10000).toISOString();
      expect(isUrlExpiredOrExpiringSoon(pastTime)).toBe(true);
    });

    it('returns true when expiresAt is within the 45s threshold', () => {
      const expiringSoon = new Date(Date.now() + 30000).toISOString(); // 30s in future (<45s)
      expect(isUrlExpiredOrExpiringSoon(expiringSoon, undefined, 45)).toBe(true);
    });

    it('returns false when expiresAt is well in the future', () => {
      const futureTime = new Date(Date.now() + 180000).toISOString(); // 3 mins in future
      expect(isUrlExpiredOrExpiringSoon(futureTime, undefined, 45)).toBe(false);
    });

    it('falls back to fetchedAt calculation when expiresAt is omitted', () => {
      const fetched270sAgo = Date.now() - 270 * 1000; // 270s elapsed out of 300s TTL -> 30s remaining
      expect(isUrlExpiredOrExpiringSoon(null, fetched270sAgo, 45)).toBe(true);

      const freshlyFetched = Date.now() - 10 * 1000; // 10s elapsed -> 290s remaining
      expect(isUrlExpiredOrExpiringSoon(null, freshlyFetched, 45)).toBe(false);
    });

    it('returns false when neither expiresAt nor valid fetchedAt is provided', () => {
      expect(isUrlExpiredOrExpiringSoon(null, 0)).toBe(false);
    });
  });

  describe('calculateRefreshDelayMs', () => {
    it('calculates accurate delay before expiration accounting for 45s threshold', () => {
      const now = Date.now();
      const expiresAt = new Date(now + 120000).toISOString(); // 120s in future
      // target = 120s - 45s = 75s = 75,000ms
      const delay = calculateRefreshDelayMs(expiresAt, undefined, 45);
      expect(delay).toBeGreaterThanOrEqual(74000);
      expect(delay).toBeLessThanOrEqual(76000);
    });

    it('enforces MIN_REFRESH_DELAY_MS (5000ms) when expiry is very near', () => {
      const now = Date.now();
      const expiresAt = new Date(now + 10000).toISOString(); // 10s in future (< 45s)
      const delay = calculateRefreshDelayMs(expiresAt, undefined, 45);
      expect(delay).toBe(MIN_REFRESH_DELAY_MS);
    });

    it('uses fetchedAt calculation when expiresAt is null', () => {
      const now = Date.now();
      const fetchedAt = now - 60000; // 60s ago
      // (300s - 45s) = 255s from fetchedAt -> 255s - 60s = 195s = 195,000ms
      const delay = calculateRefreshDelayMs(null, fetchedAt, 45);
      expect(delay).toBeGreaterThanOrEqual(194000);
      expect(delay).toBeLessThanOrEqual(196000);
    });
  });

  describe('isPlaybackExpiryError', () => {
    it('returns true if URL is expired by timestamp regardless of error type', () => {
      const pastTime = new Date(Date.now() - 5000).toISOString();
      expect(isPlaybackExpiryError('some generic network error', pastTime)).toBe(true);
    });

    it('identifies 403 / Forbidden / Signature error strings', () => {
      const futureTime = new Date(Date.now() + 200000).toISOString();
      expect(isPlaybackExpiryError('HTTP 403 Forbidden', futureTime)).toBe(true);
      expect(isPlaybackExpiryError({ message: 'AccessDenied: Signature expired' }, futureTime)).toBe(true);
      expect(isPlaybackExpiryError('Token expired', futureTime)).toBe(true);
      expect(isPlaybackExpiryError('RequestTimeTooSkewed', futureTime)).toBe(true);
    });

    it('returns false for unrelated errors when URL is fresh', () => {
      const futureTime = new Date(Date.now() + 200000).toISOString();
      expect(isPlaybackExpiryError('User cancelled playback', futureTime)).toBe(false);
      expect(isPlaybackExpiryError(null, futureTime)).toBe(false);
    });
  });

  describe('StudentPlaybackRefreshController', () => {
    let controller: StudentPlaybackRefreshController;

    beforeEach(() => {
      controller = new StudentPlaybackRefreshController();
    });

    it('successfully requests new playback URL and tracks generation', async () => {
      vi.mocked(webService.getStudentPlaybackUrl).mockResolvedValueOnce({
        data: {
          playbackUrl: 'https://cdn.example.com/recording.mp4?token=abc',
          expiresAt: '2026-09-16T12:00:00.000Z',
          durationSeconds: 3600,
        },
        error: null,
      });

      const res = await controller.refresh(REC_ID);

      expect(res.generation).toBe(1);
      expect(res.error).toBeNull();
      expect(res.data?.playbackUrl).toBe('https://cdn.example.com/recording.mp4?token=abc');
      expect(controller.isLatest(1)).toBe(true);
      expect(controller.isLatest(0)).toBe(false);
    });

    it('shares single-flight in-flight promise for concurrent refresh requests', async () => {
      let resolvePromise: (val: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(webService.getStudentPlaybackUrl).mockReturnValueOnce(pendingPromise as any);

      const call1 = controller.refresh(REC_ID);
      const call2 = controller.refresh(REC_ID);

      expect(webService.getStudentPlaybackUrl).toHaveBeenCalledTimes(1);

      resolvePromise!({
        data: {
          playbackUrl: 'https://cdn.example.com/shared.mp4',
          expiresAt: '2026-09-16T12:00:00.000Z',
        },
        error: null,
      });

      const [res1, res2] = await Promise.all([call1, call2]);

      expect(res1.data?.playbackUrl).toBe('https://cdn.example.com/shared.mp4');
      expect(res2.data?.playbackUrl).toBe('https://cdn.example.com/shared.mp4');
      expect(controller.isLatest(res1.generation)).toBe(true);
      expect(controller.isLatest(res2.generation)).toBe(true);
    });

    it('resets state correctly', () => {
      controller.reset();
      expect(controller.isLatest(1)).toBe(false);
    });
  });
});
