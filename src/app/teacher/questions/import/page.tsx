'use client';

import { useState, useCallback, useRef } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/utils';

type ImportFormat = 'csv' | 'json' | 'xlsx';
type ImportStatus = 'idle' | 'parsing' | 'validating' | 'importing' | 'done' | 'error';

interface ImportRowResult {
  row: number;
  status: 'success' | 'error';
  questionText?: string;
  error?: string;
}

export default function BulkImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setStatus('idle');
    setResults([]);
    setImportError(null);
    const name = f.name.toLowerCase();
    if (name.endsWith('.json')) setFormat('json');
    else if (name.endsWith('.xlsx') || name.endsWith('.xls')) setFormat('xlsx');
    else setFormat('csv');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleImport = useCallback(async () => {
    if (!file) return;
    setStatus('parsing');
    setImportError(null);

    try {
      const text = await file.text();
      let parsed: any[] = [];
      setStatus('validating');

      if (format === 'json') {
        parsed = JSON.parse(text);
      } else {
        const lines = text.split('\n').filter((l) => l.trim());
        if (lines.length < 2) throw new Error('CSV file must have a header row and at least one data row');
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map((v) => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
          parsed.push(row);
        }
      }

      setStatus('importing');
      const rowResults: ImportRowResult[] = parsed.map((row, i) => {
        const questionText = row.questionText || row.question_text || row.text || '';
        if (!questionText) return { row: i + 1, status: 'error', error: 'Missing question text' };
        return { row: i + 1, status: 'success', questionText: questionText.slice(0, 80) };
      });

      setResults(rowResults);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setImportError(err instanceof Error ? err.message : 'Failed to parse file');
    }
  }, [file, format]);

  const successCount = results.filter((r) => r.status === 'success').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Bulk Import"
        description="Import questions from Excel (.xlsx), CSV, or JSON files"
        breadcrumbs={[
          { label: 'Question Bank', href: '/teacher/questions' },
          { label: 'Import' },
        ]}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { format: 'CSV', desc: 'Comma-separated values', icon: '📄' },
          { format: 'JSON', desc: 'Structured data format', icon: '📋' },
          { format: 'XLSX', desc: 'Excel spreadsheet', icon: '📊' },
        ].map((f) => (
          <div key={f.format} className={cn(
            'rounded-xl border p-4 transition-all',
            format === f.format.toLowerCase()
              ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
              : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900',
          )}>
            <div className="mb-2 text-2xl">{f.icon}</div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{f.format}</p>
            <p className="text-[11px] text-gray-500">{f.desc}</p>
          </div>
        ))}
      </div>

      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.csv,.json,.xlsx,.xls';
          input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f); };
          input.click();
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 transition-colors',
          file ? 'border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-900/10' : 'border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500',
        )}
      >
        {file ? (
          <div className="text-center">
            <div className="mb-2 text-3xl">{file.name.endsWith('.json') ? '📋' : file.name.endsWith('.xlsx') ? '📊' : '📄'}</div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{file.name}</p>
            <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
            <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); setStatus('idle'); setResults([]); }}
              className="mt-3 text-xs font-medium text-red-500 hover:text-red-600">Remove</button>
          </div>
        ) : (
          <>
            <svg className="mb-3 h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Drop your file here, or click to browse</p>
            <p className="text-xs text-gray-500">Supports .csv, .json, .xlsx files</p>
          </>
        )}
      </div>

      {file && status === 'idle' && (
        <div className="mt-6">
          <button type="button" onClick={handleImport}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
            Import {file.name}
          </button>
        </div>
      )}

      {(status === 'parsing' || status === 'validating' || status === 'importing') && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm text-blue-700">
            {status === 'parsing' && 'Parsing file...'}
            {status === 'validating' && 'Validating rows...'}
            {status === 'importing' && 'Importing questions...'}
          </span>
        </div>
      )}

      {status === 'error' && importError && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">Import Failed</p>
          <p className="mt-1 text-sm text-red-600">{importError}</p>
        </div>
      )}

      {status === 'done' && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-2xl font-bold text-emerald-600">{successCount}</p>
              <p className="text-xs text-emerald-700">Valid</p>
            </div>
            {errorCount > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-2xl font-bold text-red-600">{errorCount}</p>
                <p className="text-xs text-red-700">Errors</p>
              </div>
            )}
          </div>

          {results.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Row</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Question</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900/50">
                  {results.map((r) => (
                    <tr key={r.row} className={r.status === 'error' ? 'bg-red-50/50 dark:bg-red-900/10' : ''}>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{r.row}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status === 'success' ? 'published' : 'archived'} showDot={false} /></td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100">{r.questionText ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{r.status === 'error' ? r.error : 'Ready to import'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {errorCount === 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800">All {successCount} rows are valid and ready for import.</p>
              <p className="mt-1 text-xs text-emerald-700">Note: Actual import to the database will be available once the Supabase connection is configured.</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Need a template?</h3>
        <p className="mt-1 text-xs text-gray-500">Download a sample CSV file with the required columns to get started.</p>
        <div className="mt-3">
          <pre className="rounded-lg bg-gray-50 p-3 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">
{`questionText,subjectId,chapterId,questionType,difficulty,marks,negativeMarks
"What is Newton's First Law?",sub-1,ch-1,mcq,medium,4,1
"Calculate the force",sub-1,ch-1,numerical,hard,5,0`}
          </pre>
        </div>
      </div>
    </div>
  );
}
