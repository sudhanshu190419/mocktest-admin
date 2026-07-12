'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import Link from 'next/link';

interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  value: number;
  unit: string;
  change?: 'up' | 'down' | 'stable';
  changeValue?: number;
  metadata?: string;
}

interface LeaderboardCardProps {
  title: string;
  entries: LeaderboardEntry[];
  maxItems?: number;
  valueLabel?: string;
  href?: string;
  className?: string;
  loading?: boolean;
  emptyMessage?: string;
}

export function LeaderboardCard({
  title,
  entries,
  maxItems = 10,
  valueLabel,
  href,
  className,
  loading,
  emptyMessage = 'No data available',
}: LeaderboardCardProps) {
  if (loading) {
    return (
      <div className={cn('rounded-xl border border-gray-200 p-5 dark:border-gray-700', className)}>
        <div className="mb-4 h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="mb-2 flex items-center gap-3">
            <div className="h-6 w-6 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    );
  }

  const displayEntries = entries.slice(0, maxItems);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900', className)}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {href && (
          <Link href={href} className="text-xs font-medium text-blue-600 hover:text-blue-700">
            View all
          </Link>
        )}
      </div>

      {displayEntries.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyMessage}</p>
      ) : (
        <div className="space-y-1.5">
          {displayEntries.map((entry, i) => {
            const rankColors = [
              'bg-gradient-to-br from-amber-400 to-amber-600',
              'bg-gradient-to-br from-gray-300 to-gray-500',
              'bg-gradient-to-br from-amber-700 to-amber-900',
            ];

            return (
              <div
                key={entry.id + '-' + i}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30"
              >
                <div
                  className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                    entry.rank <= 3 ? rankColors[entry.rank - 1] : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                  )}
                >
                  {entry.rank}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">
                    {entry.name}
                  </p>
                  {entry.metadata && (
                    <p className="text-[10px] text-gray-400">{entry.metadata}</p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                    {entry.value.toFixed(1)}{entry.unit}
                  </span>
                  {entry.change && entry.change !== 'stable' && (
                    <span className={cn(
                      'ml-1 text-[10px]',
                      entry.change === 'up' ? 'text-emerald-500' : 'text-rose-500',
                    )}>
                      {entry.change === 'up' ? '↑' : '↓'}
                      {entry.changeValue?.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
