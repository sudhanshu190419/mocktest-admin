'use client';

/**
 * ProcessingIndicator
 *
 * Displays a visual indicator for recordings that are actively being
 * recorded or processed. Used in recording list items and detail views
 * to inform the user that the recording is not yet ready.
 *
 * @module components/recording/ProcessingIndicator
 */

import type { RecordingStatus } from '@/types/recording';

// ─── Icons ──────────────────────────────────────────────────────────────────

import { CircleNotch } from '@phosphor-icons/react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProcessingIndicatorProps {
  /** The current recording status. Determines the message shown. */
  status: 'recording' | 'processing';
  /**
   * Optional size variant.
   * - `'default'`: Full-width banner with icon + description.
   * - `'compact'`: Inline spinner + short label (for cards).
   *
   * Default: `'default'`.
   */
  size?: 'default' | 'compact';
}

// ─── Configuration ──────────────────────────────────────────────────────────

const STATUS_MESSAGES: Record<
  'recording' | 'processing',
  { title: string; description: string }
> = {
  recording: {
    title: 'Recording in Progress',
    description: 'The live class is being recorded. The recording will be available once it has completed processing.',
  },
  processing: {
    title: 'Processing Recording',
    description: 'Your recording is being processed and exported to storage. This may take a few minutes depending on the duration.',
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export function ProcessingIndicator({
  status,
  size = 'default',
}: ProcessingIndicatorProps) {
  const config = STATUS_MESSAGES[status];

  if (size === 'compact') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
        <CircleNotch size={12} weight="bold" className="animate-spin" />
        {config.title}
      </span>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
      <CircleNotch
        size={20}
        weight="bold"
        className="mt-0.5 shrink-0 animate-spin text-blue-500"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
          {config.title}
        </p>
        <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">
          {config.description}
        </p>
      </div>
    </div>
  );
}
