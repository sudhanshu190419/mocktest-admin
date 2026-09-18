/**
 * Web Persistence Queue & Synchronization Engine
 *
 * High-performance, collision-free, and crash-resilient answer persistence queue
 * adapted specifically for web browsers (Next.js / React 19).
 *
 * Preserves the exact semantics and guarantees from the mobile test engine:
 *   - Instant UI (0ms): Changes are buffered in memory immediately.
 *   - Latest-Write-Wins (Monotonic Timestamps): Edits during in-flight network requests
 *     are never lost or overwritten by stale server acknowledgments.
 *   - Batch Persistence: Flushes multiple answers via persist_mock_answers_batch RPC.
 *   - Non-reentrant in-flight barrier: Prevents overlapping duplicate network calls.
 *   - Automatic debouncing (800ms) + Batch threshold (5 items) + Periodic sync (15s).
 *   - Browser Lifecycle Listeners: visibilitychange, pagehide, and beforeunload.
 *   - SSR Safe: No direct DOM/window access during server-side compilation.
 *
 * @module services/student/webPersistenceQueue
 */

import { persistMockAnswersBatch, type DirtyAnswerItem } from './studentTestWebService';

export type { DirtyAnswerItem };

export type SaveStatus = 'saved' | 'saving' | 'pending' | 'failed';

export type BatchPersistHandler = (
  attemptId: string,
  answers: DirtyAnswerItem[]
) => Promise<{ success: boolean; error?: string; syncedCount?: number }>;

export interface WebPersistenceQueueConfig {
  debounceMs?: number; // Default: 800ms
  maxBatchSize?: number; // Default: 5 items
  periodicIntervalMs?: number; // Default: 15,000ms (15s)
  drainTimeoutMs?: number; // Default: 15,000ms (15s)
  drainRetryBackoffMs?: number; // Default: 300ms
}

// ─── Default Configuration (Matching Mobile Source Exactly) ─────────────────

export const DEFAULT_QUEUE_CONFIG: Required<WebPersistenceQueueConfig> = {
  debounceMs: 800, // Matched from mobile TestEngineScreen.tsx:734
  maxBatchSize: 5, // Matched batch threshold trigger
  periodicIntervalMs: 15_000, // Matched from mobile persistenceQueue.ts:275
  drainTimeoutMs: 15_000, // Matched from mobile persistenceQueue.ts:236
  drainRetryBackoffMs: 300, // Matched from mobile persistenceQueue.ts:260
};

export interface FlushResult {
  persistedCount: number;
  remainingCount: number;
  success: boolean;
  error?: string;
}

// ─── WebPersistenceQueue Class ───────────────────────────────────────────────

export class WebPersistenceQueue {
  private dirtyAnswers = new Map<string, DirtyAnswerItem>();
  private activeAttemptId: string | null = null;
  private dirtySequence = 0;
  private config: Required<WebPersistenceQueueConfig>;

  // Timers
  private debounceTimerId: ReturnType<typeof setTimeout> | null = null;
  private periodicSyncTimerId: ReturnType<typeof setInterval> | null = null;

  // Concurrency & in-flight barrier
  private isFlushInProgress = false;
  private flushInProgressPromise: Promise<FlushResult> | null = null;

  // Custom handler override (e.g. for unit testing)
  private persistHandler: BatchPersistHandler = persistMockAnswersBatch;

  // Browser lifecycle handlers
  private visibilityHandler: (() => void) | null = null;
  private pageHideHandler: (() => void) | null = null;
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

  // Save status & subscribers
  private currentSaveStatus: SaveStatus = 'saved';
  private statusListeners = new Set<(status: SaveStatus) => void>();

  constructor(config?: WebPersistenceQueueConfig, handler?: BatchPersistHandler) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
    if (handler) {
      this.persistHandler = handler;
    }
  }

  public registerPersistHandler(handler: BatchPersistHandler): void {
    this.persistHandler = handler;
  }

  public setActiveAttemptId(attemptId: string | null): void {
    this.activeAttemptId = attemptId;
  }

  public getActiveAttemptId(): string | null {
    return this.activeAttemptId;
  }

  public setSaveStatus(status: SaveStatus): void {
    this.currentSaveStatus = status;
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (err) {
        console.error('[WebPersistenceQueue] Error in status listener:', err);
      }
    });
  }

  public subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentSaveStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public getSaveStatus(): SaveStatus {
    return this.currentSaveStatus;
  }

  /**
   * Buffers an answer locally with a strictly increasing monotonic timestamp.
   */
  public enqueueAnswer(item: Omit<DirtyAnswerItem, 'dirtyAt'>, attemptId?: string): void {
    this.markAnswerDirty(item, attemptId);
  }

  public markAnswerDirty(item: Omit<DirtyAnswerItem, 'dirtyAt'>, attemptId?: string): void {
    if (attemptId) {
      this.activeAttemptId = attemptId;
    }

    const key = item.answerId || item.questionId;
    const monotonicDirtyAt = Date.now() * 1000 + (++this.dirtySequence % 1000);

    const dirtyRecord: DirtyAnswerItem = {
      ...item,
      dirtyAt: monotonicDirtyAt,
    };

    this.dirtyAnswers.set(key, dirtyRecord);
    this.setSaveStatus('pending');

    // Immediate flush if threshold is reached
    if (this.dirtyAnswers.size >= this.config.maxBatchSize) {
      if (this.debounceTimerId) {
        clearTimeout(this.debounceTimerId);
        this.debounceTimerId = null;
      }
      void this.flushDirtyAnswers(this.activeAttemptId || attemptId || undefined);
      return;
    }

    // Otherwise reset debounce timer
    if (this.debounceTimerId) {
      clearTimeout(this.debounceTimerId);
    }
    this.debounceTimerId = setTimeout(() => {
      this.debounceTimerId = null;
      void this.flushDirtyAnswers(this.activeAttemptId || attemptId || undefined);
    }, this.config.debounceMs);
  }

  public getDirtyAnswersCount(): number {
    return this.dirtyAnswers.size;
  }

  public getDirtyCount(): number {
    return this.dirtyAnswers.size;
  }

  public getDirtyAnswer(key: string): DirtyAnswerItem | undefined {
    return this.dirtyAnswers.get(key);
  }

  public isDirty(key: string): boolean {
    return this.dirtyAnswers.has(key);
  }

  public getAllDirtyAnswers(): DirtyAnswerItem[] {
    return Array.from(this.dirtyAnswers.values());
  }

  public clearDirtyAnswer(key: string): void {
    this.dirtyAnswers.delete(key);
  }

  public clearAllDirtyAnswers(): void {
    this.dirtyAnswers.clear();
  }

  /**
   * Flushes dirty answers to the backend using an in-flight non-reentrant barrier.
   */
  public async flushDirtyAnswers(attemptId?: string): Promise<FlushResult> {
    const targetAttemptId = attemptId || this.activeAttemptId || undefined;

    if (this.debounceTimerId) {
      clearTimeout(this.debounceTimerId);
      this.debounceTimerId = null;
    }

    if (this.dirtyAnswers.size === 0) {
      if (this.currentSaveStatus !== 'saving') {
        this.setSaveStatus('saved');
      }
      return { persistedCount: 0, remainingCount: 0, success: true };
    }

    if (!targetAttemptId) {
      return {
        persistedCount: 0,
        remainingCount: this.dirtyAnswers.size,
        success: false,
        error: 'No active attemptId specified for flush.',
      };
    }

    // In-flight barrier: await current in-flight flush if active
    if (this.isFlushInProgress && this.flushInProgressPromise) {
      return this.flushInProgressPromise;
    }

    this.isFlushInProgress = true;
    this.setSaveStatus('saving');

    this.flushInProgressPromise = (async () => {
      const snapshot = Array.from(this.dirtyAnswers.values());
      try {
        const result = await this.persistHandler(targetAttemptId, snapshot);

        if (result.success) {
          // Reconcile snapshot against dirty map to preserve newer in-flight edits
          for (const item of snapshot) {
            const key = item.answerId || item.questionId;
            const current = this.dirtyAnswers.get(key);
            if (current && current.dirtyAt === item.dirtyAt) {
              this.dirtyAnswers.delete(key);
            }
          }

          const remaining = this.dirtyAnswers.size;
          this.setSaveStatus(remaining > 0 ? 'pending' : 'saved');

          return {
            persistedCount: result.syncedCount ?? snapshot.length,
            remainingCount: remaining,
            success: true,
          };
        } else {
          console.warn('[WebPersistenceQueue] Batch persist rejected by server:', result.error);
          this.setSaveStatus('failed');
          return {
            persistedCount: 0,
            remainingCount: this.dirtyAnswers.size,
            success: false,
            error: result.error,
          };
        }
      } catch (err: any) {
        console.error('[WebPersistenceQueue] Flush exception:', err);
        this.setSaveStatus('failed');
        return {
          persistedCount: 0,
          remainingCount: this.dirtyAnswers.size,
          success: false,
          error: err?.message || 'Network failure during batch persistence',
        };
      } finally {
        this.isFlushInProgress = false;
        this.flushInProgressPromise = null;
      }
    })();

    return this.flushInProgressPromise;
  }

  public flushBatch(attemptId?: string): Promise<FlushResult> {
    return this.flushDirtyAnswers(attemptId);
  }

  /**
   * Pre-Submission Drain Barrier.
   * Guarantees zero dirty answers remain in the queue before test submission.
   */
  public async drainAllDirtyAnswers(attemptId?: string, timeoutMs?: number): Promise<void> {
    const targetAttemptId = (attemptId || this.activeAttemptId) ?? undefined;
    const timeout = timeoutMs ?? this.config.drainTimeoutMs;
    const startTime = Date.now();

    if (this.debounceTimerId) {
      clearTimeout(this.debounceTimerId);
      this.debounceTimerId = null;
    }

    if (this.isFlushInProgress && this.flushInProgressPromise) {
      await this.flushInProgressPromise;
    }

    while (this.dirtyAnswers.size > 0) {
      if (Date.now() - startTime > timeout) {
        throw new Error(
          `[WebPersistenceQueue] drainAllDirtyAnswers timed out after ${timeout}ms with ${this.dirtyAnswers.size} dirty answers remaining.`
        );
      }

      const flushRes = await this.flushDirtyAnswers(targetAttemptId);
      if (!flushRes.success) {
        await new Promise((resolve) => setTimeout(resolve, this.config.drainRetryBackoffMs));
      }
    }
  }

  public startPeriodicSync(attemptId: string, intervalMs?: number): void {
    this.activeAttemptId = attemptId;
    this.stopPeriodicSync();

    const interval = intervalMs ?? this.config.periodicIntervalMs;
    this.periodicSyncTimerId = setInterval(() => {
      if (this.dirtyAnswers.size > 0 && this.activeAttemptId) {
        void this.flushDirtyAnswers(this.activeAttemptId);
      }
    }, interval);
  }

  public stopPeriodicSync(): void {
    if (this.periodicSyncTimerId) {
      clearInterval(this.periodicSyncTimerId);
      this.periodicSyncTimerId = null;
    }
  }

  public setupBrowserLifecycle(attemptId?: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    if (attemptId) {
      this.activeAttemptId = attemptId;
    }

    this.cleanupBrowserLifecycle();

    this.visibilityHandler = () => {
      if (document.visibilityState === 'hidden' && this.dirtyAnswers.size > 0) {
        void this.flushDirtyAnswers(this.activeAttemptId || undefined);
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    this.pageHideHandler = () => {
      if (this.dirtyAnswers.size > 0) {
        void this.flushDirtyAnswers(this.activeAttemptId || undefined);
      }
    };
    window.addEventListener('pagehide', this.pageHideHandler);

    this.beforeUnloadHandler = () => {
      if (this.dirtyAnswers.size > 0) {
        void this.flushDirtyAnswers(this.activeAttemptId || undefined);
      }
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  public cleanupBrowserLifecycle(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
    }
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }

  public dispose(): void {
    if (this.debounceTimerId) {
      clearTimeout(this.debounceTimerId);
      this.debounceTimerId = null;
    }
    this.stopPeriodicSync();
    this.cleanupBrowserLifecycle();
    this.clearAllDirtyAnswers();
    this.statusListeners.clear();
    this.currentSaveStatus = 'saved';
  }
}

// ─── Default Singleton Instance ──────────────────────────────────────────────

export const webPersistenceQueue = new WebPersistenceQueue();

// Export convenience functions wrapping the singleton
export const markAnswerDirty = (item: Omit<DirtyAnswerItem, 'dirtyAt'>, attemptId?: string) =>
  webPersistenceQueue.markAnswerDirty(item, attemptId);
export const flushDirtyAnswers = (attemptId?: string) =>
  webPersistenceQueue.flushDirtyAnswers(attemptId);
export const drainAllDirtyAnswers = (attemptId?: string, timeoutMs?: number) =>
  webPersistenceQueue.drainAllDirtyAnswers(attemptId, timeoutMs);
export const startPeriodicSync = (attemptId: string, intervalMs?: number) =>
  webPersistenceQueue.startPeriodicSync(attemptId, intervalMs);
export const stopPeriodicSync = () => webPersistenceQueue.stopPeriodicSync();
export const setActiveAttemptId = (attemptId: string | null) =>
  webPersistenceQueue.setActiveAttemptId(attemptId);
export const getDirtyAnswersCount = () => webPersistenceQueue.getDirtyAnswersCount();
export const getDirtyAnswer = (answerId: string) =>
  webPersistenceQueue.getDirtyAnswer(answerId);
export const clearDirtyAnswer = (answerId: string) =>
  webPersistenceQueue.clearDirtyAnswer(answerId);
export const clearAllDirtyAnswers = () => webPersistenceQueue.clearAllDirtyAnswers();
export const registerBatchPersistHandler = (handler: BatchPersistHandler) =>
  webPersistenceQueue.registerPersistHandler(handler);
export const setupBrowserLifecycle = (attemptId?: string) =>
  webPersistenceQueue.setupBrowserLifecycle(attemptId);
export const cleanupBrowserLifecycle = () =>
  webPersistenceQueue.cleanupBrowserLifecycle();
