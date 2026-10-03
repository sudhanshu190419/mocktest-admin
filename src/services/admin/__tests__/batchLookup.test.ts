import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchManagementService } from '../batchManagementService';
import { adminKeys } from '@/hooks/admin/queryKeys';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('batchManagementService.getBatchLookup (Phase 3 Batch Filter Optimization)', () => {
  let mockChain: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChain = {
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { batch_id: 'batch-1', name: 'Alpha Batch' },
          { batch_id: 'batch-2', name: 'Beta Batch' },
        ],
        error: null,
      }),
    };

    vi.mocked(supabase.from).mockReturnValue(mockChain as any);
  });

  it('fetches lightweight non-deleted batches with only batch_id and name', async () => {
    const res = await batchManagementService.getBatchLookup();

    expect(supabase.from).toHaveBeenCalledWith('batches');
    expect(mockChain.select).toHaveBeenCalledWith('batch_id, name');
    expect(mockChain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(mockChain.order).toHaveBeenCalledWith('name', { ascending: true });
    expect(mockChain.eq).not.toHaveBeenCalled();

    // Verify batch_subject_teachers is NEVER queried
    expect(supabase.from).not.toHaveBeenCalledWith('batch_subject_teachers');

    expect(res.success).toBe(true);
    expect(res.data).toEqual([
      { batchId: 'batch-1', batchName: 'Alpha Batch' },
      { batchId: 'batch-2', batchName: 'Beta Batch' },
    ]);
  });

  it('applies institute scoping when instituteId is provided', async () => {
    const instituteId = 'inst-uuid-123';
    // When eq is called, it returns mockChain which chain-resolves order
    mockChain.eq.mockReturnValue(mockChain);

    const res = await batchManagementService.getBatchLookup(instituteId);

    expect(supabase.from).toHaveBeenCalledWith('batches');
    expect(mockChain.select).toHaveBeenCalledWith('batch_id, name');
    expect(mockChain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(mockChain.eq).toHaveBeenCalledWith('institute_id', instituteId);
    expect(mockChain.order).toHaveBeenCalledWith('name', { ascending: true });

    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2);
  });

  it('handles database errors gracefully without throwing', async () => {
    mockChain.order.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database connection failure' },
    });

    const res = await batchManagementService.getBatchLookup();

    expect(res.success).toBe(false);
    expect(res.error).toBe('Database connection failure');
  });

  it('maintains expected query key structure in adminKeys.batchManagement.lookup', () => {
    expect(adminKeys.batchManagement.lookup()).toEqual([
      'admin',
      'batchManagement',
      'lookup',
      undefined,
    ]);

    expect(adminKeys.batchManagement.lookup('inst-abc')).toEqual([
      'admin',
      'batchManagement',
      'lookup',
      'inst-abc',
    ]);
  });
});
