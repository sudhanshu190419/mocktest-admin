'use client';

import { cn } from '@/lib/utils';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}

interface FilterPanelProps {
  groups: FilterGroup[];
  className?: string;
}

export function FilterPanel({ groups, className }: FilterPanelProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-3',
        className,
      )}
    >
      {groups.map((group) => (
        <div key={group.key} className="min-w-[140px] flex-1">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {group.label}
          </label>
          <select
            value={group.value}
            onChange={(e) => group.onChange(e.target.value)}
            className={cn(
              'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900',
              'transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
              'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
            )}
          >
            <option value="">All</option>
            {group.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
