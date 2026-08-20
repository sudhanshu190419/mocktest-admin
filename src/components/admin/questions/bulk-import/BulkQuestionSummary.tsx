'use client';

import type { QuestionImportSummary } from '@/types/bulkQuestionImport';
import { CheckCircle, WarningCircle, XCircle, FileText } from '@phosphor-icons/react';

interface BulkQuestionSummaryProps {
  summary: QuestionImportSummary;
}

export function BulkQuestionSummary({ summary }: BulkQuestionSummaryProps) {
  const { totalRows, validRows, invalidRows, warningRows, questionTypesCount } = summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Total */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              <FileText size={20} weight="bold" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Questions</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{totalRows}</p>
            </div>
          </div>
        </div>

        {/* Valid */}
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircle size={20} weight="bold" />
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Ready to Publish</p>
              <p className="text-xl font-bold text-emerald-800 dark:text-emerald-200">{validRows}</p>
            </div>
          </div>
        </div>

        {/* Invalid */}
        <div className="rounded-2xl border border-red-200 bg-red-50/40 p-4 shadow-sm dark:border-red-900/40 dark:bg-red-950/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              <XCircle size={20} weight="bold" />
            </div>
            <div>
              <p className="text-xs font-medium text-red-700 dark:text-red-400">Errors (Blocked)</p>
              <p className="text-xl font-bold text-red-800 dark:text-red-200">{invalidRows}</p>
            </div>
          </div>
        </div>

        {/* Warnings */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <WarningCircle size={20} weight="bold" />
            </div>
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Warnings</p>
              <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{warningRows}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown by question type */}
      {validRows > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-300">Valid Breakdown:</span>
          {questionTypesCount.mcq > 0 && (
            <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              MCQ: {questionTypesCount.mcq}
            </span>
          )}
          {questionTypesCount.msq > 0 && (
            <span className="rounded-full bg-purple-50 px-2.5 py-1 font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              MSQ: {questionTypesCount.msq}
            </span>
          )}
          {questionTypesCount.true_false > 0 && (
            <span className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
              True/False: {questionTypesCount.true_false}
            </span>
          )}
          {questionTypesCount.numerical > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Numerical: {questionTypesCount.numerical}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
