vi.mock('../../admin/approvalGuard', () => ({
  canApproveAcademicResources: vi.fn().mockResolvedValue(true),
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockAuditLog, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAuditLog: vi.fn().mockResolvedValue({ success: true, logId: 'log-1' }),
  mockGetUser: vi.fn().mockResolvedValue({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } }, error: null }),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      getUser: mockGetUser,
    },
  },
}));

vi.mock('../../config/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      getUser: mockGetUser,
    },
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logCreate: (payload: any) => mockAuditLog({ ...payload, action: 'create' }),
    logUpdate: (payload: any) => mockAuditLog({ ...payload, action: 'update' }),
    logSoftDelete: (payload: any) => mockAuditLog({ ...payload, action: 'soft_delete' }),
  },
}));

vi.mock('../../audit/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logCreate: (payload: any) => mockAuditLog({ ...payload, action: 'create' }),
    logUpdate: (payload: any) => mockAuditLog({ ...payload, action: 'update' }),
    logSoftDelete: (payload: any) => mockAuditLog({ ...payload, action: 'soft_delete' }),
  },
}));

vi.mock('../../content/teacherResolver', () => ({
  resolveCurrentTeacherId: vi.fn().mockResolvedValue({ teacherId: '22222222-2222-4222-8222-222222222222' }),
}));
vi.mock('@/services/content/teacherResolver', () => ({
  resolveCurrentTeacherId: vi.fn().mockResolvedValue({ teacherId: '22222222-2222-4222-8222-222222222222' }),
}));

import { createMockTest, updateMockTest, deleteMockTest } from '../mockTestService';

function mockChain(data: any = null, error: any = null) {
  const result = { data, error };
  const c: Record<string, any> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.is = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
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
const STREAM_ID = '33333333-3333-4333-8333-333333333333';
const SUBJECT_ID = '44444444-4444-4444-8444-444444444444';

describe('mockTestService - Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createMockTest logs create audit event on success', async () => {
    const dbMockTest = {
      test_id: TEST_ID,
      institute_id: INST_ID,
      teacher_id: 'teacher-1',
      stream_id: STREAM_ID,
      subject_id: SUBJECT_ID,
      title: 'Full Length Test #1',
      duration_min: 180,
      total_marks: 100,
      passing_marks: 40,
      negative_marking: 1,
      attempt_limit: 1,
      shuffle_questions: true,
      shuffle_options: true,
      calculator_allowed: false,
      status: 'draft',
      test_type: 'full_length',
      result_release_mode: 'manual',
      result_release_at: null,
      available_from: null,
      available_until: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockFrom.mockReturnValue(mockChain(dbMockTest));

    const result = await createMockTest({
      instituteId: INST_ID,
      streamId: STREAM_ID,
      subjectId: SUBJECT_ID,
      title: 'Full Length Test #1',
      durationMin: 180,
      totalMarks: 100,
      passingMarks: 40,
    });

    if (!result.success) console.error("CREATE_MOCK_TEST_FAILED:", result.error);
    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        resourceType: 'mock_tests',
        resourceId: TEST_ID,
        newValue: expect.objectContaining({
          title: 'Full Length Test #1',
          totalMarks: 100,
          passingMarks: 40,
        }),
      })
    );
  });

  it('updateMockTest logs update audit event with diff snapshots', async () => {
    const existingTest = {
      test_id: TEST_ID,
      institute_id: INST_ID,
      teacher_id: 'teacher-1',
      stream_id: STREAM_ID,
      subject_id: SUBJECT_ID,
      title: 'Original Title',
      duration_min: 180,
      total_marks: 100,
      passing_marks: 40,
      status: 'draft',
      test_type: 'full_length',
      result_release_mode: 'manual',
    };

    const updatedTest = {
      ...existingTest,
      title: 'Updated Title',
      duration_min: 120,
    };

    mockFrom.mockReturnValueOnce(mockChain(existingTest)).mockReturnValueOnce(mockChain(updatedTest));

    const result = await updateMockTest(TEST_ID, {
      title: 'Updated Title',
      durationMin: 120,
    });

    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        resourceType: 'mock_tests',
        resourceId: TEST_ID,
        oldValue: expect.objectContaining({
          title: 'Original Title',
          duration_min: 180,
        }),
        newValue: expect.objectContaining({
          title: 'Updated Title',
          duration_min: 120,
        }),
      })
    );
  });

  it('deleteMockTest logs soft_delete audit event', async () => {
    mockFrom.mockReturnValue(mockChain(null));

    const result = await deleteMockTest(TEST_ID, 'End of academic session');

    expect(result.success).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'soft_delete',
        resourceType: 'mock_tests',
        resourceId: TEST_ID,
        reason: 'End of academic session',
      })
    );
  });
});
