'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  IconRefresh,
  IconChartBar,
  IconTarget,
  IconTrophy,
  IconFileText,
  IconTrendUp,
  IconTrendDown,
  IconSearch,
  IconLibrary,
  IconFilter,
  IconClock,
  IconSpark,
  IconArrowRight,
  IconCheckCircle,
  IconWarning,
  IconTest,
  IconCalculator,
  IconPercent,
} from '@/components/icons/student-icons';
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
import { formatDate, formatPercent, ordinal } from '@/lib/format';
import { getRubricLevel, isWorthPracticing, isMastered } from '@/lib/rubric';
import { Button, ButtonLink, EmptyState, ErrorState, Skeleton } from '@/components/ui/mmt';

// ─── Subject Icon Selector (Vector Icons) ───────────────────────────────────

function getSubjectIconComponent(subjectName: string): React.ElementType {
  const name = subjectName.toLowerCase();
  if (name.includes('math') || name.includes('calc')) return IconCalculator;
  if (name.includes('phys') || name.includes('chem') || name.includes('bio') || name.includes('sci')) return IconSpark;
  return IconLibrary;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

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
    <div className="p-5 rounded-card bg-surface border border-line shadow-card hover:border-brand/40 transition-all flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-caption font-bold text-ink-muted uppercase tracking-wider">{title}</span>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-field ${iconBg} ${iconColor}`}>
          <IconComponent size={20} />
        </div>
      </div>
      <div>
        <div className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight tabular-nums">{value}</div>
        <p className="text-caption font-medium text-ink-secondary mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

/** Design A Score Trajectory Trend Chart (White / Paper Surface) */
function ScoreTrendCard({
  trendData,
  isLoading,
  error,
  onRetry,
}: {
  trendData?: ScoreTrendPoint[];
  isLoading: boolean;
  error: Error | null;
  onRetry?: () => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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
      const p = Math.max(0, Math.min(100, d.percentage));
      const y = padY + chartH - (p / 100) * chartH;
      return { x, y, data: d, index: i };
    });

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

  const activePoint = hoveredIndex !== null && chartLayout ? chartLayout.points[hoveredIndex] : null;

  return (
    <div className="p-6 sm:p-7 rounded-card bg-surface border border-line shadow-card space-y-6 relative">
      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-field bg-sky-tint text-brand">
              <IconChartBar size={18} />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-ink tracking-tight">
              Score Trajectory Trend
            </h2>
          </div>
          <p className="text-xs text-ink-secondary mt-1">
            Chronological percentage scored across evaluated mock tests
          </p>
        </div>

        {/* Quick summary stat chips */}
        {stats.peak !== null && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="px-3 py-1.5 rounded-field bg-mint-tint border border-emerald-200 flex items-center gap-1.5">
              <span className="text-ink-secondary text-caption">Peak:</span>
              <span className="font-extrabold text-mint-ink">{Math.round(stats.peak)}%</span>
            </div>
            <div className="px-3 py-1.5 rounded-field bg-sky-tint border border-line flex items-center gap-1.5">
              <span className="text-ink-secondary text-caption">Average:</span>
              <span className="font-extrabold text-brand-hover">{stats.avg}%</span>
            </div>
            <div className="px-3 py-1.5 rounded-field bg-paper border border-line flex items-center gap-1.5">
              <span className="text-ink-secondary text-caption">Latest:</span>
              <span className="font-extrabold text-ink">{Math.round(stats.latest || 0)}%</span>
              {stats.delta !== null && (
                <span
                  className={`inline-flex items-center gap-0.5 text-caption font-bold px-1.5 py-0.5 rounded-md ${
                    stats.delta >= 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {stats.delta >= 0 ? <IconTrendUp size={10} /> : <IconTrendDown size={10} />}
                  {Math.abs(stats.delta)}%
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Chart Body */}
      {isLoading ? (
        <Skeleton className="h-60 rounded-field" />
      ) : error ? (
        <ErrorState
          title="Unable to load score trajectory"
          detail="Please check your network connection and retry."
          onRetry={onRetry}
        />
      ) : !trendData || trendData.length === 0 ? (
        <EmptyState
          icon={IconFileText}
          title="No Test Trend Available Yet"
          detail="Complete and submit mock tests to unlock your interactive score trajectory and accuracy curves."
          action={
            <ButtonLink href="/student/tests" size="sm">
              Explore Assigned Mock Tests
            </ButtonLink>
          }
        />
      ) : trendData.length === 1 ? (
        <div className="p-6 rounded-field bg-paper border border-line space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-field bg-mint-tint text-mint-ink border border-emerald-200">
              <IconCheckCircle size={22} />
            </div>
            <div>
              <span className="text-caption font-bold text-brand-hover uppercase tracking-wider">Initial Test Attempt</span>
              <h3 className="text-sm font-bold text-ink">{trendData[0].testName}</h3>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-field bg-surface border border-line">
              <span className="text-caption text-ink-muted block font-medium">Score Achieved</span>
              <span className="text-sm font-extrabold text-ink">
                {trendData[0].score} / {trendData[0].maxScore}
              </span>
            </div>
            <div className="p-3 rounded-field bg-surface border border-line">
              <span className="text-caption text-ink-muted block font-medium">Percentage</span>
              <span className="text-sm font-extrabold text-mint-ink">
                {trendData[0].percentage.toFixed(1)}%
              </span>
            </div>
            <div className="p-3 rounded-field bg-surface border border-line">
              <span className="text-caption text-ink-muted block font-medium">Accuracy</span>
              <span className="text-sm font-extrabold text-brand-hover">
                {trendData[0].accuracy !== null ? `${Math.round(trendData[0].accuracy)}%` : '—'}
              </span>
            </div>
            <div className="p-3 rounded-field bg-surface border border-line">
              <span className="text-caption text-ink-muted block font-medium">Attempted On</span>
              <span className="text-sm font-extrabold text-ink-secondary">
                {formatDate(trendData[0].attemptedOn)}
              </span>
            </div>
          </div>
          <p className="text-caption text-ink-muted italic">
            Complete at least 2 tests to display your continuous progress trajectory chart.
          </p>
        </div>
      ) : chartLayout ? (
        <div className="relative pt-2">
          {/* SVG Container */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartLayout.width} ${chartLayout.height}`}
              className="w-full h-auto min-w-[550px] overflow-visible select-none"
            >
              <defs>
                <linearGradient id="scoreAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="scoreLineGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2563EB" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>
              </defs>

              {/* Grid Lines & Y-Axis Labels */}
              {[0, 25, 50, 75, 100].map((val) => {
                const y = chartLayout.padY + chartLayout.chartH - (val / 100) * chartLayout.chartH;
                return (
                  <g key={val}>
                    <line
                      x1={chartLayout.padX}
                      y1={y}
                      x2={chartLayout.width - chartLayout.padX}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={chartLayout.padX - 8}
                      y={y + 4}
                      fill="#94A3B8"
                      fontSize="10"
                      fontWeight="bold"
                      textAnchor="end"
                    >
                      {`${val}%`}
                    </text>
                  </g>
                );
              })}

              {/* Area Fill */}
              {chartLayout.areaD && <path d={chartLayout.areaD} fill="url(#scoreAreaGradient)" />}

              {/* Trend Curve Line */}
              <path
                d={chartLayout.pathD}
                fill="none"
                stroke="url(#scoreLineGradient)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Data Interactive Points */}
              {chartLayout.points.map((pt, idx) => {
                const isSelected = hoveredIndex === idx;
                return (
                  <g
                    key={idx}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onClick={() => setHoveredIndex(idx)}
                    onTouchStart={() => setHoveredIndex(idx)}
                  >
                    <circle cx={pt.x} cy={pt.y} r="20" fill="transparent" />

                    {isSelected && (
                      <circle cx={pt.x} cy={pt.y} r="10" fill="#2563EB" fillOpacity="0.2" />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isSelected ? 6 : 4.5}
                      fill={isSelected ? '#059669' : '#FFFFFF'}
                      stroke={isSelected ? '#059669' : '#2563EB'}
                      strokeWidth="2.5"
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* First / Last Date Labels along X-Axis */}
          <div className="flex items-center justify-between pt-2 px-10 text-caption font-semibold text-ink-muted border-t border-line/60 mt-1">
            <span>First: {formatDate(trendData[0].attemptedOn)}</span>
            <span>Latest: {formatDate(trendData[trendData.length - 1].attemptedOn)}</span>
          </div>

          {/* Anchored Tooltip Card */}
          {activePoint && (
            <div className="mt-4 p-4 rounded-field bg-paper border border-line shadow-card text-xs space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="font-extrabold text-ink text-sm">{activePoint.data.testName}</span>
                <span className="text-caption font-bold text-ink-muted">
                  {formatDate(activePoint.data.attemptedOn)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div>
                  <span className="text-ink-muted text-caption block">Score</span>
                  <span className="font-extrabold text-ink">
                    {activePoint.data.score} / {activePoint.data.maxScore}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted text-caption block">Percentage</span>
                  <span className="font-extrabold text-mint-ink">
                    {activePoint.data.percentage.toFixed(1)}%
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted text-caption block">Accuracy</span>
                  <span className="font-extrabold text-brand-hover">
                    {formatPercent(activePoint.data.accuracy, { forceZero: true })}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted text-caption block">Rank / Percentile</span>
                  <span className="font-extrabold text-purple-700">
                    {activePoint.data.rank !== null ? `#${activePoint.data.rank}` : '—'}{' '}
                    {activePoint.data.percentile !== null ? `(${ordinal(activePoint.data.percentile)} percentile)` : ''}
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

// ─── Subject Performance Section ─────────────────────────────────────────────

function SubjectPerformanceSection({
  subjects,
  isLoading,
  error,
  selectedTestId,
  onSelectTest,
  attemptedTests,
  isAttemptedTestsLoading,
  onRetry,
}: {
  subjects?: SubjectPerformanceSummary[];
  isLoading: boolean;
  error: Error | null;
  selectedTestId: string | null;
  onSelectTest: (testId: string | null) => void;
  attemptedTests?: AttemptedTestOption[];
  isAttemptedTestsLoading?: boolean;
  onRetry?: () => void;
}) {
  const selectedTest = useMemo(() => {
    if (!selectedTestId || !attemptedTests) return null;
    return attemptedTests.find((t) => t.testId === selectedTestId) || null;
  }, [selectedTestId, attemptedTests]);

  return (
    <div className="p-6 sm:p-7 rounded-card bg-surface border border-line shadow-card space-y-6">
      {/* ── Header & Scope Selection Bar ─────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-field bg-sky-tint text-brand">
                <IconLibrary size={18} />
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-ink tracking-tight">
                Subject-wise Accuracy & Performance
              </h2>
            </div>
            <p className="text-xs text-ink-secondary mt-1">
              {selectedTestId
                ? `Showing subject metrics for ${selectedTest?.testName || 'selected test'}`
                : 'Cumulative metrics across all completed mock tests'}
            </p>
          </div>

          {/* Test Selector Dropdown */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-field bg-paper border border-line text-xs font-bold text-ink-secondary min-h-[44px]">
              <IconFilter size={14} className="text-brand" />
              <span>Scope:</span>
              <select
                value={selectedTestId || 'overall'}
                onChange={(e) => onSelectTest(e.target.value === 'overall' ? null : e.target.value)}
                disabled={isAttemptedTestsLoading}
                aria-label="Analytics scope filter"
                className="bg-transparent font-bold text-ink focus:outline-none cursor-pointer pr-2"
              >
                <option value="overall">
                  Overall Performance ({attemptedTests?.length ?? 0} {attemptedTests?.length === 1 ? 'Test' : 'Tests'})
                </option>
                {attemptedTests?.map((test) => (
                  <option key={test.testId} value={test.testId}>
                    {test.testName} {test.attemptedOn ? `(${formatDate(test.attemptedOn)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Horizontal Quick-Filter Chips */}
        {attemptedTests && attemptedTests.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 no-scrollbar">
            <button
              onClick={() => onSelectTest(null)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-all min-h-[44px] ${
                selectedTestId === null
                  ? 'bg-brand text-white shadow-2xs'
                  : 'bg-paper hover:bg-sky-tint/80 text-ink border border-line'
              }`}
            >
              <IconChartBar size={14} />
              <span>Overall ({attemptedTests.length})</span>
            </button>

            {attemptedTests.map((test) => {
              const isSelected = selectedTestId === test.testId;
              return (
                <button
                  key={test.testId}
                  onClick={() => onSelectTest(test.testId)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-all max-w-[220px] truncate min-h-[44px] ${
                    isSelected
                      ? 'bg-brand text-white shadow-2xs'
                      : 'bg-paper hover:bg-sky-tint/80 text-ink border border-line'
                  }`}
                >
                  <IconClock size={14} />
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
            <Skeleton key={i} className="h-44 rounded-card" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Unable to load subject analytics"
          detail="Please refresh or try again later."
          onRetry={onRetry}
        />
      ) : !subjects || subjects.length === 0 ? (
        <EmptyState
          icon={IconLibrary}
          title={selectedTestId ? 'No Questions Recorded for This Test' : 'No Subject Performance Data Yet'}
          detail={
            selectedTestId
              ? 'This specific test did not contain recorded questions for the selected subject scope.'
              : 'Complete and submit mock tests to view subject-specific strengths and accuracy breakdowns.'
          }
          action={
            selectedTestId ? (
              <Button variant="secondary" size="sm" onClick={() => onSelectTest(null)}>
                Reset to Overall Performance
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {subjects.map((sub) => {
            const rubric = getRubricLevel(sub.accuracy);
            const accuracyVal = sub.accuracy !== null ? Math.round(sub.accuracy) : null;
            const SubjectIcon = getSubjectIconComponent(sub.subjectName);
            const totalQ = sub.correct + sub.wrong + sub.skipped;

            return (
              <div
                key={sub.subjectId}
                className="p-5 rounded-card bg-surface border border-line shadow-card hover:border-brand/40 transition-all space-y-4"
              >
                {/* Subject Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-field bg-sky-tint text-brand">
                      <SubjectIcon size={22} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-ink">{sub.subjectName}</h3>
                      {rubric && (
                        <span
                          className={`inline-block text-caption font-bold px-2 py-0.5 rounded-full border mt-0.5 ${rubric.colorClass.pill}`}
                        >
                          {rubric.label}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs font-extrabold px-2.5 py-1 rounded-full border ${
                        rubric
                          ? rubric.colorClass.pill
                          : 'bg-paper text-ink-secondary border-line'
                      }`}
                    >
                      {accuracyVal !== null ? `${accuracyVal}% Accuracy` : 'No Answers'}
                    </span>
                    {sub.averageTimePerQuestionSeconds !== null && sub.averageTimePerQuestionSeconds > 0 && (
                      <span className="block text-caption font-bold text-ink-muted mt-1">
                        {Math.round(sub.averageTimePerQuestionSeconds)}s / Q
                      </span>
                    )}
                  </div>
                </div>

                {/* Multi-Segmented Progress Bar */}
                <div className="space-y-1.5">
                  {totalQ > 0 ? (
                    <div className="h-2.5 w-full rounded-full bg-paper overflow-hidden flex border border-line/60">
                      {sub.correct > 0 && (
                        <div
                          style={{ flex: sub.correct }}
                          className="h-full bg-emerald-500 transition-all duration-300"
                          title={`Correct: ${sub.correct}`}
                        />
                      )}
                      {sub.wrong > 0 && (
                        <div
                          style={{ flex: sub.wrong }}
                          className="h-full bg-amber-500 transition-all duration-300"
                          title={`Wrong: ${sub.wrong}`}
                        />
                      )}
                      {sub.skipped > 0 && (
                        <div
                          style={{ flex: sub.skipped }}
                          className="h-full bg-line transition-all duration-300"
                          title={`Skipped: ${sub.skipped}`}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="h-2.5 w-full rounded-full bg-paper overflow-hidden border border-line/60">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          rubric ? rubric.colorClass.bar : 'bg-brand'
                        }`}
                        style={{ width: `${accuracyVal ?? 0}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Inline counts under segmented bars */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs pt-1">
                  <div className="p-2 rounded-field bg-paper border border-line">
                    <span className="text-caption text-ink-muted block font-medium">Attempted</span>
                    <span className="font-extrabold text-ink tabular-nums">{sub.questionsAttempted}</span>
                  </div>
                  <div className="p-2 rounded-field bg-mint-tint/60 border border-emerald-100">
                    <span className="text-caption text-mint-ink block font-medium">Correct</span>
                    <span className="font-extrabold text-mint-ink tabular-nums">{sub.correct}</span>
                  </div>
                  <div className="p-2 rounded-field bg-amber-50/70 border border-amber-200/80">
                    <span className="text-caption text-amber-800 block font-medium">Wrong</span>
                    <span className="font-extrabold text-amber-900 tabular-nums">{sub.wrong}</span>
                  </div>
                  <div className="p-2 rounded-field bg-paper border border-line">
                    <span className="text-caption text-ink-muted block font-medium">Score</span>
                    <span className="font-extrabold text-ink tabular-nums">
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

// ─── Chapter Performance Section ─────────────────────────────────────────────

function ChapterPerformanceSection({
  chapters,
  isLoading,
  error,
  subjects,
  onRetry,
}: {
  chapters?: ChapterPerformanceSummary[];
  isLoading: boolean;
  error: Error | null;
  subjects?: SubjectPerformanceSummary[];
  onRetry?: () => void;
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
    <div className="p-6 sm:p-7 rounded-card bg-surface border border-line shadow-card space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-field bg-sky-tint text-brand">
              <IconFileText size={18} />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-ink tracking-tight">
              Chapter-wise Breakdown
            </h2>
          </div>
          <p className="text-xs text-ink-secondary mt-1">
            Pinpoint specific syllabus topics needing practice and review
          </p>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            className="px-3 py-2 text-xs font-bold rounded-field bg-paper border border-line text-ink focus:outline-none focus:border-brand min-h-[44px]"
            aria-label="Filter chapters by subject"
          >
            <option value="all">All Subjects</option>
            {subjects?.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.subjectName}
              </option>
            ))}
          </select>

          <div className="relative">
            <IconSearch
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
            />
            <input
              type="text"
              placeholder="Search chapters..."
              aria-label="Search chapters"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-2 text-xs rounded-field bg-paper border border-line text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand w-36 sm:w-48 min-h-[44px]"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 text-xs font-bold rounded-field bg-paper border border-line text-ink focus:outline-none focus:border-brand min-h-[44px]"
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
            <Skeleton key={i} className="h-16 rounded-field" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Unable to load chapter analytics"
          detail="Please refresh the dashboard."
          onRetry={onRetry}
        />
      ) : filteredChapters.length === 0 ? (
        <EmptyState
          title="No chapters found"
          detail={
            searchQuery || selectedSubjectId !== 'all'
              ? 'Try changing your search query or subject filter.'
              : 'Complete mock tests to generate chapter-specific analytics.'
          }
        />
      ) : (
        <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
          {filteredChapters.map((chap) => {
            const rubric = getRubricLevel(chap.accuracy);
            const accuracyVal = chap.accuracy !== null ? Math.round(chap.accuracy) : null;
            return (
              <div
                key={chap.chapterId}
                className="p-3.5 sm:p-4 rounded-field bg-paper/60 border border-line hover:bg-paper transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-caption font-bold text-ink-secondary px-2 py-0.5 rounded-full bg-sky-tint uppercase tracking-wider">
                      {chap.subjectName}
                    </span>
                    <h3 className="text-xs font-bold text-ink">{chap.chapterName}</h3>
                  </div>
                  <p className="text-caption text-ink-secondary">
                    {formatChapterBreakdownStats(chap)}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <div className="w-24 sm:w-32 hidden sm:block">
                    <div className="h-1.5 w-full bg-line rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          rubric ? rubric.colorClass.bar : 'bg-brand'
                        }`}
                        style={{ width: `${accuracyVal ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <span
                    className={`text-xs font-extrabold px-2.5 py-1 rounded-full border ${
                      rubric
                        ? rubric.colorClass.pill
                        : 'bg-paper text-ink-secondary border-line'
                    }`}
                  >
                    {accuracyVal !== null ? `${accuracyVal}%` : '—'}
                  </span>

                  <Link
                    href="/student/tests"
                    className="px-3.5 py-2 rounded-field bg-surface border border-line hover:border-brand hover:text-brand text-ink font-bold text-caption transition-colors shadow-2xs min-h-[44px] inline-flex items-center"
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

// ─── Targeted Syllabus Recommendations (Unified Rubric) ──────────────────────

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

  // Unified rubric thresholds: <60% = worth practicing, >=80% = mastered
  const filteredWeak = useMemo(
    () => weakChapters?.filter((c) => isWorthPracticing(c.accuracy)) ?? [],
    [weakChapters],
  );

  const filteredStrong = useMemo(
    () => strongChapters?.filter((c) => isMastered(c.accuracy)) ?? [],
    [strongChapters],
  );

  const displayList = activeTab === 'weak' ? filteredWeak : filteredStrong;
  const isLoading = activeTab === 'weak' ? isWeakLoading : isStrongLoading;

  return (
    <div className="p-6 sm:p-7 rounded-card bg-surface border border-line shadow-card space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-field bg-amber-50 text-amber-600">
              <IconSpark size={18} />
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-ink tracking-tight">
              Targeted Syllabus Recommendations
            </h2>
          </div>
          <p className="text-xs text-ink-secondary mt-1">
            Focus on chapters worth practicing to maximize score gains, and maintain mastered topics
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="inline-flex p-1 rounded-field bg-paper border border-line">
          <button
            type="button"
            onClick={() => setActiveTab('weak')}
            className={`px-4 py-2 text-xs font-bold rounded-field transition-all flex items-center gap-1.5 min-h-[44px] ${
              activeTab === 'weak'
                ? 'bg-surface text-amber-900 shadow-2xs border border-amber-200'
                : 'text-ink-secondary hover:text-ink'
            }`}
          >
            <IconWarning size={14} className="text-amber-600" />
            <span>Worth Practicing ({filteredWeak.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('strong')}
            className={`px-4 py-2 text-xs font-bold rounded-field transition-all flex items-center gap-1.5 min-h-[44px] ${
              activeTab === 'strong'
                ? 'bg-surface text-emerald-900 shadow-2xs border border-emerald-200'
                : 'text-ink-secondary hover:text-ink'
            }`}
          >
            <IconTrophy size={14} className="text-emerald-600" />
            <span>Mastered Topics ({filteredStrong.length})</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-field" />
          ))}
        </div>
      ) : displayList.length === 0 ? (
        <EmptyState
          icon={activeTab === 'weak' ? IconCheckCircle : IconTrophy}
          title={activeTab === 'weak' ? 'No Topics Below 60%' : 'No Mastered Topics Yet'}
          detail={
            activeTab === 'weak'
              ? 'Great job! You currently have no chapters scoring below the 60% accuracy threshold.'
              : 'Complete more tests and score 80% or above to highlight mastery chapters here.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {displayList.map((item) => {
            const rubric = getRubricLevel(item.accuracy);
            const accuracyVal = item.accuracy !== null ? Math.round(item.accuracy) : null;
            return (
              <div
                key={item.chapterId}
                className={`p-4 rounded-field border transition-all flex flex-col justify-between ${
                  activeTab === 'weak'
                    ? 'bg-amber-50/50 border-amber-200/80 hover:bg-amber-50/80'
                    : 'bg-mint-tint/50 border-emerald-200/80 hover:bg-mint-tint/80'
                }`}
              >
                <div className="space-y-1 mb-3">
                  <span
                    className={`text-caption font-bold uppercase tracking-wider ${
                      activeTab === 'weak' ? 'text-amber-800' : 'text-mint-ink'
                    }`}
                  >
                    {item.subjectName}
                  </span>
                  <h4 className="text-xs font-bold text-ink leading-tight">{item.chapterName}</h4>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-line/60">
                  <span
                    className={`text-xs font-extrabold ${
                      rubric ? rubric.colorClass.text : 'text-ink'
                    }`}
                  >
                    {accuracyVal !== null ? `${accuracyVal}% Accuracy` : '—'}
                  </span>
                  <Link
                    href="/student/tests"
                    className={`text-xs font-bold hover:underline flex items-center gap-1 min-h-[44px] ${
                      activeTab === 'weak' ? 'text-amber-900' : 'text-mint-ink'
                    }`}
                  >
                    <span>Practice</span>
                    <IconArrowRight size={12} />
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
    <div className="store-container space-y-6 pb-12">
      {/* ── Top Header & Breadcrumb ───────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">My Learning</Link>
            <span aria-hidden="true">/</span>
            <span>Performance Analytics</span>
          </nav>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight mt-1">
            Performance Analytics
          </h1>
          <p className="student-hero-lead">
            Track your mock test accuracy, score trajectories, and identify targeted syllabus areas to improve.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          {/* Cross-Link CTA to Test Results */}
          <Link
            href="/student/results"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-field bg-sky-tint hover:bg-sky-tint/80 border border-line text-brand-hover font-bold text-xs transition-colors shadow-2xs min-h-[44px]"
          >
            <IconTest size={16} className="text-brand" />
            <span>View Test Scorecards</span>
            <IconArrowRight size={14} />
          </Link>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-field bg-surface border border-line hover:bg-paper text-ink font-bold text-xs transition-colors shadow-2xs min-h-[44px] disabled:opacity-60"
          >
            <IconRefresh
              size={14}
              className={`text-ink-secondary ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* ── Section 1: Performance Overview 5-Card Grid ───────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {isSummaryLoading ? (
          <>
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-28 rounded-card" />
            ))}
          </>
        ) : (
          <>
            <MetricCard
              title="Tests Completed"
              value={summary?.testsAttempted ?? 0}
              subtitle="Total evaluated attempts"
              icon={IconFileText}
              iconColor="text-brand"
              iconBg="bg-sky-tint"
            />
            <MetricCard
              title="Average Score"
              value={
                summary?.averageScore != null && (summary?.testsAttempted ?? 0) > 0
                  ? summary.averageScore
                  : '—'
              }
              subtitle="Mean marks per test"
              icon={IconChartBar}
              iconColor="text-brand"
              iconBg="bg-sky-tint"
            />
            <MetricCard
              title="Best Score"
              value={
                summary?.bestScore != null && (summary?.testsAttempted ?? 0) > 0
                  ? summary.bestScore
                  : '—'
              }
              subtitle="Highest marks achieved"
              icon={IconTrophy}
              iconColor="text-purple-600"
              iconBg="bg-purple-50"
            />
            <MetricCard
              title="Overall Accuracy"
              value={
                summary?.overallAccuracy != null && (summary?.testsAttempted ?? 0) > 0
                  ? formatPercent(summary.overallAccuracy, { forceZero: true })
                  : '—'
              }
              subtitle="Correct / Total answered"
              icon={IconTarget}
              iconColor="text-mint-ink"
              iconBg="bg-mint-tint"
            />
            <MetricCard
              title="Avg Percentage"
              value={
                summary?.averagePercentage != null && (summary?.testsAttempted ?? 0) > 0
                  ? formatPercent(summary.averagePercentage, { forceZero: true })
                  : '—'
              }
              subtitle="Overall test percentage"
              icon={IconPercent}
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
        onRetry={refetchTrend}
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
        onRetry={refetchSubject}
      />

      {/* ── Section 4: Chapter-wise Performance Breakdown ─────── */}
      <ChapterPerformanceSection
        chapters={chapterData?.chapters}
        subjects={subjectData?.subjects}
        isLoading={isChapterLoading}
        error={chapterError}
        onRetry={refetchChapter}
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
