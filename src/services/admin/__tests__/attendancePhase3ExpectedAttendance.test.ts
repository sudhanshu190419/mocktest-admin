import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '../../attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('Attendance Phase 3: Expected Attendance Business Logic Validation', () => {
  const INSTITUTE_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to setup mock database tables
  function setupDbMocks(config: {
    students?: Array<{ student_id: string }>;
    classes?: Array<{ class_id: string; scheduled_at: string; institute_id?: string; status?: string }>;
    batches?: Array<{ batch_id: string; institute_id?: string; deleted_at?: string | null }>;
    bslc?: Array<{ class_id: string; batch_subjects: { batch_id: string } | Array<{ batch_id: string }> }>;
    directLinks?: Array<{ class_id: string; batch_id: string }>;
    batchStudents?: Array<{ student_id: string; batch_id: string; enrolled_on: string; status?: string }>;
    attendance?: Array<{ class_id: string; student_id: string; attendance_status: string }>;
  }) {
    const {
      students = [],
      classes = [],
      batches = [],
      bslc = [],
      directLinks = [],
      batchStudents = [],
      attendance = [],
    } = config;

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'student_details') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              const filtered = students;
              return Promise.resolve({ data: filtered, error: null });
            }),
          }),
        } as any;
      }

      if (table === 'live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((col1: string, val1: string) => ({
              eq: vi.fn().mockImplementation((col2: string, val2: string) => {
                const filtered = classes.filter(
                  (c) => (!c.institute_id || c.institute_id === val1) && (!c.status || c.status === val2)
                );
                return Promise.resolve({ data: filtered, error: null });
              }),
            })),
          }),
        } as any;
      }

      if (table === 'batches') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockImplementation((col: string, val: any) => {
                const filtered = batches.filter((b) => b.deleted_at === val);
                return Promise.resolve({ data: filtered, error: null });
              }),
            }),
          }),
        } as any;
      }

      if (table === 'batch_subject_live_classes') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              in: vi.fn().mockImplementation((col: string, vals: string[]) => {
                const filtered = bslc.filter((l) => vals.includes(l.class_id));
                return Promise.resolve({ data: filtered, error: null });
              }),
            }),
          }),
        } as any;
      }

      if (table === 'live_class_batch') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              in: vi.fn().mockImplementation((col: string, vals: string[]) => {
                const filtered = directLinks.filter((l) => vals.includes(l.class_id));
                return Promise.resolve({ data: filtered, error: null });
              }),
            }),
          }),
        } as any;
      }

      if (table === 'batch_students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                const filtered = batchStudents.filter((bs) => (bs.status ?? 'active') === val);
                return Promise.resolve({ data: filtered, error: null });
              }),
            }),
          }),
        } as any;
      }

      if (table === 'attendance') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockImplementation((col: string, vals: string[]) => {
              const filtered = attendance.filter((a) => vals.includes(a.class_id));
              return Promise.resolve({ data: filtered, error: null });
            }),
          }),
        } as any;
      }

      return { select: vi.fn().mockReturnThis() } as any;
    });
  }

  // 1. Missing attendance row -> absent
  it('1. treats missing attendance records as absent', async () => {
    setupDbMocks({
      students: [{ student_id: 's-1' }, { student_id: 's-2' }],
      classes: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z', institute_id: INSTITUTE_ID, status: 'completed' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      directLinks: [{ class_id: 'c-1', batch_id: 'b-1' }],
      batchStudents: [
        { student_id: 's-1', batch_id: 'b-1', enrolled_on: '2026-07-01' },
        { student_id: 's-2', batch_id: 'b-1', enrolled_on: '2026-07-01' },
      ],
      // s-1 is present, s-2 has NO attendance record
      attendance: [{ class_id: 'c-1', student_id: 's-1', attendance_status: 'present' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    // Total expected: 2 (s-1, s-2)
    // s-1: present (100)
    // s-2: missing -> absent (0)
    // Overall = (100 + 0) / 2 = 50%
    expect(res.overallAttendancePercent).toBe(50);
    // s-2 has 0% < 75% -> below threshold
    expect(res.studentsBelowThreshold).toBe(1);
  });

  // 2. Present -> 100%
  it('2. evaluates present records as 100%', async () => {
    setupDbMocks({
      students: [{ student_id: 's-1' }],
      classes: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      directLinks: [{ class_id: 'c-1', batch_id: 'b-1' }],
      batchStudents: [{ student_id: 's-1', batch_id: 'b-1', enrolled_on: '2026-07-01' }],
      attendance: [{ class_id: 'c-1', student_id: 's-1', attendance_status: 'present' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    expect(res.overallAttendancePercent).toBe(100);
    expect(res.studentsBelowThreshold).toBe(0);
  });

  // 3. Partial -> 50%
  it('3. evaluates partial records as 50%', async () => {
    setupDbMocks({
      students: [{ student_id: 's-1' }],
      classes: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      directLinks: [{ class_id: 'c-1', batch_id: 'b-1' }],
      batchStudents: [{ student_id: 's-1', batch_id: 'b-1', enrolled_on: '2026-07-01' }],
      attendance: [{ class_id: 'c-1', student_id: 's-1', attendance_status: 'partial' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    expect(res.overallAttendancePercent).toBe(50);
    // 50% < 75% -> below threshold
    expect(res.studentsBelowThreshold).toBe(1);
  });

  // 4. Student joined after class -> excluded
  it('4. excludes students who enrolled after the scheduled class date', async () => {
    setupDbMocks({
      students: [{ student_id: 's-early' }, { student_id: 's-late' }],
      classes: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      directLinks: [{ class_id: 'c-1', batch_id: 'b-1' }],
      batchStudents: [
        { student_id: 's-early', batch_id: 'b-1', enrolled_on: '2026-07-15' },
        { student_id: 's-late', batch_id: 'b-1', enrolled_on: '2026-08-05' }, // Enrolled AFTER class
      ],
      attendance: [{ class_id: 'c-1', student_id: 's-early', attendance_status: 'present' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    // Only s-early was expected for c-1. Total expected = 1.
    // Overall = 100 / 1 = 100%
    expect(res.overallAttendancePercent).toBe(100);
    // s-late had 0 expected opportunities, so s-late is NOT below threshold.
    expect(res.studentsBelowThreshold).toBe(0);
  });

  // 5. Student with expected class but no attendance -> 0%
  it('5. evaluates student with expected class but no attendance records as 0%', async () => {
    setupDbMocks({
      students: [{ student_id: 's-absent' }],
      classes: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      directLinks: [{ class_id: 'c-1', batch_id: 'b-1' }],
      batchStudents: [{ student_id: 's-absent', batch_id: 'b-1', enrolled_on: '2026-07-01' }],
      attendance: [], // No attendance row
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    expect(res.overallAttendancePercent).toBe(0);
    expect(res.studentsBelowThreshold).toBe(1);
  });

  // 6. Same class through both relationship paths -> one opportunity
  it('6. deduplicates classes linked via both live_class_batch AND batch_subject_live_classes', async () => {
    setupDbMocks({
      students: [{ student_id: 's-1' }],
      classes: [{ class_id: 'c-dual', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      // Linked via both tables
      directLinks: [{ class_id: 'c-dual', batch_id: 'b-1' }],
      bslc: [{ class_id: 'c-dual', batch_subjects: { batch_id: 'b-1' } }],
      batchStudents: [{ student_id: 's-1', batch_id: 'b-1', enrolled_on: '2026-07-01' }],
      attendance: [{ class_id: 'c-dual', student_id: 's-1', attendance_status: 'present' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    // Must only count as 1 expected opportunity, not 2
    expect(res.overallAttendancePercent).toBe(100);
    expect(res.studentsBelowThreshold).toBe(0);
  });

  // 7. Student enrolled in multiple batches containing same class -> one institute-level opportunity
  it('7. deduplicates expected pairs when a student is in multiple batches containing the same class', async () => {
    setupDbMocks({
      students: [{ student_id: 's-multi' }],
      classes: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [
        { batch_id: 'b-1', deleted_at: null },
        { batch_id: 'b-2', deleted_at: null },
      ],
      // c-1 is in both batches
      directLinks: [
        { class_id: 'c-1', batch_id: 'b-1' },
        { class_id: 'c-1', batch_id: 'b-2' },
      ],
      // Student is enrolled in both batches
      batchStudents: [
        { student_id: 's-multi', batch_id: 'b-1', enrolled_on: '2026-07-01' },
        { student_id: 's-multi', batch_id: 'b-2', enrolled_on: '2026-07-01' },
      ],
      attendance: [{ class_id: 'c-1', student_id: 's-multi', attendance_status: 'present' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    // Student should have 1 opportunity, not 2
    expect(res.overallAttendancePercent).toBe(100);
    expect(res.studentsBelowThreshold).toBe(0);
  });

  // 8. Batch with zero completed classes -> zero expected opportunities
  it('8. contributes zero expected opportunities if a batch has students but no completed classes', async () => {
    setupDbMocks({
      students: [{ student_id: 's-in-idle-batch' }],
      classes: [], // Zero completed classes
      batches: [{ batch_id: 'b-idle', deleted_at: null }],
      batchStudents: [{ student_id: 's-in-idle-batch', batch_id: 'b-idle', enrolled_on: '2026-07-01' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    expect(res.totalStudents).toBe(1);
    expect(res.totalLiveClasses).toBe(0);
    expect(res.overallAttendancePercent).toBe(0);
    expect(res.studentsBelowThreshold).toBe(0);
  });

  // 9. Class without batch mapping -> excluded
  it('9. excludes completed classes that have no valid batch mapping', async () => {
    setupDbMocks({
      students: [{ student_id: 's-1' }],
      classes: [{ class_id: 'c-orphan', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      // No links in directLinks or bslc
      directLinks: [],
      bslc: [],
      batchStudents: [{ student_id: 's-1', batch_id: 'b-1', enrolled_on: '2026-07-01' }],
      attendance: [],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    expect(res.totalLiveClasses).toBe(1); // Preserves completed class count
    expect(res.overallAttendancePercent).toBe(0); // 0 expected opportunities
    expect(res.studentsBelowThreshold).toBe(0); // 0 students with expected opportunities
  });

  // 10. Student with zero expected opportunities -> excluded from threshold calculation
  it('10. excludes students with zero expected opportunities from below-threshold count', async () => {
    setupDbMocks({
      students: [
        { student_id: 's-active-expected' },
        { student_id: 's-not-in-batch' },
        { student_id: 's-joined-after-class' },
      ],
      classes: [{ class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' }],
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      directLinks: [{ class_id: 'c-1', batch_id: 'b-1' }],
      batchStudents: [
        { student_id: 's-active-expected', batch_id: 'b-1', enrolled_on: '2026-07-01' },
        // s-not-in-batch is not in batch_students
        { student_id: 's-joined-after-class', batch_id: 'b-1', enrolled_on: '2026-08-10' },
      ],
      attendance: [{ class_id: 'c-1', student_id: 's-active-expected', attendance_status: 'present' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    expect(res.totalStudents).toBe(3);
    expect(res.overallAttendancePercent).toBe(100);
    // Only s-active-expected has expected opportunities and is at 100% (>= 75%).
    // s-not-in-batch and s-joined-after-class have 0 expected opportunities, so must NOT be counted below threshold.
    expect(res.studentsBelowThreshold).toBe(0);
  });

  // 11. Institute isolation
  it('11. enforces institute isolation across classes and students', async () => {
    setupDbMocks({
      students: [{ student_id: 's-current-inst' }],
      classes: [{ class_id: 'c-current', scheduled_at: '2026-08-01T10:00:00Z', institute_id: INSTITUTE_ID, status: 'completed' }],
      batches: [{ batch_id: 'b-current', institute_id: INSTITUTE_ID, deleted_at: null }],
      directLinks: [{ class_id: 'c-current', batch_id: 'b-current' }],
      batchStudents: [{ student_id: 's-current-inst', batch_id: 'b-current', enrolled_on: '2026-07-01' }],
      attendance: [{ class_id: 'c-current', student_id: 's-current-inst', attendance_status: 'present' }],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    expect(res.totalStudents).toBe(1);
    expect(res.totalLiveClasses).toBe(1);
    expect(res.overallAttendancePercent).toBe(100);
    expect(res.studentsBelowThreshold).toBe(0);
  });

  // 12. Threshold < 75
  it('12. adheres strictly to threshold < 75 (75% is NOT below threshold, 74% IS below threshold)', async () => {
    // Student 1 has 3 present, 1 absent out of 4 classes = 75% -> NOT below threshold
    // Student 2 has 2 present, 1 partial, 1 absent out of 4 classes = (200 + 50)/4 = 62.5% -> 63% -> IS below threshold
    const classes = [
      { class_id: 'c-1', scheduled_at: '2026-08-01T10:00:00Z' },
      { class_id: 'c-2', scheduled_at: '2026-08-02T10:00:00Z' },
      { class_id: 'c-3', scheduled_at: '2026-08-03T10:00:00Z' },
      { class_id: 'c-4', scheduled_at: '2026-08-04T10:00:00Z' },
    ];
    const directLinks = classes.map((c) => ({ class_id: c.class_id, batch_id: 'b-1' }));

    setupDbMocks({
      students: [{ student_id: 's-75pct' }, { student_id: 's-below' }],
      classes,
      batches: [{ batch_id: 'b-1', deleted_at: null }],
      directLinks,
      batchStudents: [
        { student_id: 's-75pct', batch_id: 'b-1', enrolled_on: '2026-07-01' },
        { student_id: 's-below', batch_id: 'b-1', enrolled_on: '2026-07-01' },
      ],
      attendance: [
        // s-75pct: 3 presents, 1 missing/absent = 75%
        { class_id: 'c-1', student_id: 's-75pct', attendance_status: 'present' },
        { class_id: 'c-2', student_id: 's-75pct', attendance_status: 'present' },
        { class_id: 'c-3', student_id: 's-75pct', attendance_status: 'present' },
        // s-below: 2 presents, 1 partial, 1 missing/absent = 250/400 = 62.5% -> 63%
        { class_id: 'c-1', student_id: 's-below', attendance_status: 'present' },
        { class_id: 'c-2', student_id: 's-below', attendance_status: 'present' },
        { class_id: 'c-3', student_id: 's-below', attendance_status: 'partial' },
      ],
    });

    const res = await attendanceAnalyticsService._getAdminSummaryFallback(INSTITUTE_ID);
    // Total expected: 8
    // Total points: (3 * 100) + (2 * 100 + 1 * 50) = 300 + 250 = 550
    // Overall = Round(550 / 8) = Round(68.75) = 69%
    expect(res.overallAttendancePercent).toBe(69);
    // Only s-below is < 75%. s-75pct is exactly 75%, so NOT counted below threshold!
    expect(res.studentsBelowThreshold).toBe(1);
  });
});
