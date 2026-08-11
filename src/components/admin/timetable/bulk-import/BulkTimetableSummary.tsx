'use client';

import { cn } from '@/lib/utils';
import type { ImportSummary } from '@/types/bulkTimetableImport';

type Tone = 'default' | 'green' | 'red' | 'amber' | 'blue';

const TONE_CLASS: Record<Tone, string> = {
  default: 'text-gray-900 dark:text-gray-100',
  green: 'text-emerald-600 dark:text-emerald-400',
  red: 'text-red-600 dark:text-red-400',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
};

interface StatTile {
  label: string;
  value: number;
  tone: Tone;
}

interface BulkTimetableSummaryProps {
  summary: ImportSummary;
}

/**
 * Import summary stat strip. Displays ONLY values already computed by the
 * Phase 2 validator (`ImportSummary`) — no independent recalculation.
 */
export function BulkTimetableSummary({ summary }: BulkTimetableSummaryProps) {
  const tiles: StatTile[] = [
    { label: 'Total Rows', value: summary.totalRows, tone: 'default' },
    { label: 'Valid Rows', value: summary.validRows, tone: 'green' },
    { label: 'Errors', value: summary.errorRows, tone: 'red' },
    { label: 'Warnings', value: summary.warningCount, tone: 'amber' },
    { label: 'Duplicates Ignored', value: summary.duplicateCount, tone: 'default' },
    { label: 'Slots to Create', value: summary.slotsToCreate, tone: 'blue' },
    { label: 'Slots Reused', value: summary.slotsToReuse, tone: 'green' },
    { label: 'Slots Extended', value: summary.slotsToExtend, tone: 'amber' },
    { label: 'Lessons to Create', value: summary.plansToCreate, tone: 'blue' },
    { label: 'Lessons to Update', value: summary.plansToUpdate, tone: 'default' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {tile.label}
          </p>
          <p className={cn('mt-1 text-xl font-bold', TONE_CLASS[tile.tone])}>{tile.value}</p>
        </div>
      ))}
    </div>
  );
}
