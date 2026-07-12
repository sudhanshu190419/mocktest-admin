'use client';

import { cn } from '@/lib/utils';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  label?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'All',
  className,
  label,
}: SelectProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900',
          'transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
          'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
