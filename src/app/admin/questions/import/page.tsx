'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { BulkQuestionUpload } from '@/components/admin/questions/bulk-import/BulkQuestionUpload';
import { BulkQuestionSummary } from '@/components/admin/questions/bulk-import/BulkQuestionSummary';
import { BulkQuestionMissingReferences } from '@/components/admin/questions/bulk-import/BulkQuestionMissingReferences';
import { BulkQuestionIssues } from '@/components/admin/questions/bulk-import/BulkQuestionIssues';
import { BulkQuestionPreview } from '@/components/admin/questions/bulk-import/BulkQuestionPreview';
import { BulkQuestionResult } from '@/components/admin/questions/bulk-import/BulkQuestionResult';
import { AddSubjectModal } from '@/features/question-bank/components/AddSubjectModal';
import { AddChapterModal } from '@/features/question-bank/components/AddChapterModal';
import { AddTopicModal } from '@/features/question-bank/components/AddTopicModal';
import {
  useQuestionReferenceData,
  useImportBulkQuestions,
} from '@/hooks/admin/useBulkQuestionImport';
import { parseQuestionImportFile } from '@/utils/bulkQuestionParser';
import { validateQuestionImportRows } from '@/utils/bulkQuestionValidator';
import {
  downloadQuestionXlsxTemplate,
  downloadQuestionCsvTemplate,
} from '@/utils/bulkQuestionTemplate';
import type {
  QuestionImportIssue,
  QuestionImportPreview,
  RawQuestionSheetRow,
} from '@/types/bulkQuestionImport';
import type { Subject, Chapter, Topic } from '@/types/academic';
import { CircleNotch, ArrowCounterClockwise, UploadSimple } from '@phosphor-icons/react';

export default function AdminBulkImportQuestionsPage() {
  const { instituteId } = useAuth();

  const {
    data: refData,
    isLoading: loadingRef,
    error: refError,
    refetch: refetchRef,
  } = useQuestionReferenceData(instituteId);

  const { mutate: importQuestions, isPending: isImporting } = useImportBulkQuestions();

  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [rawRows, setRawRows] = useState<RawQuestionSheetRow[]>([]);
  const [fileIssues, setFileIssues] = useState<QuestionImportIssue[]>([]);
  const [preview, setPreview] = useState<QuestionImportPreview | null>(null);
  const [importProgress, setImportProgress] = useState<{ completed: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Missing Reference Modals State ───────────────────────────────────────
  const [missingSubjectName, setMissingSubjectName] = useState<string | null>(null);
  const [missingChapterData, setMissingChapterData] = useState<{
    subjectId: string;
    chapterName: string;
  } | null>(null);
  const [missingTopicData, setMissingTopicData] = useState<{
    chapterId: string;
    topicName: string;
  } | null>(null);

  // ── Handle file selection and parsing ────────────────────────────────────
  const handleFileSelected = useCallback(
    async (file: File) => {
      if (!refData) return;

      setActiveFileName(file.name);
      setIsParsing(true);
      setImportError(null);
      setImportedCount(null);

      try {
        const parsed = await parseQuestionImportFile(file);
        setRawRows(parsed.rows);
        setFileIssues(parsed.issues);

        const validationResult = validateQuestionImportRows(parsed.rows, refData, parsed.issues);
        setPreview(validationResult);
      } catch (err: any) {
        setImportError(err.message || 'Failed to parse file.');
      } finally {
        setIsParsing(false);
      }
    },
    [refData],
  );

  // ── Revalidate rows with fresh reference data ────────────────────────────
  const revalidateWithFreshData = useCallback(
    async (toastMsg: string) => {
      const freshRes = await refetchRef();
      if (freshRes.data && rawRows.length > 0) {
        const validationResult = validateQuestionImportRows(rawRows, freshRes.data, fileIssues);
        setPreview(validationResult);
        setToastMessage(toastMsg);
        setTimeout(() => setToastMessage(null), 5000);
      }
    },
    [refetchRef, rawRows, fileIssues],
  );

  // ── Missing reference creation callbacks ─────────────────────────────────
  const handleSubjectCreated = useCallback(
    async (subject: Subject) => {
      setMissingSubjectName(null);
      await revalidateWithFreshData(`✓ Subject "${subject.name}" created successfully! Revalidated questions.`);
    },
    [revalidateWithFreshData],
  );

  const handleChapterCreated = useCallback(
    async (chapter: Chapter) => {
      setMissingChapterData(null);
      await revalidateWithFreshData(`✓ Chapter "${chapter.name}" created successfully! Revalidated questions.`);
    },
    [revalidateWithFreshData],
  );

  const handleTopicCreated = useCallback(
    async (topic: Topic) => {
      setMissingTopicData(null);
      await revalidateWithFreshData(`✓ Topic "${topic.name}" created successfully! Revalidated questions.`);
    },
    [revalidateWithFreshData],
  );

  // ── Download template handlers ───────────────────────────────────────────
  const handleDownloadXlsx = useCallback(async () => {
    setTemplateError(null);
    const ok = await downloadQuestionXlsxTemplate(refData);
    if (!ok) setTemplateError('Failed to generate Excel template.');
  }, [refData]);

  const handleDownloadCsv = useCallback(() => {
    setTemplateError(null);
    const ok = downloadQuestionCsvTemplate();
    if (!ok) setTemplateError('Failed to generate CSV template.');
  }, []);

  // ── Execute Import ───────────────────────────────────────────────────────
  const handleExecuteImport = useCallback(() => {
    if (!preview || !preview.validPayloads.length || !instituteId) return;

    setImportError(null);
    setImportProgress({ completed: 0, total: preview.validPayloads.length });

    importQuestions(
      {
        instituteId,
        payload: preview.validPayloads,
        onProgress: (completed, total) => {
          setImportProgress({ completed, total });
        },
      },
      {
        onSuccess: (result) => {
          setImportedCount(result.imported_count ?? preview.validPayloads.length);
          setImportProgress(null);
        },
        onError: (err) => {
          setImportError(err.message || 'Bulk import failed.');
          setImportProgress(null);
        },
      },
    );
  }, [preview, instituteId, importQuestions]);

  const handleReset = useCallback(() => {
    setActiveFileName(null);
    setRawRows([]);
    setFileIssues([]);
    setPreview(null);
    setImportError(null);
    setImportProgress(null);
    setImportedCount(null);
    setToastMessage(null);
  }, []);

  if (refError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
        <p className="font-semibold">Failed to load academic reference data:</p>
        <p className="mt-1">{refError.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Import Questions"
        description="Import batches of text-only questions directly into the published Question Bank"
        breadcrumbs={[
          { label: 'Question Bank', href: '/admin/questions' },
          { label: 'Bulk Import' },
        ]}
      />

      {/* Success toast after creating missing reference */}
      {toastMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {toastMessage}
        </div>
      )}

      {/* Success result screen */}
      {importedCount !== null ? (
        <BulkQuestionResult importedCount={importedCount} onReset={handleReset} />
      ) : (
        <div className="space-y-6">
          {/* File Upload Dropzone */}
          <BulkQuestionUpload
            onFileSelected={handleFileSelected}
            onDownloadXlsx={handleDownloadXlsx}
            onDownloadCsv={handleDownloadCsv}
            activeFileName={activeFileName}
            busy={loadingRef || isParsing || isImporting}
            templateError={templateError}
          />

          {/* Import error banner */}
          {importError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              <span className="font-semibold">Import Error:</span> {importError}
            </div>
          )}

          {/* Validation & Preview section */}
          {preview && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <BulkQuestionSummary summary={preview.summary} />

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Ready to publish {preview.validPayloads.length} question
                    {preview.validPayloads.length === 1 ? '' : 's'}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {preview.summary.invalidRows > 0
                      ? `${preview.summary.invalidRows} invalid rows will be skipped.`
                      : 'All rows are valid and will be published.'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={isImporting}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <ArrowCounterClockwise size={14} />
                    Reset
                  </button>

                  <button
                    type="button"
                    onClick={handleExecuteImport}
                    disabled={isImporting || preview.validPayloads.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isImporting ? (
                      <>
                        <CircleNotch size={16} className="animate-spin" />
                        Publishing {importProgress ? `${importProgress.completed}/${importProgress.total}...` : '...'}
                      </>
                    ) : (
                      <>
                        <UploadSimple size={16} weight="bold" />
                        Import & Publish {preview.validPayloads.length} Valid Questions
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Missing Academic References Resolution Card */}
              {preview.missingReferences && (
                <BulkQuestionMissingReferences
                  missingReferences={preview.missingReferences}
                  onResolveSubject={(rawName) => setMissingSubjectName(rawName)}
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

              {/* Issues List (if any) */}
              {(preview.fileIssues.length > 0 || preview.rowIssues.length > 0) && (
                <BulkQuestionIssues
                  fileIssues={preview.fileIssues}
                  rowIssues={preview.rowIssues}
                />
              )}

              {/* Parsed Rows Preview */}
              <BulkQuestionPreview rows={preview.rows} />
            </div>
          )}
        </div>
      )}

      {/* ── Add Missing Subject Modal ───────────────────────────────────────── */}
      <AddSubjectModal
        isOpen={Boolean(missingSubjectName)}
        existingSubjects={refData?.subjects ?? []}
        initialName={missingSubjectName ?? ''}
        onClose={() => setMissingSubjectName(null)}
        onCreated={handleSubjectCreated}
      />

      {/* ── Add Missing Chapter Modal ───────────────────────────────────────── */}
      {missingChapterData && (
        <AddChapterModal
          isOpen={Boolean(missingChapterData)}
          subjectId={missingChapterData.subjectId}
          existingChapters={(refData?.chapters ?? []).filter(
            (c) => c.subjectId === missingChapterData.subjectId,
          )}
          initialName={missingChapterData.chapterName}
          onClose={() => setMissingChapterData(null)}
          onCreated={handleChapterCreated}
        />
      )}

      {/* ── Add Missing Topic Modal ─────────────────────────────────────────── */}
      {missingTopicData && (
        <AddTopicModal
          isOpen={Boolean(missingTopicData)}
          chapterId={missingTopicData.chapterId}
          existingTopics={(refData?.topics ?? []).filter(
            (t) => t.chapterId === missingTopicData.chapterId,
          )}
          initialName={missingTopicData.topicName}
          onClose={() => setMissingTopicData(null)}
          onCreated={handleTopicCreated}
        />
      )}
    </div>
  );
}
