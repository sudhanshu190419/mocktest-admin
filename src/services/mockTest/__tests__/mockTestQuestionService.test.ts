import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockAuditLog } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAuditLog: vi.fn().mockResolvedValue({ success: true, logId: 'log-1' }),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

vi.mock('../../config/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logAssign: (payload: any) => mockAuditLog({ ...payload, action: 'assign' }),
    logUnassign: (payload: any) => mockAuditLog({ ...payload, action: 'unassign' }),
    logUpdate: (payload: any) => mockAuditLog({ ...payload, action: 'update' }),
    logCreate: (payload: any) => mockAuditLog({ ...payload, action: 'create' }),
  },
}));

vi.mock('../audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logAssign: (payload: any) => mockAuditLog({ ...payload, action: 'assign' }),
    logUnassign: (payload: any) => mockAuditLog({ ...payload, action: 'unassign' }),
    logUpdate: (payload: any) => mockAuditLog({ ...payload, action: 'update' }),
    logCreate: (payload: any) => mockAuditLog({ ...payload, action: 'create' }),
  },
}));

import {
  addQuestionToMockTest,
  removeQuestionFromMockTest,
  addQuestionsToMockTest,
  replaceMockTestQuestions,
  reorderMockTestQuestions,
  updateMockTestQuestion,
} from '../mockTestQuestionService';

function mockChain(data: any = null, error: any = null) {
  const result = { data, error };
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
  c.delete = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue(result);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  c.then = (onFulfilled: any, onRejected?: any) => {
    if (error && onRejected) return onRejected(error);
    return onFulfilled(result);
  };
  return c;
}

const TEST_ID = '11111111-1111-4111-8111-111111111111';
const INST_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';
const ASSIGNMENT_ID = `${TEST_ID}::${QUESTION_ID}`;

describe('mockTestQuestionService - Published Test Immutability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addQuestionToMockTest rejects published tests', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_tests') {
        return mockChain({
          test_id: TEST_ID,
          institute_id: INST_ID,
          status: 'published',
        });
      }
      return mockChain();
    });

    const result = await addQuestionToMockTest({
      testId: TEST_ID,
      questionId: QUESTION_ID,
      orderSequence: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot add questions to a published mock test');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('removeQuestionFromMockTest rejects published tests', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_tests') {
        return mockChain({
          test_id: TEST_ID,
          institute_id: INST_ID,
          status: 'published',
        });
      }
      return mockChain();
    });

    const result = await removeQuestionFromMockTest(ASSIGNMENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot remove questions from a published mock test');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('addQuestionsToMockTest (bulk) rejects published tests', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_tests') {
        return mockChain({
          test_id: TEST_ID,
          institute_id: INST_ID,
          status: 'published',
        });
      }
      return mockChain();
    });

    const result = await addQuestionsToMockTest(TEST_ID, [
      { questionId: QUESTION_ID, orderSequence: 1 },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot add questions to a published mock test');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('replaceMockTestQuestions rejects published tests', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_tests') {
        return mockChain({
          test_id: TEST_ID,
          institute_id: INST_ID,
          status: 'published',
        });
      }
      return mockChain();
    });

    const result = await replaceMockTestQuestions(TEST_ID, [
      { questionId: QUESTION_ID, orderSequence: 1 },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot replace questions on a published mock test');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('reorderMockTestQuestions rejects published tests', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_tests') {
        return mockChain({
          test_id: TEST_ID,
          institute_id: INST_ID,
          status: 'published',
        });
      }
      return mockChain();
    });

    const result = await reorderMockTestQuestions(TEST_ID, [
      { assignmentId: ASSIGNMENT_ID, displayOrder: 1 },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot reorder questions on a published mock test');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('updateMockTestQuestion rejects published tests', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_tests') {
        return mockChain({
          test_id: TEST_ID,
          institute_id: INST_ID,
          status: 'published',
        });
      }
      return mockChain();
    });

    const result = await updateMockTestQuestion(ASSIGNMENT_ID, {
      marksOverride: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot update questions on a published mock test');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});

describe('mockTestQuestionService - Audit Logging on Draft Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removeQuestionFromMockTest logs unassign audit event on success', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'mock_tests') {
        return mockChain({ test_id: TEST_ID, institute_id: INST_ID, status: 'draft' });
      }
      if (table === 'mock_test_questions') {
        return mockChain([]);
      }
      return mockChain();
    });

    const result = await removeQuestionFromMockTest(ASSIGNMENT_ID);

    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unassign',
        resourceType: 'mock_test_questions',
        resourceId: QUESTION_ID,
        metadata: expect.objectContaining({
          testId: TEST_ID,
          questionId: QUESTION_ID,
        }),
      })
    );
  });
});
