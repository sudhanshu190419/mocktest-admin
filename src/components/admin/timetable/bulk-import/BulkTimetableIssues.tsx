'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { Info, Warning, WarningCircle } from '@phosphor-icons/react';
import type { ImportIssue, ImportSeverity } from '@/types/bulkTimetableImport';

interface BulkTimetableIssuesProps {
  /** File-level issues (from `preview.issues`). */
  fileIssues: ImportIssue[];
  /** Row-level issues (flat-mapped from `preview.rows[].issues`). */
  rowIssues: ImportIssue[];
}

type SeverityFilter = 'all' | ImportSeverity;

const SEVERITY_OPTIONS = [
  { value: 'error', label: 'Errors' },
  { value: 'warning', label: 'Warnings' },
  { value: 'info', label: 'Notes' },
];

const SEVERITY_META: Record<ImportSeverity, { label: string; icon: React.ReactNode; className: string }> = {
  error: {
    label: 'Error',
    icon: <WarningCircle size={16} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />,
    className: 'text-red-700 dark:text-red-400',
  },
  warning: {
    label: 'Warning',
    icon: <Warning size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />,
    className: 'text-amber-700 dark:text-amber-400',
  },
  info: {
    label: 'Note',
    icon: <Info size={16} className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />,
    className: 'text-gray-600 dark:text-gray-300',
  },
};

function matchesSearch(issue: ImportIssue, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    String(issue.row ?? '').includes(q) ||
    String(issue.column ?? '').toLowerCase().includes(q) ||
    String(issue.value ?? '').toLowerCase().includes(q) ||
    issue.problem.toLowerCase().includes(q) ||
    String(issue.suggestion ?? '').toLowerCase().includes(q)
  );
}

/**
 * Blocking errors + non-blocking warnings/notes for the import preview.
 *
 * Displays ONLY the `ImportIssue` data produced by Phase 2 — no second
 * validation mechanism. Errors block the import; warnings/notes do not.
 */
export function BulkTimetableIssues({ fileIssues, rowIssues }: BulkTimetableIssuesProps) {
  const allIssues = useMemo(() => [...fileIssues, ...rowIssues], [fileIssues, rowIssues]);
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [query, setQuery] = useState('');

  const errorCount = allIssues.filter((i) => i.severity === 'error').length;
  const warningCount = allIssues.filter((i) => i.severity === 'warning').length;
  const infoCount = allIssues.filter((i) => i.severity === 'info').length;

  const filtered = useMemo(() => {
    return allIssues
      .filter((i) => (severity === 'all' ? true : i.severity === severity))
      .filter((i) => matchesSearch(i, query))
      .sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  }, [allIssues, severity, query]);

  if (allIssues.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Issues</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {errorCount > 0 ? (
              <span className="font-medium text-red-600 dark:text-red-400">
                {errorCount} blocking error{errorCount === 1 ? '' : 's'} — fix the file and upload it again.
              </span>
            ) : (
              <span>
                No blocking errors. {warningCount > 0 && 'Warnings do not prevent import.'}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {errorCount} errors · {warningCount} warnings{infoCount > 0 ? ` · ${infoCount} notes` : ''}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search rows, columns, values…"
          className="w-full sm:w-72"
        />
        <Select
          value={severity === 'all' ? '' : severity}
          onChange={(v) => setSeverity(v ? (v as ImportSeverity) : 'all')}
          options={SEVERITY_OPTIONS}
          placeholder="All"
          className="w-36"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          No issues match the current filter.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {filtered.map((issue, idx) => {
            const meta = SEVERITY_META[issue.severity];
            return (
              <li key={`${issue.row ?? 'file'}-${idx}`} className="flex items-start gap-3 py-2.5">
                {meta.icon}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className={cn('font-medium', meta.className)}>{meta.label}</span>
                    <span>{issue.row ? `Row ${issue.row}` : 'File'}</span>
                    {issue.column && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {issue.column}
                      </span>
                    )}
                    {issue.value !== null && issue.value !== undefined && issue.value !== '' && (
                      <span className="truncate text-gray-400">&ldquo;{String(issue.value)}&rdquo;</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-200">{issue.problem}</p>
                  {issue.suggestion && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      Suggestion: {issue.suggestion}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
