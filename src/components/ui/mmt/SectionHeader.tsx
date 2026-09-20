import { cn } from '@/lib/cn';

export interface SectionHeaderProps {
  /** Small uppercase kicker above the title (optional). */
  eyebrow?: string;
  title: React.ReactNode;
  /** Right-aligned slot: "View all →" links, filters, etc. */
  action?: React.ReactNode;
  className?: string;
}

/** Consistent section heading: h2 on the type scale + optional action slot. */
export function SectionHeader({ eyebrow, title, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        {eyebrow && (
          <p className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">
            {eyebrow}
          </p>
        )}
        <h2 className="text-h2 font-bold text-ink">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
