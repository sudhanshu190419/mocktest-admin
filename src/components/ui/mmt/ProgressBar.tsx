'use client';

import { cn } from '@/lib/cn';

export type ProgressTone = 'brand' | 'success' | 'warning';

const tones: Record<ProgressTone, string> = {
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
};

export interface ProgressBarProps {
  /** 0–100. Values outside are clamped. */
  value: number;
  tone?: ProgressTone;
  /** Accessible label, e.g. "Physics course progress". Required. */
  label: string;
  className?: string;
}

/** Fill animates in via CSS on mount; respects prefers-reduced-motion
 *  via the global tokens.css kill-switch. */
export function ProgressBar({ value, tone = 'brand', label, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-sky-tint', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 ease-coach', tones[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
