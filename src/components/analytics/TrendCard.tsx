'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface TrendCardProps {
  title: string;
  currentValue: number;
  previousValue: number;
  unit?: string;
  format?: 'number' | 'percentage' | 'time';
  icon?: React.ReactNode;
  className?: string;
  loading?: boolean;
}

export function TrendCard({
  title,
  currentValue,
  previousValue,
  unit = '%',
  format = 'percentage',
  icon,
  className,
  loading,
}: TrendCardProps) {
  const change = previousValue > 0 ? ((currentValue - previousValue) / previousValue) * 100 : 0;
  const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'stable';
  const isPositive = trend === 'up';

  const formatValue = (val: number): string => {
    switch (format) {
      case 'percentage':
        return `${val.toFixed(1)}${unit}`;
      case 'time': {
        const mins = Math.floor(val / 60);
        const secs = Math.round(val % 60);
        return `${mins}m ${secs}s`;
      }
      default:
        return `${val.toFixed(1)}`;
    }
  };

  if (loading) {
    return (
      <div className={cn('rounded-xl border border-gray-200 p-5 dark:border-gray-700', className)}>
        <div className="mb-3 h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mb-2 h-6 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900', className)}
    >
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{title}</p>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatValue(currentValue)}
        </span>
        <span className={cn(
          'inline-flex items-center gap-0.5 text-sm font-medium',
          isPositive ? 'text-emerald-600' : 'text-rose-600',
        )}>
          {isPositive ? '↑' : '↓'}
          {Math.abs(change).toFixed(1)}%
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Previous: {formatValue(previousValue)}
      </p>
    </motion.div>
  );
}
