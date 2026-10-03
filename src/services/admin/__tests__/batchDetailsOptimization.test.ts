import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchSubjectTeacherAssignmentService } from '../batchSubjectTeacherAssignmentService';
import { batchManagementService } from '../batchManagementService';
import { adminKeys } from '@/hooks/admin/queryKeys';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('Batch Details Optimization (Phases 1–4)', () => {
  const validBatchId = '11111111-1111-4111-8111-111111111111';
  const validInstituteId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('batchSubjectTeacherAssignmentService.getBatchTeacherSummary (Phase 1)', () => {
    it('fetches batch subjects and assigned teachers in a single query (no N+1 loop)', async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockEq = vi.fn().mockResolvedValue({
        data: [
          {
            batch_subject_id: 'bs-1',
            is_active: true,
            subjects: { name: 'Physics' },
            batches: { name: 'JEE Morning A' },
            batch_subject_teachers: [
              {
                teacher_id: 'teacher-1',
                teacher_details: {
                  teacher_id: 'teacher-1',
                  profiles: { name: 'Dr. H. C. Verma' },
                },
              },
              {
                teacher_id: 'teacher-2',
                teacher_details: {
                  teacher_id: 'teacher-2',
                  profiles: { name: 'Prof. Sharma' },
                },
              },
            ],
          },
          {
            batch_subject_id: 'bs-2',
            is_active: true,
            subjects: { name: 'Mathematics' },
            batches: { name: 'JEE Morning A' },
            batch_subject_teachers: [],
          },
        ],
        error: null,
      });

      vi.mocked(supabase.from).mockReturnValue({
        select: mockSelect,
        eq: mockEq,
      } as any);

      const res = await batchSubjectTeacherAssignmentService.getBatchTeacherSummary(
        validBatchId,
        validInstituteId,
      );

      // Exactly 1 Supabase query should be made to batch_subjects
      expect(supabase.from).toHaveBeenCalledTimes(1);
      expect(supabase.from).toHaveBeenCalledWith('batch_subjects');
      expect(mockEq).toHaveBeenCalledWith('batch_id', validBatchId);

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(2);

      // Verify Physics subject mapping
      expect(res.data![0]).toEqual({
        batchSubjectId: 'bs-1',
        subjectName: 'Physics',
        batchName: 'JEE Morning A',
        teachers: [
          {
            teacherId: 'teacher-1',
            teacherName: 'Dr. H. C. Verma',
            assignmentId: 'bs-1_teacher-1',
          },
          {
            teacherId: 'teacher-2',
            teacherName: 'Prof. Sharma',
            assignmentId: 'bs-1_teacher-2',
          },
        ],
      });

      // Verify Mathematics subject mapping
      expect(res.data![1]).toEqual({
        batchSubjectId: 'bs-2',
        subjectName: 'Mathematics',
        batchName: 'JEE Morning A',
        teachers: [],
      });
    });

    it('returns database error when single query fails', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Network query error' },
        }),
      } as any);

      const res = await batchSubjectTeacherAssignmentService.getBatchTeacherSummary(
        validBatchId,
        validInstituteId,
      );

      expect(res.success).toBe(false);
      expect(res.error).toBe('Network query error');
    });
  });

  describe('batchManagementService.getDetail (Phase 1 assignedStudents array removal)', () => {
    it('queries lightweight student count and mock tests count without downloading full student profiles array', async () => {
      const mockBatch = {
        batch_id: validBatchId,
        batch_code: 'JEE-2026',
        name: 'JEE Morning A',
        stream_id: 'stream-1',
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        created_by: 'admin-1',
        academic_year: '2025-26',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        max_seats: 100,
        streams: { name: 'Engineering' },
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batches') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockBatch, error: null }),
          } as any;
        }

        if (table === 'batch_subjects') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [{ batch_subject_id: 'bs-1' }],
              error: null,
            }),
          } as any;
        }

        if (table === 'batch_subject_teachers') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  teacher_id: 't-1',
                  teacher_details: {
                    teacher_id: 't-1',
                    profiles: { name: 'Prof. Gupta', email: 'gupta@test.com', phone: '123456' },
                  },
                },
              ],
              error: null,
            }),
          } as any;
        }

        if (table === 'batch_students') {
          return {
            select: vi.fn().mockImplementation((fields: string, opts?: any) => {
              if (opts?.head && opts?.count === 'exact') {
                return {
                  eq: vi.fn().mockReturnThis(),
                  then: (resolve: any) => resolve({ count: 42, error: null }),
                };
              }
              throw new Error('Unexpected full profile fetch on batch_students!');
            }),
            eq: vi.fn().mockReturnThis(),
          } as any;
        }

        if (table === 'batch_subject_mock_tests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
          } as any;
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as any;
      });

      const res = await batchManagementService.getDetail(validBatchId);

      expect(res.success).toBe(true);
      expect(res.data?.studentCount).toBe(42);
      expect(res.data?.mockTestCount).toBe(5);
      expect(res.data?.teacher?.name).toBe('Prof. Gupta');
      expect(res.data?.assignedStudents).toEqual([]);
    });
  });

  describe('Phase 4: Targeted Cache Invalidation Keys', () => {
    it('generates distinct targeted keys for detail, lists, counts, and lookups', () => {
      const detailKey = adminKeys.batchManagement.detail(validBatchId);
      const listsKey = adminKeys.batchManagement.lists();
      const countsKey = adminKeys.batchManagement.counts();
      const lookupKey = adminKeys.batchManagement.lookup(validInstituteId);

      expect(detailKey).toEqual(['admin', 'batchManagement', 'detail', validBatchId]);
      expect(listsKey).toEqual(['admin', 'batchManagement', 'list']);
      expect(countsKey).toEqual(['admin', 'batchManagement', 'counts']);
      expect(lookupKey).toEqual(['admin', 'batchManagement', 'lookup', validInstituteId]);

      // Ensure detail key does not start with lists key
      expect(detailKey.join('/')).not.toContain(listsKey.join('/'));
    });
  });
});
