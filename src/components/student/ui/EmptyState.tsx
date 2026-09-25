import React from 'react';
import { cn } from '@/lib/cn';
import { IconEmptyBox } from '@/components/icons/student-icons';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  detail?: string;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card,16px)] border border-[var(--line,#d9e3ed)] bg-white text-center flex flex-col items-center justify-center',
        compact ? 'p-5' : 'p-8 sm:p-12',
        className
      )}
    >
      <div className="text-[var(--ink-muted,#5e7084)] mb-3 flex items-center justify-center">
        {icon || <IconEmptyBox size={compact ? 32 : 44} />}
      </div>
      <h3
        className={cn(
          'font-bold text-[var(--ink,#152b45)]',
          compact ? 'text-sm' : 'text-base sm:text-lg'
        )}
      >
        {title}
      </h3>
      {detail && (
        <p className="mt-1 text-xs sm:text-sm text-[var(--ink-secondary,#51637a)] max-w-md">
          {detail}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
