/**
 * Mock Result Service — Focused Tests
 *
 * Tests audit logging and student notification behavior for
 * result release/unrelease operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAuditLog = vi.fn().mockResolvedValue({ success: true, logId: 'audit-1' });
const mockCreateBulkNotification = vi.fn().mockResolvedValue({
  success: true,
  data: { notificationId: 'notif-1', recipientCount: 1 },
});

vi.mock('@/config/supabase', () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: { log: mockAuditLog },
}));

vi.mock('@/services/notification/notificationService', () => ({
  createBulkNotification: mockCreateBulkNotification,
}));

function okChain(data: any = null, error: any = null) {
  const result = { data, error };
  const c: Record<string, any> = {};
  // Every chain method returns the same builder (mutates `c` for chaining).
  // The chain is thenable: `await chain` resolves with { data, error }.
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.range = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
  // Terminal methods resolve the chain:
  c.single = vi.fn().mockResolvedValue(result);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  c.then = (onFulfilled: any, onRejected?: any) => {
    if (error && onRejected) return onRejected(error);
    return onFulfilled(result);
  };
  return c;
}

const UUIDS = {
  resultId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  testId: '33333333-3333-4333-8333-333333333333',
  studentId: '44444444-4444-4444-8444-444444444444',
  instituteId: '55555555-5555-4555-8555-555555555555',
  profileId: '66666666-6666-4666-8666-666666666666',
  resultId2: '77777777-7777-4777-8777-777777777777',
  attemptId2: '88888888-8888-4888-8888-888888888888',
  studentId2: '99999999-9999-4999-8999-999999999999',
  profileId2: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  resultIdFail: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  testIdRelease: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  testIdUnrelease: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

const MOCK_RESULT = {
  result_id: UUIDS.resultId,
  attempt_id: UUIDS.attemptId,
  test_id: UUIDS.testId,
  student_id: UUIDS.studentId,
  institute_id: UUIDS.instituteId,
  total_score: 85,
  max_score: 100,
  percentage: 85,
  rank: null,
  percentile: null,
  correct_count: 17,
  wrong_count: 2,
  skipped_count: 1,
  total_time_seconds: 3600,
  avg_time_per_question: 180,
  subject_breakdown: null,
  chapter_breakdown: null,
  is_released: true,
  generated_at: '2026-01-01T00:00:00Z',
  released_at: '2026-01-02T00:00:00Z',
};

describe('mockResultService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-001' } },
    });
  });

  it('exports all required functions', async () => {
    const mod = await import('../mockResultService');
    expect(typeof mod.releaseResult).toBe('function');
    expect(typeof mod.hideResult).toBe('function');
    expect(typeof mod.releaseMockResults).toBe('function');
    expect(typeof mod.unreleaseMockResults).toBe('function');
    expect(typeof mod.getReleaseStatus).toBe('function');
    expect(typeof mod.getResult).toBe('function');
    expect(typeof mod.getResults).toBe('function');
  });

  it('releaseResult logs result_released audit event', async () => {
    mockFrom.mockReturnValue(
      okChain({
        ...MOCK_RESULT,
        student_details: { profiles: { name: 'Test Student' } },
      }),
    );

    const { releaseResult } = await import('../mockResultService');
    await releaseResult(UUIDS.resultId);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'result_released',
        resourceType: 'mock_results',
        resourceId: UUIDS.resultId,
        metadata: expect.objectContaining({
          attemptId: UUIDS.attemptId,
          studentId: UUIDS.studentId,
          testId: UUIDS.testId,
          releasedBy: 'admin-001',
          totalScore: 85,
          maxScore: 100,
        }),
      }),
    );
  });

  it('releaseResult sends student notification', async () => {
    mockFrom
      .mockReturnValueOnce(okChain({
        ...MOCK_RESULT,
        student_details: { profiles: { name: 'Test Student' } },
      }))
      .mockReturnValueOnce(okChain({ profile_id: UUIDS.profileId }));

    const { releaseResult } = await import('../mockResultService');
    await releaseResult(UUIDS.resultId);

    expect(mockCreateBulkNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'result_published',
        referenceType: 'test_result',
        referenceId: UUIDS.attemptId,
        recipientIds: [UUIDS.profileId],
      }),
    );
  });

  it('hideResult logs result_unreleased audit event', async () => {
    mockFrom.mockReturnValue(
      okChain({
        ...MOCK_RESULT,
        is_released: false,
        released_at: null,
        student_details: { profiles: { name: 'Test Student' } },
      }),
    );

    const { hideResult } = await import('../mockResultService');
    await hideResult(UUIDS.resultId);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'result_unreleased',
        resourceType: 'mock_results',
        resourceId: UUIDS.resultId,
        metadata: expect.objectContaining({
          attemptId: UUIDS.attemptId,
          studentId: UUIDS.studentId,
          testId: UUIDS.testId,
          unreleasedBy: 'admin-001',
        }),
      }),
    );
  });

  it('releaseResult does not send audit/notification on failure', async () => {
    mockFrom.mockReturnValue(okChain(null, { code: 'PGRST116', message: 'No rows' }));

    const { releaseResult } = await import('../mockResultService');
    const result = await releaseResult(UUIDS.resultIdFail);

    expect(result.success).toBe(false);
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockCreateBulkNotification).not.toHaveBeenCalled();
  });

  it('releaseMockResults logs audit events for each result', async () => {
    const unreleasedRows = [
      { result_id: UUIDS.resultId, attempt_id: UUIDS.attemptId, student_id: UUIDS.studentId, test_id: UUIDS.testIdRelease, institute_id: UUIDS.instituteId, total_score: 80, max_score: 100 },
      { result_id: UUIDS.resultId2, attempt_id: UUIDS.attemptId2, student_id: UUIDS.studentId2, test_id: UUIDS.testIdRelease, institute_id: UUIDS.instituteId, total_score: 70, max_score: 100 },
    ];

    mockFrom
      .mockReturnValueOnce(okChain(unreleasedRows))
      .mockReturnValueOnce(okChain({ profile_id: UUIDS.profileId }))
      .mockReturnValueOnce(okChain({ profile_id: UUIDS.profileId2 }));

    mockRpc.mockResolvedValue({ data: [{ updated_count: 2 }], error: null });

    const { releaseMockResults } = await import('../mockResultService');
    const result = await releaseMockResults(UUIDS.testIdRelease);

    expect(result.success).toBe(true);
    expect(result.data?.updatedCount).toBe(2);
    expect(mockAuditLog).toHaveBeenCalledTimes(2);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'result_released',
        metadata: expect.objectContaining({ bulkRelease: true }),
      }),
    );
  });

  it('unreleaseMockResults logs audit events for each result', async () => {
    const releasedRows = [
      { result_id: UUIDS.resultId, attempt_id: UUIDS.attemptId, student_id: UUIDS.studentId, test_id: UUIDS.testIdUnrelease },
    ];

    mockFrom.mockReturnValueOnce(okChain(releasedRows));
    mockRpc.mockResolvedValue({ data: [{ updated_count: 1 }], error: null });

    const { unreleaseMockResults } = await import('../mockResultService');
    const result = await unreleaseMockResults(UUIDS.testIdUnrelease);

    expect(result.success).toBe(true);
    expect(result.data?.updatedCount).toBe(1);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'result_unreleased',
        metadata: expect.objectContaining({ bulkUnrelease: true }),
      }),
    );
  });
});
