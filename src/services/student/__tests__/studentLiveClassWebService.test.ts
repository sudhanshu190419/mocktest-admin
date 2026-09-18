import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchStudentLiveClassesHubData,
  filterStudentLiveClasses,
  formatClassTimeDisplay,
  formatRelativeClassTime,
  getClassSubjectColor,
  type StudentLiveClassItem,
} from '../studentLiveClassWebService';
import { supabase } from '@/config/supabase';

// Mock Supabase client
vi.mock('@/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('studentLiveClassWebService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Helper Function Tests ──────────────────────────────────────────────

  describe('formatClassTimeDisplay', () => {
    it('handles invalid date strings gracefully', () => {
      expect(formatClassTimeDisplay('invalid-date')).toBe('Scheduled');
    });

    it('formats today timestamps with "Today, HH:MM"', () => {
      const today = new Date();
      today.setHours(16, 30, 0, 0);
      const res = formatClassTimeDisplay(today.toISOString());
      expect(res).toContain('Today');
    });

    it('formats tomorrow timestamps with "Tomorrow, HH:MM"', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const res = formatClassTimeDisplay(tomorrow.toISOString());
      expect(res).toContain('Tomorrow');
    });

    it('formats future timestamps with month and day', () => {
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const res = formatClassTimeDisplay(future.toISOString());
      expect(res).not.toBe('Scheduled');
      expect(res.length).toBeGreaterThan(5);
    });
  });

  describe('formatRelativeClassTime', () => {
    it('returns Completed for completed status', () => {
      expect(formatRelativeClassTime(new Date().toISOString(), 'completed')).toBe('Completed');
    });

    it('returns Cancelled for cancelled status', () => {
      expect(formatRelativeClassTime(new Date().toISOString(), 'cancelled')).toBe('Cancelled');
    });

    it('returns "Started just now" or "Started Xm ago" for live status', () => {
      const justStarted = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      expect(formatRelativeClassTime(justStarted, 'live')).toBe('Started 2m ago');
    });

    it('returns "Starts in Xm" or "Starts in Xh" for upcoming scheduled status', () => {
      const inThirtyMins = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      expect(formatRelativeClassTime(inThirtyMins, 'scheduled')).toBe('Starts in 30m');
    });
  });

  describe('getClassSubjectColor', () => {
    it('returns indigo color tokens for Physics', () => {
      const c = getClassSubjectColor('Advanced Physics');
      expect(c.bg).toContain('indigo');
      expect(c.text).toContain('indigo');
    });

    it('returns emerald color tokens for Chemistry', () => {
      const c = getClassSubjectColor('Organic Chemistry');
      expect(c.bg).toContain('emerald');
      expect(c.text).toContain('emerald');
    });

    it('returns amber color tokens for Mathematics', () => {
      const c = getClassSubjectColor('Mathematics');
      expect(c.bg).toContain('amber');
      expect(c.text).toContain('amber');
    });

    it('returns teal color tokens for Biology', () => {
      const c = getClassSubjectColor('Biology / Zoology');
      expect(c.bg).toContain('teal');
      expect(c.text).toContain('teal');
    });

    it('returns sky default tokens for General subjects', () => {
      const c = getClassSubjectColor('General Aptitude');
      expect(c.bg).toContain('sky');
      expect(c.text).toContain('sky');
    });
  });

  // ─── 2. Filter Function Tests ──────────────────────────────────────────────

  describe('filterStudentLiveClasses', () => {
    const sampleClasses: StudentLiveClassItem[] = [
      {
        classId: 'c1',
        title: 'Mechanics & Rotational Dynamics',
        status: 'live',
        subjectName: 'Physics',
        subjectCode: 'PHY101',
        teacherName: 'Dr. H.C. Verma',
        batchName: 'JEE Advanced 2026',
        batchId: 'b1',
        courseName: null,
        scheduledAt: new Date().toISOString(),
        durationMin: 90,
        sessionStatus: 'live',
        roomName: 'room-101',
        isRecorded: true,
        hasRecordingAvailable: false,
        recordingId: null,
        chapterName: 'Rotational Motion',
        topicName: 'Moment of Inertia',
        description: 'Comprehensive problem solving',
        canJoin: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        classId: 'c2',
        title: 'Electrochemistry Fundamentals',
        status: 'scheduled',
        subjectName: 'Chemistry',
        subjectCode: 'CHEM101',
        teacherName: 'Prof. K. Sharma',
        batchName: 'JEE Main 2026',
        batchId: 'b2',
        courseName: null,
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        durationMin: 60,
        sessionStatus: null,
        roomName: 'room-102',
        isRecorded: true,
        hasRecordingAvailable: false,
        recordingId: null,
        chapterName: 'Electrochemistry',
        topicName: 'Nernst Equation',
        description: 'Theory and derivations',
        canJoin: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        classId: 'c3',
        title: 'Calculus: Integration Techniques',
        status: 'completed',
        subjectName: 'Mathematics',
        subjectCode: 'MATH101',
        teacherName: 'Dr. Ramanujan',
        batchName: 'JEE Advanced 2026',
        batchId: 'b1',
        courseName: null,
        scheduledAt: new Date(Date.now() - 86400000).toISOString(),
        durationMin: 75,
        sessionStatus: 'ended',
        roomName: 'room-103',
        isRecorded: true,
        hasRecordingAvailable: true,
        recordingId: 'rec-103',
        chapterName: 'Definite Integrals',
        topicName: 'By Parts',
        description: 'Past class session',
        canJoin: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    it('returns all items when filters are empty or "all"', () => {
      const res = filterStudentLiveClasses(sampleClasses, {
        searchQuery: '',
        selectedSubject: 'all',
        selectedBatch: 'all',
      });
      expect(res.length).toBe(3);
    });

    it('filters by search matching title (case-insensitive)', () => {
      const res = filterStudentLiveClasses(sampleClasses, {
        searchQuery: 'mechanics',
      });
      expect(res.length).toBe(1);
      expect(res[0].classId).toBe('c1');
    });

    it('filters by search matching teacher name', () => {
      const res = filterStudentLiveClasses(sampleClasses, {
        searchQuery: 'verma',
      });
      expect(res.length).toBe(1);
      expect(res[0].classId).toBe('c1');
    });

    it('filters by search matching chapter or topic', () => {
      const res = filterStudentLiveClasses(sampleClasses, {
        searchQuery: 'Nernst',
      });
      expect(res.length).toBe(1);
      expect(res[0].classId).toBe('c2');
    });

    it('filters by selected subject', () => {
      const res = filterStudentLiveClasses(sampleClasses, {
        selectedSubject: 'Chemistry',
      });
      expect(res.length).toBe(1);
      expect(res[0].subjectName).toBe('Chemistry');
    });

    it('filters by selected batch', () => {
      const res = filterStudentLiveClasses(sampleClasses, {
        selectedBatch: 'JEE Advanced 2026',
      });
      expect(res.length).toBe(2);
      expect(res.map((c) => c.classId)).toEqual(['c1', 'c3']);
    });

    it('returns empty array when no classes match', () => {
      const res = filterStudentLiveClasses(sampleClasses, {
        searchQuery: 'nonexistent subject query',
      });
      expect(res.length).toBe(0);
    });
  });

  // ─── 3. fetchStudentLiveClassesHubData Service Tests ────────────────────────

  describe('fetchStudentLiveClassesHubData', () => {
    it('returns empty structure when student is not authenticated', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });

      const fromMock = vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });
      (supabase.from as any) = fromMock;

      const res = await fetchStudentLiveClassesHubData();
      expect(res.error).toBeNull();
      expect(res.data?.allClasses).toEqual([]);
      expect(res.data?.summary.totalAssigned).toBe(0);
    });

    it('returns empty structure when student has no active batches', async () => {
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
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              return {
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              };
            }),
          };
        }
        if (table === 'course_enrollments') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const res = await fetchStudentLiveClassesHubData(studentId);
      expect(res.error).toBeNull();
      expect(res.data?.allClasses).toEqual([]);
      expect(res.data?.summary.totalAssigned).toBe(0);
    });

    it('correctly maps assigned live classes, resolves teachers & partitions by status', async () => {
      const studentId = '11111111-1111-4111-8111-111111111111';
      const batchId = '22222222-2222-4222-8222-222222222222';
      const batchSubjectId = '33333333-3333-4333-8333-333333333333';
      const teacherId = '44444444-4444-4444-8444-444444444444';
      const liveClassId = '55555555-5555-4555-8555-555555555555';
      const scheduledClassId = '66666666-6666-4666-8666-666666666666';

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
              eq: vi.fn().mockResolvedValue({
                data: [{ batch_id: batchId }],
                error: null,
              }),
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
                  subjects: { subject_id: 'sub-1', name: 'Physics', code: 'PHY' },
                  batches: { batch_id: batchId, name: 'Target Batch 2026', batch_code: 'TB26' },
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnValue({
              neq: vi.fn().mockResolvedValue({
                data: [
                  {
                    batch_subject_id: batchSubjectId,
                    class_id: liveClassId,
                    live_classes: {
                      class_id: liveClassId,
                      title: 'Live Mechanics Session',
                      status: 'live',
                      scheduled_at: new Date().toISOString(),
                      duration_min: 90,
                      description: 'Live interactive class',
                      is_recorded: true,
                      room_name: 'mechanics-room',
                      teacher_id: teacherId,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                      chapter_id: 'ch-1',
                      topic_id: 'tp-1',
                      chapters: { name: 'Laws of Motion' },
                      topics: { name: 'Friction' },
                    },
                  },
                  {
                    batch_subject_id: batchSubjectId,
                    class_id: scheduledClassId,
                    live_classes: {
                      class_id: scheduledClassId,
                      title: 'Upcoming Optics Lecture',
                      status: 'scheduled',
                      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
                      duration_min: 60,
                      description: 'Ray optics',
                      is_recorded: false,
                      room_name: 'optics-room',
                      teacher_id: teacherId,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                      chapter_id: 'ch-2',
                      topic_id: null,
                      chapters: { name: 'Optics' },
                      topics: null,
                    },
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'teacher_details') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  teacher_id: teacherId,
                  profiles: { name: 'Dr. Richard Feynman' },
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'live_sessions') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [{ class_id: liveClassId, status: 'live' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'recordings') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const res = await fetchStudentLiveClassesHubData(studentId);
      expect(res.error).toBeNull();
      expect(res.data).not.toBeNull();

      expect(res.data?.liveNow.length).toBe(1);
      expect(res.data?.liveNow[0].classId).toBe(liveClassId);
      expect(res.data?.liveNow[0].teacherName).toBe('Dr. Richard Feynman');
      expect(res.data?.liveNow[0].canJoin).toBe(true);
      expect(res.data?.liveNow[0].sessionStatus).toBe('live');

      expect(res.data?.upcoming.length).toBe(1);
      expect(res.data?.upcoming[0].classId).toBe(scheduledClassId);
      expect(res.data?.upcoming[0].canJoin).toBe(false);

      expect(res.data?.summary.totalLive).toBe(1);
      expect(res.data?.summary.totalUpcoming).toBe(1);
      expect(res.data?.summary.totalAssigned).toBe(2);
      expect(res.data?.subjects).toEqual(['Physics']);
      expect(res.data?.batches).toEqual(['Target Batch 2026']);
    });
  });
});
