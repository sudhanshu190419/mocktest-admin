import { cn } from '@/lib/cn';
import { ButtonLink } from './Button';

export { ButtonLink as EmptyStateLink };

export interface EmptyStateProps {
  icon?: React.ElementType;
  /** One human line, calm-coach voice. */
  title: string;
  /** Optional supporting sentence. */
  detail?: string;
  /** Single next action. */
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}

/**
 * Empty state standard (PRD §6): icon + one human line + one action.
 * Empty states teach — they always point at the next step.
 */
export function EmptyState({
  icon: Icon,
  title,
  detail,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface text-center',
        compact ? 'p-5' : 'p-8 sm:p-10',
        className
      )}
    >
      {Icon && (
        <Icon
          size={compact ? 28 : 36}
          weight="duotone"
          className="mx-auto text-ink-muted"
          aria-hidden="true"
        />
      )}
      <p className={cn('mt-3 font-bold text-ink', compact ? 'text-body' : 'text-h3')}>{title}</p>
      {detail && <p className="mt-1 text-meta text-ink-secondary">{detail}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
