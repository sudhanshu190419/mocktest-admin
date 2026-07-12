'use client';

import { useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AnalyticsFilters, DateRangePreset } from '@/types/analytics-extended';
import { DEFAULT_FILTERS, FILTER_DATE_PRESETS } from '@/types/analytics-extended';

interface AnalyticsFilterProps {
  filters: AnalyticsFilters;
  onChange: (filters: AnalyticsFilters) => void;
  className?: string;
  showSubject?: boolean;
  showChapter?: boolean;
  showDifficulty?: boolean;
  showBatch?: boolean;
  showMockTest?: boolean;
  showExport?: boolean;
  /** Available batches for the batch filter dropdown */
  batches?: { id: string; name: string }[];
  /** Available mock tests for the mock test filter dropdown */
  mockTests?: { id: string; title: string }[];
  /** Available subjects for the subject filter dropdown */
  subjects?: { id: string; name: string }[];
}

export function AnalyticsFilter({
  filters,
  onChange,
  className,
  showSubject = false,
  showChapter = false,
  showDifficulty = false,
  showBatch = false,
  showMockTest = false,
  showExport = false,
  batches = [],
  mockTests = [],
  subjects = [],
}: AnalyticsFilterProps) {
  const updateFilter = useCallback(
    (key: keyof AnalyticsFilters, value: string) => {
      onChange({ ...filters, [key]: value });
    },
    [filters, onChange],
  );

  const updateDatePreset = useCallback(
    (preset: DateRangePreset) => {
      onChange({
        ...filters,
        dateRange: { ...filters.dateRange, preset },
      });
    },
    [filters, onChange],
  );

  const updateDateRange = useCallback(
    (field: 'from' | 'to', value: string) => {
      onChange({
        ...filters,
        dateRange: { ...filters.dateRange, [field]: value, preset: 'custom' },
      });
    },
    [filters, onChange],
  );

  const activePreset = filters.dateRange.preset;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Date presets */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => updateDatePreset(preset.value)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              activePreset === preset.value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Custom date range + filters row */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Custom date from */}
        {activePreset === 'custom' && (
          <>
            <div className="min-w-[140px]">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">From</label>
              <input
                type="date"
                value={filters.dateRange.from}
                onChange={(e) => updateDateRange('from', e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">To</label>
              <input
                type="date"
                value={filters.dateRange.to}
                onChange={(e) => updateDateRange('to', e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </>
        )}

        {/* Batch filter */}
        {showBatch && (
          <div className="min-w-[160px]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">Batch</label>
            <select
              value={filters.batchId}
              onChange={(e) => updateFilter('batchId', e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Subject filter */}
        {showSubject && (
          <div className="min-w-[140px]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">Subject</label>
            <select
              value={filters.subjectId}
              onChange={(e) => updateFilter('subjectId', e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              {subjects.length === 0 && (
                <>
                  <option value="physics">Physics</option>
                  <option value="chemistry">Chemistry</option>
                  <option value="biology">Biology</option>
                  <option value="mathematics">Mathematics</option>
                </>
              )}
            </select>
          </div>
        )}

        {/* Mock Test filter */}
        {showMockTest && (
          <div className="min-w-[160px]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">Mock Test</label>
            <select
              value={filters.mockTestId}
              onChange={(e) => updateFilter('mockTestId', e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Tests</option>
              {mockTests.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Difficulty filter */}
        {showDifficulty && (
          <div className="min-w-[120px]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">Difficulty</label>
            <select
              value={filters.difficulty}
              onChange={(e) => updateFilter('difficulty', e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">All Difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        )}

        {/* Export buttons */}
        {showExport && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled
              title="CSV export requires backend integration"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-400 opacity-60 dark:border-gray-700 dark:bg-gray-900"
            >
              CSV
            </button>
            <button
              type="button"
              disabled
              title="Excel export requires backend integration"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-400 opacity-60 dark:border-gray-700 dark:bg-gray-900"
            >
              Excel
            </button>
            <button
              type="button"
              disabled
              title="PDF export requires backend integration"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-400 opacity-60 dark:border-gray-700 dark:bg-gray-900"
            >
              PDF
            </button>
            <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
              TODO
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
