'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  color?: 'blue' | 'emerald' | 'amber' | 'purple' | 'rose' | 'indigo' | 'cyan' | 'gray';
  className?: string;
  onClick?: () => void;
  loading?: boolean;
}

const COLOR_STYLES = {
  blue: { text: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', icon: 'bg-blue-100 dark:bg-blue-800/40' },
  emerald: { text: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', icon: 'bg-emerald-100 dark:bg-emerald-800/40' },
  amber: { text: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', icon: 'bg-amber-100 dark:bg-amber-800/40' },
  purple: { text: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800', icon: 'bg-purple-100 dark:bg-purple-800/40' },
  rose: { text: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800', icon: 'bg-rose-100 dark:bg-rose-800/40' },
  indigo: { text: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20', border: 'border-indigo-200 dark:border-indigo-800', icon: 'bg-indigo-100 dark:bg-indigo-800/40' },
  cyan: { text: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-900/20', border: 'border-cyan-200 dark:border-cyan-800', icon: 'bg-cyan-100 dark:bg-cyan-800/40' },
  gray: { text: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-800/30', border: 'border-gray-200 dark:border-gray-700', icon: 'bg-gray-100 dark:bg-gray-800' },
};

export function MetricCard({
  label,
  value,
  subtext,
  icon,
  trend,
  trendValue,
  color = 'blue',
  className,
  onClick,
  loading,
}: MetricCardProps) {
  const t = COLOR_STYLES[color];

  if (loading) {
    return (
      <div className={cn('rounded-xl border border-gray-200 p-5 dark:border-gray-700', className)}>
        <div className="mb-2 h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mb-1 h-7 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className={cn(
        'rounded-xl border p-5 transition-all',
        t.border,
        t.bg,
        onClick && 'cursor-pointer hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        {icon && (
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', t.icon)}>
            {icon}
          </div>
        )}
      </div>
      <p className={cn('mt-1.5 text-2xl font-bold', t.text)}>
        {value}
      </p>
      {(subtext || trend) && (
        <div className="mt-1 flex items-center gap-2">
          {subtext && <p className="text-xs text-gray-400 dark:text-gray-500">{subtext}</p>}
          {trend && trendValue && (
            <span className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              trend === 'up' && 'text-emerald-600',
              trend === 'down' && 'text-rose-600',
              trend === 'stable' && 'text-gray-400',
            )}>
              {trend === 'up' && '↑'}
              {trend === 'down' && '↓'}
              {trend === 'stable' && '→'}
              {trendValue}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
