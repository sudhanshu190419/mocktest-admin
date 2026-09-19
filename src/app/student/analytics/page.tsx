'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowClockwise,
  ChartBar,
  Target,
  Trophy,
  Percent,
  ClipboardText,
  WarningCircle,
  CheckCircle,
  TrendUp,
  TrendDown,
  MagnifyingGlass,
  BookOpen,
  Funnel,
  SlidersHorizontal,
  Clock,
  ArrowCounterClockwise,
  Sparkle,
  ArrowRight,
} from '@phosphor-icons/react';
import {
  useStudentDashboardSummary,
  useStudentScoreTrend,
  useSubjectAnalytics,
  useStudentAttemptedTests,
  useChapterAnalytics,
  useStudentWeakChapters,
  useStudentStrongChapters,
} from '@/hooks/analytics/useAnalytics';
import type {
  ScoreTrendPoint,
  AttemptedTestOption,
  SubjectPerformanceSummary,
  ChapterPerformanceSummary,
} from '@/types/analytics';
import { formatChapterBreakdownStats } from '@/utils/chapterAnalyticsFormatter';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function getSubjectIcon(subjectName: string): string {
  const name = subjectName.toLowerCase();
  if (name.includes('phys')) return '🔬';
  if (name.includes('chem')) return '🧪';
  if (name.includes('bio') || name.includes('botan') || name.includes('zool')) return '🧬';
  if (name.includes('math')) return '📐';
  if (name.includes('eng')) return '📖';
  if (name.includes('hist') || name.includes('civic') || name.includes('polity')) return '📜';
  if (name.includes('geo')) return '🌍';
  if (name.includes('econ') || name.includes('commerc')) return '💰';
  if (name.includes('comp') || name.includes('tech') || name.includes('it')) return '💻';
  if (name.includes('gk') || name.includes('general') || name.includes('current')) return '🗞️';
  return '📚';
}

function getAccuracyColor(accuracy: number | null): { text: string; bg: string; border: string; bar: string } {
  if (accuracy === null || accuracy === undefined) {
    return { text: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-200', bar: 'bg-slate-400' };
  }
  if (accuracy >= 75) {
    return { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', bar: 'bg-emerald-500' };
  }
  if (accuracy >= 50) {
    return { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', bar: 'bg-amber-500' };
  }
  return { text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200', bar: 'bg-rose-500' };
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

/** Skeleton loader for metric cards */
function MetricCardSkeleton() {
  return (
    <div className="p-5 rounded-3xl bg-white border border-slate-200/80 shadow-xs animate-pulse space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 bg-slate-100 rounded-md" />
        <div className="h-9 w-9 bg-slate-100 rounded-xl" />
      </div>
      <div className="h-8 w-20 bg-slate-200 rounded-lg" />
      <div className="h-3 w-32 bg-slate-100 rounded-md" />
    </div>
  );
}

/** Performance Overview Metric Card */
function MetricCard({
  title,
  value,
  subtitle,
  icon: IconComponent,
  iconColor,
  iconBg,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{title}</span>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${iconBg} ${iconColor}`}>
          <IconComponent size={20} weight="duotone" />
        </div>
      </div>
      <div>
        <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{value}</div>
        <p className="text-[11px] font-medium text-slate-500 mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

/** Interactive Web-Native Score Trend SVG Chart */
function ScoreTrendCard({
  trendData,
  isLoading,
  error,
}: {
  trendData?: ScoreTrendPoint[];
  isLoading: boolean;
  error: Error | null;
}) {
  const [hoveredPoint, setHoveredPoint] = useState<ScoreTrendPoint | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const stats = useMemo(() => {
    if (!trendData || trendData.length === 0) {
      return { peak: null, avg: null, latest: null, delta: null };
    }
    const percentages = trendData.map((d) => d.percentage);
    const peak = Math.max(...percentages);
    const avg = Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);
    const latest = percentages[percentages.length - 1];
    let delta = null;
    if (percentages.length >= 2) {
      delta = Number((latest - percentages[percentages.length - 2]).toFixed(1));
    }
    return { peak, avg, latest, delta };
  }, [trendData]);

  // Chart coordinates calculation
  const chartLayout = useMemo(() => {
    if (!trendData || trendData.length === 0) return null;

    const width = 800;
    const height = 240;
    const padX = 45;
    const padY = 30;

    const chartW = width - padX * 2;
    const chartH = height - padY * 2;

    const n = trendData.length;
    const stepX = n > 1 ? chartW / (n - 1) : chartW / 2;

    const points = trendData.map((d, i) => {
      const x = n === 1 ? width / 2 : padX + i * stepX;
      // Clamp percentage between 0 and 100 for graph Y mapping
      const p = Math.max(0, Math.min(100, d.percentage));
      const y = padY + chartH - (p / 100) * chartH;
      return { x, y, data: d };
    });

    // Build SVG Path
    let pathD = '';
    if (points.length === 1) {
      pathD = `M ${points[0].x} ${points[0].y}`;
    } else {
      pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
    }

    const areaD =
      points.length > 1
        ? `${pathD} L ${points[points.length - 1].x} ${padY + chartH} L ${points[0].x} ${padY + chartH} Z`
        : '';

    return { width, height, padX, padY, chartW, chartH, points, pathD, areaD };
  }, [trendData]);

  return (
    <div className="p-6 sm:p-7 rounded-3xl bg-slate-900 text-white shadow-sm space-y-6 relative overflow-hidden">
      {/* Background aesthetic gradient */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/30">
              <ChartBar size={18} weight="duotone" />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
              Score Trajectory Trend
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Chronological percentage scored across released evaluated mock tests
          </p>
        </div>

        {/* Quick summary stat chips */}
        {stats.peak !== null && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-1.5">
              <span className="text-slate-400 text-[11px]">Peak:</span>
              <span className="font-extrabold text-emerald-400">{Math.round(stats.peak)}%</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-1.5">
              <span className="text-slate-400 text-[11px]">Average:</span>
              <span className="font-extrabold text-sky-300">{stats.avg}%</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-1.5">
              <span className="text-slate-400 text-[11px]">Latest:</span>
              <span className="font-extrabold text-white">{Math.round(stats.latest || 0)}%</span>
              {stats.delta !== null && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                    stats.delta >= 0
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {stats.delta >= 0 ? <TrendUp size={10} weight="bold" /> : <TrendDown size={10} weight="bold" />}
                  {Math.abs(stats.delta)}%
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Chart Body */}
      {isLoading ? (
        <div className="h-60 rounded-2xl bg-slate-800/60 animate-pulse flex items-center justify-center">
          <span className="text-xs text-slate-500 font-semibold">Loading score trend data...</span>
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-950/40 border border-rose-800/40 text-center space-y-2">
          <WarningCircle size={24} weight="duotone" className="text-rose-400 mx-auto" />
          <p className="text-xs font-bold text-rose-200">Unable to load score trajectory</p>
          <p className="text-[11px] text-rose-300/80">Please check your network connection and retry.</p>
        </div>
      ) : !trendData || trendData.length === 0 ? (
        <div className="py-12 px-6 rounded-2xl bg-white/5 border border-white/10 text-center space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-400/20 flex items-center justify-center mx-auto">
            <ClipboardText size={24} weight="duotone" />
          </div>
          <h3 className="text-sm font-bold text-white">No Test Trend Available Yet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            Complete and submit mock tests to unlock your interactive score trajectory and accuracy curves.
          </p>
          <div className="pt-2">
            <Link
              href="/student/tests"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition-colors shadow-xs"
            >
              <span>Explore Assigned Mock Tests</span>
              <ArrowRight size={14} weight="bold" />
            </Link>
          </div>
        </div>
      ) : trendData.length === 1 ? (
        <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <CheckCircle size={22} weight="duotone" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Initial Test Attempt</span>
              <h3 className="text-sm font-bold text-white">{trendData[0].testName}</h3>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-slate-800/80 border border-white/5">
              <span className="text-[10px] text-slate-400 block font-medium">Score Achieved</span>
              <span className="text-sm font-extrabold text-white">
                {trendData[0].score} / {trendData[0].maxScore}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-white/5">
              <span className="text-[10px] text-slate-400 block font-medium">Percentage</span>
              <span className="text-sm font-extrabold text-emerald-400">
                {trendData[0].percentage.toFixed(1)}%
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-white/5">
              <span className="text-[10px] text-slate-400 block font-medium">Accuracy</span>
              <span className="text-sm font-extrabold text-sky-400">
                {trendData[0].accuracy !== null ? `${Math.round(trendData[0].accuracy)}%` : '—'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-white/5">
              <span className="text-[10px] text-slate-400 block font-medium">Attempted On</span>
              <span className="text-sm font-extrabold text-slate-300">
                {formatDateTime(trendData[0].attemptedOn)}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 italic">
            Complete at least 2 tests to start drawing your multi-test progress trajectory line chart.
          </p>
        </div>
      ) : chartLayout ? (
        <div className="relative pt-2">
          {/* Responsive SVG Container */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartLayout.width} ${chartLayout.height}`}
              className="w-full h-auto min-w-[550px] overflow-visible"
            >
              <defs>
                <linearGradient id="webAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0284C7" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#0284C7" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="webLineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#34D399" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {[0, 25, 50, 75, 100].map((val) => {
                const y = chartLayout.padY + chartLayout.chartH - (val / 100) * chartLayout.chartH;
                return (
                  <g key={val}>
                    <line
                      x1={chartLayout.padX}
                      y1={y}
                      x2={chartLayout.width - chartLayout.padX}
                      y2={y}
                      stroke="rgba(255, 255, 255, 0.08)"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={chartLayout.padX - 8}
                      y={y + 4}
                      fill="rgba(148, 163, 184, 0.8)"
                      fontSize="10"
                      fontWeight="bold"
                      textAnchor="end"
                    >
                      {`${val}%`}
                    </text>
                  </g>
                );
              })}

              {/* Area Under Curve */}
              {chartLayout.areaD && <path d={chartLayout.areaD} fill="url(#webAreaGrad)" />}

              {/* Trend Curve Line */}
              <path
                d={chartLayout.pathD}
                fill="none"
                stroke="url(#webLineGrad)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Data Interactive Dots */}
              {chartLayout.points.map((pt, idx) => {
                const isHovered = hoverIndex === idx;
                return (
                  <g
                    key={idx}
                    className="cursor-pointer transition-transform"
                    onMouseEnter={() => {
                      setHoverIndex(idx);
                      setHoveredPoint(pt.data);
                    }}
                    onMouseLeave={() => {
                      setHoverIndex(null);
                      setHoveredPoint(null);
                    }}
                  >
                    {isHovered && (
                      <circle cx={pt.x} cy={pt.y} r="10" fill="#0284C7" fillOpacity="0.3" />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 6 : 4.5}
                      fill={isHovered ? '#34D399' : '#FFFFFF'}
                      stroke={isHovered ? '#34D399' : '#0284C7'}
                      strokeWidth="2.5"
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Active Hover / Selected Tooltip Drawer */}
          {hoveredPoint && (
            <div className="mt-4 p-4 rounded-2xl bg-slate-800/95 border border-sky-500/40 shadow-lg text-xs space-y-2 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between gap-4">
                <span className="font-extrabold text-white text-sm">{hoveredPoint.testName}</span>
                <span className="text-[11px] font-bold text-slate-400">
                  {formatDateTime(hoveredPoint.attemptedOn)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div>
                  <span className="text-slate-400 text-[10px] block">Score</span>
                  <span className="font-extrabold text-white">
                    {hoveredPoint.score} / {hoveredPoint.maxScore}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Percentage</span>
                  <span className="font-extrabold text-emerald-400">
                    {hoveredPoint.percentage.toFixed(1)}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Accuracy</span>
                  <span className="font-extrabold text-sky-400">
                    {hoveredPoint.accuracy !== null ? `${Math.round(hoveredPoint.accuracy)}%` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Rank / Percentile</span>
                  <span className="font-extrabold text-purple-300">
                    {hoveredPoint.rank !== null ? `#${hoveredPoint.rank}` : '—'}{' '}
                    {hoveredPoint.percentile !== null ? `(${hoveredPoint.percentile}%ile)` : ''}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Subject Performance Component with Overall and Test-wise Scope Filter */
function SubjectPerformanceSection({
  subjects,
  isLoading,
  error,
  selectedTestId,
  onSelectTest,
  attemptedTests,
  isAttemptedTestsLoading,
}: {
  subjects?: SubjectPerformanceSummary[];
  isLoading: boolean;
  error: Error | null;
  selectedTestId: string | null;
  onSelectTest: (testId: string | null) => void;
  attemptedTests?: AttemptedTestOption[];
  isAttemptedTestsLoading?: boolean;
}) {
  const selectedTest = useMemo(() => {
    if (!selectedTestId || !attemptedTests) return null;
    return attemptedTests.find((t) => t.testId === selectedTestId) || null;
  }, [selectedTestId, attemptedTests]);

  return (
    <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-6">
      {/* ── Header & Scope Selection Bar ─────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                <BookOpen size={18} weight="duotone" />
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
                Subject-wise Accuracy & Performance
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {selectedTestId
                ? `Showing subject metrics for ${selectedTest?.testName || 'selected test'}`
                : 'Cumulative metrics across all completed mock tests'}
            </p>
          </div>

          {/* Test Selector Dropdown */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600">
              <Funnel size={14} weight="bold" className="text-indigo-500" />
              <span>Scope:</span>
              <select
                value={selectedTestId || 'overall'}
                onChange={(e) => onSelectTest(e.target.value === 'overall' ? null : e.target.value)}
                disabled={isAttemptedTestsLoading}
                className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer pr-2"
              >
                <option value="overall">
                  Overall Performance ({attemptedTests?.length ?? 0} {attemptedTests?.length === 1 ? 'Test' : 'Tests'})
                </option>
                {attemptedTests?.map((test) => (
                  <option key={test.testId} value={test.testId}>
                    {test.testName} {test.attemptedOn ? `(${formatDateTime(test.attemptedOn)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Horizontal Quick-Filter Chips */}
        {attemptedTests && attemptedTests.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 no-scrollbar">
            {/* Overall Chip */}
            <button
              onClick={() => onSelectTest(null)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                selectedTestId === null
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
              }`}
            >
              <ChartBar size={14} weight={selectedTestId === null ? 'fill' : 'regular'} />
              <span>Overall ({attemptedTests.length})</span>
            </button>

            {/* Individual Test Chips */}
            {attemptedTests.map((test) => {
              const isSelected = selectedTestId === test.testId;
              return (
                <button
                  key={test.testId}
                  onClick={() => onSelectTest(test.testId)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all max-w-[220px] truncate ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
                  }`}
                >
                  <Clock size={14} weight={isSelected ? 'fill' : 'regular'} />
                  <span className="truncate">{test.testName}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Subject Cards Grid ──────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 animate-pulse space-y-3">
              <div className="h-4 w-28 bg-slate-200 rounded-md" />
              <div className="h-3 w-full bg-slate-200 rounded-full" />
              <div className="h-4 w-36 bg-slate-100 rounded-md" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-50 border border-rose-100 text-center space-y-1">
          <p className="text-xs font-bold text-rose-700">Unable to load subject analytics</p>
          <p className="text-[11px] text-slate-500">Please pull down or refresh the page.</p>
        </div>
      ) : !subjects || subjects.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-3">
          <p className="text-xs font-bold text-slate-700">
            {selectedTestId ? 'No Questions Recorded for This Test' : 'No Subject Performance Data Yet'}
          </p>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
            {selectedTestId
              ? 'This specific test did not contain recorded questions for the selected subject scope.'
              : 'Complete and submit mock tests to view subject-specific strengths and accuracy breakdowns.'}
          </p>
          {selectedTestId && (
            <div>
              <button
                onClick={() => onSelectTest(null)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs transition-colors"
              >
                <ArrowCounterClockwise size={14} weight="bold" />
                <span>Reset to Overall Performance</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {subjects.map((sub) => {
            const accStyle = getAccuracyColor(sub.accuracy);
            const accuracyVal = sub.accuracy !== null ? Math.round(sub.accuracy) : null;
            const isHigh = sub.accuracy !== null && sub.accuracy >= 80;
            const isMid = sub.accuracy !== null && sub.accuracy >= 50 && sub.accuracy < 80;
            const statusLabel = isHigh ? 'Mastered' : isMid ? 'Moderate' : 'Needs Focus';
            const statusBg = isHigh ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : isMid ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200';

            const totalQ = sub.correct + sub.wrong + sub.skipped;

            return (
              <div
                key={sub.subjectId}
                className="p-5 rounded-2xl bg-slate-50/70 border border-slate-200/80 hover:bg-white hover:border-slate-300 transition-all space-y-4"
              >
                {/* Subject Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{getSubjectIcon(sub.subjectName)}</span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{sub.subjectName}</h3>
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border mt-0.5 ${statusBg}`}>
                        {isHigh ? '🌟 ' : isMid ? '⚡ ' : '⚠️ '}{statusLabel}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-extrabold px-2.5 py-1 rounded-full border ${accStyle.bg} ${accStyle.text} ${accStyle.border}`}
                    >
                      {accuracyVal !== null ? `${accuracyVal}% Accuracy` : 'No Answers'}
                    </span>
                    {sub.averageTimePerQuestionSeconds !== null && sub.averageTimePerQuestionSeconds > 0 && (
                      <span className="block text-[10px] font-bold text-slate-400 mt-1">
                        ⚡ {Math.round(sub.averageTimePerQuestionSeconds)}s / Q
                      </span>
                    )}
                  </div>
                </div>

                {/* Multi-Segmented Progress Bar */}
                <div className="space-y-1.5">
                  {totalQ > 0 ? (
                    <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden flex">
                      {sub.correct > 0 && (
                        <div
                          style={{ flex: sub.correct }}
                          className="h-full bg-emerald-500 transition-all duration-500"
                          title={`Correct: ${sub.correct}`}
                        />
                      )}
                      {sub.wrong > 0 && (
                        <div
                          style={{ flex: sub.wrong }}
                          className="h-full bg-rose-500 transition-all duration-500"
                          title={`Wrong: ${sub.wrong}`}
                        />
                      )}
                      {sub.skipped > 0 && (
                        <div
                          style={{ flex: sub.skipped }}
                          className="h-full bg-slate-300 transition-all duration-500"
                          title={`Skipped: ${sub.skipped}`}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${accStyle.bar}`}
                        style={{ width: `${accuracyVal ?? 0}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Granular Stats Chips */}
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-center text-xs pt-1">
                  <div className="p-2 rounded-xl bg-white border border-slate-100">
                    <span className="text-[10px] text-slate-400 block font-medium">Attempted</span>
                    <span className="font-extrabold text-slate-900">{sub.questionsAttempted}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-white border border-slate-100">
                    <span className="text-[10px] text-emerald-600 block font-medium">Correct</span>
                    <span className="font-extrabold text-emerald-600">{sub.correct}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-white border border-slate-100">
                    <span className="text-[10px] text-rose-500 block font-medium">Wrong</span>
                    <span className="font-extrabold text-rose-600">{sub.wrong}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-white border border-slate-100 col-span-3 sm:col-span-1">
                    <span className="text-[10px] text-slate-400 block font-medium">Score</span>
                    <span className="font-extrabold text-slate-900">
                      {sub.score}/{sub.maxScore}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Chapter Performance Section with Subject Filter */
function ChapterPerformanceSection({
  chapters,
  isLoading,
  error,
  subjects,
}: {
  chapters?: ChapterPerformanceSummary[];
  isLoading: boolean;
  error: Error | null;
  subjects?: SubjectPerformanceSummary[];
}) {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'accuracy_asc' | 'accuracy_desc' | 'name'>('accuracy_asc');

  const filteredChapters = useMemo(() => {
    if (!chapters) return [];
    let list = [...chapters];

    if (selectedSubjectId !== 'all') {
      list = list.filter((c) => c.subjectId === selectedSubjectId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) => c.chapterName.toLowerCase().includes(q) || c.subjectName.toLowerCase().includes(q),
      );
    }

    if (sortBy === 'accuracy_asc') {
      list.sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
    } else if (sortBy === 'accuracy_desc') {
      list.sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
    } else if (sortBy === 'name') {
      list.sort((a, b) => a.chapterName.localeCompare(b.chapterName));
    }

    return list;
  }, [chapters, selectedSubjectId, searchQuery, sortBy]);

  return (
    <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-50 text-sky-600">
              <ClipboardText size={18} weight="duotone" />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
              Chapter-wise Breakdown
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Pinpoint specific syllabus topics needing practice and review
          </p>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Subject Selector */}
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">All Subjects</option>
            {subjects?.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.subjectName}
              </option>
            ))}
          </select>

          {/* Search Box */}
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search chapters..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 w-36 sm:w-48"
            />
          </div>

          {/* Sort Selector */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="accuracy_asc">Lowest Accuracy First</option>
            <option value="accuracy_desc">Highest Accuracy First</option>
            <option value="name">Chapter Name</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-slate-50 rounded-2xl border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-rose-50 border border-rose-100 text-center space-y-1">
          <p className="text-xs font-bold text-rose-700">Unable to load chapter analytics</p>
          <p className="text-[11px] text-slate-500">Please refresh the dashboard.</p>
        </div>
      ) : filteredChapters.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1.5">
          <p className="text-xs font-bold text-slate-700">No chapters found</p>
          <p className="text-[11px] text-slate-500">
            {searchQuery || selectedSubjectId !== 'all'
              ? 'Try changing your search query or subject filter.'
              : 'Complete mock tests to generate chapter-specific analytics.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
          {filteredChapters.map((chap) => {
            const accStyle = getAccuracyColor(chap.accuracy);
            const accuracyVal = chap.accuracy !== null ? Math.round(chap.accuracy) : null;
            return (
              <div
                key={chap.chapterId}
                className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/60 border border-slate-200/80 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-500 px-2 py-0.5 rounded-full bg-slate-200/60 uppercase tracking-wider">
                      {chap.subjectName}
                    </span>
                    <h3 className="text-xs font-bold text-slate-900">{chap.chapterName}</h3>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {formatChapterBreakdownStats(chap)}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <div className="w-24 sm:w-32 hidden sm:block">
                    <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${accStyle.bar}`}
                        style={{ width: `${accuracyVal ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <span
                    className={`text-xs font-extrabold px-2.5 py-1 rounded-xl border ${accStyle.bg} ${accStyle.text} ${accStyle.border}`}
                  >
                    {accuracyVal !== null ? `${accuracyVal}%` : '—'}
                  </span>

                  <Link
                    href="/student/tests"
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:border-sky-300 hover:text-sky-600 text-slate-700 font-bold text-[11px] transition-colors shadow-2xs"
                  >
                    Practice
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Targeted Focus Areas (Weak Chapters & Strong Chapters) */
function TargetedFocusSection({
  weakChapters,
  strongChapters,
  isWeakLoading,
  isStrongLoading,
}: {
  weakChapters?: ChapterPerformanceSummary[];
  strongChapters?: ChapterPerformanceSummary[];
  isWeakLoading: boolean;
  isStrongLoading: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'weak' | 'strong'>('weak');

  const filteredWeak = useMemo(
    () => weakChapters?.filter((c) => c.accuracy !== null && c.accuracy < 50) ?? [],
    [weakChapters],
  );

  const filteredStrong = useMemo(
    () => strongChapters?.filter((c) => c.accuracy !== null && c.accuracy >= 80) ?? [],
    [strongChapters],
  );

  const displayList = activeTab === 'weak' ? filteredWeak : filteredStrong;
  const isLoading = activeTab === 'weak' ? isWeakLoading : isStrongLoading;

  return (
    <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Sparkle size={18} weight="duotone" />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
              Targeted Syllabus Recommendations
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Focus on weak chapters to maximize test score jumps, and reinforce strong topics
          </p>
        </div>

        {/* Weak vs Strong Tab Toggle */}
        <div className="inline-flex p-1 rounded-2xl bg-slate-100 border border-slate-200">
          <button
            onClick={() => setActiveTab('weak')}
            className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'weak'
                ? 'bg-white text-amber-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <WarningCircle size={14} weight="bold" className="text-amber-600" />
            <span>Needs Attention ({filteredWeak.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('strong')}
            className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'strong'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Trophy size={14} weight="bold" className="text-emerald-600" />
            <span>Mastery Areas ({filteredStrong.length})</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-slate-50 rounded-2xl border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : displayList.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1.5">
          <p className="text-xs font-bold text-slate-700">
            {activeTab === 'weak' ? 'No Weak Chapters Identified' : 'No mastered topics yet'}
          </p>
          <p className="text-[11px] text-slate-500">
            {activeTab === 'weak'
              ? "Great job! You have no chapters scoring below the 50% accuracy threshold."
              : 'Complete more tests and score above 80% to highlight mastery chapters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {displayList.map((item) => {
            const accStyle = getAccuracyColor(item.accuracy);
            const accuracyVal = item.accuracy !== null ? Math.round(item.accuracy) : null;
            return (
              <div
                key={item.chapterId}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  activeTab === 'weak'
                    ? 'bg-amber-50/40 border-amber-200/80 hover:bg-amber-50/70'
                    : 'bg-emerald-50/40 border-emerald-200/80 hover:bg-emerald-50/70'
                }`}
              >
                <div className="space-y-1 mb-3">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      activeTab === 'weak' ? 'text-amber-800' : 'text-emerald-800'
                    }`}
                  >
                    {item.subjectName}
                  </span>
                  <h4 className="text-xs font-bold text-slate-900 leading-tight">{item.chapterName}</h4>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                  <span className={`text-xs font-black ${accStyle.text}`}>
                    {accuracyVal !== null ? `${accuracyVal}% Accuracy` : '—'}
                  </span>
                  <Link
                    href="/student/tests"
                    className={`text-xs font-bold hover:underline flex items-center gap-1 ${
                      activeTab === 'weak' ? 'text-amber-900' : 'text-emerald-900'
                    }`}
                  >
                    <span>Practice</span>
                    <ArrowRight size={12} weight="bold" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function StudentAnalyticsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Queries
  const {
    data: summary,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
  } = useStudentDashboardSummary();

  const {
    data: scoreTrend,
    isLoading: isTrendLoading,
    error: trendError,
    refetch: refetchTrend,
  } = useStudentScoreTrend();

  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);

  const {
    data: attemptedTests,
    isLoading: isAttemptedTestsLoading,
    refetch: refetchAttemptedTests,
  } = useStudentAttemptedTests();

  const {
    data: subjectData,
    isLoading: isSubjectLoading,
    error: subjectError,
    refetch: refetchSubject,
  } = useSubjectAnalytics(undefined, selectedTestId);

  const {
    data: chapterData,
    isLoading: isChapterLoading,
    error: chapterError,
    refetch: refetchChapter,
  } = useChapterAnalytics();

  const {
    data: weakChapters,
    isLoading: isWeakLoading,
    refetch: refetchWeak,
  } = useStudentWeakChapters();

  const {
    data: strongChapters,
    isLoading: isStrongLoading,
    refetch: refetchStrong,
  } = useStudentStrongChapters();

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchSummary(),
        refetchTrend(),
        refetchSubject(),
        refetchAttemptedTests(),
        refetchChapter(),
        refetchWeak(),
        refetchStrong(),
      ]);
    } catch (err) {
      console.warn('[StudentAnalyticsPage] Refetch failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchSummary, refetchTrend, refetchSubject, refetchAttemptedTests, refetchChapter, refetchWeak, refetchStrong]);

  return (
    <div className="store-container space-y-8 pb-12">
      {/* ── Top Header ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">Student Hub</Link>
            <span aria-hidden="true">/</span>
            <span>Performance Analytics</span>
          </nav>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">Performance Analytics</h1>
          <p className="student-hero-lead">
            Track your mock test accuracy, score trajectories, and identify targeted syllabus areas to improve.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors shadow-2xs shrink-0 self-start sm:self-auto disabled:opacity-60"
        >
          <ArrowClockwise
            size={14}
            weight="bold"
            className={`text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh Analytics'}</span>
        </button>
      </div>

      {/* ── Section 1: Performance Overview 5-Card Grid ───────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {isSummaryLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              title="Tests Completed"
              value={summary?.testsAttempted ?? 0}
              subtitle="Total evaluated attempts"
              icon={ClipboardText}
              iconColor="text-sky-600"
              iconBg="bg-sky-50"
            />
            <MetricCard
              title="Average Score"
              value={summary?.averageScore != null && (summary?.testsAttempted ?? 0) > 0 ? summary.averageScore : '—'}
              subtitle="Mean marks per test"
              icon={ChartBar}
              iconColor="text-indigo-600"
              iconBg="bg-indigo-50"
            />
            <MetricCard
              title="Best Score"
              value={summary?.bestScore != null && (summary?.testsAttempted ?? 0) > 0 ? summary.bestScore : '—'}
              subtitle="Highest marks achieved"
              icon={Trophy}
              iconColor="text-purple-600"
              iconBg="bg-purple-50"
            />
            <MetricCard
              title="Overall Accuracy"
              value={
                summary?.overallAccuracy != null && (summary?.testsAttempted ?? 0) > 0
                  ? `${Math.round(summary.overallAccuracy)}%`
                  : '—'
              }
              subtitle="Correct / Total answered"
              icon={Target}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-50"
            />
            <MetricCard
              title="Avg Percentage"
              value={
                summary?.averagePercentage != null && (summary?.testsAttempted ?? 0) > 0
                  ? `${Math.round(summary.averagePercentage)}%`
                  : '—'
              }
              subtitle="Overall test percentage"
              icon={Percent}
              iconColor="text-amber-600"
              iconBg="bg-amber-50"
            />
          </>
        )}
      </div>

      {/* ── Section 2: Score Trajectory Trend Chart ───────────── */}
      <ScoreTrendCard
        trendData={scoreTrend}
        isLoading={isTrendLoading}
        error={trendError}
      />

      {/* ── Section 3: Subject-wise Performance Breakdown ─────── */}
      <SubjectPerformanceSection
        subjects={subjectData?.subjects}
        isLoading={isSubjectLoading}
        error={subjectError}
        selectedTestId={selectedTestId}
        onSelectTest={setSelectedTestId}
        attemptedTests={attemptedTests}
        isAttemptedTestsLoading={isAttemptedTestsLoading}
      />

      {/* ── Section 4: Chapter-wise Performance Breakdown ─────── */}
      <ChapterPerformanceSection
        chapters={chapterData?.chapters}
        subjects={subjectData?.subjects}
        isLoading={isChapterLoading}
        error={chapterError}
      />

      {/* ── Section 5: Targeted Syllabus Recommendations ──────── */}
      <TargetedFocusSection
        weakChapters={weakChapters}
        strongChapters={strongChapters}
        isWeakLoading={isWeakLoading}
        isStrongLoading={isStrongLoading}
      />
    </div>
  );
}
