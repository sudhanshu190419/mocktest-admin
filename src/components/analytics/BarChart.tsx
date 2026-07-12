'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';

export interface BarChartDataPoint {
  label: string;
  value: number;
  color?: string;
  secondaryLabel?: string;
}

interface BarChartProps {
  data: BarChartDataPoint[];
  height?: number;
  barWidth?: number;
  showValues?: boolean;
  showLabels?: boolean;
  className?: string;
  emptyMessage?: string;
  maxValue?: number;
}

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#EC4899', '#6366F1'];

export function BarChart({
  data,
  height = 200,
  barWidth,
  showValues = true,
  showLabels = true,
  className,
  emptyMessage = 'No data available',
  maxValue,
}: BarChartProps) {
  const max = useMemo(() => {
    if (maxValue) return maxValue;
    const m = Math.max(...data.map((d) => d.value), 0);
    return m > 0 ? m * 1.15 : 100;
  }, [data, maxValue]);

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className="flex items-end gap-2"
        style={{ height, paddingTop: 16 }}
      >
        {data.map((point, i) => {
          const pctHeight = (point.value / max) * 100;
          const barColor = point.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];

          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              {showValues && (
                <motion.span
                  className="text-[10px] font-semibold text-gray-600 dark:text-gray-400"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                >
                  {typeof point.value === 'number' ? point.value.toFixed(1) : point.value}
                </motion.span>
              )}
              <div className="w-full flex-1 self-end" style={{ minHeight: 0 }}>
                <motion.div
                  className="w-full rounded-t transition-all hover:opacity-80"
                  style={{ backgroundColor: barColor }}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(pctHeight, 2)}%` }}
                  transition={{ duration: 0.4, delay: i * 0.03, ease: 'easeOut' }}
                  title={`${point.label}: ${point.value}`}
                />
              </div>
              {showLabels && (
                <span className="text-[9px] text-gray-400 dark:text-gray-500 truncate w-full text-center">
                  {point.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
