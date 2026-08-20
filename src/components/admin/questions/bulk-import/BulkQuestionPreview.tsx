'use client';

import { useState } from 'react';
import type { QuestionImportPreviewRow } from '@/types/bulkQuestionImport';
import { CheckCircle, XCircle } from '@phosphor-icons/react';

interface BulkQuestionPreviewProps {
  rows: QuestionImportPreviewRow[];
}

export function BulkQuestionPreview({ rows }: BulkQuestionPreviewProps) {
  const [filterValid, setFilterValid] = useState<'all' | 'valid' | 'invalid'>('all');

  const filtered = rows.filter((r) => {
    if (filterValid === 'valid') return r.isValid;
    if (filterValid === 'invalid') return !r.isValid;
    return true;
  });

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Parsed Rows Preview ({filtered.length} of {rows.length})
        </h3>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setFilterValid('all')}
            className={`rounded-lg px-2.5 py-1 font-medium transition ${
              filterValid === 'all'
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            All ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterValid('valid')}
            className={`rounded-lg px-2.5 py-1 font-medium transition ${
              filterValid === 'valid'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            Valid Only ({rows.filter((r) => r.isValid).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterValid('invalid')}
            className={`rounded-lg px-2.5 py-1 font-medium transition ${
              filterValid === 'invalid'
                ? 'bg-red-600 text-white'
                : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300'
            }`}
          >
            Errors Only ({rows.filter((r) => !r.isValid).length})
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <tr>
              <th className="py-2.5 pl-4 pr-2 font-semibold">Row</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Type</th>
              <th className="px-3 py-2.5 font-semibold">Subject / Chapter</th>
              <th className="px-3 py-2.5 font-semibold">Question Stem</th>
              <th className="px-3 py-2.5 font-semibold">Marks</th>
              <th className="py-2.5 pl-3 pr-4 font-semibold">Options / Answer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((r) => (
              <tr
                key={r.rowNumber}
                className={`transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-800/40 ${
                  !r.isValid ? 'bg-red-50/20 dark:bg-red-950/10' : ''
                }`}
              >
                <td className="py-2.5 pl-4 pr-2 font-mono font-medium text-gray-700 dark:text-gray-300">
                  {r.rowNumber}
                </td>
                <td className="px-3 py-2.5">
                  {r.isValid ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <CheckCircle size={13} weight="bold" />
                      Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      <XCircle size={13} weight="bold" />
                      Error
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    {r.questionType}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{r.subjectName}</div>
                  <div className="text-[11px] text-gray-500">{r.chapterName}</div>
                </td>
                <td className="max-w-xs truncate px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">
                  {r.questionText}
                </td>
                <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-gray-300">
                  +{r.marks} / -{r.negativeMarks}
                </td>
                <td className="max-w-xs truncate py-2.5 pl-3 pr-4 text-gray-600 dark:text-gray-400">
                  {r.optionsSummary || r.correctAnswer || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
