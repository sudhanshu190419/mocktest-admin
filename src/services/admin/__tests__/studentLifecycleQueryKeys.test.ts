import { describe, it, expect } from 'vitest';
import { adminKeys } from '@/hooks/admin/queryKeys';

describe('adminKeys.studentLifecycle (Phase 2 Query Key Cache Validation)', () => {
  it('generates distinct query keys when sort configuration changes', () => {
    const filters = { status: 'approved' };
    const pagination = { page: 1, pageSize: 15 };

    const keySortNewest = adminKeys.studentLifecycle.list(
      filters,
      { sortBy: 'createdAt', sortDirection: 'desc' },
      pagination,
    );

    const keySortNameAsc = adminKeys.studentLifecycle.list(
      filters,
      { sortBy: 'name', sortDirection: 'asc' },
      pagination,
    );

    const keySortStatusDesc = adminKeys.studentLifecycle.list(
      filters,
      { sortBy: 'accountStatus', sortDirection: 'desc' },
      pagination,
    );

    const keySortTargetYearAsc = adminKeys.studentLifecycle.list(
      filters,
      { sortBy: 'targetYear', sortDirection: 'asc' },
      pagination,
    );

    expect(keySortNewest).not.toEqual(keySortNameAsc);
    expect(keySortNewest).not.toEqual(keySortStatusDesc);
    expect(keySortNewest).not.toEqual(keySortTargetYearAsc);
    expect(keySortNameAsc).not.toEqual(keySortStatusDesc);

    // Verify key structure: ['admin', 'studentLifecycle', 'list', filters, sort, pagination]
    expect(keySortNewest[0]).toBe('admin');
    expect(keySortNewest[1]).toBe('studentLifecycle');
    expect(keySortNewest[2]).toBe('list');
    expect(keySortNewest[3]).toEqual(filters);
    expect(keySortNewest[4]).toEqual({ sortBy: 'createdAt', sortDirection: 'desc' });
    expect(keySortNewest[5]).toEqual(pagination);
  });

  it('generates distinct query keys when filters change', () => {
    const sort = { sortBy: 'createdAt', sortDirection: 'desc' };
    const pagination = { page: 1, pageSize: 15 };

    const keyPending = adminKeys.studentLifecycle.list({ status: 'pending' }, sort, pagination);
    const keyApproved = adminKeys.studentLifecycle.list({ status: 'approved' }, sort, pagination);
    const keyBatch = adminKeys.studentLifecycle.list({ batchId: 'batch-123' }, sort, pagination);

    expect(keyPending).not.toEqual(keyApproved);
    expect(keyPending).not.toEqual(keyBatch);
  });

  it('generates distinct query keys when page changes', () => {
    const filters = { status: 'approved' };
    const sort = { sortBy: 'createdAt', sortDirection: 'desc' };

    const keyPage1 = adminKeys.studentLifecycle.list(filters, sort, { page: 1, pageSize: 15 });
    const keyPage2 = adminKeys.studentLifecycle.list(filters, sort, { page: 2, pageSize: 15 });

    expect(keyPage1).not.toEqual(keyPage2);
  });

  it('broad invalidation key lists() forms a prefix of any specific list key', () => {
    const listsKey = adminKeys.studentLifecycle.lists();
    const specificKey = adminKeys.studentLifecycle.list(
      { status: 'pending' },
      { sortBy: 'name', sortDirection: 'asc' },
      { page: 1, pageSize: 15 },
    );

    expect(specificKey.slice(0, listsKey.length)).toEqual(listsKey);
  });
});
