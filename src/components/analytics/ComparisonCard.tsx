'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ComparisonMetric {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'stable';
  trendLabel?: string;
  color?: string;
}

interface ComparisonCardProps {
  title: string;
  primary: ComparisonMetric;
  secondary: ComparisonMetric;
  difference?: {
    value: string | number;
    label: string;
    type: 'positive' | 'negative' | 'neutral';
  };
  className?: string;
  loading?: boolean;
}

const TREND_ICONS: Record<string, string> = {
  up: '↑',
  down: '↓',
  stable: '→',
};

const DIFF_COLORS: Record<string, string> = {
  positive: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30',
  negative: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30',
  neutral: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-950/30',
};

export function ComparisonCard({
  title,
  primary,
  secondary,
  difference,
  className,
  loading = false,
}: ComparisonCardProps) {
  if (loading) {
    return (
      <div className={cn('rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900', className)}>
        <div className="mb-3 h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="h-2 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-6 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="space-y-2">
            <div className="h-2 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-6 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
        {difference && <div className="mt-3 h-6 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900',
        className,
      )}
    >
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Primary metric */}
        <div>
          <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{primary.label}</p>
          <p
            className="mt-0.5 text-xl font-bold"
            style={primary.color ? { color: primary.color } : undefined}
          >
            {primary.value}
          </p>
          {primary.trend && (
            <span className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span>{TREND_ICONS[primary.trend]}</span>
              {primary.trendLabel ?? `${primary.trend === 'up' ? 'Increasing' : primary.trend === 'down' ? 'Decreasing' : 'Stable'}`}
            </span>
          )}
        </div>

        {/* Secondary metric */}
        <div className="text-right">
          <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{secondary.label}</p>
          <p
            className="mt-0.5 text-xl font-bold"
            style={secondary.color ? { color: secondary.color } : undefined}
          >
            {secondary.value}
          </p>
          {secondary.trend && (
            <span className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span>{TREND_ICONS[secondary.trend]}</span>
              {secondary.trendLabel ?? `${secondary.trend === 'up' ? 'Increasing' : secondary.trend === 'down' ? 'Decreasing' : 'Stable'}`}
            </span>
          )}
        </div>
      </div>

      {/* Difference badge */}
      {difference && (
        <div className="mt-3 flex items-center justify-center">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
              DIFF_COLORS[difference.type],
            )}
          >
            {difference.value} {difference.label}
          </span>
        </div>
      )}
    </motion.div>
  );
}
