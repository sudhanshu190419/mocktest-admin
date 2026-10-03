import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '../../attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('attendanceAnalyticsService: Teacher Details & Attendance', () => {
  let mockChain: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };

    vi.mocked(supabase.from).mockReturnValue(mockChain as any);
  });

  describe('getAdminTeachers', () => {
    it('queries teacher_details via profiles!inner and filters on profiles.institute_id (preventing HTTP 400)', async () => {
      const instituteId = '11111111-1111-1111-1111-111111111111';

      mockChain.eq.mockResolvedValueOnce({
        data: [
          {
            teacher_id: 't-1',
            profiles: { name: 'Prof. Sharma', institute_id: instituteId },
          },
          {
            teacher_id: 't-2',
            profiles: { name: 'Dr. Anita Roy', institute_id: instituteId },
          },
        ],
        error: null,
      });

      const teachers = await attendanceAnalyticsService.getAdminTeachers(instituteId);

      expect(supabase.from).toHaveBeenCalledWith('teacher_details');
      expect(mockChain.select).toHaveBeenCalledWith('teacher_id, profiles!inner(name, institute_id)');
      expect(mockChain.eq).toHaveBeenCalledWith('profiles.institute_id', instituteId);
      // Explicitly verify it does NOT query on teacher_details.institute_id
      expect(mockChain.eq).not.toHaveBeenCalledWith('institute_id', instituteId);

      expect(teachers).toEqual([
        { teacherId: 't-1', name: 'Prof. Sharma' },
        { teacherId: 't-2', name: 'Dr. Anita Roy' },
      ]);
    });

    it('correctly parses profile name when profiles is returned as array or single object', async () => {
      const instituteId = '11111111-1111-1111-1111-111111111111';

      mockChain.eq.mockResolvedValueOnce({
        data: [
          {
            teacher_id: 't-array',
            profiles: [{ name: 'Array Teacher', institute_id: instituteId }],
          },
          {
            teacher_id: 't-fallback',
            profiles: null,
          },
        ],
        error: null,
      });

      const teachers = await attendanceAnalyticsService.getAdminTeachers(instituteId);

      expect(teachers).toEqual([
        { teacherId: 't-array', name: 'Array Teacher' },
        { teacherId: 't-fallback', name: 'Unknown Teacher' },
      ]);
    });

    it('handles query errors cleanly without throwing unhandled exceptions', async () => {
      mockChain.eq.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      const teachers = await attendanceAnalyticsService.getAdminTeachers('inst-1');
      expect(teachers).toEqual([]);
    });
  });

  describe('getAdminTeacherAttendance', () => {
    const instituteId = '11111111-1111-1111-1111-111111111111';

    it('queries teacher_details via profiles!inner with profiles.institute_id', async () => {
      // First query in getAdminTeacherAttendance is the teacher lookup
      mockChain.eq.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await attendanceAnalyticsService.getAdminTeacherAttendance(instituteId);

      expect(supabase.from).toHaveBeenCalledWith('teacher_details');
      expect(mockChain.select).toHaveBeenCalledWith('teacher_id, profiles!inner(name, institute_id)');
      expect(mockChain.eq).toHaveBeenCalledWith('profiles.institute_id', instituteId);
      expect(mockChain.eq).not.toHaveBeenCalledWith('institute_id', instituteId);
      expect(result).toEqual([]);
    });

    it('returns empty array cleanly when Supabase returns an error', async () => {
      mockChain.eq.mockResolvedValueOnce({
        data: null,
        error: { message: 'Query error' },
      });

      const result = await attendanceAnalyticsService.getAdminTeacherAttendance('inst-1');
      expect(result).toEqual([]);
    });

    it('computes distinct batchCount, classesAssigned, classesTaken, and preserves average attendance', async () => {
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'teacher_details') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    teacher_id: 't-1',
                    profiles: { name: 'Prof. Sharma', institute_id: instituteId },
                  },
                ],
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
                  { batch_subjects: { batch_id: 'batch-A' } },
                  { batch_subjects: { batch_id: 'batch-A' } }, // duplicate batch (different subject)
                  { batch_subjects: { batch_id: 'batch-B' } }, // distinct batch
                ],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                const chain: any = {
                  eq: vi.fn().mockImplementation((col2: string, val2: string) => {
                    const innerChain: any = {
                      eq: vi.fn().mockImplementation((col3: string, val3: string) => {
                        // completed classes query (col3 === 'status', val3 === 'completed')
                        return Promise.resolve({
                          data: [
                            { class_id: 'c-1' },
                            { class_id: 'c-2' },
                          ],
                          error: null,
                        });
                      }),
                      // assigned classes query finishes at eq('institute_id')
                      then: (resolve: any) => resolve({
                        data: [
                          { class_id: 'c-1' },
                          { class_id: 'c-2' },
                          { class_id: 'c-3' },
                          { class_id: 'c-4' },
                        ],
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
                data: [
                  { attendance_status: 'present' }, // 100
                  { attendance_status: 'partial' }, // 50
                ],
                error: null,
              }),
            }),
          } as any;
        }

        return mockChain;
      });

      const rows = await attendanceAnalyticsService.getAdminTeacherAttendance(instituteId);

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.teacherId).toBe('t-1');
      expect(row.teacherName).toBe('Prof. Sharma');
      // 3 subject assignments, but only 2 distinct batches (batch-A and batch-B)
      expect(row.batchCount).toBe(2);
      // 4 total classes assigned
      expect(row.classesAssigned).toBe(4);
      // 2 completed classes taken
      expect(row.classesTaken).toBe(2);
      // Avg: (100 + 50) / 2 = 75%
      expect(row.averageAttendancePercent).toBe(75);

      // Verify class-level details
      expect(row.classes).toHaveLength(4);
    });

    it('populates class-level details with Taken/Not Taken status and batch name', async () => {
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'teacher_details') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ teacher_id: 't-1', profiles: { name: 'Prof. Sharma', institute_id: instituteId } }],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'batch_subject_teachers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ batch_subjects: { batch_id: 'b-1' } }],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation((col: string) => {
                  const inner: any = {
                    eq: vi.fn().mockResolvedValue({
                      data: [{ class_id: 'c-1', status: 'completed' }],
                      error: null,
                    }),
                    then: (resolve: any) => resolve({
                      data: [
                        { class_id: 'c-1', title: 'Algebra Lecture 1', scheduled_at: '2026-09-01T10:00:00Z', duration_min: 60, status: 'completed' },
                        { class_id: 'c-2', title: 'Algebra Lecture 2', scheduled_at: '2026-09-02T10:00:00Z', duration_min: 60, status: 'scheduled' },
                        { class_id: 'c-3', title: 'Algebra Lecture 3', scheduled_at: '2026-09-03T10:00:00Z', duration_min: 60, status: 'cancelled' },
                      ],
                      error: null,
                    }),
                  };
                  return inner;
                }),
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

        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ class_id: 'c-1', batch_subjects: { batch_id: 'b-1' } }],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_class_batch') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ class_id: 'c-2', batch_id: 'b-2' }],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'batches') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [
                { batch_id: 'b-1', name: 'Morning Batch' },
                { batch_id: 'b-2', name: 'Evening Batch' },
              ],
              error: null,
            }),
          } as any;
        }

        return mockChain;
      });

      const rows = await attendanceAnalyticsService.getAdminTeacherAttendance(instituteId);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.classesAssigned).toBe(3);
      expect(row.classesTaken).toBe(1);

      const classes = row.classes ?? [];
      expect(classes).toHaveLength(3);

      // c-1 is completed -> Taken, linked to Morning Batch via batch_subject_live_classes
      const c1 = classes.find(c => c.classId === 'c-1');
      expect(c1).toBeDefined();
      expect(c1?.title).toBe('Algebra Lecture 1');
      expect(c1?.batchName).toBe('Morning Batch');
      expect(c1?.status).toBe('Taken');

      // c-2 is scheduled -> Not Taken, linked to Evening Batch via live_class_batch
      const c2 = classes.find(c => c.classId === 'c-2');
      expect(c2).toBeDefined();
      expect(c2?.title).toBe('Algebra Lecture 2');
      expect(c2?.batchName).toBe('Evening Batch');
      expect(c2?.status).toBe('Not Taken');

      // c-3 is cancelled -> Not Taken, unlinked -> '—'
      const c3 = classes.find(c => c.classId === 'c-3');
      expect(c3).toBeDefined();
      expect(c3?.title).toBe('Algebra Lecture 3');
      expect(c3?.batchName).toBe('—');
      expect(c3?.status).toBe('Not Taken');
    });

    it('passes date range filters (dateFrom, dateTo) to both assigned and completed classes queries', async () => {
      const gteSpy = vi.fn().mockReturnThis();
      const lteAssignedSpy = vi.fn().mockResolvedValue({
        data: [{ class_id: 'c-1' }, { class_id: 'c-2' }],
        error: null,
      });
      const lteCompletedSpy = vi.fn().mockResolvedValue({
        data: [{ class_id: 'c-1' }],
        error: null,
      });

      let callCount = 0;

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'teacher_details') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ teacher_id: 't-1', profiles: { name: 'Prof. Sharma', institute_id: instituteId } }],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'batch_subject_teachers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ batch_subjects: { batch_id: 'batch-1' } }],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_classes') {
          callCount++;
          const isCompletedQuery = callCount % 2 === 0;
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation(() => {
                  if (isCompletedQuery) {
                    return {
                      eq: vi.fn().mockReturnValue({
                        gte: gteSpy,
                        lte: lteCompletedSpy,
                      }),
                    };
                  }
                  return {
                    gte: gteSpy,
                    lte: lteAssignedSpy,
                  };
                }),
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

        return mockChain;
      });

      const filters = { dateFrom: '2026-09-01T00:00:00Z', dateTo: '2026-09-30T23:59:59Z' };
      const rows = await attendanceAnalyticsService.getAdminTeacherAttendance(instituteId, filters);

      expect(rows).toHaveLength(1);
      expect(rows[0].classesAssigned).toBe(2);
      expect(rows[0].classesTaken).toBe(1);
      expect(gteSpy).toHaveBeenCalledWith('scheduled_at', filters.dateFrom);
      expect(lteAssignedSpy).toHaveBeenCalledWith('scheduled_at', filters.dateTo);
      expect(lteCompletedSpy).toHaveBeenCalledWith('scheduled_at', filters.dateTo);
    });
  });
});
