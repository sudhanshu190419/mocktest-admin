'use client';

import { cn } from '@/lib/utils';
import type { CompletionChecklistItem } from '@/types/profile';

interface ProfileCompletionCardProps {
  items: CompletionChecklistItem[];
  percentage: number;
  className?: string;
}

const STATUS_ICONS: Record<string, string> = {
  completed: '✓',
  pending: '○',
};

export function ProfileCompletionCard({
  items,
  percentage,
  className,
}: ProfileCompletionCardProps) {
  const completedItems = items.filter((i) => i.completed);

  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900', className)}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Profile Completion
        </h3>
        <span className="text-xs font-medium text-gray-500">
          {completedItems.length}/{items.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700 ease-out',
            percentage >= 80 ? 'bg-emerald-500' : percentage >= 50 ? 'bg-amber-500' : 'bg-rose-500',
          )}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Profile ${percentage}% complete`}
        />
      </div>

      {/* Checklist */}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold',
                item.completed
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
              )}
            >
              {STATUS_ICONS[item.completed ? 'completed' : 'pending']}
            </span>
            <span
              className={cn(
                'text-xs',
                item.completed
                  ? 'font-medium text-gray-700 dark:text-gray-300'
                  : 'text-gray-400 dark:text-gray-500',
              )}
            >
              {item.label}
              {item.required && !item.completed && (
                <span className="ml-1 text-[10px] text-amber-500">(required)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
