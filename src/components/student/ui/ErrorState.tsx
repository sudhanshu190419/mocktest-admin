'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import { IconWarning } from '@/components/icons/student-icons';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title = "Something didn't load",
  detail,
  onRetry,
  retryLabel = 'Try again',
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-[var(--radius-card,16px)] border border-[var(--line,#d9e3ed)] bg-white text-center flex flex-col items-center justify-center',
        compact ? 'p-5' : 'p-8 sm:p-12',
        className
      )}
    >
      <div className="text-amber-600 mb-3 flex items-center justify-center">
        <IconWarning size={compact ? 32 : 44} />
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
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-5"
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
