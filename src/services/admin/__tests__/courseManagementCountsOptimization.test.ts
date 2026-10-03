import { describe, it, expect, vi, beforeEach } from 'vitest';
import { courseManagementService } from '../courseManagementService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('courseManagementService.getCounts (Phase 1 RPC Consolidation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses get_admin_course_counts RPC to fetch consolidated counts in a single call', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 42,
        draft: 10,
        pending_approval: 5,
        pendingApproval: 5,
        approved: 7,
        published: 18,
        archived: 2,
      },
      error: null,
    } as any);

    const res = await courseManagementService.getCounts('inst-123');

    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_course_counts', {
      p_institute_id: 'inst-123',
    });
    // Should NOT query courses table directly when RPC succeeds
    expect(supabase.from).not.toHaveBeenCalled();

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      total: 42,
      draft: 10,
      pendingApproval: 5,
      approved: 7,
      published: 18,
      archived: 2,
    });
  });

  it('correctly passes null instituteId when queried platform-wide', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 100,
        draft: 20,
        pending_approval: 10,
        approved: 15,
        published: 50,
        archived: 5,
      },
      error: null,
    } as any);

    const res = await courseManagementService.getCounts(null);

    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_course_counts', {
      p_institute_id: null,
    });
    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(100);
    expect(res.data?.pendingApproval).toBe(10);
  });

  it('falls back to _getCountsFallback when RPC fails or is missing', async () => {
    // Simulate RPC error (e.g. function does not exist during migration rollout)
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Function not found' },
    } as any);

    const createMockQuery = (resolvedCount: number) => {
      const query: any = {};
      query.select = vi.fn().mockReturnValue(query);
      query.eq = vi.fn().mockReturnValue(query);
      query.is = vi.fn().mockReturnValue(query);
      query.then = (onFulfilled: any) => Promise.resolve({ count: resolvedCount, error: null }).then(onFulfilled);
      return query;
    };

    let callCount = 0;
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'courses') {
        callCount++;
        // draft (4), pending_approval (2), approved (3), published (10), archived (1)
        const counts = [4, 2, 3, 10, 1];
        return createMockQuery(counts[(callCount - 1) % counts.length]);
      }
      return {} as any;
    });

    const res = await courseManagementService.getCounts('inst-123');

    expect(supabase.rpc).toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith('courses');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      total: 20,
      draft: 4,
      pendingApproval: 2,
      approved: 3,
      published: 10,
      archived: 1,
    });
  });
});
