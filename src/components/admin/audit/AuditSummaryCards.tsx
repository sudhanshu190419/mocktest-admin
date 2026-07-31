'use client';

import { ListMagnifyingGlass, Clock, Calendar, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { AuditLogSummary } from '@/services/admin/auditLogService';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

interface AuditSummaryCardsProps {
  data?: AuditLogSummary;
  isLoading?: boolean;
}

/**
 * Dashboard summary cards for the Audit Logs page.
 *
 * Uses the existing admin card styling (rounded border, subtle background,
 * full dark-mode support) — no new design language.
 */
export function AuditSummaryCards({ data, isLoading }: AuditSummaryCardsProps) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
          >
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="mb-1 h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Logs',
      value: data.total.toLocaleString('en-IN'),
      hint: 'All recorded events',
      icon: ListMagnifyingGlass,
      iconClass: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
    },
    {
      label: "Today's Events",
      value: data.today.toLocaleString('en-IN'),
      hint: 'Since midnight',
      icon: Clock,
      iconClass: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    },
    {
      label: 'This Week',
      value: data.thisWeek.toLocaleString('en-IN'),
      hint: 'Since Monday',
      icon: Calendar,
      iconClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    },
    {
      label: 'Failed Operations',
      value: data.failed.toLocaleString('en-IN'),
      hint: 'outcome = failure',
      icon: WarningCircle,
      iconClass: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <div
            className={cn(
              'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
              card.iconClass,
            )}
          >
            <card.icon size={20} weight="duotone" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {card.label}
            </p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              {card.value}
            </p>
            <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
              {card.hint}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default AuditSummaryCards;
