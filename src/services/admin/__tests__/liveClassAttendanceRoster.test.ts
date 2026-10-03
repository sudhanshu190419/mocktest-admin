import { describe, it, expect, vi, beforeEach } from 'vitest';
import { liveClassAttendanceService } from '@/services/liveClassAttendanceService';
import { supabase } from '@/config/supabase';

// Mock Supabase
vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('liveClassAttendanceService.getClassAttendance - Unified Roster Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves expected absent students for classes linked ONLY via live_class_batch', async () => {
    const classId = 'class-lcb-only';

    // Existing physical attendance row: Student A attended and is present
    const mockAttendance = [
      {
        attendance_id: 'att-1',
        class_id: classId,
        student_id: 'stu-a',
        institute_id: 'inst-1',
        joined_at: '2026-09-30T10:00:00Z',
        left_at: '2026-09-30T11:00:00Z',
        duration_seconds: 3600,
        attendance_status: 'present',
        join_count: 1,
        is_manual_override: false,
        override_by: null,
        override_reason: null,
        created_at: '2026-09-30T10:00:00Z',
        updated_at: '2026-09-30T11:00:00Z',
        student_details: {
          profiles: { name: 'Alice Present' },
        },
      },
    ];

    // BSLC returns empty
    const mockBslc: any[] = [];

    // LCB returns batch-morning
    const mockLcb = [{ batch_id: 'batch-morning' }];

    // Batch students has Student A (attended) and Student B (did not attend)
    const mockBatchStudents = [
      {
        student_id: 'stu-a',
        status: 'active',
        student_details: {
          institute_id: 'inst-1',
          profiles: { name: 'Alice Present' },
        },
      },
      {
        student_id: 'stu-b',
        status: 'active',
        student_details: {
          institute_id: 'inst-1',
          profiles: { name: 'Bob Absent' },
        },
      },
    ];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'attendance') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockAttendance, error: null }),
            }),
          }),
        } as any;
      }
      if (table === 'batch_subject_live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockBslc, error: null }),
          }),
        } as any;
      }
      if (table === 'live_class_batch') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockLcb, error: null }),
          }),
        } as any;
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockBatchStudents, error: null }),
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const roster = await liveClassAttendanceService.getClassAttendance(classId);

    expect(roster).toHaveLength(2);

    // Alice: Present with 3600s
    const alice = roster.find((r) => r.studentId === 'stu-a');
    expect(alice).toBeDefined();
    expect(alice?.studentName).toBe('Alice Present');
    expect(alice?.attendanceStatus).toBe('present');
    expect(alice?.durationSeconds).toBe(3600);
    expect(alice?.attendanceId).toBe('att-1');

    // Bob: Synthetic Absent with 0s duration
    const bob = roster.find((r) => r.studentId === 'stu-b');
    expect(bob).toBeDefined();
    expect(bob?.studentName).toBe('Bob Absent');
    expect(bob?.attendanceStatus).toBe('absent');
    expect(bob?.durationSeconds).toBe(0);
    expect(bob?.joinCount).toBe(0);
    expect(bob?.attendanceId).toBe('synthetic-stu-b');
  });

  it('resolves expected absent students for classes linked ONLY via batch_subject_live_classes', async () => {
    const classId = 'class-bslc-only';

    const mockAttendance = [
      {
        attendance_id: 'att-2',
        class_id: classId,
        student_id: 'stu-c',
        institute_id: 'inst-1',
        joined_at: '2026-09-30T10:00:00Z',
        left_at: '2026-09-30T10:30:00Z',
        duration_seconds: 1800,
        attendance_status: 'partial',
        join_count: 1,
        student_details: {
          profiles: { name: 'Charlie Partial' },
        },
      },
    ];

    const mockBslc = [
      {
        batch_subject_id: 'bs-1',
        batch_subjects: { batch_id: 'batch-testtt' },
      },
    ];

    const mockLcb: any[] = [];

    const mockBatchStudents = [
      {
        student_id: 'stu-c',
        status: 'active',
        student_details: {
          institute_id: 'inst-1',
          profiles: { name: 'Charlie Partial' },
        },
      },
      {
        student_id: 'stu-d',
        status: 'active',
        student_details: {
          institute_id: 'inst-1',
          profiles: { name: 'Diana Absent' },
        },
      },
    ];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'attendance') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockAttendance, error: null }),
            }),
          }),
        } as any;
      }
      if (table === 'batch_subject_live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockBslc, error: null }),
          }),
        } as any;
      }
      if (table === 'live_class_batch') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockLcb, error: null }),
          }),
        } as any;
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockBatchStudents, error: null }),
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const roster = await liveClassAttendanceService.getClassAttendance(classId);

    expect(roster).toHaveLength(2);

    const charlie = roster.find((r) => r.studentId === 'stu-c');
    expect(charlie).toBeDefined();
    expect(charlie?.attendanceStatus).toBe('partial');
    expect(charlie?.durationSeconds).toBe(1800);

    const diana = roster.find((r) => r.studentId === 'stu-d');
    expect(diana).toBeDefined();
    expect(diana?.attendanceStatus).toBe('absent');
    expect(diana?.durationSeconds).toBe(0);
  });

  it('deduplicates batch IDs and students when class is linked through BOTH paths and students overlap', async () => {
    const classId = 'class-dual';

    const mockAttendance: any[] = [];

    // Both paths link to batch-1 and batch-2
    const mockBslc = [
      { batch_subject_id: 'bs-1', batch_subjects: { batch_id: 'batch-1' } },
    ];
    const mockLcb = [
      { batch_id: 'batch-1' }, // Overlapping batch
      { batch_id: 'batch-2' },
    ];

    // Student 1 is in both batch-1 and batch-2
    // Student 2 is only in batch-2
    const mockBatchStudents = [
      {
        student_id: 'stu-1',
        status: 'active',
        student_details: {
          institute_id: 'inst-1',
          profiles: { name: 'Student One' },
        },
      },
      {
        student_id: 'stu-1', // Duplicated because enrolled in both batches
        status: 'active',
        student_details: {
          institute_id: 'inst-1',
          profiles: { name: 'Student One' },
        },
      },
      {
        student_id: 'stu-2',
        status: 'active',
        student_details: {
          institute_id: 'inst-1',
          profiles: { name: 'Student Two' },
        },
      },
    ];

    let batchInQuery: string[] = [];
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'attendance') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockAttendance, error: null }),
            }),
          }),
        } as any;
      }
      if (table === 'batch_subject_live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockBslc, error: null }),
          }),
        } as any;
      }
      if (table === 'live_class_batch') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockLcb, error: null }),
          }),
        } as any;
      }
      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation((col: string, batches: string[]) => {
              batchInQuery = batches;
              return {
                eq: vi.fn().mockResolvedValue({ data: mockBatchStudents, error: null }),
              };
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const roster = await liveClassAttendanceService.getClassAttendance(classId);

    // Batches queried should be deduplicated: ['batch-1', 'batch-2']
    expect(batchInQuery).toHaveLength(2);
    expect(batchInQuery).toContain('batch-1');
    expect(batchInQuery).toContain('batch-2');

    // Students returned should be exactly 2 (Student 1 and Student 2), not 3!
    expect(roster).toHaveLength(2);
    expect(roster.map((r) => r.studentId)).toEqual(['stu-1', 'stu-2']);
    expect(roster[0].attendanceStatus).toBe('absent');
    expect(roster[1].attendanceStatus).toBe('absent');
  });

  it('filters out non-active batch_students and handles empty batches gracefully', async () => {
    const classId = 'class-no-batches';

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'attendance') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        } as any;
      }
      if (table === 'batch_subject_live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      if (table === 'live_class_batch') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      return {} as any;
    });

    const roster = await liveClassAttendanceService.getClassAttendance(classId);
    expect(roster).toEqual([]);
  });
});
