import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateSubjectiveAnswer } from '../manualEvaluationService';
import { supabase } from '@/config/supabase';

const { mockGetUser, mockFrom, mockRpc, mockAuditLog } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockAuditLog: vi.fn().mockResolvedValue({ success: true, logId: 'audit-1' }),
}));

vi.mock('@/config/supabase', () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  },
}));

vi.mock('@/services/audit/auditService', () => ({
  log: mockAuditLog,
}));

describe('evaluateSubjectiveAnswer RPC & Diagnostic Timing Instrumentation', () => {
  let logSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('Calls evaluate_subjective_answer RPC with 1 atomic operation and logs [EVAL][COMPLETE] on success', async () => {
    const validAnswerId = '11111111-1111-4111-8111-111111111111';

    mockRpc.mockResolvedValue({
      data: {
        success: true,
        data: { answerId: validAnswerId },
      },
      error: null,
    });

    const res = await evaluateSubjectiveAnswer({
      answerId: validAnswerId,
      awardedMarks: 8.5,
      feedback: 'Excellent work',
    });

    expect(mockRpc).toHaveBeenCalledWith('evaluate_subjective_answer', {
      p_answer_id: validAnswerId,
      p_awarded_marks: 8.5,
      p_feedback: 'Excellent work',
    });

    expect(res.success).toBe(true);
    expect(res.data?.answerId).toBe(validAnswerId);

    const loggedLines = logSpy.mock.calls.map((args: any[]) => args.join(' '));
    expect(loggedLines.some((l: string) => l.includes('[EVAL][START]') && l.includes('correlationId=EVAL-'))).toBe(true);
    expect(loggedLines.some((l: string) => l.includes('[EVAL][STEP_START]') && l.includes('rpc.evaluate_subjective_answer'))).toBe(true);
    expect(loggedLines.some((l: string) => l.includes('[EVAL][STEP_SUCCESS]') && l.includes('rpc.evaluate_subjective_answer'))).toBe(true);
    expect(loggedLines.some((l: string) => l.includes('[EVAL][COMPLETE]') && l.includes('totalSupabaseOperations=1'))).toBe(true);
  });

  it('Logs [EVAL][STEP_ERROR] and [EVAL][FAILED] on network / PostgREST RPC failure without crashing', async () => {
    const validAnswerId = '11111111-1111-4111-8111-111111111111';

    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '504', message: 'Gateway Timeout' },
    });

    const res = await evaluateSubjectiveAnswer({
      answerId: validAnswerId,
      awardedMarks: 5,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Gateway Timeout');

    const errorLines = errorSpy.mock.calls.map((args: any[]) => args.join(' '));
    expect(errorLines.some((l: string) => l.includes('[EVAL][STEP_ERROR]') && l.includes('rpc.evaluate_subjective_answer'))).toBe(true);
    expect(errorLines.some((l: string) => l.includes('[EVAL][FAILED]'))).toBe(true);
  });

  it('Handles business validation rejection from RPC (e.g. Unauthorized teacher)', async () => {
    const validAnswerId = '11111111-1111-4111-8111-111111111111';

    mockRpc.mockResolvedValue({
      data: {
        success: false,
        error: 'You are not authorized to evaluate this student\'s answer.',
      },
      error: null,
    });

    const res = await evaluateSubjectiveAnswer({
      answerId: validAnswerId,
      awardedMarks: 5,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('You are not authorized to evaluate this student\'s answer.');

    const errorLines = errorSpy.mock.calls.map((args: any[]) => args.join(' '));
    expect(errorLines.some((l: string) => l.includes('[EVAL][FAILED]'))).toBe(true);
  });
});
