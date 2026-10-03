import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchManagementService } from '../batchManagementService';
import { adminKeys } from '@/hooks/admin/queryKeys';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('batchManagementService Optimization (Counts RPC & Student Count Aggregation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCounts (RPC consolidation)', () => {
    it('uses get_admin_batch_counts RPC to fetch consolidated counts in a single call', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: {
          total: 25,
          active: 15,
          inactive: 8,
          upcoming: 5,
          completed: 3,
          archived: 2,
          full: 4,
          availableSeats: 120,
        },
        error: null,
      } as any);

      const res = await batchManagementService.getCounts('inst-123');

      expect(supabase.rpc).toHaveBeenCalledWith('get_admin_batch_counts', {
        p_institute_id: 'inst-123',
      });
      // Should NOT query batches table when RPC succeeds
      expect(supabase.from).not.toHaveBeenCalled();

      expect(res.success).toBe(true);
      expect(res.data).toEqual({
        total: 25,
        active: 15,
        inactive: 8,
        archived: 2,
        full: 4,
        availableSeats: 120,
      });
    });

    it('falls back to _getCountsFallback when RPC fails or is missing', async () => {
      // Simulate RPC error (e.g. function does not exist during migration rollout)
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Function not found' },
      } as any);

      const createMockQuery = (resolvedValue: any) => {
        const query: any = {};
        query.select = vi.fn().mockReturnValue(query);
        query.eq = vi.fn().mockReturnValue(query);
        query.is = vi.fn().mockReturnValue(query);
        query.then = (onFulfilled: any) => Promise.resolve(resolvedValue).then(onFulfilled);
        return query;
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batches') {
          return createMockQuery({
            data: [
              { batch_id: 'b-1', max_seats: 50, student_count: [{ count: 50 }] },
              { batch_id: 'b-2', max_seats: 100, student_count: [{ count: 30 }] },
            ],
            count: 5,
            error: null,
          });
        }
        return {} as any;
      });

      const res = await batchManagementService.getCounts('inst-123');

      expect(supabase.rpc).toHaveBeenCalled();
      expect(supabase.from).toHaveBeenCalledWith('batches');
      expect(res.success).toBe(true);
      expect(res.data?.total).toBe(20); // active(5) + inactive(10) + archived(5)
    });
  });

  describe('getList (Student Count Aggregation)', () => {
    it('requests batch_students(count) aggregate and maps studentCount correctly without row transfer', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              batch_id: 'b-1',
              batch_code: 'CODE-1',
              name: 'Batch Alpha',
              stream_id: 's-1',
              streams: { name: 'Science' },
              max_seats: 50,
              status: 'active',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              batch_students: [{ count: 35 }],
            },
            {
              batch_id: 'b-2',
              batch_code: 'CODE-2',
              name: 'Batch Beta',
              stream_id: 's-2',
              streams: { name: 'Commerce' },
              max_seats: 40,
              status: 'active',
              created_at: '2026-01-02T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              batch_students: [{ count: 0 }],
            },
          ],
          count: 2,
          error: null,
        }),
      };

      const mockTeacherBuilder = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [
            {
              teacher_id: 't-1',
              batch_subjects: { batch_id: 'b-1' },
              teacher_details: { profiles: { name: 'Prof. John' } },
            },
          ],
          error: null,
        }),
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batches') return mockQueryBuilder as any;
        if (table === 'batch_subject_teachers') return mockTeacherBuilder as any;
        return {} as any;
      });

      const res = await batchManagementService.getList({ instituteId: 'inst-1' }, undefined, { page: 1, pageSize: 15 });

      expect(supabase.from).toHaveBeenCalledWith('batches');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        expect.stringContaining('batch_students!left (\n            count\n          )'),
        { count: 'exact' },
      );

      expect(res.success).toBe(true);
      expect(res.data?.data).toHaveLength(2);
      expect(res.data?.data[0].studentCount).toBe(35);
      expect(res.data?.data[0].availableSeats).toBe(15);
      expect(res.data?.data[0].teacherName).toBeNull();
      expect(supabase.from).not.toHaveBeenCalledWith('batch_subject_teachers');

      expect(res.data?.data[1].studentCount).toBe(0);
      expect(res.data?.data[1].availableSeats).toBe(40);
    });

    it('gracefully handles legacy array or scalar student count fallbacks', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              batch_id: 'b-3',
              batch_code: 'CODE-3',
              name: 'Batch Gamma',
              max_seats: 30,
              status: 'active',
              batch_students: [
                { student_id: 's-1', status: 'active' },
                { student_id: 's-2', status: 'active' },
                { student_id: 's-3', status: 'inactive' },
              ],
            },
          ],
          count: 1,
          error: null,
        }),
      };

      const mockTeacherBuilder = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batches') return mockQueryBuilder as any;
        if (table === 'batch_subject_teachers') return mockTeacherBuilder as any;
        return {} as any;
      });

      const res = await batchManagementService.getList(undefined, undefined, { page: 1, pageSize: 15 });

      expect(res.success).toBe(true);
      expect(res.data?.data[0].studentCount).toBe(2);
      expect(res.data?.data[0].availableSeats).toBe(28);
    });
  });
});
