import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isUrlExpiredOrExpiringSoon,
  calculateRefreshDelayMs,
  isPlaybackExpiryError,
  StudentPlaybackRefreshController,
} from '../studentRecordingPlaybackManager';
import {
  saveStudentRecordingProgress,
  markStudentRecordingCompleted,
  fetchSingleRecordingProgress,
} from '../studentRecordingProgressWebService';
import {
  fetchStudentRecordingById,
  getStudentPlaybackUrl,
} from '../studentRecordingWebService';
import { supabase } from '@/config/supabase';
import * as courseService from '../studentCourseWebService';
import * as progressService from '../studentRecordingProgressWebService';

// Mock Supabase client
vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn(),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// Mock studentCourseWebService
vi.mock('../studentCourseWebService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../studentCourseWebService')>();
  return {
    ...actual,
    resolveCurrentStudentId: vi.fn(),
  };
});

// Mock studentRecordingProgressWebService for fetchSingleRecordingProgress
vi.mock('../studentRecordingProgressWebService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../studentRecordingProgressWebService')>();
  return {
    ...actual,
    fetchSingleRecordingProgress: vi.fn(),
  };
});

describe('Student Recording Player Flow & Lifecycle Integration', () => {
  const STUDENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const RECORDING_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const BATCH_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const BS_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const TEACHER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('End-to-End Playback Authorization & Initial Resume Flow', () => {
    it('successfully authorizes student, loads recording metadata, and fetches prior viewing history', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      // 1. batch_students
      const mockBatchStudentQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [{ batch_id: BATCH_ID }],
          error: null,
        }),
      };

      // 2. batch_subjects
      const mockBatchSubjectsQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValueOnce({
          data: [
            {
              batch_subject_id: BS_ID,
              batch_id: BATCH_ID,
              name: 'Physics XI',
              batches: { name: 'Batch 2026' },
              subjects: { name: 'Physics' },
            },
          ],
          error: null,
        }),
      };

      // 3. batch_subject_recordings
      const mockBSRQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      (mockBSRQuery.eq as any)
        .mockReturnValueOnce(mockBSRQuery)
        .mockReturnValueOnce(mockBSRQuery)
        .mockResolvedValueOnce({
          data: [
            {
              batch_subject_id: BS_ID,
              recordings: {
                recording_id: RECORDING_ID,
                class_id: 'class-101',
                teacher_id: TEACHER_ID,
                status: 'completed',
                duration_seconds: 3600,
                thumbnail_path: 'thumbs/rec101.png',
                created_at: '2026-09-16T08:00:00.000Z',
                is_deleted: false,
                live_classes: {
                  class_id: 'class-101',
                  title: 'Thermodynamics & Heat Transfer',
                  description: 'Detailed analysis of Carnot Cycle',
                  teacher_id: TEACHER_ID,
                  scheduled_at: '2026-09-16T07:00:00.000Z',
                },
              },
            },
          ],
          error: null,
        });

      // 4. teacher_details -> profiles
      const mockTeacherQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [
            {
              teacher_id: TEACHER_ID,
              profiles: { name: 'Prof. Richard Feynman' },
            },
          ],
          error: null,
        }),
      };

      vi.mocked(supabase.from)
        .mockReturnValueOnce(mockBatchStudentQuery as any)
        .mockReturnValueOnce(mockBatchSubjectsQuery as any)
        .mockReturnValueOnce(mockBSRQuery as any)
        .mockReturnValueOnce(mockTeacherQuery as any);

      vi.mocked(progressService.fetchSingleRecordingProgress).mockResolvedValueOnce({
        data: {
          recordingId: RECORDING_ID,
          lastPositionSeconds: 1245,
          isCompleted: false,
          watchedPercentage: 35,
          lastWatchedAt: '2026-09-16T08:30:00.000Z',
        },
        error: null,
      });

      const res = await fetchStudentRecordingById(RECORDING_ID);

      expect(res.error).toBeNull();
      expect(res.data).not.toBeNull();
      expect(res.data?.recordingId).toBe(RECORDING_ID);
      expect(res.data?.title).toBe('Thermodynamics & Heat Transfer');
      expect(res.data?.teacherName).toBe('Prof. Richard Feynman');
      expect(res.data?.subjectName).toBe('Physics');
      expect(res.data?.batchName).toBe('Batch 2026');
      expect(res.data?.durationSeconds).toBe(3600);

      // Verify resume position
      expect(res.data?.progress?.lastPositionSeconds).toBe(1245);
      expect(res.data?.progress?.watchedPercentage).toBe(35);
      expect(res.data?.progress?.isCompleted).toBe(false);
    });

    it('denies access if student is not enrolled in the recording batch', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockBatchStudentQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [],
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockBatchStudentQuery as any);

      const res = await fetchStudentRecordingById(RECORDING_ID);

      expect(res.data).toBeNull();
      expect(res.error).toContain('not enrolled in any active batch');
    });
  });

  describe('Playback URL Refresh & Error Classification', () => {
    it('requests signed Cloudflare R2 playback URL from Edge Function without exposing credentials', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
        data: {
          url: 'https://r2.example.com/stream/rec101.mp4?X-Amz-Expires=300',
          expiresAt: '2026-09-16T12:05:00.000Z',
          durationSeconds: 3600,
        },
        error: null,
      });

      const res = await getStudentPlaybackUrl(RECORDING_ID);

      expect(res.error).toBeNull();
      expect(res.data?.playbackUrl).toContain('https://r2.example.com/stream/rec101.mp4');
      expect(res.data?.expiresAt).toBe('2026-09-16T12:05:00.000Z');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('recording-playback-url', {
        body: {
          recordingId: RECORDING_ID,
          expirySeconds: 300,
        },
      });
    });

    it('correctly classifies 403 Forbidden playback errors as expiration', () => {
      const futureTime = new Date(Date.now() + 200000).toISOString();
      const err403 = { message: 'HTTP 403: Forbidden - Signature Expired' };
      expect(isPlaybackExpiryError(err403, futureTime)).toBe(true);

      const errUnauthorized = 'Unauthorized: AccessDenied';
      expect(isPlaybackExpiryError(errUnauthorized, futureTime)).toBe(true);

      const errNetwork = 'Network disconnected';
      expect(isPlaybackExpiryError(errNetwork, futureTime)).toBe(false);
    });

    it('correctly classifies HTML5 MediaError when URL is within expiration window', () => {
      const expiringSoon = new Date(Date.now() + 20000).toISOString(); // 20s remaining
      const mediaError = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
      expect(isPlaybackExpiryError(mediaError, expiringSoon)).toBe(true);
    });
  });
});
