import { describe, it, expect, vi, beforeEach } from 'vitest';
import { studentLifecycleService } from '../studentLifecycleService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('studentLifecycleService.getCounts (Phase 1 RPC Consolidation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully fetches and maps consolidated student counts for Super Admin (null instituteId)', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 2231,
        totalStudents: 2231,
        pending: 0,
        approved: 2229,
        rejected: 0,
        suspended: 0,
        inactive: 2,
      },
      error: null,
    } as any);

    const res = await studentLifecycleService.getCounts();

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_student_lifecycle_counts', {
      p_institute_id: null,
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      total: 2231,
      totalStudents: 2231,
      pending: 0,
      approved: 2229,
      rejected: 0,
      suspended: 0,
      inactive: 2,
    });
  });

  it('successfully passes instituteId when provided for Institute Admin scope', async () => {
    const instituteId = '33333333-3333-3333-3333-333333333333';
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 100,
        totalStudents: 100,
        pending: 10,
        approved: 85,
        rejected: 2,
        suspended: 2,
        inactive: 1,
      },
      error: null,
    } as any);

    const res = await studentLifecycleService.getCounts(instituteId);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_student_lifecycle_counts', {
      p_institute_id: instituteId,
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      total: 100,
      totalStudents: 100,
      pending: 10,
      approved: 85,
      rejected: 2,
      suspended: 2,
      inactive: 1,
    });
  });

  it('correctly calculates total and totalStudents if total is missing or 0 in RPC return', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        total: 0,
        pending: 5,
        approved: 20,
        rejected: 2,
        suspended: 1,
        inactive: 2,
      },
      error: null,
    } as any);

    const res = await studentLifecycleService.getCounts();

    expect(res.success).toBe(true);
    expect(res.data?.total).toBe(30);
    expect(res.data?.totalStudents).toBe(30);
    expect(res.data?.approved).toBe(20);
  });

  it('surfaces RPC errors cleanly without throwing unhandled exceptions', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'Forbidden: only administrators can access student lifecycle counts.' },
    } as any);

    const res = await studentLifecycleService.getCounts();

    expect(res.success).toBe(false);
    expect(res.error).toBe('Forbidden: only administrators can access student lifecycle counts.');
  });
});
