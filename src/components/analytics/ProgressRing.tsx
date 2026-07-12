'use client';

import { motion } from 'framer-motion';

interface ProgressRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  label?: string;
  showPercentage?: boolean;
  className?: string;
}

export function ProgressRing({
  percentage,
  size = 80,
  strokeWidth = 6,
  color = '#3B82F6',
  bgColor = '#E5E7EB',
  label,
  showPercentage = true,
  className,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const clampedPct = Math.min(Math.max(percentage, 0), 100);
  const offset = circumference - (clampedPct / 100) * circumference;

  return (
    <div className={`flex flex-col items-center ${className ?? ''}`}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      {showPercentage && (
        <span
          className="mt-1 text-lg font-bold"
          style={{ color }}
        >
          {clampedPct.toFixed(0)}%
        </span>
      )}
      {label && (
        <span className="mt-0.5 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}
