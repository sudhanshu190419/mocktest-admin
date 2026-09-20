'use client';

import { WarningCircle } from '@phosphor-icons/react';
import { Button } from './Button';
import { cn } from '@/lib/cn';

export interface ErrorStateProps {
  /** Human line, calm-coach voice: "Couldn't load your timetable". */
  title?: string;
  /** Optional one-liner of reassurance/context (never the raw error). */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Compact variant for inline sections vs page-level failures. */
  compact?: boolean;
  className?: string;
}

/**
 * The ONLY error surface in student scope (PRD §6):
 * raw errors/statuses go to console/monitoring, never the UI.
 */
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
        'rounded-card border border-line bg-surface text-center',
        compact ? 'p-5' : 'p-8 sm:p-10',
        className
      )}
    >
      <WarningCircle
        size={compact ? 28 : 36}
        weight="duotone"
        className="mx-auto text-apricot-ink"
        aria-hidden="true"
      />
      <p className={cn('mt-3 font-bold text-ink', compact ? 'text-body' : 'text-h3')}>
        {title}
      </p>
      {detail && <p className="mt-1 text-meta text-ink-secondary">{detail}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
