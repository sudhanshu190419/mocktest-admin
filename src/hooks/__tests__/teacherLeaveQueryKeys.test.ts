import { describe, it, expect } from 'vitest';
import { adminKeys } from '@/hooks/admin/queryKeys';
import { teacherLeaveKeys } from '@/hooks/teacher/queryKeys';

describe('adminKeys.leaveRequests', () => {
  it('nests under the admin root', () => {
    expect(adminKeys.leaveRequests.all()).toEqual(['admin', 'leaveRequests']);
  });

  it('builds list keys from filters + pagination', () => {
    const key = adminKeys.leaveRequests.list(
      { status: 'pending', emergency: true },
      { page: 1, pageSize: 25 },
    );
    expect(key).toEqual([
      'admin',
      'leaveRequests',
      'list',
      { status: 'pending', emergency: true },
      { page: 1, pageSize: 25 },
    ]);
  });

  it('prefix-invalidates all leave-request lists and details', () => {
    expect(adminKeys.leaveRequests.lists()[2]).toBe('list');
    expect(adminKeys.leaveRequests.details()[2]).toBe('detail');

    const listKey = adminKeys.leaveRequests.list({}, {});
    const detailKey = adminKeys.leaveRequests.detail('leave-abc');

    // Both derive from the same root, so invalidating the root hits both.
    expect(listKey.slice(0, 2)).toEqual(adminKeys.leaveRequests.all());
    expect(detailKey.slice(0, 2)).toEqual(adminKeys.leaveRequests.all());
  });

  it('builds detail keys', () => {
    expect(adminKeys.leaveRequests.detail('leave-abc')).toEqual([
      'admin',
      'leaveRequests',
      'detail',
      'leave-abc',
    ]);
  });
});

describe('teacherLeaveKeys', () => {
  it('builds the root, list and detail keys', () => {
    expect(teacherLeaveKeys.all()).toEqual(['teacher-leave']);
    expect(teacherLeaveKeys.lists()).toEqual(['teacher-leave', 'list']);
    expect(teacherLeaveKeys.list()).toEqual(['teacher-leave', 'list']);
    expect(teacherLeaveKeys.details()).toEqual(['teacher-leave', 'detail']);
    expect(teacherLeaveKeys.detail('leave-xyz')).toEqual(['teacher-leave', 'detail', 'leave-xyz']);
  });

  it('supports prefix invalidation from the root', () => {
    const listKey = teacherLeaveKeys.list();
    const detailKey = teacherLeaveKeys.detail('leave-xyz');
    expect(listKey[0]).toBe(teacherLeaveKeys.all()[0]);
    expect(detailKey[0]).toBe(teacherLeaveKeys.all()[0]);
  });
});
