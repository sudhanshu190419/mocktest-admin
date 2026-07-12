'use client';

import { motion } from 'framer-motion';
import { ProgressRing } from './ProgressRing';
import { cn } from '@/lib/utils';

interface ScoreCardProps {
  title: string;
  score: number | string;
  maxScore?: number;
  percentage?: number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'stable';
  trendLabel?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  loading?: boolean;
}

const SIZE_CONFIG = {
  sm: { ringSize: 56, strokeWidth: 4, titleClass: 'text-[10px]', scoreClass: 'text-lg', subtitleClass: 'text-[9px]' },
  md: { ringSize: 72, strokeWidth: 5, titleClass: 'text-xs', scoreClass: 'text-2xl', subtitleClass: 'text-[10px]' },
  lg: { ringSize: 96, strokeWidth: 6, titleClass: 'text-sm', scoreClass: 'text-3xl', subtitleClass: 'text-xs' },
} as const;

const TREND_COLORS: Record<string, string> = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-red-600 dark:text-red-400',
  stable: 'text-gray-500 dark:text-gray-400',
};

const TREND_ICONS: Record<string, string> = {
  up: '↑',
  down: '↓',
  stable: '→',
};

export function ScoreCard({
  title,
  score,
  maxScore,
  percentage,
  subtitle,
  trend,
  trendLabel,
  color = '#3B82F6',
  size = 'md',
  className,
  loading = false,
}: ScoreCardProps) {
  const config = SIZE_CONFIG[size];
  const numericScore = typeof score === 'number' ? score : 0;
  const displayPct = percentage ?? (maxScore && maxScore > 0 ? (numericScore / maxScore) * 100 : 0);
  const clampedPct = Math.min(Math.max(displayPct, 0), 100);

  if (loading) {
    return (
      <div className={cn('rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900', className)}>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-6 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-2 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
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
      <div className="flex items-center gap-4">
        <ProgressRing
          percentage={clampedPct}
          size={config.ringSize}
          strokeWidth={config.strokeWidth}
          color={color}
          showPercentage={false}
        />
        <div className="min-w-0 flex-1">
          <p className={cn('font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400', config.titleClass)}>
            {title}
          </p>
          <p className={cn('mt-0.5 font-bold text-gray-900 dark:text-gray-100', config.scoreClass)}>
            {maxScore ? `${score} / ${maxScore}` : score}
            {!maxScore && percentage !== undefined && (
              <span className="ml-1 text-sm font-normal text-gray-400">({clampedPct.toFixed(0)}%)</span>
            )}
          </p>
          {subtitle && (
            <p className={cn('mt-0.5 text-gray-400 dark:text-gray-500', config.subtitleClass)}>
              {subtitle}
            </p>
          )}
          {trend && (
            <span className={cn('mt-1 inline-flex items-center gap-0.5 text-xs font-medium', TREND_COLORS[trend])}>
              <span>{TREND_ICONS[trend]}</span>
              {trendLabel ?? trend}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
