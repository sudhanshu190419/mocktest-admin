'use client';

/**
 * RecordingDuration
 *
 * Formats a duration in seconds into a human-readable string
 * (e.g. "1h 23m 45s"). Used inside RecordingCard and the
 * recording detail view.
 *
 * @module components/recording/RecordingDuration
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecordingDurationProps {
  /** Duration in seconds. Must be a positive integer. */
  seconds: number;
  /**
   * Display format.
   * - `'compact'`: "1h 23m" (omits seconds when minutes > 0)
   * - `'full'`:    "1h 23m 45s"
   * - `'auto'`:    `'compact'` for durations >= 60 min, `'full'` for shorter.
   *   Default: `'auto'`.
   */
  format?: 'compact' | 'full' | 'auto';
  /**
   * If true, renders a dark overlay badge style (for thumbnails).
   * Default: false.
   */
  overlay?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Formats seconds into hours, minutes, seconds components.
 */
function formatDuration(seconds: number): { h: number; m: number; s: number } {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return { h, m, s };
}

/**
 * Builds a human-readable string from duration components.
 */
function buildLabel(
  components: { h: number; m: number; s: number },
  format: 'compact' | 'full',
): string {
  const { h, m, s } = components;
  const parts: string[] = [];

  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (format === 'full' || (h === 0 && m === 0)) parts.push(`${s}s`);

  return parts.join(' ') || '0s';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RecordingDuration({
  seconds,
  format: formatProp = 'auto',
  overlay = false,
}: RecordingDurationProps) {
  const components = formatDuration(Math.max(0, seconds));

  // Resolve 'auto' format
  const resolvedFormat: 'compact' | 'full' =
    formatProp === 'auto'
      ? components.h >= 1 || components.m >= 60
        ? 'compact'
        : 'full'
      : formatProp;

  const label = buildLabel(components, resolvedFormat);

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${
        overlay
          ? 'bg-black/60 text-white'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      }`}
      title={`${seconds} seconds`}
      aria-label={`Duration: ${label}`}
    >
      {label}
    </span>
  );
}

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Converts seconds to a human-readable string without rendering.
 * Useful for data attributes, aria labels, or server-side usage.
 *
 * @example
 * formatDurationLabel(5025) // => "1h 23m 45s"
 */
export function formatDurationLabel(seconds: number): string {
  const components = formatDuration(Math.max(0, seconds));
  return buildLabel(components, 'full');
}
