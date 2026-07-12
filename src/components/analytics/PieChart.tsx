'use client';

import { useMemo } from 'react';

export interface PieChartDataPoint {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieChartDataPoint[];
  size?: number;
  innerRadius?: number;
  showLabels?: boolean;
  showLegend?: boolean;
  className?: string;
  emptyMessage?: string;
}

export function PieChart({
  data,
  size = 200,
  innerRadius = 50,
  showLabels = true,
  showLegend = true,
  className,
  emptyMessage = 'No data available',
}: PieChartProps) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const slices = useMemo(() => {
    if (total === 0) return [];
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 4;
    const innerR = innerRadius;

    let currentAngle = -Math.PI / 2;

    return data.map((d) => {
      const sliceAngle = (d.value / total) * 2 * Math.PI;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      currentAngle = endAngle;

      // Outer arc
      const x1 = cx + outerR * Math.cos(startAngle);
      const y1 = cy + outerR * Math.sin(startAngle);
      const x2 = cx + outerR * Math.cos(endAngle);
      const y2 = cy + outerR * Math.sin(endAngle);

      // Inner arc
      const x3 = cx + innerR * Math.cos(endAngle);
      const y3 = cy + innerR * Math.sin(endAngle);
      const x4 = cx + innerR * Math.cos(startAngle);
      const y4 = cy + innerR * Math.sin(startAngle);

      const largeArc = sliceAngle > Math.PI ? 1 : 0;

      const path = [
        `M ${x1} ${y1}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
        'Z',
      ].join(' ');

      // Label position
      const midAngle = startAngle + sliceAngle / 2;
      const labelR = outerR * 0.65;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);

      return {
        path,
        color: d.color,
        label: d.label,
        value: d.value,
        percentage: (d.value / total) * 100,
        labelX: lx,
        labelY: ly,
      };
    });
  }, [data, size, innerRadius, total]);

  if (data.length === 0 || total === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center ${className ?? ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((slice, i) => (
          <g key={i}>
            <path
              d={slice.path}
              fill={slice.color}
              className="transition-all hover:opacity-80"
            />
            {showLabels && slice.percentage >= 5 && (
              <text
                x={slice.labelX}
                y={slice.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-white text-[9px] font-bold"
              >
                {slice.percentage.toFixed(0)}%
              </text>
            )}
          </g>
        ))}
      </svg>
      {showLegend && (
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {d.label} ({total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
