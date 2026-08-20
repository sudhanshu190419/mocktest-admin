'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CircleNotch, FileArrowUp, FileCsv, FileXls } from '@phosphor-icons/react';

interface BulkQuestionUploadProps {
  onFileSelected: (file: File) => void;
  onDownloadXlsx: () => void;
  onDownloadCsv: () => void;
  activeFileName?: string | null;
  busy?: boolean;
  templateError?: string | null;
}

export function BulkQuestionUpload({
  onFileSelected,
  onDownloadXlsx,
  onDownloadCsv,
  activeFileName,
  busy = false,
  templateError,
}: BulkQuestionUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFileSelected(file);
  };

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) handleFiles(e.dataTransfer.files);
        }}
        onClick={openPicker}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          dragOver
            ? 'border-blue-500 bg-blue-50/50 dark:border-blue-400 dark:bg-blue-950/20'
            : 'border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600',
          busy && 'cursor-wait opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
          disabled={busy}
        />

        {busy ? (
          <div className="flex flex-col items-center gap-2">
            <CircleNotch size={36} className="animate-spin text-blue-600 dark:text-blue-400" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Parsing & validating question rows...
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <FileArrowUp size={24} weight="bold" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {activeFileName ? (
                  <span className="text-blue-600 dark:text-blue-400">Selected: {activeFileName}</span>
                ) : (
                  'Click to upload or drag and drop spreadsheet'
                )}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Supports Excel (.xlsx) and CSV (.csv) up to 10 MB (max 5,000 questions)
              </p>
            </div>
          </div>
        )}
      </label>

      {/* Template download section */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Need the sample format? Download our pre-formatted template with example questions and active subject codes:
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDownloadXlsx}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <FileXls size={15} weight="bold" className="text-emerald-600" />
            Excel Template
          </button>
          <button
            type="button"
            onClick={onDownloadCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <FileCsv size={15} weight="bold" className="text-blue-600" />
            CSV Template
          </button>
        </div>
      </div>

      {templateError && (
        <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          {templateError}
        </p>
      )}
    </div>
  );
}
