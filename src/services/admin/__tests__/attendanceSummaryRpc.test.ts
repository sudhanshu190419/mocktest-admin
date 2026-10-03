import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '../../attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('attendanceAnalyticsService Phase 3: getAdminSummary RPC consolidation & fallback', () => {
  const INSTITUTE_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully fetches consolidated attendance summary via RPC in a single call', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        totalStudents: 2228,
        totalLiveClasses: 51,
        overallAttendancePercent: 5,
        studentsBelowThreshold: 12,
      },
      error: null,
    } as any);

    const summary = await attendanceAnalyticsService.getAdminSummary(INSTITUTE_ID);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_attendance_summary', {
      p_institute_id: INSTITUTE_ID,
      p_threshold: 75,
    });

    // Verify it did NOT make separate client-side table queries
    expect(supabase.from).not.toHaveBeenCalled();

    expect(summary).toEqual({
      totalStudents: 2228,
      totalLiveClasses: 51,
      overallAttendancePercent: 5,
      studentsBelowThreshold: 12,
    });
  });

  it('falls back to client-side aggregation if the RPC returns an error', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'function get_admin_attendance_summary does not exist' },
    } as any);

    // Mock the fallback chain with Phase 3 expected attendance logic
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'student_details') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 's-1' }, { student_id: 's-2' }],
            }),
          }),
        };
      }
      if (table === 'live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' }],
              }),
            }),
          }),
        };
      }
      if (table === 'batches') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({
                data: [{ batch_id: 'b-1' }],
              }),
            }),
          }),
        };
      }
      if (table === 'batch_subject_live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ class_id: 'c-1', batch_subjects: { batch_id: 'b-1' } }],
              }),
            }),
          }),
        };
      }
      if (table === 'live_class_batch') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [],
              }),
            }),
          }),
        };
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { student_id: 's-1', batch_id: 'b-1', enrolled_on: '2026-07-01' },
                  { student_id: 's-2', batch_id: 'b-1', enrolled_on: '2026-07-01' },
                ],
              }),
            }),
          }),
        };
      }
      if (table === 'attendance') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { class_id: 'c-1', student_id: 's-1', attendance_status: 'present' },
                { class_id: 'c-1', student_id: 's-2', attendance_status: 'absent' },
              ],
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    });

    vi.mocked(supabase.from).mockImplementation(mockFrom as any);

    const summary = await attendanceAnalyticsService.getAdminSummary(INSTITUTE_ID);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('student_details');
    expect(supabase.from).toHaveBeenCalledWith('live_classes');
    expect(supabase.from).toHaveBeenCalledWith('batches');
    expect(supabase.from).toHaveBeenCalledWith('batch_students');
    expect(supabase.from).toHaveBeenCalledWith('attendance');

    expect(summary.totalStudents).toBe(2);
    expect(summary.totalLiveClasses).toBe(1);
    expect(summary.overallAttendancePercent).toBe(50);
    expect(summary.studentsBelowThreshold).toBe(1); // s-2 has 0% < 75%
  });

  it('returns zeroes gracefully without throwing when unhandled exceptions occur', async () => {
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('Network offline'));
    vi.spyOn(attendanceAnalyticsService, '_getAdminSummaryFallback').mockRejectedValueOnce(
      new Error('Fallback also failed')
    );

    const summary = await attendanceAnalyticsService.getAdminSummary(INSTITUTE_ID);

    expect(summary).toEqual({
      totalStudents: 0,
      totalLiveClasses: 0,
      overallAttendancePercent: 0,
      studentsBelowThreshold: 0,
    });
  });
});
