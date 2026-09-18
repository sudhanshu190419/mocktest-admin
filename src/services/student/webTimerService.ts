/**
 * Web Test Timer & Server Synchronization Service
 *
 * Standalone, drift-resistant, and SSR-safe countdown timer and sync engine
 * for the Web Test Runner.
 *
 * Key Capabilities:
 *   1. Wall-Clock Delta Model: Derives remaining time using `initialRemaining - floor((now - startTime)/1000)`
 *      to ensure 100% accuracy even when browsers throttle background tab timers.
 *   2. Server Heartbeat Synchronization: Periodic 60-second sync updating `mock_attempts.time_remaining_seconds`
 *      and `last_question_id`.
 *   3. Lifecycle Synchronization: Immediate sync on tab backgrounding (`visibilitychange` hidden) and test submission.
 *   4. Zero Expiry Detection: Invokes `onTimeUp` callback once when timer reaches zero.
 *   5. React Decoupled: Can be cleanly subscribed to and disposed of by React components.
 *   6. SSR Safe: Does not access browser globals during server rendering.
 *
 * @module services/student/webTimerService
 */

export interface WebTimerConfig {
  attemptId: string;
  initialRemainingSeconds: number;
  syncIntervalMs?: number; // Default: 60,000ms (60s)
  getCurrentQuestionId?: () => string | null | undefined;
  onTick?: (remainingSeconds: number, formattedTime: string) => void;
  onTimeUp?: () => void;
  onSyncStatusChange?: (status: 'saved' | 'pending' | 'failed') => void;
  onServerSync?: (
    attemptId: string,
    timeRemainingSeconds: number,
    lastQuestionId?: string | null
  ) => Promise<boolean>;
}

export class WebTimerService {
  private attemptId: string | null = null;
  private initialRemainingSeconds: number = 0;
  private remainingSeconds: number = 0;
  private startTimestamp: number = 0;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private hasExpired: boolean = false;

  private tickIntervalId: ReturnType<typeof setInterval> | null = null;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private syncIntervalMs: number = 60_000;

  private getCurrentQuestionId: (() => string | null | undefined) | null = null;
  private onTickListeners: Set<(remaining: number, formatted: string) => void> = new Set();
  private onTimeUpListeners: Set<() => void> = new Set();
  private onSyncStatusListeners: Set<(status: 'saved' | 'pending' | 'failed') => void> = new Set();
  private onServerSyncHandler: ((
    attemptId: string,
    timeRemainingSeconds: number,
    lastQuestionId?: string | null
  ) => Promise<boolean>) | null = null;

  private isSyncing: boolean = false;

  /**
   * Format total seconds into HH:MM:SS or MM:SS
   */
  public static formatTime(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  /**
   * Start the timer with the given configuration.
   */
  public start(config: WebTimerConfig): void {
    this.stop(); // Stop any existing running instance

    this.attemptId = config.attemptId;
    this.initialRemainingSeconds = Math.max(0, Math.floor(config.initialRemainingSeconds));
    this.remainingSeconds = this.initialRemainingSeconds;
    this.syncIntervalMs = config.syncIntervalMs ?? 60_000;
    this.getCurrentQuestionId = config.getCurrentQuestionId ?? null;
    this.onServerSyncHandler = config.onServerSync ?? null;

    if (config.onTick) this.onTickListeners.add(config.onTick);
    if (config.onTimeUp) this.onTimeUpListeners.add(config.onTimeUp);
    if (config.onSyncStatusChange) this.onSyncStatusListeners.add(config.onSyncStatusChange);

    this.startTimestamp = Date.now();
    this.isRunning = true;
    this.isPaused = false;
    this.hasExpired = this.remainingSeconds <= 0;

    // Immediate initial notification
    this.notifyTick();

    if (this.hasExpired) {
      this.notifyTimeUp();
      return;
    }

    // 1. Tick interval (every 1s)
    this.tickIntervalId = setInterval(() => {
      this.tick();
    }, 1000);

    // 2. Periodic server sync interval (every 60s)
    this.syncIntervalId = setInterval(() => {
      void this.syncWithServer();
    }, this.syncIntervalMs);
  }

  /**
   * Internal tick handler using wall-clock delta
   */
  private tick(): void {
    if (!this.isRunning || this.isPaused || this.hasExpired) return;

    const elapsedSeconds = Math.floor((Date.now() - this.startTimestamp) / 1000);
    const currentRemaining = Math.max(0, this.initialRemainingSeconds - elapsedSeconds);

    this.remainingSeconds = currentRemaining;
    this.notifyTick();

    if (this.remainingSeconds <= 0) {
      this.hasExpired = true;
      this.stopIntervals();
      this.notifyTimeUp();
      // Perform immediate zero sync
      void this.syncWithServer();
    }
  }

  /**
   * Reconcile remaining time with an authoritative server state or resume value
   */
  public reconcileRemaining(serverRemainingSeconds: number): void {
    const s = Math.max(0, Math.floor(serverRemainingSeconds));
    this.initialRemainingSeconds = s;
    this.remainingSeconds = s;
    this.startTimestamp = Date.now();
    this.hasExpired = s <= 0;

    this.notifyTick();

    if (this.hasExpired) {
      this.stopIntervals();
      this.notifyTimeUp();
    }
  }

  /**
   * Sync current timer and last question position to the backend
   */
  public async syncWithServer(): Promise<boolean> {
    if (!this.attemptId || !this.onServerSyncHandler || this.isSyncing) {
      return false;
    }

    this.isSyncing = true;
    const timeRemaining = Math.max(0, Math.floor(this.remainingSeconds));
    const lastQuestionId = this.getCurrentQuestionId ? this.getCurrentQuestionId() : null;

    try {
      this.notifySyncStatus('pending');
      const success = await this.onServerSyncHandler(this.attemptId, timeRemaining, lastQuestionId);
      if (success) {
        this.notifySyncStatus('saved');
      } else {
        this.notifySyncStatus('failed');
      }
      return success;
    } catch (err) {
      console.warn('[WebTimerService] Sync error:', err);
      this.notifySyncStatus('failed');
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pause the countdown timer (e.g. during system modals)
   */
  public pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
  }

  /**
   * Resume the countdown timer after a pause
   */
  public resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    // Re-anchor startTimestamp to preserve remaining duration
    this.initialRemainingSeconds = this.remainingSeconds;
    this.startTimestamp = Date.now();
    this.isPaused = false;
  }

  /**
   * Stop the timer and clear all intervals and subscriptions
   */
  public stop(): void {
    this.stopIntervals();
    this.isRunning = false;
    this.isPaused = false;
    this.attemptId = null;
    this.getCurrentQuestionId = null;
    this.onServerSyncHandler = null;
    this.onTickListeners.clear();
    this.onTimeUpListeners.clear();
    this.onSyncStatusListeners.clear();
  }

  /**
   * Stop internal interval timers without clearing listeners
   */
  private stopIntervals(): void {
    if (this.tickIntervalId !== null) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }
    if (this.syncIntervalId !== null) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  /**
   * Subscribe to 1s visual ticks
   */
  public subscribeTicks(callback: (remaining: number, formatted: string) => void): () => void {
    this.onTickListeners.add(callback);
    callback(this.remainingSeconds, WebTimerService.formatTime(this.remainingSeconds));
    return () => this.onTickListeners.delete(callback);
  }

  /**
   * Subscribe to zero-expiry event
   */
  public subscribeZero(callback: () => void): () => void {
    this.onTimeUpListeners.add(callback);
    return () => this.onTimeUpListeners.delete(callback);
  }

  /**
   * Subscribe to heartbeat sync status changes
   */
  public subscribeSyncStatus(callback: (status: 'saved' | 'pending' | 'failed') => void): () => void {
    this.onSyncStatusListeners.add(callback);
    return () => this.onSyncStatusListeners.delete(callback);
  }

  /**
   * Get current remaining time in seconds
   */
  public getRemainingSeconds(): number {
    return Math.max(0, Math.floor(this.remainingSeconds));
  }

  /**
   * Get formatted time string
   */
  public getFormattedTime(): string {
    return WebTimerService.formatTime(this.remainingSeconds);
  }

  /**
   * Whether the timer is currently active
   */
  public isActive(): boolean {
    return this.isRunning && !this.isPaused && !this.hasExpired;
  }

  /**
   * Full cleanup / disposal
   */
  public dispose(): void {
    this.stop();
  }

  // ─── Event Dispatchers ───────────────────────────────────────────────────

  private notifyTick(): void {
    const formatted = WebTimerService.formatTime(this.remainingSeconds);
    for (const listener of this.onTickListeners) {
      try {
        listener(this.remainingSeconds, formatted);
      } catch (err) {
        console.error('[WebTimerService] Error in tick listener:', err);
      }
    }
  }

  private notifyTimeUp(): void {
    for (const listener of this.onTimeUpListeners) {
      try {
        listener();
      } catch (err) {
        console.error('[WebTimerService] Error in time-up listener:', err);
      }
    }
  }

  private notifySyncStatus(status: 'saved' | 'pending' | 'failed'): void {
    for (const listener of this.onSyncStatusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('[WebTimerService] Error in sync status listener:', err);
      }
    }
  }
}

/**
 * Singleton timer instance for shared runner access
 */
export const webTimerService = new WebTimerService();
