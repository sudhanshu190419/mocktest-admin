'use client';

/**
 * RecordingStatusBadge
 *
 * Displays the recording status as a colored badge with a pulsing dot
 * for active states (`recording`, `processing`).
 *
 * @module components/recording/RecordingStatusBadge
 */

import type { RecordingStatus } from '@/types/recording';

// ─── Status Configuration ───────────────────────────────────────────────────

interface StatusConfig {
  /** Human-readable label. */
  label: string;
  /** Tailwind classes for the container. */
  className: string;
  /** Tailwind classes for the status dot. */
  dotClassName: string;
  /** Whether the dot should pulse (active states). */
  pulse: boolean;
}

const STATUS_CONFIG: Record<RecordingStatus, StatusConfig> = {
  recording: {
    label: 'Recording',
    className:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    dotClassName: 'bg-yellow-500',
    pulse: true,
  },
  processing: {
    label: 'Processing',
    className:
      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    dotClassName: 'bg-blue-500',
    pulse: true,
  },
  completed: {
    label: 'Completed',
    className:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    dotClassName: 'bg-emerald-500',
    pulse: false,
  },
  failed: {
    label: 'Failed',
    className:
      'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    dotClassName: 'bg-red-500',
    pulse: false,
  },
  partial: {
    label: 'Partial',
    className:
      'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    dotClassName: 'bg-orange-500',
    pulse: false,
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export interface RecordingStatusBadgeProps {
  /** The recording status to display. */
  status: RecordingStatus;
  /** If true, shows a dot indicator before the label. Default: true. */
  showDot?: boolean;
}

export function RecordingStatusBadge({
  status,
  showDot = true,
}: RecordingStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${config.className}`}
    >
      {showDot && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            config.dotClassName
          } ${config.pulse ? 'animate-pulse' : ''}`}
        />
      )}
      {config.label}
    </span>
  );
}

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable label for a recording status.
 * Useful for tooltips or screen readers.
 */
export function getRecordingStatusLabel(status: RecordingStatus): string {
  return STATUS_CONFIG[status]?.label ?? status;
}
