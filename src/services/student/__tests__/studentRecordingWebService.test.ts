import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchStudentRecordingsHubData,
  fetchStudentRecordingById,
  getStudentPlaybackUrl,
  filterStudentRecordings,
  formatRecordingDuration,
  formatRecordingDate,
  getRecordingSubjectColor,
  type StudentRecording,
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

// Mock studentRecordingProgressWebService
vi.mock('../studentRecordingProgressWebService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../studentRecordingProgressWebService')>();
  return {
    ...actual,
    fetchBatchRecordingProgress: vi.fn(),
    fetchSingleRecordingProgress: vi.fn(),
  };
});

describe('studentRecordingWebService', () => {
  const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
  const BATCH_ID_1 = '22222222-2222-4222-8222-222222222222';
  const BS_ID_1 = '33333333-3333-4333-8333-333333333333';
  const BS_ID_2 = '44444444-4444-4444-8444-444444444444';
  const REC_ID_1 = '55555555-5555-4555-8555-555555555555';
  const REC_ID_2 = '66666666-6666-4666-8666-666666666666';
  const TEACHER_ID = '77777777-7777-4777-8777-777777777777';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatters & color helpers', () => {
    it('formats duration in seconds into human-readable text', () => {
      expect(formatRecordingDuration(4500)).toBe('1 hr 15 mins');
      expect(formatRecordingDuration(3600)).toBe('1 hr');
      expect(formatRecordingDuration(2700)).toBe('45 mins');
      expect(formatRecordingDuration(0)).toBe('0 mins');
      expect(formatRecordingDuration(-100)).toBe('0 mins');
    });

    it('formats recording date safely', () => {
      expect(formatRecordingDate(null)).toBe('Recorded');
      expect(formatRecordingDate('invalid-date')).toBe('Recorded');
      const formatted = formatRecordingDate('2026-09-16T10:00:00.000Z');
      expect(formatted).toContain('2026');
    });

    it('returns consistent color configurations for subjects', () => {
      expect(getRecordingSubjectColor('Physics').text).toBe('text-indigo-700');
      expect(getRecordingSubjectColor('Organic Chemistry').text).toBe('text-emerald-700');
      expect(getRecordingSubjectColor('Mathematics').text).toBe('text-amber-800');
      expect(getRecordingSubjectColor('Botany').text).toBe('text-teal-700');
      expect(getRecordingSubjectColor('General Science').text).toBe('text-sky-700');
    });
  });

  describe('fetchStudentRecordingsHubData', () => {
    it('returns error when student authentication cannot be resolved', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(null);

      const res = await fetchStudentRecordingsHubData();
      expect(res.data).toBeNull();
      expect(res.error).toContain('Student authentication required');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns empty list if student is not enrolled in any active batches', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockBatchStudentQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({ data: [], error: null }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockBatchStudentQuery as any);

      const res = await fetchStudentRecordingsHubData();
      expect(res.error).toBeNull();
      expect(res.data?.recordings).toEqual([]);
      expect(res.data?.totalCount).toBe(0);
    });

    it('propagates error if batch_students query fails', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockBatchStudentQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { code: '500', message: 'Failed to verify student batch enrollments.' },
        }),
      };

      vi.mocked(supabase.from).mockReturnValueOnce(mockBatchStudentQuery as any);

      const res = await fetchStudentRecordingsHubData();
      expect(res.data).toBeNull();
      expect(res.error).toBe('Failed to verify student batch enrollments.');
    });

    it('successfully loads, maps, and deduplicates recordings assigned to multiple batch subjects', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      // 1. batch_students
      const mockBatchStudentQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [{ batch_id: BATCH_ID_1 }],
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
              batch_subject_id: BS_ID_1,
              batch_id: BATCH_ID_1,
              name: 'Physics Track 1',
              batches: { name: 'NEET 2026 Morning' },
              subjects: { name: 'Physics' },
            },
            {
              batch_subject_id: BS_ID_2,
              batch_id: BATCH_ID_1,
              name: 'Physics Track 2',
              batches: { name: 'NEET 2026 Morning' },
              subjects: { name: 'Physics' },
            },
          ],
          error: null,
        }),
      };

      // 3. batch_subject_recordings (REC_ID_1 mapped twice to BS_ID_1 and BS_ID_2; REC_ID_2 mapped once)
      const mockBSRQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      // Mock chaining for eq('recordings.status', 'completed').eq('recordings.is_deleted', false)
      mockBSRQuery.eq
        .mockReturnValueOnce(mockBSRQuery) // first .eq
        .mockResolvedValueOnce({
          data: [
            {
              recording_id: REC_ID_1,
              batch_subject_id: BS_ID_1,
              recordings: {
                recording_id: REC_ID_1,
                class_id: 'class-1',
                teacher_id: TEACHER_ID,
                status: 'completed',
                duration_seconds: 3600,
                thumbnail_path: 'thumbnails/rec1.jpg',
                created_at: '2026-09-15T10:00:00.000Z',
                is_deleted: false,
                live_classes: {
                  class_id: 'class-1',
                  title: 'Electromagnetism Lecture 1',
                  description: 'Deep dive into Faraday Law',
                  teacher_id: TEACHER_ID,
                  scheduled_at: '2026-09-15T09:00:00.000Z',
                },
              },
            },
            {
              recording_id: REC_ID_1, // Duplicate mapping
              batch_subject_id: BS_ID_2,
              recordings: {
                recording_id: REC_ID_1,
                class_id: 'class-1',
                teacher_id: TEACHER_ID,
                status: 'completed',
                duration_seconds: 3600,
                thumbnail_path: 'thumbnails/rec1.jpg',
                created_at: '2026-09-15T10:00:00.000Z',
                is_deleted: false,
                live_classes: {
                  class_id: 'class-1',
                  title: 'Electromagnetism Lecture 1',
                  description: 'Deep dive into Faraday Law',
                  teacher_id: TEACHER_ID,
                  scheduled_at: '2026-09-15T09:00:00.000Z',
                },
              },
            },
            {
              recording_id: REC_ID_2,
              batch_subject_id: BS_ID_1,
              recordings: {
                recording_id: REC_ID_2,
                class_id: 'class-2',
                teacher_id: TEACHER_ID,
                status: 'completed',
                duration_seconds: 1800,
                thumbnail_path: null,
                created_at: '2026-09-16T10:00:00.000Z',
                is_deleted: false,
                live_classes: {
                  class_id: 'class-2',
                  title: 'Optics Lecture 1',
                  description: 'Wave optics introduction',
                  teacher_id: TEACHER_ID,
                  scheduled_at: '2026-09-16T09:00:00.000Z',
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
              profiles: { name: 'Dr. H. C. Verma' },
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

      // Mock viewing progress for REC_ID_1 (completed) and REC_ID_2 (in progress)
      const progressMap = new Map([
        [
          REC_ID_1,
          {
            recordingId: REC_ID_1,
            lastPositionSeconds: 3600,
            isCompleted: true,
            watchedPercentage: 100,
            lastWatchedAt: '2026-09-16T10:30:00.000Z',
          },
        ],
        [
          REC_ID_2,
          {
            recordingId: REC_ID_2,
            lastPositionSeconds: 900,
            isCompleted: false,
            watchedPercentage: 50,
            lastWatchedAt: '2026-09-16T11:00:00.000Z',
          },
        ],
      ]);

      vi.mocked(progressService.fetchBatchRecordingProgress).mockResolvedValueOnce({
        data: progressMap,
        error: null,
      });

      const res = await fetchStudentRecordingsHubData();

      expect(res.error).toBeNull();
      expect(res.data).not.toBeNull();

      // Deduplicated to 2 recordings
      expect(res.data?.totalCount).toBe(2);
      expect(res.data?.recordings.length).toBe(2);
      expect(res.data?.completedCount).toBe(1);
      expect(res.data?.inProgressCount).toBe(1);
      expect(res.data?.unwatchedCount).toBe(0);

      const r1 = res.data?.recordings.find((r) => r.recordingId === REC_ID_1);
      expect(r1?.title).toBe('Electromagnetism Lecture 1');
      expect(r1?.teacherName).toBe('Dr. H. C. Verma');
      expect(r1?.progress?.isCompleted).toBe(true);

      const r2 = res.data?.recordings.find((r) => r.recordingId === REC_ID_2);
      expect(r2?.title).toBe('Optics Lecture 1');
      expect(r2?.progress?.watchedPercentage).toBe(50);

      // Verify NO playback URL requests or Edge Functions called
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });
  });

  describe('filterStudentRecordings', () => {
    const mockRecordings: StudentRecording[] = [
      {
        recordingId: 'rec-1',
        classId: 'class-1',
        title: 'Thermodynamics Part 1',
        description: 'First law of thermodynamics',
        teacherName: 'Prof. Sharma',
        subjectName: 'Physics',
        batchName: 'Morning Batch',
        batchId: 'batch-1',
        courseName: null,
        thumbnailPath: null,
        durationSeconds: 3600,
        scheduledAt: '2026-09-10T10:00:00.000Z',
        createdAt: '2026-09-10T10:00:00.000Z',
        progress: {
          recordingId: 'rec-1',
          lastPositionSeconds: 3600,
          isCompleted: true,
          watchedPercentage: 100,
          lastWatchedAt: '2026-09-10T11:00:00.000Z',
        },
      },
      {
        recordingId: 'rec-2',
        classId: 'class-2',
        title: 'Chemical Bonding Basics',
        description: 'Ionic and covalent bonds',
        teacherName: 'Dr. Mukherjee',
        subjectName: 'Chemistry',
        batchName: 'Morning Batch',
        batchId: 'batch-1',
        courseName: null,
        thumbnailPath: null,
        durationSeconds: 1800,
        scheduledAt: '2026-09-12T10:00:00.000Z',
        createdAt: '2026-09-12T10:00:00.000Z',
        progress: {
          recordingId: 'rec-2',
          lastPositionSeconds: 900,
          isCompleted: false,
          watchedPercentage: 50,
          lastWatchedAt: '2026-09-12T11:00:00.000Z',
        },
      },
      {
        recordingId: 'rec-3',
        classId: 'class-3',
        title: 'Calculus Integrals',
        description: 'Definite integrals introduction',
        teacherName: 'Dr. Gupta',
        subjectName: 'Mathematics',
        batchName: 'Evening Batch',
        batchId: 'batch-2',
        courseName: null,
        thumbnailPath: null,
        durationSeconds: 5400,
        scheduledAt: '2026-09-15T10:00:00.000Z',
        createdAt: '2026-09-15T10:00:00.000Z',
        progress: null,
      },
    ];

    it('filters by search query across title, teacher, and subject', () => {
      const byTitle = filterStudentRecordings(mockRecordings, { searchQuery: 'thermo' });
      expect(byTitle.length).toBe(1);
      expect(byTitle[0].recordingId).toBe('rec-1');

      const byTeacher = filterStudentRecordings(mockRecordings, { searchQuery: 'mukherjee' });
      expect(byTeacher.length).toBe(1);
      expect(byTeacher[0].recordingId).toBe('rec-2');

      const bySubject = filterStudentRecordings(mockRecordings, { searchQuery: 'math' });
      expect(bySubject.length).toBe(1);
      expect(bySubject[0].recordingId).toBe('rec-3');
    });

    it('filters by specific subject', () => {
      const res = filterStudentRecordings(mockRecordings, { subject: 'Physics' });
      expect(res.length).toBe(1);
      expect(res[0].subjectName).toBe('Physics');
    });

    it('filters by specific batch', () => {
      const res = filterStudentRecordings(mockRecordings, { batchId: 'batch-2' });
      expect(res.length).toBe(1);
      expect(res[0].recordingId).toBe('rec-3');
    });

    it('filters by watch status (completed, in_progress, not_started)', () => {
      const completed = filterStudentRecordings(mockRecordings, { watchStatus: 'completed' });
      expect(completed.length).toBe(1);
      expect(completed[0].recordingId).toBe('rec-1');

      const inProgress = filterStudentRecordings(mockRecordings, { watchStatus: 'in_progress' });
      expect(inProgress.length).toBe(1);
      expect(inProgress[0].recordingId).toBe('rec-2');

      const notStarted = filterStudentRecordings(mockRecordings, { watchStatus: 'not_started' });
      expect(notStarted.length).toBe(1);
      expect(notStarted[0].recordingId).toBe('rec-3');
    });

    it('sorts recordings by newest, oldest, and duration', () => {
      const newest = filterStudentRecordings(mockRecordings, { sortBy: 'newest' });
      expect(newest[0].recordingId).toBe('rec-3');

      const oldest = filterStudentRecordings(mockRecordings, { sortBy: 'oldest' });
      expect(oldest[0].recordingId).toBe('rec-1');

      const longest = filterStudentRecordings(mockRecordings, { sortBy: 'duration_desc' });
      expect(longest[0].durationSeconds).toBe(5400);

      const shortest = filterStudentRecordings(mockRecordings, { sortBy: 'duration_asc' });
      expect(shortest[0].durationSeconds).toBe(1800);
    });
  });

  describe('fetchStudentRecordingById', () => {
    it('returns error when recordingId is an invalid UUID format', async () => {
      const res = await fetchStudentRecordingById('invalid-uuid');
      expect(res.data).toBeNull();
      expect(res.error).toContain('Invalid recording ID format');
    });

    it('returns error when student is unauthenticated', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(null);

      const res = await fetchStudentRecordingById(REC_ID_1);
      expect(res.data).toBeNull();
      expect(res.error).toContain('Student authentication required');
    });

    it('returns error when student has no active batches', async () => {
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

      const res = await fetchStudentRecordingById(REC_ID_1);
      expect(res.data).toBeNull();
      expect(res.error).toContain('not enrolled in any active batch');
    });

    it('successfully loads recording metadata and progress when enrolled', async () => {
      vi.mocked(courseService.resolveCurrentStudentId).mockResolvedValueOnce(STUDENT_ID);

      const mockBatchStudentQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [{ batch_id: BATCH_ID_1 }],
          error: null,
        }),
      };

      const mockBatchSubjectsQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValueOnce({
          data: [
            {
              batch_subject_id: BS_ID_1,
              batch_id: BATCH_ID_1,
              name: 'Physics I',
              batches: { name: 'Batch Alpha' },
              subjects: { name: 'Physics' },
            },
          ],
          error: null,
        }),
      };

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
              batch_subject_id: BS_ID_1,
              recordings: {
                recording_id: REC_ID_1,
                class_id: 'class-1',
                teacher_id: TEACHER_ID,
                status: 'completed',
                duration_seconds: 3600,
                thumbnail_path: 'thumbnails/rec1.jpg',
                created_at: '2026-09-15T10:00:00.000Z',
                is_deleted: false,
                live_classes: {
                  class_id: 'class-1',
                  title: 'Electromagnetism Lecture 1',
                  description: 'Faraday Law in depth',
                  teacher_id: TEACHER_ID,
                  scheduled_at: '2026-09-15T09:00:00.000Z',
                },
              },
            },
          ],
          error: null,
        });

      const mockTeacherQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValueOnce({
          data: [
            {
              teacher_id: TEACHER_ID,
              profiles: { name: 'Dr. H. C. Verma' },
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
          recordingId: REC_ID_1,
          lastPositionSeconds: 1800,
          isCompleted: false,
          watchedPercentage: 50,
          lastWatchedAt: '2026-09-15T12:00:00.000Z',
        },
        error: null,
      });

      const res = await fetchStudentRecordingById(REC_ID_1);

      expect(res.error).toBeNull();
      expect(res.data).not.toBeNull();
      expect(res.data?.recordingId).toBe(REC_ID_1);
      expect(res.data?.title).toBe('Electromagnetism Lecture 1');
      expect(res.data?.teacherName).toBe('Dr. H. C. Verma');
      expect(res.data?.subjectName).toBe('Physics');
      expect(res.data?.batchName).toBe('Batch Alpha');
      expect(res.data?.progress?.lastPositionSeconds).toBe(1800);
      expect(res.data?.progress?.watchedPercentage).toBe(50);
    });
  });

  describe('getStudentPlaybackUrl', () => {
    it('returns error on invalid recording ID format', async () => {
      const res = await getStudentPlaybackUrl('bad-id');
      expect(res.data).toBeNull();
      expect(res.error).toContain('Invalid recording ID format');
    });

    it('invokes recording-playback-url edge function and returns signed URL', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
        data: {
          url: 'https://r2.example.com/recording.mp4?X-Amz-Signature=123',
          expiresAt: '2026-09-16T12:05:00.000Z',
          durationSeconds: 3600,
        },
        error: null,
      });

      const res = await getStudentPlaybackUrl(REC_ID_1);

      expect(res.error).toBeNull();
      expect(res.data).toEqual({
        playbackUrl: 'https://r2.example.com/recording.mp4?X-Amz-Signature=123',
        expiresAt: '2026-09-16T12:05:00.000Z',
        durationSeconds: 3600,
      });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('recording-playback-url', {
        body: {
          recordingId: REC_ID_1,
          expirySeconds: 300,
        },
      });
    });

    it('returns error if edge function returns error', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
        data: null,
        error: { message: 'Access denied: not enrolled' },
      });

      const res = await getStudentPlaybackUrl(REC_ID_1);
      expect(res.data).toBeNull();
      expect(res.error).toBe('Access denied: not enrolled');
    });
  });

});
