/**
 * Manual Evaluation Service — Focused Tests
 *
 * Tests function exports, authentication, and basic authorization paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/config/supabase', () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: vi.fn(),
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  log: vi.fn().mockResolvedValue({ success: true, logId: 'audit-1' }),
}));

function okChain(data: any = null, error: any = null) {
  const result = { data, error };
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.range = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockResolvedValue(result);
  c.insert = vi.fn().mockResolvedValue(result);
  c.single = vi.fn().mockResolvedValue(result);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  // Make the chain thenable so `await chain` resolves with { data, error }.
  // This mimics Supabase's PostgrestFilterBuilder which is thenable.
  c.then = (onFulfilled: any) => onFulfilled(result);
  return c;
}

describe('manualEvaluationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports all required functions', async () => {
    const mod = await import('../manualEvaluationService');
    expect(typeof mod.getPendingEvaluations).toBe('function');
    expect(typeof mod.evaluateSubjectiveAnswer).toBe('function');
    expect(typeof mod.finalizeSubjectiveEvaluation).toBe('function');
    expect(typeof mod.getTestPendingEvaluationCount).toBe('function');
  });

  it('rejects unauthenticated users for getPendingEvaluations', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    const { getPendingEvaluations } = await import('../manualEvaluationService');
    const result = await getPendingEvaluations();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication required');
  });

  it('rejects unauthenticated users for evaluateSubjectiveAnswer', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    const { evaluateSubjectiveAnswer } = await import('../manualEvaluationService');
    const result = await evaluateSubjectiveAnswer({
      answerId: '11111111-1111-1111-1111-111111111111',
      awardedMarks: 5,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication required');
  });

  it('rejects unauthenticated users for finalizeSubjectiveEvaluation', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    const { finalizeSubjectiveEvaluation } = await import('../manualEvaluationService');
    const result = await finalizeSubjectiveEvaluation({
      attemptId: '33333333-3333-3333-3333-333333333333',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication required');
  });

  it('rejects finance_admin role (no admin_roles entry)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    // profiles.role = 'admin', but no admin_roles entry for super/academic
    mockFrom.mockReturnValue(okChain({ role: 'admin' }, null));
    const { getPendingEvaluations } = await import('../manualEvaluationService');
    const result = await getPendingEvaluations();
    // Should fail because no admin_roles entry AND no teacher_details
    expect(result.success).toBe(false);
  });

  it('rejects student role', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockFrom.mockReturnValue(okChain({ role: 'student' }, null));
    const { getPendingEvaluations } = await import('../manualEvaluationService');
    const result = await getPendingEvaluations();
    expect(result.success).toBe(false);
  });

  it('recognizes super_admin via admin_roles table', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    // First .from('profiles') returns role: 'admin', then .from('admin_roles')
    // returns a super_admin entry
    mockFrom.mockReturnValue(okChain({ admin_role: 'super_admin' }, null));
    // Override the first call to return profiles data
    const originalFrom = mockFrom.getMockImplementation();
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'profiles') {
        return okChain({ role: 'admin' }, null);
      }
      if (table === 'admin_roles') {
        return okChain([{ admin_role: 'super_admin' }], null);
      }
      // Default for other tables
      return okChain(null, null);
    });

    const { getPendingEvaluations } = await import('../manualEvaluationService');
    const result = await getPendingEvaluations();
    // Super admin should succeed (though data may be empty)
    expect(result.success).toBe(true);
  });

  it('recognizes academic_admin via admin_roles table', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return okChain({ role: 'admin' }, null);
      }
      if (table === 'admin_roles') {
        return okChain([{ admin_role: 'academic_admin' }], null);
      }
      return okChain(null, null);
    });

    const { getPendingEvaluations } = await import('../manualEvaluationService');
    const result = await getPendingEvaluations();
    expect(result.success).toBe(true);
  });

  it('rejects finance_admin when admin_roles only has finance_admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return okChain({ role: 'admin' }, null);
      }
      if (table === 'admin_roles') {
        // The real query uses .in('admin_role', ['super_admin', 'academic_admin'])
        // which would filter OUT finance_admin, returning empty.
        // We simulate that by returning [].
        return okChain([], null);
      }
      return okChain(null, null);
    });

    const { getPendingEvaluations } = await import('../manualEvaluationService');
    const result = await getPendingEvaluations();
    // Should fail: finance_admin is not in ['super_admin', 'academic_admin']
    expect(result.success).toBe(false);
  });
  it('returns pending evaluation count for test with submitted attempts', async () => {
    const testId = '11111111-1111-4111-8111-111111111111';
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_answers') {
        return okChain([
          { attempt_id: 'att-1', mock_attempts: { test_id: testId, status: 'submitted' } },
          { attempt_id: 'att-1', mock_attempts: { test_id: testId, status: 'submitted' } }, // duplicate attempt with 2 pending questions
          { attempt_id: 'att-2', mock_attempts: { test_id: testId, status: 'submitted' } },
        ], null);
      }
      return okChain(null, null);
    });

    const { getTestPendingEvaluationCount } = await import('../manualEvaluationService');
    const result = await getTestPendingEvaluationCount(testId);

    expect(result.success).toBe(true);
    expect(result.data?.pendingEvaluationCount).toBe(2); // 2 distinct attempts
  });

  it('returns pending evaluation count = 0 when all evaluations complete', async () => {
    const testId = '22222222-2222-4222-8222-222222222222';
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_answers') {
        return okChain([], null);
      }
      return okChain(null, null);
    });

    const { getTestPendingEvaluationCount } = await import('../manualEvaluationService');
    const result = await getTestPendingEvaluationCount(testId);

    expect(result.success).toBe(true);
    expect(result.data?.pendingEvaluationCount).toBe(0);
  });
});
