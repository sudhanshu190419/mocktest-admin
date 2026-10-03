import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleanRecordingTitle,
  resolveSubjectName,
  getStudentRecordingSubjects,
  getStudentRecordingsPage,
  fetchActiveStudentBatchIds,
} from '../studentRecordingWebService';
import { supabase } from '@/config/supabase';
import * as progressService from '../studentRecordingProgressWebService';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('../studentRecordingProgressWebService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../studentRecordingProgressWebService')>();
  return {
    ...actual,
    fetchBatchRecordingProgress: vi.fn().mockResolvedValue({ data: new Map(), error: null }),
  };
});

describe('studentRecordingTwoTier', () => {
  const BATCH_ID_1 = '22222222-2222-4222-8222-222222222222';
  const SUBJECT_ID_1 = '33333333-3333-4333-8333-333333333333';
  const BS_ID_1 = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cleanRecordingTitle helper', () => {
    it('removes trailing batch name in parentheses', () => {
      expect(cleanRecordingTitle('Thermodynamics Lecture 1 (JEE Batch 2026)', 'JEE Batch 2026')).toBe(
        'Thermodynamics Lecture 1',
      );
    });

    it('removes hyphenated trailing batch name', () => {
      expect(cleanRecordingTitle('Optics Class - NEET Droppers', 'NEET Droppers')).toBe('Optics Class');
    });

    it('returns default fallback if title is empty', () => {
      expect(cleanRecordingTitle('', 'Batch A')).toBe('Recorded Class');
      expect(cleanRecordingTitle(null, null)).toBe('Recorded Class');
    });
  });

  describe('resolveSubjectName helper', () => {
    it('prefers subjects.name over batch_subjects.name', () => {
      const bs = {
        name: 'Physics Batch Subject',
        subjects: { name: 'Physics' },
        batches: { name: 'Morning Batch' },
      };
      expect(resolveSubjectName(bs)).toBe('Physics');
    });

    it('strips batch name from fallback batch_subjects.name', () => {
      const bs = {
        name: 'Chemistry - Morning Batch',
        subjects: null,
        batches: { name: 'Morning Batch' },
      };
      expect(resolveSubjectName(bs)).toBe('Chemistry');
    });
  });

  describe('getStudentRecordingSubjects (Level 1 Overview)', () => {
    it('returns empty array if no batch IDs are provided', async () => {
      const result = await getStudentRecordingSubjects([]);
      expect(result).toEqual([]);
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('calls get_student_recording_subjects RPC with target batch IDs', async () => {
      const mockRpcData = [
        {
          subject_id: SUBJECT_ID_1,
          subject_name: 'Physics',
          recording_count: 42,
          latest_recording_at: '2026-09-28T10:00:00Z',
        },
      ];

      (supabase.rpc as any).mockResolvedValueOnce({
        data: mockRpcData,
        error: null,
      });

      const result = await getStudentRecordingSubjects([BATCH_ID_1]);
      expect(supabase.rpc).toHaveBeenCalledWith('get_student_recording_subjects', {
        p_batch_ids: [BATCH_ID_1],
      });
      expect(result).toHaveLength(1);
      expect(result[0].subjectName).toBe('Physics');
      expect(result[0].recordingCount).toBe(42);
      expect(result[0].latestRecordingAt).toBe('2026-09-28T10:00:00Z');
    });

    it('throws error if RPC returns an error', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection failed' },
      });

      await expect(getStudentRecordingSubjects([BATCH_ID_1])).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('getStudentRecordingsPage (Level 2 Keyset Pagination)', () => {
    it('returns empty page when batchIds is empty', async () => {
      const result = await getStudentRecordingsPage([]);
      expect(result).toEqual({ recordings: [], nextCursor: null, hasMore: false });
    });

    it('correctly executes keyset query with ordered cursor and page limit', async () => {
      const mockBsQuery: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((onfulfilled) => {
          return Promise.resolve({
            data: [
              {
                batch_subject_id: BS_ID_1,
                batch_id: BATCH_ID_1,
                subject_id: SUBJECT_ID_1,
                name: 'Physics',
                batches: { name: 'Batch 1' },
                subjects: { name: 'Physics' },
              },
            ],
            error: null,
          }).then(onfulfilled);
        }),
      };

      const mockBsrQuery: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((onfulfilled) => {
          return Promise.resolve({
            data: [
              {
                recording_id: '66666666-6666-4666-8666-666666666666',
                batch_subject_id: BS_ID_1,
                assigned_at: '2026-09-28T12:00:00Z',
                recordings: {
                  recording_id: '66666666-6666-4666-8666-666666666666',
                  class_id: 'class-1',
                  teacher_id: '55555555-5555-4555-8555-555555555555',
                  title: 'Electrostatics 1',
                  description: 'Introduction',
                  status: 'completed',
                  duration_seconds: 3600,
                  thumbnail_path: null,
                  created_at: '2026-09-28T12:00:00Z',
                  is_deleted: false,
                  live_classes: {
                    class_id: 'class-1',
                    title: 'Electrostatics 1',
                    description: 'Introduction',
                    teacher_id: '55555555-5555-4555-8555-555555555555',
                    chapter_id: null,
                    topic_id: null,
                    scheduled_at: '2026-09-28T12:00:00Z',
                    chapters: null,
                    topics: null,
                  },
                },
              },
            ],
            error: null,
          }).then(onfulfilled);
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'batch_subjects') return mockBsQuery;
        if (table === 'batch_subject_recordings') return mockBsrQuery;
        if (table === 'teacher_details') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ teacher_id: '55555555-5555-4555-8555-555555555555', profiles: { name: 'Dr. HC Verma' } }],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis() };
      });

      const result = await getStudentRecordingsPage([BATCH_ID_1], {
        subjectId: SUBJECT_ID_1,
        pageSize: 20,
      });

      expect(result.recordings).toHaveLength(1);
      expect(result.recordings[0].recordingId).toBe('66666666-6666-4666-8666-666666666666');
      expect(result.recordings[0].title).toBe('Electrostatics 1');
      expect(result.recordings[0].teacherName).toBe('Dr. HC Verma');
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();

      expect(mockBsrQuery.order).toHaveBeenCalledWith('assigned_at', { ascending: false });
      expect(mockBsrQuery.order).toHaveBeenCalledWith('recording_id', { ascending: false });
    });

    it('prevents premature hasMore=false when duplicates across batches reduce page below pageSize', async () => {
      // 41 raw rows from DB, but containing duplicate assignments of only 14 unique recordings
      const rawRows = [];
      for (let i = 0; i < 41; i++) {
        const uniqueNum = Math.floor(i / 3); // 0 to 13 (14 unique recordings)
        const recId = 'rec-' + String(uniqueNum).padStart(3, '0');
        rawRows.push({
          recording_id: recId,
          batch_subject_id: BS_ID_1,
          assigned_at: '2026-09-28T12:00:00Z',
          recordings: {
            recording_id: recId,
            class_id: 'class-' + uniqueNum,
            teacher_id: null,
            title: 'Lecture ' + uniqueNum,
            description: null,
            status: 'completed',
            duration_seconds: 1800,
            thumbnail_path: null,
            created_at: '2026-09-28T12:00:00Z',
            is_deleted: false,
            live_classes: null,
          },
        });
      }

      const mockBsQuery: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((onfulfilled) => {
          return Promise.resolve({
            data: [{ batch_subject_id: BS_ID_1, batch_id: BATCH_ID_1, subject_id: SUBJECT_ID_1, name: 'Physics' }],
            error: null,
          }).then(onfulfilled);
        }),
      };

      const mockBsrQuery: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((onfulfilled) => {
          return Promise.resolve({
            data: rawRows,
            error: null,
          }).then(onfulfilled);
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'batch_subjects') return mockBsQuery;
        if (table === 'batch_subject_recordings') return mockBsrQuery;
        if (table === 'teacher_details') {
          return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        return {};
      });

      const result = await getStudentRecordingsPage([BATCH_ID_1], {
        subjectId: SUBJECT_ID_1,
        pageSize: 20,
      });

      // 14 deduplicated recordings returned
      expect(result.recordings).toHaveLength(14);
      // Because raw rows matched fetchLimit (41), hasMore MUST be true even though 14 <= 20!
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).not.toBeNull();
      expect(result.nextCursor?.recordingId).toBe('rec-000');
    });
  });

  describe('fetchActiveStudentBatchIds fallback', () => {
    it('queries batch_students where status in active or approved', async () => {
      (supabase.auth.getSession as any).mockResolvedValueOnce({
        data: { session: { user: { id: 'user-1' } } },
      });

      const mockQuery: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [{ batch_id: BATCH_ID_1 }],
          error: null,
        }),
      };

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'batch_students') return mockQuery;
        return {};
      });

      const batches = await fetchActiveStudentBatchIds();
      expect(batches).toEqual([BATCH_ID_1]);
      expect(mockQuery.in).toHaveBeenCalledWith('status', ['active', 'approved']);
    });
  });
});
