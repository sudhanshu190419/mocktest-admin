import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchBatchRecordingProgress,
  fetchSingleRecordingProgress,
  saveStudentRecordingProgress,
  markStudentRecordingCompleted,
  calculateWatchedPercentage,
  clampPercentage,
} from '../studentRecordingProgressWebService';
import { supabase } from '@/config/supabase';
import * as courseService from '../studentCourseWebService';

// Mock Supabase
vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn(),
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

describe('studentRecordingProgressWebService', () => {
  const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
  const REC_ID_1 = '22222222-2222-4222-8222-222222222222';
  const REC_ID_2 = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('clampPercentage & calculateWatchedPercentage', () => {
    it('clamps percentages strictly between 0 and 100', () => {
      expect(clampPercentage(-10)).toBe(0);
      expect(clampPercentage(55.6)).toBe(56);
      expect(clampPercentage(150)).toBe(100);
      expect(clampPercentage(NaN)).toBe(0);
      expect(clampPercentage(Infinity)).toBe(0);
    });

    it('calculates watched percentage safely with duration', () => {
      expect(calculateWatchedPercentage(1800, 3600)).toBe(50);
      expect(calculateWatchedPercentage(3600, 3600)).toBe(100);
      expect(calculateWatchedPercentage(0, 3600)).toBe(0);
      expect(calculateWatchedPercentage(500, 0)).toBe(0);
      expect(calculateWatchedPercentage(500, -100)).toBe(0);
    });
  });

  describe('fetchBatchRecordingProgress', () => {
    it('returns empty map immediately without DB query if recordingIds is empty', async () => {
      const res = await fetchBatchRecordingProgress([]);
      expect(res.error).toBeNull();
      expect(res.data).toBeInstanceOf(Map);
      expect(res.data?.size).toBe(0);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns empty map immediately without DB query if all recordingIds are invalid UUIDs', async () => {
      const res = await fetchBatchRecordingProgress(['invalid-id-1', 'not-a-uuid']);
      expect(res.error).toBeNull();
      expect(res.data?.size).toBe(0);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns error when student authentication cannot be resolved', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(null);

      const res = await fetchBatchRecordingProgress([REC_ID_1]);
      expect(res.data).toBeNull();
      expect(res.error).toContain('Student authentication required');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('successfully queries and maps progress for multiple recordings', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const durationsMap = new Map<string, number>([
        [REC_ID_1, 3600],
        [REC_ID_2, 1800],
      ]);

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [
            {
              resource_id: REC_ID_1,
              last_position_seconds: 1800,
              is_completed: false,
              viewed_at: '2026-09-16T08:00:00.000Z',
            },
            {
              resource_id: REC_ID_2,
              last_position_seconds: 1800,
              is_completed: true,
              viewed_at: '2026-09-16T09:00:00.000Z',
            },
          ],
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery as any);

      const res = await fetchBatchRecordingProgress([REC_ID_1, REC_ID_2], { durationsMap });

      expect(res.error).toBeNull();
      expect(res.data).toBeInstanceOf(Map);
      expect(res.data?.size).toBe(2);

      const p1 = res.data?.get(REC_ID_1);
      expect(p1).toEqual({
        recordingId: REC_ID_1,
        lastPositionSeconds: 1800,
        isCompleted: false,
        watchedPercentage: 50,
        lastWatchedAt: '2026-09-16T08:00:00.000Z',
      });

      const p2 = res.data?.get(REC_ID_2);
      expect(p2).toEqual({
        recordingId: REC_ID_2,
        lastPositionSeconds: 1800,
        isCompleted: true,
        watchedPercentage: 100,
        lastWatchedAt: '2026-09-16T09:00:00.000Z',
      });
    });

    it('returns error (NOT empty map) when Supabase query fails with DB error', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { code: '500', message: 'Database connection failed' },
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery as any);

      const res = await fetchBatchRecordingProgress([REC_ID_1]);

      expect(res.data).toBeNull();
      expect(res.error).toBe('Database connection failed');
    });

    it('uses pre-resolved studentId from options if supplied', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [],
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery as any);

      const res = await fetchBatchRecordingProgress([REC_ID_1], { studentId: STUDENT_ID });

      expect(courseService.resolveCurrentStudentId).not.toHaveBeenCalled();
      expect(res.error).toBeNull();
      expect(res.data?.size).toBe(0);
    });
  });

  describe('fetchSingleRecordingProgress', () => {
    it('returns error on invalid recording ID', async () => {
      const res = await fetchSingleRecordingProgress('not-a-valid-uuid');
      expect(res.data).toBeNull();
      expect(res.error).toContain('Invalid recording ID format');
    });

    it('returns error when student is unauthenticated', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(null);

      const res = await fetchSingleRecordingProgress(REC_ID_1);
      expect(res.data).toBeNull();
      expect(res.error).toContain('Student authentication required');
    });

    it('returns null data and null error when recording has never been watched', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValueOnce({
          data: null,
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery as any);

      const res = await fetchSingleRecordingProgress(REC_ID_1, 3600);
      expect(res.error).toBeNull();
      expect(res.data).toBeNull();
    });

    it('returns progress data when recording exists in viewing history', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValueOnce({
          data: {
            resource_id: REC_ID_1,
            last_position_seconds: 900,
            is_completed: false,
            viewed_at: '2026-09-16T10:00:00.000Z',
          },
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery as any);

      const res = await fetchSingleRecordingProgress(REC_ID_1, 3600);
      expect(res.error).toBeNull();
      expect(res.data).toEqual({
        recordingId: REC_ID_1,
        lastPositionSeconds: 900,
        isCompleted: false,
        watchedPercentage: 25,
        lastWatchedAt: '2026-09-16T10:00:00.000Z',
      });
    });

    it('returns error when Supabase query fails on single lookup', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { code: '42501', message: 'Permission denied' },
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockQuery as any);

      const res = await fetchSingleRecordingProgress(REC_ID_1);
      expect(res.data).toBeNull();
      expect(res.error).toBe('Permission denied');
    });
  });

describe('saveStudentRecordingProgress', () => {
    it('returns error on invalid recording ID', async () => {
      const res = await saveStudentRecordingProgress('invalid-id', 100, 3600);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid recording ID format');
    });

    it('returns error when student is unauthenticated', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(null);

      const res = await saveStudentRecordingProgress(REC_ID_1, 100, 3600);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Student authentication required');
    });

    it('upserts viewing history record successfully with clamped position', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockUpsertQuery = {
        upsert: vi.fn().mockResolvedValueOnce({
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockUpsertQuery as any);

      const res = await saveStudentRecordingProgress(REC_ID_1, 1800, 3600);

      expect(res.error).toBeNull();
      expect(res.success).toBe(true);

      expect(mockUpsertQuery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          student_id: STUDENT_ID,
          resource_type: 'live_class',
          resource_id: REC_ID_1,
          last_position_seconds: 1800,
          is_completed: false,
        }),
        { onConflict: 'student_id,resource_type,resource_id' }
      );
    });

    it('auto-marks is_completed = true when position reaches 90% of duration', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockUpsertQuery = {
        upsert: vi.fn().mockResolvedValueOnce({
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockUpsertQuery as any);

      // 3300 / 3600 = 91.6% >= 90%
      const res = await saveStudentRecordingProgress(REC_ID_1, 3300, 3600, false);

      expect(res.error).toBeNull();
      expect(res.success).toBe(true);

      expect(mockUpsertQuery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          student_id: STUDENT_ID,
          resource_type: 'live_class',
          resource_id: REC_ID_1,
          last_position_seconds: 3300,
          is_completed: true,
        }),
        { onConflict: 'student_id,resource_type,resource_id' }
      );
    });

    it('returns error when Supabase upsert fails', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockUpsertQuery = {
        upsert: vi.fn().mockResolvedValueOnce({
          error: { code: '500', message: 'DB upsert failed' },
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockUpsertQuery as any);

      const res = await saveStudentRecordingProgress(REC_ID_1, 600, 3600);

      expect(res.success).toBe(false);
      expect(res.error).toBe('DB upsert failed');
    });
  });

  describe('markStudentRecordingCompleted', () => {
    it('sets is_completed = true and saves progress', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockUpsertQuery = {
        upsert: vi.fn().mockResolvedValueOnce({
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockUpsertQuery as any);

      const res = await markStudentRecordingCompleted(REC_ID_1, 3600);

      expect(res.error).toBeNull();
      expect(res.success).toBe(true);

      expect(mockUpsertQuery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          student_id: STUDENT_ID,
          resource_type: 'live_class',
          resource_id: REC_ID_1,
          last_position_seconds: 3600,
          is_completed: true,
        }),
        { onConflict: 'student_id,resource_type,resource_id' }
      );
    });
  });
});
