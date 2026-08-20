'use client';

import { useState, useMemo } from 'react';
import type { QuestionImportIssue } from '@/types/bulkQuestionImport';
import { WarningCircle, XCircle, Info, Funnel } from '@phosphor-icons/react';

interface BulkQuestionIssuesProps {
  fileIssues: QuestionImportIssue[];
  rowIssues: QuestionImportIssue[];
}

export function BulkQuestionIssues({ fileIssues, rowIssues }: BulkQuestionIssuesProps) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');

  const allIssues = useMemo(() => {
    return [...fileIssues, ...rowIssues];
  }, [fileIssues, rowIssues]);

  const errorCount = useMemo(() => allIssues.filter((i) => i.severity === 'error').length, [allIssues]);
  const warningCount = useMemo(() => allIssues.filter((i) => i.severity === 'warning').length, [allIssues]);
  const infoCount = useMemo(() => allIssues.filter((i) => i.severity === 'info').length, [allIssues]);

  const filteredIssues = useMemo(() => {
    if (filter === 'all') return allIssues;
    return allIssues.filter((i) => i.severity === filter);
  }, [allIssues, filter]);

  if (!allIssues.length) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 text-center text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
        ✓ No issues found. All questions are valid and ready to import!
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Validation Issues & Warnings ({allIssues.length})
        </h3>

        {/* Filter buttons */}
        <div className="flex items-center gap-1.5 text-xs">
          <Funnel size={14} className="text-gray-400" />
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-lg px-2.5 py-1 font-medium transition ${
              filter === 'all'
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            All ({allIssues.length})
          </button>
          {errorCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter('error')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filter === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300'
              }`}
            >
              Errors ({errorCount})
            </button>
          )}
          {warningCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter('warning')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filter === 'warning'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300'
              }`}
            >
              Warnings ({warningCount})
            </button>
          )}
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <tr>
              <th className="py-2.5 pl-4 pr-2 font-semibold">Row</th>
              <th className="px-3 py-2.5 font-semibold">Column</th>
              <th className="px-3 py-2.5 font-semibold">Severity</th>
              <th className="px-3 py-2.5 font-semibold">Problem</th>
              <th className="py-2.5 pl-3 pr-4 font-semibold">Suggestion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredIssues.map((issue, idx) => {
              const isErr = issue.severity === 'error';
              const isWarn = issue.severity === 'warning';
              return (
                <tr
                  key={idx}
                  className={`transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-800/40 ${
                    isErr ? 'bg-red-50/20 dark:bg-red-950/10' : ''
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2 font-mono font-medium text-gray-900 dark:text-gray-100">
                    {issue.row ? `Row ${issue.row}` : 'File'}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-700 dark:text-gray-300">
                    {issue.column ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {isErr && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                        <XCircle size={13} weight="bold" />
                        Error
                      </span>
                    )}
                    {isWarn && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        <WarningCircle size={13} weight="bold" />
                        Warning
                      </span>
                    )}
                    {!isErr && !isWarn && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        <Info size={13} weight="bold" />
                        Info
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                    {issue.problem}
                    {issue.value !== null && issue.value !== undefined && (
                      <span className="mt-0.5 block font-mono text-[11px] text-gray-500">
                        Value: "{String(issue.value)}"
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pl-3 pr-4 text-gray-600 dark:text-gray-400">
                    {issue.suggestion ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
