'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { InsightItem } from '@/types/analytics-extended';

interface InsightCardProps {
  insight: InsightItem;
  className?: string;
  onClick?: () => void;
  compact?: boolean;
}

const TYPE_STYLES = {
  positive: { border: 'border-emerald-200 dark:border-emerald-800', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: '🟢', text: 'text-emerald-700 dark:text-emerald-400' },
  negative: { border: 'border-rose-200 dark:border-rose-800', bg: 'bg-rose-50 dark:bg-rose-900/20', icon: '🔴', text: 'text-rose-700 dark:text-rose-400' },
  warning: { border: 'border-amber-200 dark:border-amber-800', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: '🟡', text: 'text-amber-700 dark:text-amber-400' },
  neutral: { border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: '🔵', text: 'text-blue-700 dark:text-blue-400' },
};

const SEVERITY_BADGES = {
  high: { label: 'High', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  medium: { label: 'Medium', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  low: { label: 'Low', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

export function InsightCard({ insight, className, onClick, compact = false }: InsightCardProps) {
  const styles = TYPE_STYLES[insight.type];
  const severity = SEVERITY_BADGES[insight.severity];

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={onClick}
      className={cn(
        'rounded-xl border p-4 transition-all',
        styles.border,
        styles.bg,
        onClick && 'cursor-pointer hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-base">{styles.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className={cn('text-sm font-semibold', styles.text)}>
              {insight.title}
            </h4>
            <span className={cn(
              'flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium',
              severity.className,
            )}>
              {severity.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {insight.description}
          </p>
          {!compact && (
            <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-500">
              <span>
                {insight.metric}: <strong>{insight.value}</strong>
              </span>
              {insight.change != null && (
                <span className={cn(
                  'font-medium',
                  Number(insight.change) > 0 ? 'text-emerald-600' : 'text-rose-600'
                )}>
                  {Number(insight.change) > 0 ? '↑' : '↓'} {insight.change}
                </span>
              )}
              {insight.actionable && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  Actionable
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
