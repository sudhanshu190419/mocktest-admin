'use client';

import Link from 'next/link';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

/** One entry in the pending review queue. */
export interface ReviewQueueItem {
  id: string;
  /** Optional short label (e.g. truncated title) — shown in hover tooltip. */
  label?: string;
}

export interface ReviewNavigationProps {
  /**
   * Ordered queue of pending resources. The order must match the review
   * list order (typically newest-first) so Prev/Next feel natural.
   */
  items: ReviewQueueItem[];
  /** ID of the currently open resource. */
  currentId: string;
  /** Builds the href for a queue item. */
  hrefFor: (id: string) => string;
  /** Short label used in the counter, e.g. "pending question". */
  itemLabel?: string;
  /** Show skeleton placeholders while the queue loads. */
  loading?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Review Navigation Bar
 *
 * Lets reviewers move between pending resources without going back to the
 * list. Renders Previous Pending / position counter / Next Pending.
 *
 * - The current item's position is computed from the provided queue.
 * - If the current item is not in the queue (e.g. already approved), the
 *   counter shows "—" and Prev/Next are disabled.
 * - While `loading`, skeleton placeholders are shown.
 */
export function ReviewNavigation({
  items,
  currentId,
  hrefFor,
  itemLabel = 'pending',
  loading = false,
}: ReviewNavigationProps) {
  if (loading) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-900">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
    );
  }

  const index = items.findIndex((i) => i.id === currentId);
  const total = items.length;
  const position = index >= 0 ? index + 1 : null;
  const prev = index > 0 ? items[index - 1] : null;
  const next = index >= 0 && index < total - 1 ? items[index + 1] : null;

  const navButtonClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800';
  const disabledButtonClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-400 opacity-60 dark:border-gray-700 dark:bg-gray-900';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-900">
      {/* Previous */}
      {prev ? (
        <Link href={hrefFor(prev.id)} className={navButtonClass} title={prev.label}>
          <CaretLeft size={14} />
          Previous {itemLabel}
        </Link>
      ) : (
        <span className={disabledButtonClass}>
          <CaretLeft size={14} />
          Previous {itemLabel}
        </span>
      )}

      {/* Position counter */}
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold text-gray-700 dark:text-gray-200">
          {position ?? '—'}
        </span>
        <span>/</span>
        <span>
          {total} {itemLabel}
          {total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Next */}
      {next ? (
        <Link href={hrefFor(next.id)} className={navButtonClass} title={next.label}>
          Next {itemLabel}
          <CaretRight size={14} />
        </Link>
      ) : (
        <span className={disabledButtonClass}>
          Next {itemLabel}
          <CaretRight size={14} />
        </span>
      )}
    </div>
  );
}

export default ReviewNavigation;
