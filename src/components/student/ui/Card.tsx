import React from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card,16px)] border border-[var(--line,#d9e3ed)] bg-white text-[var(--ink,#152b45)] shadow-sm overflow-hidden',
        interactive &&
          'transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-[var(--brand,#0284c7)]/50 hover:shadow-md hover:-translate-y-0.5',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-5 sm:p-6 pb-0', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-5 sm:p-6', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('p-5 sm:p-6 pt-0 border-t border-[var(--line,#d9e3ed)]/40 mt-auto', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardMedia({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('relative w-full overflow-hidden bg-[var(--paper,#f3f8fc)]', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardBadge({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'absolute top-3 right-3 z-10 rounded-full px-2.5 py-1 text-xs font-semibold shadow-xs',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
