'use client';

/**
 * Shared leave badges (Phase 2D dedup)
 *
 * Used by both the teacher ("My Leave Requests") and admin ("Leave Requests"
 * inbox) surfaces. The shared `StatusBadge` lacks plain `pending`, so the
 * leave palette lives here.
 *
 * @module components/ui/LeaveStatusBadge
 */

import { WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const LEAVE_STATUS_STYLES: Record<string, { label: string; cls: string; dot: string }> = {
  pending: {
    label: 'Pending',
    cls: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
    dot: 'bg-amber-500',
  },
  approved: {
    label: 'Approved',
    cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
    dot: 'bg-emerald-500',
  },
  rejected: {
    label: 'Rejected',
    cls: 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
    dot: 'bg-red-500',
  },
  cancelled: {
    label: 'Cancelled',
    cls: 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800',
    dot: 'bg-rose-500',
  },
};

export function LeaveStatusBadge({ status }: { status: string }) {
  const s = LEAVE_STATUS_STYLES[status] ?? {
    label: status,
    cls: 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700',
    dot: 'bg-gray-400',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-5',
        s.cls,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

export function LeaveEmergencyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400">
      <WarningCircle size={11} weight="fill" />
      Emergency
    </span>
  );
}
