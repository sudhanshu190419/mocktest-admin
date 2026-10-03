import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '../../attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('attendanceAnalyticsService Phase 3: getAdminBatchAttendance RPC consolidation', () => {
  const INSTITUTE_ID = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully fetches consolidated batch attendance via RPC in a single call', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [
        {
          batchId: 'batch-1',
          batchName: 'Morning Batch',
          studentCount: 15,
          averageAttendancePercent: 88,
          presentCount: 20,
          partialCount: 4,
          absentCount: 2,
        },
        {
          batchId: 'batch-2',
          batchName: 'Evening Batch',
          studentCount: 10,
          averageAttendancePercent: 75,
          presentCount: 12,
          partialCount: 2,
          absentCount: 4,
        },
      ],
      error: null,
    } as any);

    const result = await attendanceAnalyticsService.getAdminBatchAttendance(INSTITUTE_ID, {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      teacherId: 'teacher-uuid-1',
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_batch_attendance_summary', {
      p_institute_id: INSTITUTE_ID,
      p_date_from: '2026-09-01T00:00:00.000Z',
      p_date_to: '2026-09-30T23:59:59.999Z',
      p_teacher_id: 'teacher-uuid-1',
    });

    // Verify it did NOT make the 5 separate client-side table queries
    expect(supabase.from).not.toHaveBeenCalled();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      batchId: 'batch-1',
      batchName: 'Morning Batch',
      studentCount: 15,
      averageAttendancePercent: 88,
      presentCount: 20,
      partialCount: 4,
      absentCount: 2,
    });
  });

  it('handles empty filters gracefully with null values in RPC payload', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [],
      error: null,
    } as any);

    const result = await attendanceAnalyticsService.getAdminBatchAttendance(INSTITUTE_ID);

    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_batch_attendance_summary', {
      p_institute_id: INSTITUTE_ID,
      p_date_from: null,
      p_date_to: null,
      p_teacher_id: null,
    });

    expect(result).toEqual([]);
  });

  it('falls back to client-side 5-step query if the RPC fails', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'function get_admin_batch_attendance_summary does not exist' },
    } as any);

    // Mock the fallback query chain
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'batches') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ batch_id: 'batch-fallback', name: 'Fallback Batch' }],
            }),
          }),
        };
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ student_id: 'stu-1', batch_id: 'batch-fallback' }],
            }),
          }),
        };
      }
      if (table === 'batch_subject_live_classes' || table === 'live_class_batch') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [],
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    vi.mocked(supabase.from).mockImplementation(mockFrom as any);

    const result = await attendanceAnalyticsService.getAdminBatchAttendance(INSTITUTE_ID);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('batches');
    expect(result).toHaveLength(1);
    expect(result[0].batchName).toBe('Fallback Batch');
    expect(result[0].studentCount).toBe(1);
  });

  it('returns empty array when unhandled exception occurs', async () => {
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('Fatal network error'));
    vi.spyOn(attendanceAnalyticsService, '_getAdminBatchAttendanceFallback').mockRejectedValueOnce(
      new Error('Fallback also failed')
    );

    const result = await attendanceAnalyticsService.getAdminBatchAttendance(INSTITUTE_ID);
    expect(result).toEqual([]);
  });
});
