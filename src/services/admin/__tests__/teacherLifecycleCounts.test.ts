import { describe, it, expect, vi, beforeEach } from 'vitest';
import { teacherLifecycleService } from '../teacherLifecycleService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('teacherLifecycleService.getCounts (Phase 1 RPC Consolidation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully fetches and maps consolidated teacher counts for Super Admin (null instituteId)', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 12,
        pending: 1,
        approved: 8,
        rejected: 1,
        suspended: 1,
        inactive: 1,
      },
      error: null,
    } as any);

    const res = await teacherLifecycleService.getCounts();

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_teacher_lifecycle_counts', {
      p_institute_id: null,
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      total: 12,
      pending: 1,
      approved: 8,
      rejected: 1,
      suspended: 1,
      inactive: 1,
    });
  });

  it('successfully passes instituteId when provided for Institute Admin scope', async () => {
    const instituteId = '33333333-3333-3333-3333-333333333333';
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 5,
        pending: 2,
        approved: 3,
        rejected: 0,
        suspended: 0,
        inactive: 0,
      },
      error: null,
    } as any);

    const res = await teacherLifecycleService.getCounts(instituteId);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_teacher_lifecycle_counts', {
      p_institute_id: instituteId,
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      total: 5,
      pending: 2,
      approved: 3,
      rejected: 0,
      suspended: 0,
      inactive: 0,
    });
  });

  it('correctly calculates total if total is missing or 0 in RPC return', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 0,
        pending: 2,
        approved: 5,
        rejected: 1,
        suspended: 1,
        inactive: 1,
      },
      error: null,
    } as any);

    const res = await teacherLifecycleService.getCounts();

    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(10);
    expect(res.data?.approved).toBe(5);
  });

  it('surfaces RPC errors cleanly without throwing unhandled exceptions', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'Forbidden: only administrators can access teacher lifecycle counts.' },
    } as any);

    const res = await teacherLifecycleService.getCounts();

    expect(res.success).toBe(false);
    expect(res.error).toBe('Forbidden: only administrators can access teacher lifecycle counts.');
  });
});
