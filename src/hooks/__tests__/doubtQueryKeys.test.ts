import { describe, it, expect } from 'vitest';
import { doubtKeys } from '@/hooks/doubt/queryKeys';

describe('doubtKeys', () => {
  it('builds the root, list and detail keys', () => {
    expect(doubtKeys.all()).toEqual(['doubts']);
    expect(doubtKeys.lists()).toEqual(['doubts', 'list']);
    expect(doubtKeys.details()).toEqual(['doubts', 'detail']);
    expect(doubtKeys.detail('d-1')).toEqual(['doubts', 'detail', 'd-1']);
  });

  it('builds role-scoped list keys from filters + pagination', () => {
    const key = doubtKeys.list(
      'teacher',
      { status: 'open', search: 'friction' },
      { page: 1, pageSize: 25 },
    );
    expect(key).toEqual([
      'doubts',
      'list',
      'teacher',
      { status: 'open', search: 'friction' },
      { page: 1, pageSize: 25 },
    ]);
  });

  it('keeps role scopes distinct even with identical filters', () => {
    const student = doubtKeys.list('student', { status: 'open' });
    const teacher = doubtKeys.list('teacher', { status: 'open' });
    expect(student).not.toEqual(teacher);
    expect(student[2]).toBe('student');
    expect(teacher[2]).toBe('teacher');
  });

  it('builds the subjectOptions key under the root', () => {
    expect(doubtKeys.subjectOptions()).toEqual(['doubts', 'subject-options']);
    expect(doubtKeys.subjectOptions()[0]).toBe(doubtKeys.all()[0]);
  });

  it('builds the admin assign-picker teacherOptions key scoped by doubt context (Phase 7F)', () => {
    expect(doubtKeys.teacherOptions('bs-1', 'sub-1')).toEqual([
      'doubts',
      'teacher-options',
      'bs-1',
      'sub-1',
    ]);
    // A different batch_subject yields a different key (cache never mixes
    // candidates across doubts).
    expect(doubtKeys.teacherOptions('bs-2', 'sub-1')).not.toEqual(
      doubtKeys.teacherOptions('bs-1', 'sub-1'),
    );
    expect(doubtKeys.teacherOptions('none', 'sub-1')[2]).toBe('none');
  });

  it('supports prefix invalidation per role scope', () => {
    const teacherList = doubtKeys.list('teacher', { status: 'open' });
    // ['doubts','list','teacher',...] — invalidating the 'teacher' prefix
    // refreshes every teacher list without touching student/admin lists.
    expect(teacherList.slice(0, 3)).toEqual(['doubts', 'list', 'teacher']);
    expect(doubtKeys.list('teacher', { status: 'resolved' }).slice(0, 3)).toEqual(
      teacherList.slice(0, 3),
    );
  });

  it('prefix-invalidates all lists and details from the root', () => {
    const listKey = doubtKeys.list('admin', {}, {});
    const detailKey = doubtKeys.detail('d-1');
    expect(listKey.slice(0, 2)).toEqual(doubtKeys.lists());
    expect(detailKey.slice(0, 2)).toEqual(doubtKeys.details());
    // Broad invalidation via lists()/details() hits both.
    expect(listKey[0]).toBe(doubtKeys.all()[0]);
    expect(detailKey[0]).toBe(doubtKeys.all()[0]);
  });
});
