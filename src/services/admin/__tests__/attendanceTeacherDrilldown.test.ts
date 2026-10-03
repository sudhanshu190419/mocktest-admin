import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '@/services/attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('attendanceAnalyticsService: Teacher Drill-Down (Batches & Classes)', () => {
  const instituteId = 'inst-1111-2222-3333-444444444444';
  const teacherId = 't-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAdminTeacherBatches (Level 2 drill-down)', () => {
    it('returns batches assigned to teacher with classesAssigned, classesTaken, and classesNotTaken counts', async () => {
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batch_subject_teachers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { batch_subjects: { batch_id: 'b-1', batches: { batch_id: 'b-1', name: 'Morning Batch' } } },
                  { batch_subjects: { batch_id: 'b-2', batches: { batch_id: 'b-2', name: 'Evening Batch' } } },
                ],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { class_id: 'c-1', status: 'completed' },
                    { class_id: 'c-2', status: 'scheduled' },
                    { class_id: 'c-3', status: 'completed' },
                    { class_id: 'c-4', status: 'cancelled' },
                  ],
                  error: null,
                }),
              }),
            }),
          } as any;
        }

        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  { class_id: 'c-1', batch_subjects: { batch_id: 'b-1' } },
                  { class_id: 'c-2', batch_subjects: { batch_id: 'b-1' } },
                ],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_class_batch') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  { class_id: 'c-3', batch_id: 'b-2' },
                ],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'batches') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { batch_id: 'b-1', name: 'Morning Batch' },
                  { batch_id: 'b-2', name: 'Evening Batch' },
                ],
                error: null,
              }),
            }),
          } as any;
        }

        return {} as any;
      });

      const batches = await attendanceAnalyticsService.getAdminTeacherBatches(instituteId, teacherId);

      // We have 2 batches + 1 unassigned item (c-4 has no batch link)
      expect(batches).toHaveLength(3);

      const morning = batches.find(b => b.batchId === 'b-1');
      expect(morning).toBeDefined();
      expect(morning?.batchName).toBe('Morning Batch');
      expect(morning?.classesAssigned).toBe(2);
      expect(morning?.classesTaken).toBe(1);
      expect(morning?.classesNotTaken).toBe(1);

      const evening = batches.find(b => b.batchId === 'b-2');
      expect(evening).toBeDefined();
      expect(evening?.batchName).toBe('Evening Batch');
      expect(evening?.classesAssigned).toBe(1);
      expect(evening?.classesTaken).toBe(1);
      expect(evening?.classesNotTaken).toBe(0);

      const unassigned = batches.find(b => b.batchId === 'unassigned');
      expect(unassigned).toBeDefined();
      expect(unassigned?.classesAssigned).toBe(1);
      expect(unassigned?.classesTaken).toBe(0);
      expect(unassigned?.classesNotTaken).toBe(1);
    });

    it('passes date range filters (dateFrom, dateTo) when querying live_classes', async () => {
      const gteSpy = vi.fn().mockReturnThis();
      const lteSpy = vi.fn().mockResolvedValue({
        data: [{ class_id: 'c-1', status: 'completed' }],
        error: null,
      });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batch_subject_teachers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          } as any;
        }

        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gte: gteSpy,
                  lte: lteSpy,
                }),
              }),
            }),
          } as any;
        }

        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      });

      const filters = { dateFrom: '2026-09-01T00:00:00Z', dateTo: '2026-09-30T23:59:59Z' };
      await attendanceAnalyticsService.getAdminTeacherBatches(instituteId, teacherId, filters);

      expect(gteSpy).toHaveBeenCalledWith('scheduled_at', filters.dateFrom);
      expect(lteSpy).toHaveBeenCalledWith('scheduled_at', filters.dateTo);
    });
  });

  describe('getAdminTeacherBatchClasses (Level 3 drill-down)', () => {
    it('returns paginated classes for a teacher and batch with Taken / Not Taken status', async () => {
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { class_id: 'c-1', batch_subjects: { batch_id: 'b-1' } },
                  { class_id: 'c-2', batch_subjects: { batch_id: 'b-1' } },
                ],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_class_batch') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      range: vi.fn().mockResolvedValue({
                        data: [
                          { class_id: 'c-1', title: 'Calculus Lecture 1', scheduled_at: '2026-09-10T10:00:00Z', duration_min: 60, status: 'completed' },
                          { class_id: 'c-2', title: 'Calculus Lecture 2', scheduled_at: '2026-09-12T10:00:00Z', duration_min: 60, status: 'scheduled' },
                        ],
                        count: 2,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          } as any;
        }

        return {} as any;
      });

      const result = await attendanceAnalyticsService.getAdminTeacherBatchClasses(
        instituteId,
        teacherId,
        'b-1',
        { page: 1, pageSize: 10 }
      );

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.classes).toHaveLength(2);

      const c1 = result.classes.find(c => c.classId === 'c-1');
      expect(c1).toBeDefined();
      expect(c1?.title).toBe('Calculus Lecture 1');
      expect(c1?.status).toBe('Taken');

      const c2 = result.classes.find(c => c.classId === 'c-2');
      expect(c2).toBeDefined();
      expect(c2?.title).toBe('Calculus Lecture 2');
      expect(c2?.status).toBe('Not Taken');
    });

    it('handles unassigned classes properly when batchId is unassigned', async () => {
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      { class_id: 'c-linked', title: 'Linked Class', scheduled_at: '2026-09-01T10:00:00Z', duration_min: 60, status: 'completed' },
                      { class_id: 'c-standalone', title: 'Standalone Class', scheduled_at: '2026-09-02T10:00:00Z', duration_min: 60, status: 'completed' },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          } as any;
        }

        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ class_id: 'c-linked' }],
                error: null,
              }),
            }),
          } as any;
        }

        if (table === 'live_class_batch') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          } as any;
        }

        return {} as any;
      });

      const result = await attendanceAnalyticsService.getAdminTeacherBatchClasses(
        instituteId,
        teacherId,
        'unassigned',
        { page: 1, pageSize: 10 }
      );

      expect(result.total).toBe(1);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].classId).toBe('c-standalone');
      expect(result.classes[0].title).toBe('Standalone Class');
      expect(result.classes[0].status).toBe('Taken');
    });
  });
});
