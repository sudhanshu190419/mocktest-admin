import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '../../attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('Attendance Phase 1 Correctness Fixes', () => {
  const INSTITUTE_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Fix 1: Student Attendance Search Institute Scoping', () => {
    it('scopes profiles query to institute_id preventing cross-tenant leakage', async () => {
      const mockChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ profile_id: 'p-1', name: 'John Doe' }],
          error: null,
        }),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'profiles') {
          return mockChain;
        }
        if (table === 'student_details') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ student_id: 's-1', profile_id: 'p-1' }],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          } as any;
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'batch_students') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return mockChain;
      });

      await attendanceAnalyticsService.getAdminStudentAttendance(INSTITUTE_ID, 'John');

      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(mockChain.eq).toHaveBeenCalledWith('institute_id', INSTITUTE_ID);
      expect(mockChain.ilike).toHaveBeenCalledWith('name', '%John%');
      expect(mockChain.limit).toHaveBeenCalledWith(20);
    });
  });

  describe('Fix 2: Teacher Attendance Batch Count & Classes Assigned', () => {
    it('counts distinct batches across batch-subject assignments and populates classesAssigned', async () => {
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'teacher_details') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ teacher_id: 't-1', profiles: { name: 'Prof. Sharma', institute_id: INSTITUTE_ID } }],
                error: null,
              }),
            }),
          } as any;
        }
        if (table === 'batch_subject_teachers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { batch_subjects: { batch_id: 'batch-1' } },
                  { batch_subjects: { batch_id: 'batch-1' } }, // duplicate batch (different subject)
                  { batch_subjects: { batch_id: 'batch-2' } },
                  { batch_subjects: { batch_id: 'batch-3' } },
                  { batch_subjects: { batch_id: 'batch-4' } },
                ],
                error: null,
              }),
            }),
          } as any;
        }
        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string) => {
                const chain: any = {
                  eq: vi.fn().mockImplementation((col2: string) => {
                    const innerChain: any = {
                      eq: vi.fn().mockResolvedValue({
                        data: [{ class_id: 'c-1', status: 'completed' }],
                        error: null,
                      }),
                      then: (resolve: any) => resolve({
                        data: [{ class_id: 'c-1' }, { class_id: 'c-2' }],
                        error: null,
                      }),
                    };
                    return innerChain;
                  }),
                };
                return chain;
              }),
            }),
          } as any;
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ attendance_status: 'present' }],
                error: null,
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const teachers = await attendanceAnalyticsService.getAdminTeacherAttendance(INSTITUTE_ID);

      expect(teachers).toHaveLength(1);
      expect(teachers[0].teacherName).toBe('Prof. Sharma');
      // Verifies that batchCount is 4 distinct batches (out of 5 subject assignments)
      expect(teachers[0].batchCount).toBe(4);
      expect(teachers[0].classesAssigned).toBe(2);
      expect(teachers[0].classesTaken).toBe(1);
    });
  });

  describe('Fix 3: Tab 1 Batch Filter', () => {
    it('filters batch attendance results when batchId is provided in filters', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          { batchId: 'batch-1', batchName: 'Morning Batch', studentCount: 10, averageAttendancePercent: 80, presentCount: 8, partialCount: 0, absentCount: 2 },
          { batchId: 'batch-2', batchName: 'Evening Batch', studentCount: 15, averageAttendancePercent: 90, presentCount: 14, partialCount: 1, absentCount: 0 },
        ],
        error: null,
      } as any);

      const result = await attendanceAnalyticsService.getAdminBatchAttendance(INSTITUTE_ID, {
        batchId: 'batch-2',
      });

      expect(result).toHaveLength(1);
      expect(result[0].batchId).toBe('batch-2');
      expect(result[0].batchName).toBe('Evening Batch');
    });

    it('returns all batches when batchId is undefined (All Batches)', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          { batchId: 'batch-1', batchName: 'Morning Batch', studentCount: 10, averageAttendancePercent: 80, presentCount: 8, partialCount: 0, absentCount: 2 },
          { batchId: 'batch-2', batchName: 'Evening Batch', studentCount: 15, averageAttendancePercent: 90, presentCount: 14, partialCount: 1, absentCount: 0 },
        ],
        error: null,
      } as any);

      const result = await attendanceAnalyticsService.getAdminBatchAttendance(INSTITUTE_ID);

      expect(result).toHaveLength(2);
      expect(result[0].batchId).toBe('batch-1');
      expect(result[1].batchId).toBe('batch-2');
    });
  });
});
