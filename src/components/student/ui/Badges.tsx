import React from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'sky'
  | 'mint'
  | 'apricot'
  | 'lilac'
  | 'sand'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error';

const toneClasses: Record<BadgeTone, string> = {
  sky: 'bg-[var(--tint-sky,#dcecf8)] text-[var(--tint-sky-ink,#0369a1)]',
  mint: 'bg-[var(--tint-mint,#dcefe8)] text-[var(--tint-mint-ink,#285e50)]',
  apricot: 'bg-[var(--tint-apricot,#ffd7b7)] text-[var(--tint-apricot-ink,#7c4c26)]',
  lilac: 'bg-[var(--tint-lilac,#e9e6f6)] text-[var(--tint-lilac-ink,#57507d)]',
  sand: 'bg-[var(--tint-sand,#f7e9d7)] text-[var(--tint-sand-ink,#854d0e)]',
  neutral: 'bg-[var(--paper,#f3f8fc)] text-[var(--ink-secondary,#51637a)] border border-[var(--line,#d9e3ed)]',
  success: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border border-amber-200',
  error: 'bg-red-50 text-red-800 border border-red-200',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
}

export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-none',
        toneClasses[tone],
        className
      )}
      {...rest}
    >
      {icon && <span className="inline-flex shrink-0 items-center">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

export { Badge as Pill, type BadgeProps as PillProps, type BadgeTone as PillTone };

export interface SectionHeadingProps {
  eyebrow?: string;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  action,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary,#51637a)]">
            {eyebrow}
          </p>
        )}
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ink,#152b45)]">
          {title}
        </h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
