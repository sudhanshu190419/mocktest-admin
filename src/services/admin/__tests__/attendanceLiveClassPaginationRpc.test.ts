import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '../../attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('attendanceAnalyticsService Phase 2: getAdminLiveClassAttendance RPC & Pagination', () => {
  const INSTITUTE_ID = '44444444-4444-4444-4444-444444444444';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully fetches paginated live class attendance via RPC in a single call', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        classes: [
          {
            classId: 'class-1',
            date: '2026-09-30T10:00:00Z',
            durationMin: 60,
            title: 'Math Morning',
            teacherId: 'teacher-1',
            teacherName: 'Teacher Alpha',
            batchName: 'Morning Batch',
            totalStudents: 30,
            presentCount: 25,
            partialCount: 3,
            absentCount: 2,
          },
        ],
        total: 45,
        page: 2,
        pageSize: 10,
        totalPages: 5,
      },
      error: null,
    } as any);

    const result = await attendanceAnalyticsService.getAdminLiveClassAttendance(INSTITUTE_ID, {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      teacherId: 'teacher-1',
      batchId: 'batch-1',
      search: 'Math',
      page: 2,
      pageSize: 10,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_live_class_attendance_paginated', {
      p_institute_id: INSTITUTE_ID,
      p_page: 2,
      p_page_size: 10,
      p_date_from: '2026-09-01T00:00:00.000Z',
      p_date_to: '2026-09-30T23:59:59.999Z',
      p_teacher_id: 'teacher-1',
      p_batch_id: 'batch-1',
      p_search: 'Math',
    });

    // Verify it did NOT make the 7 individual client-side table queries
    expect(supabase.from).not.toHaveBeenCalled();

    expect(result.total).toBe(45);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(5);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]).toEqual({
      classId: 'class-1',
      date: '2026-09-30T10:00:00Z',
      durationMin: 60,
      title: 'Math Morning',
      teacherId: 'teacher-1',
      teacherName: 'Teacher Alpha',
      batchName: 'Morning Batch',
      totalStudents: 30,
      presentCount: 25,
      partialCount: 3,
      absentCount: 2,
    });
  });

  it('handles empty filters gracefully with null values in RPC payload and default page settings', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        classes: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      },
      error: null,
    } as any);

    const result = await attendanceAnalyticsService.getAdminLiveClassAttendance(INSTITUTE_ID);

    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_live_class_attendance_paginated', {
      p_institute_id: INSTITUTE_ID,
      p_page: 1,
      p_page_size: 10,
      p_date_from: null,
      p_date_to: null,
      p_teacher_id: null,
      p_batch_id: null,
      p_search: null,
    });

    expect(result.classes).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('falls back to client-side query and slices page results if the RPC fails', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'function get_admin_live_class_attendance_paginated does not exist' },
    } as any);

    const liveClasses = [
      { class_id: 'c-1', title: 'Physics 101', scheduled_at: '2026-09-10T10:00:00Z', duration_min: 60, teacher_id: 't-1' },
      { class_id: 'c-2', title: 'Chemistry 101', scheduled_at: '2026-09-11T10:00:00Z', duration_min: 60, teacher_id: 't-2' },
      { class_id: 'c-3', title: 'Biology 101', scheduled_at: '2026-09-12T10:00:00Z', duration_min: 60, teacher_id: 't-1' },
    ];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: liveClasses, error: null }),
              }),
            }),
          }),
        } as any;
      }
      if (table === 'teacher_details') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { teacher_id: 't-1', profiles: { name: 'Teacher One' } },
                { teacher_id: 't-2', profiles: { name: 'Teacher Two' } },
              ],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === 'batches') {
        return {
          select: vi.fn().mockResolvedValue({
            data: [{ batch_id: 'b-1', name: 'Batch Alpha' }],
            error: null,
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
              data: [
                { class_id: 'c-2', batch_id: 'b-1' },
                { class_id: 'c-3', batch_id: 'b-1' },
              ],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ student_id: 's-1', batch_id: 'b-1' }],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === 'attendance') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { class_id: 'c-1', student_id: 's-1', attendance_status: 'present' },
                { class_id: 'c-2', student_id: 's-1', attendance_status: 'partial' },
              ],
              error: null,
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    // Request page 1 with pageSize 2 (total 3 classes)
    const result = await attendanceAnalyticsService.getAdminLiveClassAttendance(INSTITUTE_ID, {
      page: 1,
      pageSize: 2,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('live_classes');

    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.totalPages).toBe(2);
    expect(result.classes).toHaveLength(2);
    expect(result.classes[0].classId).toBe('c-1');
    expect(result.classes[1].classId).toBe('c-2');
  });

  it('filters by search term in client-side fallback mode', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC not available' },
    } as any);

    const liveClasses = [
      { class_id: 'c-1', title: 'Calculus Advanced', scheduled_at: '2026-09-10T10:00:00Z', duration_min: 60, teacher_id: 't-1' },
      { class_id: 'c-2', title: 'Organic Chemistry', scheduled_at: '2026-09-11T10:00:00Z', duration_min: 60, teacher_id: 't-2' },
    ];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: liveClasses, error: null }),
              }),
            }),
          }),
        } as any;
      }
      if (table === 'teacher_details') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { teacher_id: 't-1', profiles: { name: 'Prof. Newton' } },
                { teacher_id: 't-2', profiles: { name: 'Prof. Curie' } },
              ],
              error: null,
            }),
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      } as any;
    });

    const result = await attendanceAnalyticsService.getAdminLiveClassAttendance(INSTITUTE_ID, {
      search: 'Newton',
    });

    expect(result.total).toBe(1);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].teacherName).toBe('Prof. Newton');
  });

  it('returns graceful empty structure on fatal network exception', async () => {
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('Fatal error'));
    vi.spyOn(attendanceAnalyticsService, '_getAdminLiveClassAttendanceFallback').mockRejectedValueOnce(
      new Error('Fallback also failed')
    );

    const result = await attendanceAnalyticsService.getAdminLiveClassAttendance(INSTITUTE_ID);
    expect(result).toEqual({
      classes: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
  });
});
