import { cn } from '@/lib/cn';

/**
 * Shimmer placeholder. Compose shapes with className
 * (e.g. `<Skeleton className="h-32 w-full rounded-card" />`).
 * Page-level skeleton layouts mirror their real layout 1:1 (PRD §6).
 */
export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-field bg-sky-tint/70', className)}
      {...rest}
    />
  );
}
