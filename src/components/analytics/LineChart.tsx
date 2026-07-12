'use client';

import { useMemo } from 'react';

export interface LineChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

interface LineChartProps {
  data: LineChartDataPoint[];
  height?: number;
  showDots?: boolean;
  showGrid?: boolean;
  showLabels?: boolean;
  showArea?: boolean;
  lineColor?: string;
  secondaryLineColor?: string;
  className?: string;
  emptyMessage?: string;
  yAxisLabel?: string;
}

export function LineChart({
  data,
  height = 200,
  showDots = true,
  showGrid = true,
  showLabels = true,
  showArea = false,
  lineColor = '#3B82F6',
  secondaryLineColor = '#10B981',
  className,
  emptyMessage = 'No data available',
  yAxisLabel,
}: LineChartProps) {
  const { points, maxValue, minValue, svgPath, areaPath, secondaryPath, yLabels } = useMemo(() => {
    if (data.length === 0) {
      return { points: [], maxValue: 0, minValue: 0, svgPath: '', areaPath: '', secondaryPath: '', yLabels: [] };
    }

    const values = data.flatMap((d) => [d.value, d.secondaryValue ?? d.value]);
    const max = Math.max(...values, 0) * 1.15;
    const min = 0;

    const padding = { top: 16, right: 8, bottom: 20, left: 32 };
    const chartW = 1000;
    const chartH = height - padding.top - padding.bottom;
    const stepX = chartW / Math.max(data.length - 1, 1);

    const pts = data.map((d, i) => ({
      x: padding.left + i * stepX,
      y: padding.top + chartH - ((d.value - min) / (max - min)) * chartH,
      label: d.label,
      value: d.value,
      secondaryValue: d.secondaryValue,
    }));

    // Build SVG path
    const pathD = pts.map((p, i) =>
      i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
    ).join(' ');

    // Area fill
    const areaD = pts.length > 0
      ? `${pathD} L ${pts[pts.length - 1].x} ${padding.top + chartH} L ${pts[0].x} ${padding.top + chartH} Z`
      : '';

    // Secondary line
    const secondaryPts = data
      .filter((d) => d.secondaryValue != null)
      .map((d, i) => ({
        x: padding.left + i * stepX,
        y: padding.top + chartH - ((d.secondaryValue! - min) / (max - min)) * chartH,
      }));
    const secPath = secondaryPts.map((p, i) =>
      i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
    ).join(' ');

    // Y-axis labels
    const yLbls = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const val = min + (max - min) * (i / steps);
      const y = padding.top + chartH - (val / max) * chartH;
      yLbls.push({ value: val.toFixed(0), y });
    }

    return {
      points: pts,
      maxValue: max,
      minValue: min,
      svgPath: pathD,
      areaPath: areaD,
      secondaryPath: secPath,
      yLabels: yLbls,
    };
  }, [data, height]);

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${1000 + 40} ${height}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis grid lines */}
        {showGrid && yLabels.map((yl, i) => (
          <g key={i}>
            <line
              x1={32}
              y1={yl.y}
              x2={1000 + 8}
              y2={yl.y}
              stroke="#E5E7EB"
              strokeWidth={1}
              className="dark:stroke-gray-700"
            />
            <text
              x={30}
              y={yl.y + 4}
              textAnchor="end"
              className="fill-gray-400 text-[9px]"
            >
              {yl.value}
            </text>
          </g>
        ))}

        {/* Y-axis label */}
        {yAxisLabel && (
          <text
            x={8}
            y={height / 2}
            textAnchor="middle"
            transform={`rotate(-90, 8, ${height / 2})`}
            className="fill-gray-400 text-[8px]"
          >
            {yAxisLabel}
          </text>
        )}

        {/* Area fill */}
        {showArea && areaPath && (
          <path
            d={areaPath}
            fill={lineColor}
            fillOpacity={0.08}
            className="transition-opacity"
          />
        )}

        {/* Secondary line */}
        {secondaryPath && (
          <path
            d={secondaryPath}
            fill="none"
            stroke={secondaryLineColor}
            strokeWidth={1.5}
            strokeDasharray="4,3"
            className="transition-all"
          />
        )}

        {/* Main line */}
        <path
          d={svgPath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all"
        />

        {/* Data dots */}
        {showDots && points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={3}
              fill="white"
              stroke={lineColor}
              strokeWidth={2}
              className="transition-all hover:r-4"
            />
            {showLabels && (
              <text
                x={p.x}
                y={height - 4}
                textAnchor="middle"
                className="fill-gray-400 text-[8px]"
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
