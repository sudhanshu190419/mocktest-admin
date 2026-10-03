import { describe, it, expect } from 'vitest';
import { adminKeys } from '@/hooks/admin/queryKeys';

describe('adminKeys.attendance (Phase 4 Query Key Factory)', () => {
  const INSTITUTE_ID = '44444444-4444-4444-4444-444444444444';

  it('produces root key for broad invalidation', () => {
    expect(adminKeys.attendance.all()).toEqual(['admin', 'attendance']);
  });

  it('produces scoped key for admin attendance summary', () => {
    expect(adminKeys.attendance.summary(INSTITUTE_ID)).toEqual([
      'admin',
      'attendance',
      'summary',
      INSTITUTE_ID,
    ]);
  });

  it('produces scoped keys for batch and teacher dropdown options', () => {
    expect(adminKeys.attendance.batches(INSTITUTE_ID)).toEqual([
      'admin',
      'attendance',
      'batches',
      INSTITUTE_ID,
    ]);
    expect(adminKeys.attendance.teachers(INSTITUTE_ID)).toEqual([
      'admin',
      'attendance',
      'teachers',
      INSTITUTE_ID,
    ]);
  });

  it('produces scoped keys with filters for batch, teacher, and live class attendance', () => {
    const batchFilters = { dateFrom: '2026-09-01', dateTo: '2026-09-30', teacherId: 't-1' };
    expect(adminKeys.attendance.batch(INSTITUTE_ID, batchFilters)).toEqual([
      'admin',
      'attendance',
      'batch',
      INSTITUTE_ID,
      batchFilters,
    ]);

    const teacherFilters = { dateFrom: '2026-09-01', dateTo: '2026-09-30' };
    expect(adminKeys.attendance.teacher(INSTITUTE_ID, teacherFilters)).toEqual([
      'admin',
      'attendance',
      'teacher',
      INSTITUTE_ID,
      teacherFilters,
    ]);

    const liveClassFilters = { batchId: 'b-1', teacherId: 't-1' };
    expect(adminKeys.attendance.liveClass(INSTITUTE_ID, liveClassFilters)).toEqual([
      'admin',
      'attendance',
      'liveClass',
      INSTITUTE_ID,
      liveClassFilters,
    ]);
  });

  it('produces scoped keys for teacher batches and teacher batch classes drill-down', () => {
    const teacherId = 't-1';
    const batchId = 'b-1';
    const filters = { dateFrom: '2026-09-01', dateTo: '2026-09-30' };
    const classFilters = { ...filters, page: 2, pageSize: 10 };

    expect(adminKeys.attendance.teacherBatches(INSTITUTE_ID, teacherId, filters)).toEqual([
      'admin',
      'attendance',
      'teacherBatches',
      INSTITUTE_ID,
      teacherId,
      filters,
    ]);

    expect(adminKeys.attendance.teacherBatchClasses(INSTITUTE_ID, teacherId, batchId, classFilters)).toEqual([
      'admin',
      'attendance',
      'teacherBatchClasses',
      INSTITUTE_ID,
      teacherId,
      batchId,
      classFilters,
    ]);
  });

  it('produces scoped key for individual class attendance sheet detail', () => {
    const classId = 'class-uuid-1234';
    expect(adminKeys.attendance.classDetail(classId)).toEqual([
      'admin',
      'attendance',
      'classDetail',
      classId,
    ]);
  });

  it('produces scoped key for student attendance search', () => {
    expect(adminKeys.attendance.student(INSTITUTE_ID, 'Rahul')).toEqual([
      'admin',
      'attendance',
      'student',
      INSTITUTE_ID,
      'Rahul',
    ]);
  });
});
