'use client';

import { cn } from '@/lib/utils';

interface NotificationToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function NotificationToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className,
}: NotificationToggleProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <label
          className="text-sm font-medium text-gray-900 dark:text-gray-100"
          id={`toggle-label-${label.replace(/\s+/g, '-').toLowerCase()}`}
        >
          {label}
        </label>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`toggle-label-${label.replace(/\s+/g, '-').toLowerCase()}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
          checked
            ? 'bg-blue-600'
            : 'bg-gray-200 dark:bg-gray-700',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  );
}
