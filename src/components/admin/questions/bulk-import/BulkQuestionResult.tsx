'use client';

import { CheckCircle, ArrowLeft, Plus } from '@phosphor-icons/react';
import Link from 'next/link';

interface BulkQuestionResultProps {
  importedCount: number;
  onReset: () => void;
}

export function BulkQuestionResult({
  importedCount,
  onReset,
}: BulkQuestionResultProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
        <CheckCircle size={36} weight="bold" />
      </div>

      <h2 className="mt-4 text-xl font-bold text-gray-900 dark:text-gray-100">
        Import Completed Successfully!
      </h2>

      <p className="mt-2 max-w-md text-sm text-gray-600 dark:text-gray-400">
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          {importedCount} question{importedCount === 1 ? '' : 's'}
        </span>{' '}
        were successfully created, validated, and directly published to the Question Bank. They are now available for mock tests.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/admin/questions"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          <ArrowLeft size={16} weight="bold" />
          Go to Question Bank
        </Link>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <Plus size={16} weight="bold" />
          Upload Another File
        </button>
      </div>
    </div>
  );
}
