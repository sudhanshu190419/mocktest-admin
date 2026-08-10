'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Lesson Month Navigator (Phase 2B — navigation shell only)
//
//  Controlled component: the parent owns the selected month (Date, first day
//  of month) and passes it in. Renders ‹ Today › + month label. The parent
//  decides what happens on prev/next/today, so Phase 2C can consume the
//  exposed month/range without this component fetching anything.
// ═══════════════════════════════════════════════════════════════════════════

interface LessonMonthNavigatorProps {
  /** First day of the currently displayed month. */
  month: Date;
  onPrev: () => void;
  onNext: () => void;
  /** Jump back to the current calendar month. */
  onToday: () => void;
}

export function LessonMonthNavigator({
  month,
  onPrev,
  onNext,
  onToday,
}: LessonMonthNavigatorProps) {
  const label = month.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          title="Previous month"
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <CaretLeft size={16} />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
        >
          Today
        </button>
        <button
          type="button"
          onClick={onNext}
          title="Next month"
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <CaretRight size={16} />
        </button>
      </div>
      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  );
}
