import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchStudentAuthorizedLiveClass,
  requestStudentLiveKitToken,
  checkLiveClassStatus,
} from '../studentLiveClassRoomWebService';
import { supabase } from '@/config/supabase';

// Mock Supabase client
vi.mock('@/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('studentLiveClassRoomWebService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. fetchStudentAuthorizedLiveClass ───────────────────────────────────

  describe('fetchStudentAuthorizedLiveClass', () => {
    it('rejects invalid class UUID formats', async () => {
      const res = await fetchStudentAuthorizedLiveClass('invalid-id');
      expect(res.data).toBeNull();
      expect(res.error).toBe('Invalid class identifier format.');
    });

    it('rejects when student is unauthenticated', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });

      (supabase.from as any) = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const res = await fetchStudentAuthorizedLiveClass('11111111-1111-4111-8111-111111111111');
      expect(res.data).toBeNull();
      expect(res.error).toBe('Student authentication required.');
    });

    it('returns error if student is not enrolled in any active batches', async () => {
      const studentId = '11111111-1111-4111-8111-111111111111';

      (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_details') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: studentId }, error: null }),
          };
        }
        if (table === 'batch_students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === 'course_enrollments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const res = await fetchStudentAuthorizedLiveClass('22222222-2222-4222-8222-222222222222', studentId);
      expect(res.data).toBeNull();
      expect(res.error).toBe('You are not actively enrolled in any batches.');
    });

    it('returns error if class is not assigned to student batches', async () => {
      const studentId = '11111111-1111-4111-8111-111111111111';
      const batchId = '22222222-2222-4222-8222-222222222222';
      const batchSubjectId = '33333333-3333-4333-8333-333333333333';
      const unauthorizedClassId = '44444444-4444-4444-8444-444444444444';

      (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_details') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: studentId }, error: null }),
          };
        }
        if (table === 'batch_students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [{ batch_id: batchId }], error: null }),
            }),
          };
        }
        if (table === 'course_enrollments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === 'batch_subjects') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  batch_subject_id: batchSubjectId,
                  batch_id: batchId,
                  subject_id: 'sub-1',
                  subjects: { name: 'Physics' },
                  batches: { name: 'Batch A' },
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const res = await fetchStudentAuthorizedLiveClass(unauthorizedClassId, studentId);
      expect(res.data).toBeNull();
      expect(res.error).toBe('You do not have access to this live class.');
    });

    it('successfully retrieves authorized live class metadata', async () => {
      const studentId = '11111111-1111-4111-8111-111111111111';
      const batchId = '22222222-2222-4222-8222-222222222222';
      const batchSubjectId = '33333333-3333-4333-8333-333333333333';
      const classId = '44444444-4444-4444-8444-444444444444';
      const teacherId = '55555555-5555-4555-8555-555555555555';

      (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
        if (table === 'student_details') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { student_id: studentId }, error: null }),
          };
        }
        if (table === 'batch_students') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [{ batch_id: batchId }], error: null }),
            }),
          };
        }
        if (table === 'course_enrollments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === 'batch_subjects') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  batch_subject_id: batchSubjectId,
                  batch_id: batchId,
                  subject_id: 'sub-1',
                  subjects: { name: 'Physics', code: 'PHY101' },
                  batches: { name: 'JEE Advanced Batch' },
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  batch_subject_id: batchSubjectId,
                  class_id: classId,
                  live_classes: {
                    class_id: classId,
                    title: 'Rotational Motion Class',
                    status: 'live',
                    scheduled_at: new Date().toISOString(),
                    duration_min: 90,
                    description: 'Lecture details',
                    is_recorded: true,
                    room_name: 'room-101',
                    teacher_id: teacherId,
                    chapters: { name: 'Rotational Mechanics' },
                    topics: { name: 'Torque' },
                  },
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'teacher_details') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                teacher_id: teacherId,
                profiles: { name: 'Prof. H.C. Verma' },
              },
              error: null,
            }),
          };
        }
        if (table === 'live_sessions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ class_id: classId, status: 'live' }],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const res = await fetchStudentAuthorizedLiveClass(classId, studentId);
      expect(res.error).toBeNull();
      expect(res.data).not.toBeNull();
      expect(res.data?.classId).toBe(classId);
      expect(res.data?.title).toBe('Rotational Motion Class');
      expect(res.data?.status).toBe('live');
      expect(res.data?.subjectName).toBe('Physics');
      expect(res.data?.teacherName).toBe('Prof. H.C. Verma');
      expect(res.data?.roomName).toBe('room-101');
      expect(res.data?.canJoin).toBe(true);
      expect(res.data?.chapterName).toBe('Rotational Mechanics');
      expect(res.data?.topicName).toBe('Torque');
    });
  });

  // ─── 2. requestStudentLiveKitToken ────────────────────────────────────────

  describe('requestStudentLiveKitToken', () => {
    it('validates UUID format', async () => {
      const res = await requestStudentLiveKitToken('invalid-id');
      expect(res.data).toBeNull();
      expect(res.error).toBe('Invalid class ID format.');
    });

    it('rejects unauthenticated user session', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const res = await requestStudentLiveKitToken('11111111-1111-4111-8111-111111111111');
      expect(res.data).toBeNull();
      expect(res.error).toBe('User is not authenticated. Please log in.');
    });

    it('successfully requests LiveKit token from Edge Function', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            access_token: 'mock-jwt-token',
            user: {
              id: 'user-123',
              user_metadata: { name: 'Student Name' },
            },
          },
        },
        error: null,
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          token: 'signed-livekit-jwt',
          url: 'wss://livekit.cloud.example',
        },
        error: null,
      });

      const res = await requestStudentLiveKitToken(
        '11111111-1111-4111-8111-111111111111',
        'Student Name'
      );

      expect(res.error).toBeNull();
      expect(res.data?.token).toBe('signed-livekit-jwt');
      expect(res.data?.url).toBe('wss://livekit.cloud.example');

      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'livekit-token',
        expect.objectContaining({
          body: {
            classId: '11111111-1111-4111-8111-111111111111',
            participantName: 'Student Name',
          },
        })
      );
    });

    it('handles token Edge Function error responses', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            access_token: 'mock-jwt-token',
            user: { id: 'user-123' },
          },
        },
        error: null,
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: null,
        error: { message: 'Access denied: You are not authorized to join this class.' },
      });

      const res = await requestStudentLiveKitToken('11111111-1111-4111-8111-111111111111');
      expect(res.data).toBeNull();
      expect(res.error).toBe('Access denied: You are not authorized to join this class.');
    });
  });

  // ─── 3. checkLiveClassStatus ──────────────────────────────────────────────

  describe('checkLiveClassStatus', () => {
    it('returns nulls for invalid UUID', async () => {
      const res = await checkLiveClassStatus('invalid');
      expect(res.status).toBeNull();
      expect(res.sessionStatus).toBeNull();
    });

    it('returns authoritative status and session status', async () => {
      const classId = '11111111-1111-4111-8111-111111111111';

      (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { status: 'live' },
              error: null,
            }),
          };
        }
        if (table === 'live_sessions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ status: 'live' }],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const res = await checkLiveClassStatus(classId);
      expect(res.status).toBe('live');
      expect(res.sessionStatus).toBe('live');
    });
  });
});
