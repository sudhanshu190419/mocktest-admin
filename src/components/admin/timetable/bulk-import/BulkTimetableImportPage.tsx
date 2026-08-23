'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleNotch, CheckCircle } from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { parseImportFile, type ParsedImportFile } from '@/utils/bulkTimetableParser';
import {
  buildImportPayload,
  buildImportPreview,
  hasBlockingErrors,
  isoDowOf,
} from '@/utils/bulkTimetableValidator';
import { useBulkImportReferenceData, useImportBulkTimetable } from '@/hooks/admin/useBulkTimetableImport';
import type {
  BulkImportRpcResult,
  ImportedRow,
  ImportIssue,
  ImportPreview,
  ImportSummary,
  ReferenceData,
} from '@/types/bulkTimetableImport';
import type { Chapter, Topic } from '@/types/academic';
import { AddChapterModal } from '@/features/question-bank/components/AddChapterModal';
import { AddTopicModal } from '@/features/question-bank/components/AddTopicModal';
import { BulkTimetableUpload } from './BulkTimetableUpload';
import { BulkTimetableSummary } from './BulkTimetableSummary';
import { BulkTimetableMissingReferences } from './BulkTimetableMissingReferences';
import { BulkTimetableGroupList, buildDisplayMaps } from './BulkTimetableGroupList';
import { BulkTimetableIssues } from './BulkTimetableIssues';
import { BulkTimetableConfirm } from './BulkTimetableConfirm';
import { BulkTimetableResult } from './BulkTimetableResult';
import { downloadCsvTemplate, downloadXlsxTemplate } from './BulkTimetableTemplate';

/** Workflow phases (page-local state — no global store). */
type Phase =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string }
  | { kind: 'parse-failed'; fileName: string; issues: ImportIssue[] }
  | { kind: 'preview'; fileName: string; parsed: ParsedImportFile }
  | { kind: 'importing'; fileName: string; parsed: ParsedImportFile }
  | { kind: 'success'; result: BulkImportRpcResult }
  | { kind: 'failed'; fileName: string; parsed: ParsedImportFile; error: string };

const EMPTY_SUMMARY: ImportSummary = {
  totalRows: 0,
  validRows: 0,
  errorRows: 0,
  warningCount: 0,
  duplicateCount: 0,
  slotsToCreate: 0,
  slotsToReuse: 0,
  slotsToExtend: 0,
  plansToCreate: 0,
  plansToUpdate: 0,
};

/**
 * Bulk Timetable Import — workflow orchestrator.
 *
 * File → `parseImportFile` → `buildImportPreview` (with reference data) →
 * preview → confirm → `useImportBulkTimetable` → RPC 114 → result.
 *
 * Phase 2 is the authoritative parser/validator; this component is
 * presentation/workflow only. The final write goes exclusively through the
 * `bulk_import_timetable` RPC via the Phase 2 hook/service.
 */
export function BulkTimetableImportPage() {
  const router = useRouter();
  const { instituteId } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Missing Reference Modals State ───────────────────────────────────────
  const [missingChapterData, setMissingChapterData] = useState<{
    subjectId: string;
    chapterName: string;
  } | null>(null);
  const [missingTopicData, setMissingTopicData] = useState<{
    chapterId: string;
    topicName: string;
  } | null>(null);

  const referenceQuery = useBulkImportReferenceData(instituteId);
  const reference: ReferenceData | undefined = referenceQuery.data;
  const mutation = useImportBulkTimetable();

  // ── Preview: only buildable once the parsed file AND reference data exist ──
  const preview = useMemo<ImportPreview | null>(() => {
    if (phase.kind !== 'preview' && phase.kind !== 'importing' && phase.kind !== 'failed') return null;
    if (!phase.parsed || !reference) return null;
    return buildImportPreview({ rows: phase.parsed.rows, reference });
  }, [phase, reference]);

  const payload = useMemo(() => (preview ? buildImportPayload(preview) : null), [preview]);

  const currentFileName =
    phase.kind === 'parsing' ||
    phase.kind === 'parse-failed' ||
    phase.kind === 'preview' ||
    phase.kind === 'importing' ||
    phase.kind === 'failed'
      ? phase.fileName
      : null;

  // ── Name resolution (from the already-loaded reference data — no N+1) ──
  const displayMaps = useMemo(() => (reference ? buildDisplayMaps(reference) : null), [reference]);

  // ── group.key → the group's valid, non-duplicate rows ───────────────────
  const rowsByGroup = useMemo(() => {
    const map = new Map<string, ImportedRow[]>();
    if (!preview) return map;
    for (const group of preview.groups) {
      const rows = preview.rows.filter(
        (r) =>
          r.duplicateOfRow === null &&
          !r.issues.some((i) => i.severity === 'error') &&
          r.teacherId === group.teacherId &&
          r.batchSubjectId === group.batchSubjectId &&
          r.startTime === group.startTime &&
          r.endTime === group.endTime &&
          isoDowOf(r.date) === group.dayOfWeek,
      );
      map.set(group.key, rows);
    }
    return map;
  }, [preview]);

  // Row-level issues live on `preview.rows`; file-level on `preview.issues`.
  const rowIssues = useMemo(() => (preview ? preview.rows.flatMap((r) => r.issues) : []), [preview]);

  // ── Missing reference resolution callbacks ───────────────────────────────
  const handleChapterCreated = useCallback(
    async (chapter: Chapter) => {
      setMissingChapterData(null);
      await referenceQuery.refetch();
      setToastMessage(`✓ Chapter "${chapter.name}" created successfully! Timetable revalidated.`);
      setTimeout(() => setToastMessage(null), 5000);
    },
    [referenceQuery],
  );

  const handleTopicCreated = useCallback(
    async (topic: Topic) => {
      setMissingTopicData(null);
      await referenceQuery.refetch();
      setToastMessage(`✓ Topic "${topic.name}" created successfully! Timetable revalidated.`);
      setTimeout(() => setToastMessage(null), 5000);
    },
    [referenceQuery],
  );

  // ── File selection → parse → preview ───────────────────────────────────
  const handleFileSelected = useCallback((file: File) => {
    setConfirmOpen(false);
    setToastMessage(null);
    setPhase({ kind: 'parsing', fileName: file.name });
    void (async () => {
      const parsed = await parseImportFile(file);
      if (!parsed.ok) {
        setPhase({ kind: 'parse-failed', fileName: file.name, issues: parsed.issues });
        return;
      }
      setPhase({ kind: 'preview', fileName: file.name, parsed });
    })();
  }, []);

  const handleDownloadXlsx = useCallback(() => {
    void downloadXlsxTemplate(reference).then((ok) => setTemplateError(ok ? null : 'Could not generate the XLSX template.'));
  }, [reference]);

  const handleDownloadCsv = useCallback(() => {
    setTemplateError(downloadCsvTemplate() ? null : 'Could not generate the CSV template.');
  }, []);

  // ── Confirmation → import ───────────────────────────────────────────────
  const canImport =
    phase.kind === 'preview' && !!preview && !!payload && !hasBlockingErrors(preview) && !mutation.isPending;

  const handleConfirmImport = useCallback(() => {
    if (phase.kind !== 'preview' || !preview || !payload || !instituteId) return;
    setConfirmOpen(false);
    const { parsed, fileName } = phase;
    setPhase({ kind: 'importing', fileName, parsed });
    mutation.mutate(
      { instituteId, payload },
      {
        onSuccess: (result) => setPhase({ kind: 'success', result }),
        onError: (err) => setPhase({ kind: 'failed', fileName, parsed, error: err.message }),
      },
    );
  }, [phase, preview, payload, instituteId, mutation]);

  const handleRetry = useCallback(() => {
    if (phase.kind !== 'failed') return;
    setPhase({ kind: 'preview', fileName: phase.fileName, parsed: phase.parsed });
  }, [phase]);

  const handleBackToTimetable = useCallback(() => router.push('/admin/timetable'), [router]);
  const handleImportAnother = useCallback(() => {
    setToastMessage(null);
    setPhase({ kind: 'idle' });
  }, []);

  // ── Reference-data gap while a file is waiting to be validated ──────────
  // `isLoading` keeps the spinner from rendering alongside the error card.
  const waitingForReference = phase.kind === 'preview' && !reference && referenceQuery.isLoading;
  const referenceFailed = phase.kind === 'preview' && referenceQuery.isError;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <BulkTimetableUpload
        onFileSelected={handleFileSelected}
        onDownloadXlsx={handleDownloadXlsx}
        onDownloadCsv={handleDownloadCsv}
        activeFileName={currentFileName}
        busy={
          phase.kind === 'parsing' ||
          phase.kind === 'importing' ||
          (phase.kind === 'preview' && referenceQuery.isLoading)
        }
        templateError={templateError}
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-xs dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle size={18} weight="fill" className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {phase.kind === 'parse-failed' && (
        <BulkTimetableIssues fileIssues={phase.issues} rowIssues={[]} />
      )}

      {waitingForReference && (
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
            <CircleNotch size={20} className="animate-spin text-blue-500" aria-hidden="true" />
            Loading institute data…
          </div>
        </div>
      )}

      {referenceFailed && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm dark:border-red-900/50 dark:bg-red-950/30">
          <p className="font-medium text-red-800 dark:text-red-300">
            Institute data could not be loaded.
          </p>
          <p className="mt-1 text-red-700 dark:text-red-400">
            {referenceQuery.error?.message ?? 'Please try again.'}
          </p>
          <button
            type="button"
            onClick={() => void referenceQuery.refetch()}
            className="mt-3 inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {preview && displayMaps && (
        <>
          <BulkTimetableSummary summary={preview.summary} />

          {/* Missing Academic References Resolution Card */}
          {preview.missingReferences && (
            <BulkTimetableMissingReferences
              missingReferences={preview.missingReferences}
              onResolveChapter={(rawSubject, rawChapter, resolvedSubjectId) => {
                if (resolvedSubjectId) {
                  setMissingChapterData({
                    subjectId: resolvedSubjectId,
                    chapterName: rawChapter,
                  });
                }
              }}
              onResolveTopic={(rawChapter, rawTopic, resolvedChapterId) => {
                if (resolvedChapterId) {
                  setMissingTopicData({
                    chapterId: resolvedChapterId,
                    topicName: rawTopic,
                  });
                }
              }}
            />
          )}

          <BulkTimetableIssues fileIssues={preview.issues} rowIssues={rowIssues} />
          <BulkTimetableGroupList
            key={currentFileName ?? 'groups'}
            groups={preview.groups}
            rowsByGroup={rowsByGroup}
            displayMaps={displayMaps}
          />

          {phase.kind === 'preview' && (
            <div className="sticky bottom-4 z-10 flex justify-end">
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!canImport}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Import Timetable
              </button>
            </div>
          )}
        </>
      )}

      {phase.kind === 'importing' && (
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-col items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
            <CircleNotch size={24} className="animate-spin text-blue-500" aria-hidden="true" />
            <p className="font-medium text-gray-900 dark:text-gray-100">Importing timetable…</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              This action is all-or-nothing and may take a moment for large files.
            </p>
          </div>
        </div>
      )}

      {phase.kind === 'success' && (
        <BulkTimetableResult
          kind="success"
          result={phase.result}
          onBackToTimetable={handleBackToTimetable}
          onImportAnother={handleImportAnother}
        />
      )}

      {phase.kind === 'failed' && (
        <BulkTimetableResult
          kind="failed"
          error={phase.error}
          onImportAnother={handleImportAnother}
          onRetry={handleRetry}
        />
      )}

      <BulkTimetableConfirm
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmImport}
        summary={preview?.summary ?? EMPTY_SUMMARY}
        loading={mutation.isPending}
      />

      {/* ── Modals for Inline Creation of Missing Academic References ── */}
      {missingChapterData && (
        <AddChapterModal
          isOpen={true}
          subjectId={missingChapterData.subjectId}
          existingChapters={
            (reference?.chapters.filter((c) => c.subjectId === missingChapterData.subjectId) ?? []) as unknown as Chapter[]
          }
          initialName={missingChapterData.chapterName}
          onClose={() => setMissingChapterData(null)}
          onCreated={handleChapterCreated}
        />
      )}

      {missingTopicData && (
        <AddTopicModal
          isOpen={true}
          chapterId={missingTopicData.chapterId}
          existingTopics={
            (reference?.topics.filter((t) => t.chapterId === missingTopicData.chapterId) ?? []) as unknown as Topic[]
          }
          initialName={missingTopicData.topicName}
          onClose={() => setMissingTopicData(null)}
          onCreated={handleTopicCreated}
        />
      )}

      <p className="sr-only" aria-live="polite">
        {phase.kind === 'importing'
          ? 'Importing timetable. This may take a moment.'
          : phase.kind === 'success'
            ? 'Import successful.'
            : phase.kind === 'failed'
              ? 'Import failed.'
              : ''}
      </p>
    </div>
  );
}
