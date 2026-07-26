'use client';

/**
 * RecordingsSkeleton
 *
 * Loading skeleton placeholder for the recordings grid view.
 * Displays a grid of pulsing card shapes while the data is loading.
 *
 * @module components/recording/RecordingsSkeleton
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecordingsSkeletonProps {
  /** Number of skeleton cards to render. Default: 6. */
  count?: number;
  /** Grid columns configuration. Default matches the recordings grid. */
  columns?: 1 | 2 | 3 | 4;
}

// ─── Grid Column Classes ────────────────────────────────────────────────────

const GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function RecordingsSkeleton({
  count = 6,
  columns = 3,
}: RecordingsSkeletonProps) {
  const gridClass = GRID_COLUMNS[columns] ?? GRID_COLUMNS[3];

  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
        >
          {/* Thumbnail placeholder */}
          <div className="aspect-video w-full rounded-t-xl bg-gray-200 dark:bg-gray-700" />

          {/* Content placeholder */}
          <div className="space-y-3 p-4">
            {/* Title */}
            <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />

            {/* Status badge */}
            <div className="h-5 w-20 rounded-full bg-gray-200 dark:bg-gray-700" />

            {/* Description */}
            <div className="space-y-1.5">
              <div className="h-3 w-full rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
            </div>

            {/* Date */}
            <div className="h-3 w-1/3 rounded bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Actions placeholder */}
          <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-700">
            <div className="h-7 w-14 rounded-md bg-gray-200 dark:bg-gray-700" />
            <div className="ml-auto h-7 w-16 rounded-md bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Single-line skeleton for list/table view.
 */
export function RecordingsListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex animate-pulse items-center gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
        >
          {/* Thumbnail */}
          <div className="h-12 w-20 shrink-0 rounded bg-gray-200 dark:bg-gray-700" />

          {/* Content */}
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-1/4 rounded bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Status */}
          <div className="h-5 w-20 rounded-full bg-gray-200 dark:bg-gray-700" />

          {/* Duration */}
          <div className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700" />

          {/* Actions */}
          <div className="h-7 w-14 rounded-md bg-gray-200 dark:bg-gray-700" />
        </div>
      ))}
    </div>
  );
}
