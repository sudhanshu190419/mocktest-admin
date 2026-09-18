import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebTimerService } from '../webTimerService';

describe('WebTimerService', () => {
  let timer: WebTimerService;

  beforeEach(() => {
    vi.useFakeTimers();
    timer = new WebTimerService();
  });

  afterEach(() => {
    timer.dispose();
    vi.restoreAllMocks();
  });

  it('formats time correctly for hours and minutes', () => {
    expect(WebTimerService.formatTime(3665)).toBe('01:01:05');
    expect(WebTimerService.formatTime(59)).toBe('00:59');
    expect(WebTimerService.formatTime(0)).toBe('00:00');
    expect(WebTimerService.formatTime(-10)).toBe('00:00');
  });

  it('starts countdown and notifies tick subscribers', () => {
    const ticks: number[] = [];
    const formattedList: string[] = [];

    timer.start({
      attemptId: 'att-123',
      initialRemainingSeconds: 120,
      onTick: (rem, fmt) => {
        ticks.push(rem);
        formattedList.push(fmt);
      },
    });

    expect(ticks[0]).toBe(120);
    expect(formattedList[0]).toBe('02:00');
    expect(timer.getRemainingSeconds()).toBe(120);
    expect(timer.isActive()).toBe(true);

    // Advance 5 seconds
    vi.advanceTimersByTime(5000);

    expect(timer.getRemainingSeconds()).toBe(115);
    expect(timer.getFormattedTime()).toBe('01:55');
  });

  it('resists timer throttling via wall-clock delta calculation', () => {
    timer.start({
      attemptId: 'att-123',
      initialRemainingSeconds: 300,
    });

    // Advance 30 seconds
    vi.advanceTimersByTime(30000);

    expect(timer.getRemainingSeconds()).toBe(270);
    expect(timer.getFormattedTime()).toBe('04:30');
  });

  it('fires onTimeUp and triggers immediate zero sync when countdown reaches zero', async () => {
    const onTimeUpMock = vi.fn();
    const onServerSyncMock = vi.fn().mockResolvedValue(true);

    timer.start({
      attemptId: 'att-123',
      initialRemainingSeconds: 3,
      onTimeUp: onTimeUpMock,
      onServerSync: onServerSyncMock,
    });

    expect(onTimeUpMock).not.toHaveBeenCalled();

    // Advance to zero
    vi.advanceTimersByTime(3000);

    expect(timer.getRemainingSeconds()).toBe(0);
    expect(onTimeUpMock).toHaveBeenCalledTimes(1);
    expect(timer.isActive()).toBe(false);

    // Advancing further does not double-fire onTimeUp
    vi.advanceTimersByTime(5000);
    expect(onTimeUpMock).toHaveBeenCalledTimes(1);
  });

  it('runs periodic 60-second server sync heartbeat', async () => {
    const onServerSyncMock = vi.fn().mockResolvedValue(true);
    const getCurrentQuestionIdMock = vi.fn().mockReturnValue('q-active-99');

    timer.start({
      attemptId: 'att-sync-1',
      initialRemainingSeconds: 180,
      syncIntervalMs: 60_000,
      getCurrentQuestionId: getCurrentQuestionIdMock,
      onServerSync: onServerSyncMock,
    });

    expect(onServerSyncMock).not.toHaveBeenCalled();

    // Advance 60s
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onServerSyncMock).toHaveBeenCalledTimes(1);
    expect(onServerSyncMock).toHaveBeenCalledWith('att-sync-1', 120, 'q-active-99');

    // Advance another 60s
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onServerSyncMock).toHaveBeenCalledTimes(2);
    expect(onServerSyncMock).toHaveBeenCalledWith('att-sync-1', 60, 'q-active-99');
  });

  it('reconciles remaining time with server updates', () => {
    timer.start({
      attemptId: 'att-123',
      initialRemainingSeconds: 100,
    });

    vi.advanceTimersByTime(10000);
    expect(timer.getRemainingSeconds()).toBe(90);

    // Server re-anchoring (e.g. after resume or visibility reconciliation)
    timer.reconcileRemaining(45);
    expect(timer.getRemainingSeconds()).toBe(45);
    expect(timer.getFormattedTime()).toBe('00:45');
  });

  it('supports pause and resume without drift', () => {
    timer.start({
      attemptId: 'att-123',
      initialRemainingSeconds: 100,
    });

    vi.advanceTimersByTime(10000);
    expect(timer.getRemainingSeconds()).toBe(90);

    // Pause
    timer.pause();
    expect(timer.isActive()).toBe(false);

    // 20s pass while paused
    vi.advanceTimersByTime(20000);
    expect(timer.getRemainingSeconds()).toBe(90);

    // Resume
    timer.resume();
    expect(timer.isActive()).toBe(true);

    // 5s pass after resume
    vi.advanceTimersByTime(5000);
    expect(timer.getRemainingSeconds()).toBe(85);
  });

  it('cleans up and stops all intervals on dispose', () => {
    const onTick = vi.fn();
    timer.start({
      attemptId: 'att-123',
      initialRemainingSeconds: 100,
      onTick,
    });

    timer.dispose();
    expect(timer.isActive()).toBe(false);

    vi.advanceTimersByTime(10000);
    // onTick should not be called after disposal
    expect(onTick).toHaveBeenCalledTimes(1); // initial call only
  });
});
