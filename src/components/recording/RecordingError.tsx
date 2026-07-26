'use client';

/**
 * RecordingError
 *
 * Displays error states for recording-related failures.
 * Supports both inline and banner variants.
 *
 * @module components/recording/RecordingError
 */

// ─── Icons ──────────────────────────────────────────────────────────────────

import { WarningCircle, ArrowCounterClockwise } from '@phosphor-icons/react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecordingErrorProps {
  /** Human-readable error message. */
  message: string;
  /** Optional callback for retry action. */
  onRetry?: () => void;
  /**
   * Visual variant.
   * - `'banner'`: Full-width banner with icon, message, and retry button.
   * - `'inline'`: Compact inline error with icon only (for cards/lists).
   *
   * Default: `'banner'`.
   */
  variant?: 'banner' | 'inline';
  /** If true, auto-hides after 8 seconds (banner only). Default: false. */
  autoHide?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RecordingError({
  message,
  onRetry,
  variant = 'banner',
}: RecordingErrorProps) {
  if (variant === 'inline') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
        <WarningCircle size={12} weight="bold" />
        <span className="truncate max-w-[200px]">{message}</span>
      </span>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
      <WarningCircle
        size={20}
        weight="fill"
        className="mt-0.5 shrink-0 text-red-500"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          {message}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-800/40"
        >
          <ArrowCounterClockwise size={14} weight="bold" />
          Retry
        </button>
      )}
    </div>
  );
}
