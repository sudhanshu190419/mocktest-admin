import React from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

export function StateSkeleton({
  rounded = 'md',
  className,
  ...rest
}: SkeletonProps) {
  const roundMap = {
    sm: 'rounded-sm',
    md: 'rounded-[var(--radius-field,10px)]',
    lg: 'rounded-[var(--radius-card,16px)]',
    full: 'rounded-full',
  };

  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-[var(--tint-sky,#dcecf8)]/60',
        roundMap[rounded],
        className
      )}
      {...rest}
    />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card,16px)] border border-[var(--line,#d9e3ed)] bg-white p-5 sm:p-6 flex flex-col gap-4',
        className
      )}
    >
      <StateSkeleton className="h-40 w-full" rounded="md" />
      <StateSkeleton className="h-5 w-3/4" />
      <StateSkeleton className="h-4 w-1/2" />
      <div className="mt-2 flex items-center justify-between pt-4 border-t border-[var(--line,#d9e3ed)]/40">
        <StateSkeleton className="h-4 w-1/4" />
        <StateSkeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between p-4 border-b border-[var(--line,#d9e3ed)]/60',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <StateSkeleton className="h-10 w-10" rounded="full" />
        <div className="flex flex-col gap-1.5">
          <StateSkeleton className="h-4 w-36" />
          <StateSkeleton className="h-3 w-24" />
        </div>
      </div>
      <StateSkeleton className="h-8 w-20" />
    </div>
  );
}
