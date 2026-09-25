import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { IconChevronRight } from '@/components/icons/student-icons';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumbs" className={cn('flex items-center text-xs sm:text-sm text-[var(--ink-secondary,#51637a)]', className)}>
      <ol className="flex items-center flex-wrap gap-1.5 list-none p-0 m-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && (
                <IconChevronRight size={14} className="text-[var(--ink-muted,#5e7084)] shrink-0" aria-hidden="true" />
              )}
              {isLast || !item.href ? (
                <span
                  className="font-medium text-[var(--ink,#152b45)] truncate max-w-[200px] sm:max-w-xs"
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-[var(--brand,#0284c7)] hover:underline transition-colors"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
