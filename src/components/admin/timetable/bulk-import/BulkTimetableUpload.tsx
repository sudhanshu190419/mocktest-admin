'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CircleNotch, FileArrowUp } from '@phosphor-icons/react';

interface BulkTimetableUploadProps {
  /** Called with every file the admin picks (drag/drop or picker). */
  onFileSelected: (file: File) => void;
  onDownloadXlsx: () => void;
  onDownloadCsv: () => void;
  /** Name of the file currently selected/being processed. */
  activeFileName?: string | null;
  /** True while parsing (or waiting on reference data). */
  busy?: boolean;
  /** Optional template-download failure message. */
  templateError?: string | null;
}

/**
 * Upload card for the bulk timetable importer.
 *
 * A real `<input type="file" accept=".xlsx,.csv">` wrapped in a label keeps
 * the picker keyboard + screen-reader accessible; drag & drop is an
 * enhancement on top. Client-side extension/size feedback is NOT duplicated
 * here — `parseImportFile()` (Phase 2) is the authoritative validator and
 * returns file-level issues that the page renders.
 */
export function BulkTimetableUpload({
  onFileSelected,
  onDownloadXlsx,
  onDownloadCsv,
  activeFileName,
  busy = false,
  templateError,
}: BulkTimetableUploadProps) {
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
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragOver
            ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/10'
            : 'border-gray-300 hover:border-blue-400 dark:border-gray-600 dark:hover:border-blue-500',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {busy ? (
          <CircleNotch size={32} className="animate-spin text-blue-500" aria-hidden="true" />
        ) : (
          <FileArrowUp size={32} className="text-gray-400" aria-hidden="true" />
        )}
        <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
          {busy
            ? `Reading ${activeFileName ?? 'file'}…`
            : activeFileName
              ? activeFileName
              : 'Drag & drop your file here, or'}
        </p>
        {!busy && !activeFileName && (
          <span className="mt-2 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
            Choose File
          </span>
        )}
        <p className="mt-2 text-xs text-gray-400">XLSX / CSV · Max 10 MB</p>
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDownloadXlsx}
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Download XLSX Template
          </button>
          <button
            type="button"
            onClick={onDownloadCsv}
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Download CSV Template
          </button>
        </div>
        {!busy && activeFileName && (
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Choose Another File
          </button>
        )}
      </div>

      {templateError && (
        <p className="mt-3 text-xs text-red-500" role="alert">
          {templateError}
        </p>
      )}
    </div>
  );
}
