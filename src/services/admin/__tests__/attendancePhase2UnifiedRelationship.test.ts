import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAnalyticsService } from '../../attendanceAnalyticsService';
import { supabase } from '@/config/supabase';

vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('Attendance Phase 2: Unified Batch <-> Live Class Relationship', () => {
  const INSTITUTE_ID = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Part 1: Batch Attendance Fallback with Unified Mapping', () => {
    it('correctly includes classes from live_class_batch, batch_subject_live_classes, and deduplicates overlap', async () => {
      // Force RPC fallback
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: 'RPC not available' },
      } as any);

      // Batches:
      // - batch-morning: class-1 (via live_class_batch)
      // - batch-testtt: class-2 (via batch_subject_live_classes)
      // - batch-hybrid: class-3 (via BOTH live_class_batch AND batch_subject_live_classes)
      const batches = [
        { batch_id: 'batch-morning', name: 'morning' },
        { batch_id: 'batch-testtt', name: 'testtt' },
        { batch_id: 'batch-hybrid', name: 'hybrid' },
      ];

      const batchStudents = [
        { student_id: 'stu-1', batch_id: 'batch-morning' },
        { student_id: 'stu-2', batch_id: 'batch-testtt' },
        { student_id: 'stu-3', batch_id: 'batch-hybrid' },
      ];

      // Path 1: batch_subject_live_classes
      const bslcLinks = [
        { class_id: 'class-2', batch_subjects: { batch_id: 'batch-testtt' } },
        { class_id: 'class-3', batch_subjects: { batch_id: 'batch-hybrid' } }, // overlap
      ];

      // Path 2: live_class_batch
      const directLinks = [
        { class_id: 'class-1', batch_id: 'batch-morning' },
        { class_id: 'class-3', batch_id: 'batch-hybrid' }, // overlap
      ];

      // All classes are completed and belong to the institute
      const completedClasses = [
        { class_id: 'class-1' },
        { class_id: 'class-2' },
        { class_id: 'class-3' },
      ];

      // Attendance records:
      // stu-1 for class-1: present
      // stu-2 for class-2: partial
      // stu-3 for class-3: present
      const attendance = [
        { class_id: 'class-1', student_id: 'stu-1', attendance_status: 'present' },
        { class_id: 'class-2', student_id: 'stu-2', attendance_status: 'partial' },
        { class_id: 'class-3', student_id: 'stu-3', attendance_status: 'present' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'batches') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: batches, error: null }),
            }),
          } as any;
        }
        if (table === 'batch_students') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: batchStudents, error: null }),
            }),
          } as any;
        }
        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: bslcLinks, error: null }),
            }),
          } as any;
        }
        if (table === 'live_class_batch') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: directLinks, error: null }),
            }),
          } as any;
        }
        if (table === 'live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: completedClasses, error: null }),
                }),
              }),
            }),
          } as any;
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: attendance, error: null }),
            }),
          } as any;
        }
        return {} as any;
      });

      const results = await attendanceAnalyticsService.getAdminBatchAttendance(INSTITUTE_ID);

      expect(results).toHaveLength(3);

      // Verify batch-morning (only in live_class_batch)
      const morningBatch = results.find((b) => b.batchId === 'batch-morning');
      expect(morningBatch).toBeDefined();
      expect(morningBatch?.batchName).toBe('morning');
      expect(morningBatch?.studentCount).toBe(1);
      expect(morningBatch?.presentCount).toBe(1);
      expect(morningBatch?.absentCount).toBe(0);
      expect(morningBatch?.averageAttendancePercent).toBe(100);

      // Verify batch-testtt (only in batch_subject_live_classes)
      const testttBatch = results.find((b) => b.batchId === 'batch-testtt');
      expect(testttBatch).toBeDefined();
      expect(testttBatch?.batchName).toBe('testtt');
      expect(testttBatch?.studentCount).toBe(1);
      expect(testttBatch?.partialCount).toBe(1);
      expect(testttBatch?.absentCount).toBe(0);
      expect(testttBatch?.averageAttendancePercent).toBe(50);

      // Verify batch-hybrid (present in BOTH paths)
      // Because class-3 was deduplicated, total evaluation is 1 class * 1 student = 1, NOT 2 classes!
      const hybridBatch = results.find((b) => b.batchId === 'batch-hybrid');
      expect(hybridBatch).toBeDefined();
      expect(hybridBatch?.batchName).toBe('hybrid');
      expect(hybridBatch?.studentCount).toBe(1);
      expect(hybridBatch?.presentCount).toBe(1);
      expect(hybridBatch?.absentCount).toBe(0); // If duplicated, absentCount or evaluations would be doubled
      expect(hybridBatch?.averageAttendancePercent).toBe(100);
    });
  });

  describe('Part 2: Tab 4 Live Class Attendance with Unified Mapping', () => {
    it('resolves batch information and student attendance for classes linked via either path without duplicate classes', async () => {
      // 3 classes:
      // class-1: linked via live_class_batch to batch-1
      // class-2: linked via batch_subject_live_classes to batch-2
      // class-3: linked via BOTH paths to batch-1
      const liveClasses = [
        { class_id: 'class-1', title: 'Math Morning', scheduled_at: '2026-09-10T10:00:00Z', duration_min: 60, teacher_id: 't-1' },
        { class_id: 'class-2', title: 'Physics Testtt', scheduled_at: '2026-09-11T10:00:00Z', duration_min: 60, teacher_id: 't-2' },
        { class_id: 'class-3', title: 'Chemistry Dual', scheduled_at: '2026-09-12T10:00:00Z', duration_min: 60, teacher_id: 't-1' },
      ];

      const teachers = [
        { teacher_id: 't-1', profiles: { name: 'Teacher Alpha' } },
        { teacher_id: 't-2', profiles: { name: 'Teacher Beta' } },
      ];

      const batches = [
        { batch_id: 'batch-1', name: 'Batch 1' },
        { batch_id: 'batch-2', name: 'Batch 2' },
      ];

      const bslcLinks = [
        { class_id: 'class-2', batch_subjects: { batch_id: 'batch-2' } },
        { class_id: 'class-3', batch_subjects: { batch_id: 'batch-1' } }, // overlap on batch-1
      ];

      const directLinks = [
        { class_id: 'class-1', batch_id: 'batch-1' },
        { class_id: 'class-3', batch_id: 'batch-1' }, // overlap on batch-1
      ];

      const batchStudents = [
        { student_id: 'stu-1', batch_id: 'batch-1' },
        { student_id: 'stu-2', batch_id: 'batch-2' },
      ];

      const attendanceRecords = [
        { class_id: 'class-1', student_id: 'stu-1', attendance_status: 'present' },
        { class_id: 'class-2', student_id: 'stu-2', attendance_status: 'partial' },
        { class_id: 'class-3', student_id: 'stu-1', attendance_status: 'present' },
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
              in: vi.fn().mockResolvedValue({ data: teachers, error: null }),
            }),
          } as any;
        }
        if (table === 'batches') {
          return {
            select: vi.fn().mockResolvedValue({ data: batches, error: null }),
          } as any;
        }
        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: bslcLinks, error: null }),
            }),
          } as any;
        }
        if (table === 'live_class_batch') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: directLinks, error: null }),
            }),
          } as any;
        }
        if (table === 'batch_students') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: batchStudents, error: null }),
            }),
          } as any;
        }
        if (table === 'attendance') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: attendanceRecords, error: null }),
            }),
          } as any;
        }
        return {} as any;
      });

      const result = await attendanceAnalyticsService.getAdminLiveClassAttendance(INSTITUTE_ID);

      // Exactly 3 classes returned, none duplicated
      expect(result.classes).toHaveLength(3);
      expect(result.total).toBe(3);

      // Class 1 (from live_class_batch)
      const c1 = result.classes.find((r: any) => r.classId === 'class-1');
      expect(c1).toBeDefined();
      expect(c1?.batchName).toBe('Batch 1'); // Not 'No Batch Assigned'
      expect(c1?.teacherName).toBe('Teacher Alpha');
      expect(c1?.totalStudents).toBe(1);
      expect(c1?.presentCount).toBe(1);
      expect(c1?.partialCount).toBe(0);
      expect(c1?.absentCount).toBe(0);

      // Class 2 (from batch_subject_live_classes)
      const c2 = result.classes.find((r: any) => r.classId === 'class-2');
      expect(c2).toBeDefined();
      expect(c2?.batchName).toBe('Batch 2');
      expect(c2?.teacherName).toBe('Teacher Beta');
      expect(c2?.totalStudents).toBe(1);
      expect(c2?.partialCount).toBe(1);

      // Class 3 (linked through BOTH paths to Batch 1)
      const c3 = result.classes.find((r: any) => r.classId === 'class-3');
      expect(c3).toBeDefined();
      // Batch 1 should only be listed ONCE, not 'Batch 1, Batch 1'
      expect(c3?.batchName).toBe('Batch 1');
      expect(c3?.totalStudents).toBe(1);
      expect(c3?.presentCount).toBe(1);
    });

    it('filters classes in Tab 4 when batchId filter is specified matching either relationship path', async () => {
      // When batchId is provided, queries both batch_subject_live_classes AND live_class_batch
      const mockClassQueryChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'live_classes') {
          return mockClassQueryChain;
        }
        if (table === 'batch_subject_live_classes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ class_id: 'class-from-bslc' }],
              }),
            }),
          } as any;
        }
        if (table === 'live_class_batch') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ class_id: 'class-from-direct' }],
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      await attendanceAnalyticsService.getAdminLiveClassAttendance(INSTITUTE_ID, {
        batchId: 'target-batch-id',
      });

      expect(supabase.from).toHaveBeenCalledWith('batch_subject_live_classes');
      expect(supabase.from).toHaveBeenCalledWith('live_class_batch');
      // Should union both class IDs into .in('class_id', ['class-from-bslc', 'class-from-direct'])
      expect(mockClassQueryChain.in).toHaveBeenCalledWith(
        'class_id',
        expect.arrayContaining(['class-from-bslc', 'class-from-direct'])
      );
    });
  });
});
