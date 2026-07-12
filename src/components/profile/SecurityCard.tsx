'use client';

import { cn } from '@/lib/utils';

interface SecurityCardProps {
  title: string;
  status: 'secure' | 'warning' | 'danger' | 'disabled';
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
    loading?: boolean;
  };
  className?: string;
}

const STATUS_CONFIG = {
  secure: { icon: '✓', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800' },
  warning: { icon: '!', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800' },
  danger: { icon: '✕', color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30', border: 'border-rose-200 dark:border-rose-800' },
  disabled: { icon: '—', color: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800/50', border: 'border-gray-200 dark:border-gray-700' },
};

const ACTION_VARIANTS = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};

export function SecurityCard({
  title,
  status,
  description,
  action,
  className,
}: SecurityCardProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-shadow hover:shadow-sm',
        config.border,
        config.bg,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
            config.color,
            config.bg,
            'border',
            config.border,
          )}>
            {config.icon}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>
          </div>
        </div>

        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
            className={cn(
              'flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
              ACTION_VARIANTS[action.variant ?? 'secondary'],
            )}
            aria-label={action.label}
          >
            {action.loading ? 'Processing...' : action.label}
          </button>
        )}
      </div>
    </div>
  );
}
