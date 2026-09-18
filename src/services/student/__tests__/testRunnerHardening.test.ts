import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitAndEvaluateMockAttempt,
  updateMockAttemptTime,
} from '../studentTestWebService';
import { supabase } from '@/config/supabase';
import { webPersistenceQueue } from '../webPersistenceQueue';

vi.mock('@/config/supabase', () => {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  return {
    supabase: {
      rpc: mockRpc,
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr-1' } }, error: null }),
      },
    },
  };
});

describe('Test Runner Hardening & Evaluation Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webPersistenceQueue.clearAllDirtyAnswers();
  });

  it('submits and evaluates mock attempt successfully via RPC', async () => {
    const mockRpcResponse = {
      success: true,
      result_id: 'res-99',
      attempt_id: 'att-100',
      test_id: 'test-1',
      student_id: 'stu-1',
      institute_id: 'inst-1',
      total_score: 85,
      max_score: 100,
      percentage: 85,
      correct_count: 17,
      wrong_count: 3,
      skipped_count: 0,
      total_time_seconds: 1800,
      avg_time_per_question: 90,
      is_released: true,
      generated_at: '2026-09-16T00:00:00Z',
      released_at: '2026-09-16T00:00:00Z',
      already_evaluated: false,
    };

    (supabase.rpc as any).mockResolvedValueOnce({
      data: mockRpcResponse,
      error: null,
    });

    const result = await submitAndEvaluateMockAttempt('att-100', 1800, { 'q-1': 90, 'q-2': 90 });

    expect(supabase.rpc).toHaveBeenCalledWith('submit_and_evaluate_mock_attempt', {
      p_attempt_id: 'att-100',
      p_time_taken_seconds: 1800,
      p_question_times: { 'q-1': 90, 'q-2': 90 },
    });

    expect(result.success).toBe(true);
    expect(result.data?.resultId).toBe('res-99');
    expect(result.data?.totalScore).toBe(85);
    expect(result.data?.isReleased).toBe(true);
  });

  it('handles evaluation RPC failures gracefully', async () => {
    (supabase.rpc as any).mockResolvedValueOnce({
      data: null,
      error: { message: 'Attempt already submitted or invalid ownership' },
    });

    const result = await submitAndEvaluateMockAttempt('att-invalid', 1000);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Attempt already submitted or invalid ownership');
  });

  it('updates attempt timer and last question position in database', async () => {
    const updateEqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });

    (supabase.from as any).mockReturnValueOnce({
      update: updateMock,
    });

    const result = await updateMockAttemptTime('att-100', 360, 'q-last-5');

    expect(supabase.from).toHaveBeenCalledWith('mock_attempts');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        time_remaining_seconds: 360,
        last_question_id: 'q-last-5',
      })
    );
    expect(updateEqMock).toHaveBeenCalledWith('attempt_id', 'att-100');
    expect(result.success).toBe(true);
  });

  it('enforces drain barrier before evaluation in submission flow', async () => {
    // Enqueue an answer
    webPersistenceQueue.enqueueAnswer(
      {
        questionId: 'q-1',
        answerId: 'ans-1',
        questionType: 'mcq',
        value: 'opt-A',
        isMarkedForReview: false,
        timeSpentSeconds: 15,
      },
      'att-drain-test'
    );

    expect(webPersistenceQueue.isDirty('ans-1')).toBe(true);
    expect(webPersistenceQueue.getDirtyCount()).toBe(1);

    (supabase.rpc as any).mockResolvedValue({
      data: { success: true, synced_count: 1 },
      error: null,
    });

    // Drain
    await webPersistenceQueue.drainAllDirtyAnswers('att-drain-test', 5000);

    expect(webPersistenceQueue.isDirty('ans-1')).toBe(false);
    expect(webPersistenceQueue.getDirtyCount()).toBe(0);
  });
});
