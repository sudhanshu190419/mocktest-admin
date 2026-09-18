import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebPersistenceQueue,
  DEFAULT_QUEUE_CONFIG,
  type DirtyAnswerItem,
} from '../webPersistenceQueue';
import { persistMockAnswersBatch } from '../studentTestWebService';
import { supabase } from '@/config/supabase';

// Mock Supabase client
vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe('WebPersistenceQueue', () => {
  let queue: WebPersistenceQueue;
  let mockHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandler = vi.fn().mockResolvedValue({ success: true, syncedCount: 1 });
    queue = new WebPersistenceQueue({
      debounceMs: 50,
      maxBatchSize: 3,
      periodicIntervalMs: 500,
      drainTimeoutMs: 2000,
      drainRetryBackoffMs: 20,
    });
    queue.registerPersistHandler(mockHandler);
    queue.setActiveAttemptId('att-test-1');
  });

  afterEach(() => {
    queue.cleanupBrowserLifecycle();
    vi.useRealTimers();
  });

  describe('Default Config Constants', () => {
    it('matches the exact mobile engine constants', () => {
      expect(DEFAULT_QUEUE_CONFIG.debounceMs).toBe(800);
      expect(DEFAULT_QUEUE_CONFIG.maxBatchSize).toBe(5);
      expect(DEFAULT_QUEUE_CONFIG.periodicIntervalMs).toBe(15_000);
      expect(DEFAULT_QUEUE_CONFIG.drainTimeoutMs).toBe(15_000);
      expect(DEFAULT_QUEUE_CONFIG.drainRetryBackoffMs).toBe(300);
    });
  });

  describe('Basic Marking & Debounce', () => {
    it('marks answer dirty and sets monotonic dirtyAt timestamp', () => {
      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'opt-1',
        isMarkedForReview: false,
        isAnswered: true,
      });

      expect(queue.getDirtyAnswersCount()).toBe(1);
      const item = queue.getDirtyAnswer('ans-1');
      expect(item).toBeDefined();
      expect(item?.value).toBe('opt-1');
      expect(typeof item?.dirtyAt).toBe('number');
    });

    it('flushes automatically after debounce delay', async () => {
      vi.useFakeTimers();

      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'opt-1',
        isMarkedForReview: false,
        isAnswered: true,
      });

      expect(mockHandler).not.toHaveBeenCalled();

      // Fast-forward debounce time (50ms)
      await vi.advanceTimersByTimeAsync(60);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith('att-test-1', [
        expect.objectContaining({ answerId: 'ans-1', value: 'opt-1' }),
      ]);
      expect(queue.getDirtyAnswersCount()).toBe(0);
    });

    it('triggers immediate flush when batch threshold is reached', async () => {
      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'opt-1',
        isMarkedForReview: false,
        isAnswered: true,
      });
      queue.markAnswerDirty({
        answerId: 'ans-2',
        questionId: 'q-2',
        questionType: 'mcq',
        value: 'opt-2',
        isMarkedForReview: false,
        isAnswered: true,
      });

      expect(mockHandler).not.toHaveBeenCalled();

      // Adding 3rd item triggers maxBatchSize (3) immediate flush
      queue.markAnswerDirty({
        answerId: 'ans-3',
        questionId: 'q-3',
        questionType: 'numerical',
        value: 42,
        isMarkedForReview: false,
        isAnswered: true,
      });

      // Flushed immediately without waiting for debounce
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith('att-test-1', expect.arrayContaining([
        expect.objectContaining({ answerId: 'ans-1' }),
        expect.objectContaining({ answerId: 'ans-2' }),
        expect.objectContaining({ answerId: 'ans-3' }),
      ]));
    });

    it('flushes dirty items on periodic heartbeat interval', async () => {
      vi.useFakeTimers();
      queue.startPeriodicSync('att-test-1', 500);

      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'opt-1',
        isMarkedForReview: false,
        isAnswered: true,
      });

      // Clear debounce mock call to isolate periodic trigger
      mockHandler.mockClear();

      // Advance periodic interval (500ms)
      await vi.advanceTimersByTimeAsync(510);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(queue.getDirtyAnswersCount()).toBe(0);
    });
  });

  describe('Deduplication & Latest-Write-Wins', () => {
    it('coalesces rapid updates to the same answerId with the latest value', async () => {
      vi.useFakeTimers();

      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'numerical',
        value: 10,
        isMarkedForReview: false,
        isAnswered: true,
      });

      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'numerical',
        value: 20,
        isMarkedForReview: false,
        isAnswered: true,
      });

      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'numerical',
        value: 30,
        isMarkedForReview: true,
        isAnswered: true,
      });

      expect(queue.getDirtyAnswersCount()).toBe(1);
      const item = queue.getDirtyAnswer('ans-1');
      expect(item?.value).toBe(30);
      expect(item?.isMarkedForReview).toBe(true);

      await vi.advanceTimersByTimeAsync(60);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith('att-test-1', [
        expect.objectContaining({ answerId: 'ans-1', value: 30, isMarkedForReview: true }),
      ]);
    });
  });

  describe('Concurrency & In-Flight Race Conditions', () => {
    it('prevents overlapping duplicate flushes while a request is in flight', async () => {
      let resolveInFlight: (val: any) => void;
      const inFlightPromise = new Promise((resolve) => {
        resolveInFlight = resolve;
      });
      mockHandler.mockReturnValue(inFlightPromise);

      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'A',
        isMarkedForReview: false,
        isAnswered: true,
      });

      // Trigger first flush
      const flushPromise1 = queue.flushDirtyAnswers();

      // Trigger second concurrent flush while first is running
      const flushPromise2 = queue.flushDirtyAnswers();

      // Handler should be called only once
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // Resolve in-flight request
      resolveInFlight!({ success: true, syncedCount: 1 });
      await flushPromise1;
      await flushPromise2;

      expect(queue.getDirtyAnswersCount()).toBe(0);
    });

    it('preserves newer edits made during an in-flight flush (Race Condition Safety)', async () => {
      let resolveFirstFlush: (val: any) => void;
      const firstFlushPromise = new Promise((resolve) => {
        resolveFirstFlush = resolve;
      });
      mockHandler.mockReturnValueOnce(firstFlushPromise);

      // 1. Mark answer = A
      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'A',
        isMarkedForReview: false,
        isAnswered: true,
      });

      // 2. Start Flush 1 (with snapshot value A)
      const flushPromise = queue.flushDirtyAnswers();
      expect(mockHandler).toHaveBeenCalledWith('att-test-1', [
        expect.objectContaining({ answerId: 'ans-1', value: 'A' }),
      ]);

      // 3. User changes answer to B while Flush 1 is still in-flight
      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'B',
        isMarkedForReview: false,
        isAnswered: true,
      });

      // 4. Flush 1 resolves successfully for snapshot A
      mockHandler.mockResolvedValueOnce({ success: true, syncedCount: 1 });
      resolveFirstFlush!({ success: true, syncedCount: 1 });
      await flushPromise;

      // 5. CRITICAL: ans-1 must NOT be removed from queue because its current dirtyAt > snapshot dirtyAt!
      expect(queue.getDirtyAnswersCount()).toBe(1);
      expect(queue.getDirtyAnswer('ans-1')?.value).toBe('B');

      // 6. Next flush sends value B
      await queue.flushDirtyAnswers();
      expect(mockHandler).toHaveBeenLastCalledWith('att-test-1', [
        expect.objectContaining({ answerId: 'ans-1', value: 'B' }),
      ]);
      expect(queue.getDirtyAnswersCount()).toBe(0);
    });
  });

  describe('Failure & Retry', () => {
    it('retains dirty answers when server rejects or throws an error', async () => {
      mockHandler.mockResolvedValueOnce({ success: false, error: 'Network timeout' });

      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'A',
        isMarkedForReview: false,
        isAnswered: true,
      });

      const res = await queue.flushDirtyAnswers();
      expect(res.success).toBe(false);

      // Items remain in queue
      expect(queue.getDirtyAnswersCount()).toBe(1);
      expect(queue.getDirtyAnswer('ans-1')).toBeDefined();

      // Retry succeeds on next attempt
      mockHandler.mockResolvedValueOnce({ success: true, syncedCount: 1 });
      const retryRes = await queue.flushDirtyAnswers();
      expect(retryRes.success).toBe(true);
      expect(queue.getDirtyAnswersCount()).toBe(0);
    });
  });

  describe('Pre-Submission Drain', () => {
    it('flushes pending debounce and resolves when queue is completely empty', async () => {
      queue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'A',
        isMarkedForReview: false,
        isAnswered: true,
      });
      queue.markAnswerDirty({
        answerId: 'ans-2',
        questionId: 'q-2',
        questionType: 'mcq',
        value: 'B',
        isMarkedForReview: false,
        isAnswered: true,
      });

      expect(queue.getDirtyAnswersCount()).toBe(2);

      // Drain all answers immediately
      await queue.drainAllDirtyAnswers('att-test-1');

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(queue.getDirtyAnswersCount()).toBe(0);
    });

    it('rejects if drain times out due to persistent server failure', async () => {
      mockHandler.mockResolvedValue({ success: false, error: 'Database unavailable' });

      const failQueue = new WebPersistenceQueue({
        debounceMs: 50,
        maxBatchSize: 5,
        drainTimeoutMs: 100,
        drainRetryBackoffMs: 20,
      });
      failQueue.registerPersistHandler(mockHandler);
      failQueue.setActiveAttemptId('att-test-1');

      failQueue.markAnswerDirty({
        answerId: 'ans-1',
        questionId: 'q-1',
        questionType: 'mcq',
        value: 'A',
        isMarkedForReview: false,
        isAnswered: true,
      });

      await expect(failQueue.drainAllDirtyAnswers('att-test-1', 50)).rejects.toThrow(/timed out/);
    });
  });

  describe('Browser Lifecycle Integration & SSR Safety', () => {
    it('is SSR safe and does not crash when window/document are undefined', () => {
      // In default Node environment, window and document may be undefined
      expect(() => {
        const ssrQueue = new WebPersistenceQueue();
        ssrQueue.setupBrowserLifecycle('att-1');
        ssrQueue.cleanupBrowserLifecycle();
      }).not.toThrow();
    });

    it('flushes on visibilitychange when document is present and becomes hidden', async () => {
      const listeners: Record<string, Function[]> = {};

      const mockDoc = {
        visibilityState: 'visible',
        addEventListener: vi.fn((event: string, cb: any) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
        removeEventListener: vi.fn((event: string, cb: any) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((f) => f !== cb);
          }
        }),
      };

      const mockWin = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      // Mock globals
      (global as any).document = mockDoc;
      (global as any).window = mockWin;

      try {
        queue.setupBrowserLifecycle('att-test-1');
        expect(mockDoc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

        queue.markAnswerDirty({
          answerId: 'ans-1',
          questionId: 'q-1',
          questionType: 'mcq',
          value: 'A',
          isMarkedForReview: false,
          isAnswered: true,
        });

        // Simulate tab switch / minimize
        mockDoc.visibilityState = 'hidden';
        const visibilityCallbacks = listeners['visibilitychange'] || [];
        visibilityCallbacks.forEach((cb) => cb());

        expect(mockHandler).toHaveBeenCalledTimes(1);

        queue.cleanupBrowserLifecycle();
        expect(mockDoc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      } finally {
        delete (global as any).document;
        delete (global as any).window;
      }
    });
  });

  describe('Service RPC Bridge: persistMockAnswersBatch', () => {
    it('formats multiple question types into the exact JSONB schema expected by the RPC', async () => {
      (supabase.rpc as any).mockResolvedValue({ data: { success: true }, error: null });

      const dirtyItems: DirtyAnswerItem[] = [
        {
          answerId: 'ans-1',
          questionId: 'q-1',
          questionType: 'mcq',
          value: 'opt-a',
          isMarkedForReview: false,
          isAnswered: true,
          timeSpentSeconds: 25,
          dirtyAt: 1,
        },
        {
          answerId: 'ans-2',
          questionId: 'q-2',
          questionType: 'msq',
          value: ['opt-b', 'opt-c'],
          isMarkedForReview: true,
          isAnswered: true,
          timeSpentSeconds: 40,
          dirtyAt: 2,
        },
        {
          answerId: 'ans-3',
          questionId: 'q-3',
          questionType: 'numerical',
          value: 98.6,
          isMarkedForReview: false,
          isAnswered: true,
          timeSpentSeconds: 15,
          dirtyAt: 3,
        },
        {
          answerId: 'ans-4',
          questionId: 'q-4',
          questionType: 'subjective',
          value: 'This is my essay answer',
          isMarkedForReview: false,
          isAnswered: true,
          timeSpentSeconds: 60,
          dirtyAt: 4,
        },
      ];

      const res = await persistMockAnswersBatch('att-123', dirtyItems);
      expect(res.success).toBe(true);
      expect(res.syncedCount).toBe(4);

      expect(supabase.rpc).toHaveBeenCalledWith('persist_mock_answers_batch', {
        p_attempt_id: 'att-123',
        p_answers: [
          {
            answer_id: 'ans-1',
            question_id: 'q-1',
            is_answered: true,
            is_marked_for_review: false,
            selected_option_ids: ['opt-a'],
            numerical_answer: null,
            text_answer: null,
            time_spent_seconds: 25,
          },
          {
            answer_id: 'ans-2',
            question_id: 'q-2',
            is_answered: true,
            is_marked_for_review: true,
            selected_option_ids: ['opt-b', 'opt-c'],
            numerical_answer: null,
            text_answer: null,
            time_spent_seconds: 40,
          },
          {
            answer_id: 'ans-3',
            question_id: 'q-3',
            is_answered: true,
            is_marked_for_review: false,
            selected_option_ids: null,
            numerical_answer: 98.6,
            text_answer: null,
            time_spent_seconds: 15,
          },
          {
            answer_id: 'ans-4',
            question_id: 'q-4',
            is_answered: true,
            is_marked_for_review: false,
            selected_option_ids: null,
            numerical_answer: null,
            text_answer: 'This is my essay answer',
            time_spent_seconds: 60,
          },
        ],
      });
    });
  });
});
