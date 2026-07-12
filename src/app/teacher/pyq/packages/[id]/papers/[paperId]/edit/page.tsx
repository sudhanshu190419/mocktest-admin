'use client';

import { useState, useCallback, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePyqPackage } from '@/hooks/pyq/usePyqPackages';
import {
  usePyqPaper,
  useUpdatePyqPaper,
  usePublishPyqPaper,
  useUnpublishPyqPaper,
  useDeletePyqPaper,
} from '@/hooks/pyq/usePyqPapers';
import { usePyqMockMappingWithTest } from '@/hooks/pyq/usePyqMockMapping';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

interface FormData {
  title: string;
  examYear: string;
  examDate: string;
  examSession: string;
  totalMarks: string;
  durationMin: string;
}

const emptyForm: FormData = {
  title: '',
  examYear: '',
  examDate: '',
  examSession: '',
  totalMarks: '',
  durationMin: '',
};

interface PdfUploadState {
  file: File | null;
  status: 'idle' | 'uploading' | 'done' | 'error';
  progress: number;
  error: string | null;
}

export default function EditPyqPaperPage({
  params,
}: {
  params: Promise<{ id: string; paperId: string }>;
}) {
  const router = useRouter();
  const { id: packageId, paperId } = use(params);

  const { data: pkg, isLoading: pkgLoading } = usePyqPackage(packageId);
  const { data: paper, isLoading: paperLoading, isError: paperError } = usePyqPaper(paperId);
  const updatePaper = useUpdatePyqPaper();
  const publishPaper = usePublishPyqPaper();
  const unpublishPaper = useUnpublishPyqPaper();
  const deletePaper = useDeletePyqPaper();

  const [formData, setFormData] = useState<FormData | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<{ type: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Mock test status
  const { data: mockData, isLoading: mockLoading } = usePyqMockMappingWithTest(paperId);

  // PDF upload state — for replacing existing PDFs
  const [questionPdf, setQuestionPdf] = useState<PdfUploadState>({ file: null, status: 'idle', progress: 0, error: null });
  const [solutionPdf, setSolutionPdf] = useState<PdfUploadState>({ file: null, status: 'idle', progress: 0, error: null });
  const questionInputRef = useRef<HTMLInputElement>(null);
  const solutionInputRef = useRef<HTMLInputElement>(null);

  // Populate form from fetched paper
  useEffect(() => {
    if (paper && !formData) {
      setFormData({
        title: paper.title,
        examYear: paper.examYear.toString(),
        examDate: paper.examDate ?? '',
        examSession: paper.examSession ?? '',
        totalMarks: paper.totalMarks?.toString() ?? '',
        durationMin: paper.durationMin?.toString() ?? '',
      });
    }
  }, [paper, formData]);

  const handleFileSelect = useCallback(
    (type: 'question' | 'solution', file: File | null) => {
      if (!file) return;
      if (file.type !== 'application/pdf') {
        const errorState: PdfUploadState = { file: null, status: 'error', progress: 0, error: 'Only PDF files are accepted.' };
        if (type === 'question') setQuestionPdf(errorState);
        else setSolutionPdf(errorState);
        return;
      }
      const state: PdfUploadState = { file, status: 'idle', progress: 0, error: null };
      if (type === 'question') {
        setQuestionPdf(state);
        setErrors((prev) => ({ ...prev, questionPdf: '' }));
      } else {
        setSolutionPdf(state);
        setErrors((prev) => ({ ...prev, solutionPdf: '' }));
      }
    },
    [],
  );

  const handleRemoveFile = useCallback((type: 'question' | 'solution') => {
    if (type === 'question') {
      setQuestionPdf({ file: null, status: 'idle', progress: 0, error: null });
      if (questionInputRef.current) questionInputRef.current.value = '';
    } else {
      setSolutionPdf({ file: null, status: 'idle', progress: 0, error: null });
      if (solutionInputRef.current) solutionInputRef.current.value = '';
    }
  }, []);

  const handleChange = useCallback(
    (field: keyof FormData, value: string) => {
      setFormData((prev) => (prev ? { ...prev, [field]: value } : prev));
      setErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const validate = useCallback((): boolean => {
    if (!formData) return false;
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Paper title is required.';
    } else if (formData.title.trim().length < 3) {
      newErrors.title = 'Paper title must be at least 3 characters.';
    }

    if (!formData.examYear.trim()) {
      newErrors.examYear = 'Exam year is required.';
    } else {
      const year = parseInt(formData.examYear);
      if (isNaN(year) || year < 1990 || year > 2100) {
        newErrors.examYear = 'Year must be between 1990 and 2100.';
      }
    }

    if (formData.totalMarks) {
      const marks = parseInt(formData.totalMarks);
      if (isNaN(marks) || marks <= 0) {
        newErrors.totalMarks = 'Marks must be a positive number.';
      }
    }

    if (formData.durationMin) {
      const duration = parseInt(formData.durationMin);
      if (isNaN(duration) || duration <= 0 || duration > 600) {
        newErrors.durationMin = 'Duration must be between 1 and 600 minutes.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData || !validate()) return;

      // Build update payload
      const payload: Record<string, unknown> = {
        title: formData.title.trim(),
        examYear: parseInt(formData.examYear),
        examDate: formData.examDate || null,
        examSession: formData.examSession || null,
        totalMarks: formData.totalMarks ? parseInt(formData.totalMarks) : null,
        durationMin: formData.durationMin ? parseInt(formData.durationMin) : null,
      };

      // Attach PDF file replacements if selected
      if (questionPdf.file) {
        payload.questionPdfFile = questionPdf.file;
      }
      if (solutionPdf.file) {
        payload.solutionPdfFile = solutionPdf.file;
      }

      updatePaper.mutate(
        { id: paperId, input: payload as any },
        {
          onSuccess: () => {
            setQuestionPdf({ file: null, status: 'idle', progress: 0, error: null });
            setSolutionPdf({ file: null, status: 'idle', progress: 0, error: null });
            setSuccessMessage('Paper saved successfully.');
            setTimeout(() => setSuccessMessage(''), 3000);
          },
          onError: (error) => {
            setErrors({ form: error.message });
          },
        },
      );
    },
    [formData, validate, updatePaper, paperId, questionPdf.file, solutionPdf.file],
  );

  const handlePublishToggle = () => {
    if (!paper) return;
    if (paper.isPublished && paper.publishedAt) {
      unpublishPaper.mutate(paperId, {
        onSuccess: () => setSuccessMessage('Paper unpublished.'),
        onError: (error) => setErrors({ form: error.message }),
      });
    } else {
      publishPaper.mutate(paperId, {
        onSuccess: () => setSuccessMessage('Paper published successfully!'),
        onError: (error) => setErrors({ form: error.message }),
      });
    }
    setConfirmAction(null);
  };

  const handleDelete = () => {
    deletePaper.mutate(
      { paperId, packageId },
      {
        onSuccess: () => {
          router.push(`/teacher/pyq/packages/${packageId}/papers`);
        },
        onError: (error) => {
          setErrors({ form: error.message });
          setConfirmAction(null);
        },
      },
    );
  };

  // ── Inline PDF Upload Section Component ──────────────────────────────

  function PdfUploadSection({
    label,
    state,
    existingPath,
    onFile,
    onRemove,
    inputRef,
    error,
  }: {
    label: string;
    state: PdfUploadState;
    existingPath: string | null;
    onFile: (file: File | null) => void;
    onRemove: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
    error?: string;
  }) {
    const hasExisting = !!existingPath;
    const isReplaceMode = !!state.file;

    // Show existing file info when no replacement is selected
    if (hasExisting && !isReplaceMode) {
      return (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
          <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/10">
            <svg className="h-5 w-5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {existingPath.split('/').pop() || 'PDF'}
              </p>
              <p className="text-xs text-gray-500">Uploaded — ready for download</p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="shrink-0 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              Replace
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }}
            className="hidden"
          />
        </div>
      );
    }

    // Show upload dropzone (no existing file, or user clicked Replace)
    return (
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {label} {!hasExisting && <span className="text-red-500">*</span>}
          {isReplaceMode && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              REPLACING
            </span>
          )}
        </label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
              onFile(e.dataTransfer.files[0]);
            }
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-sm transition-colors ${
            state.file
              ? 'border-emerald-300 bg-emerald-50/30 text-emerald-700 hover:border-emerald-400 dark:border-emerald-700 dark:bg-emerald-950/10 dark:text-emerald-400'
              : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:hover:border-gray-500'
          }`}
          onClick={() => inputRef.current?.click()}
        >
          {state.file ? (
            <div className="text-center">
              <svg className="mx-auto mb-2 h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium text-gray-900 dark:text-gray-100">{state.file.name}</p>
              <p className="mt-1 text-xs text-gray-400">{(state.file.size / 1024 / 1024).toFixed(2)} MB</p>
              {state.status === 'uploading' && (
                <div className="mt-2 w-full max-w-[200px] mx-auto">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-full rounded-full bg-blue-600 transition-all duration-300" style={{ width: `${state.progress}%` }} />
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="mt-2 text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              <svg className="mb-2 h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
              </svg>
              <span className="font-medium">
                {hasExisting ? 'Click or drag to replace' : 'Click or drag to upload'}
              </span>
              <span className="mt-1 text-xs text-gray-400">PDF only, max 100 MB</span>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }}
          className="hidden"
        />
        {(error || state.error) && (
          <p className="mt-1 text-xs text-red-500">{error || state.error}</p>
        )}
      </div>
    );
  }

  // ── Loading State ─────────────────────────────────────────────────────

  const isLoading = pkgLoading || paperLoading;
  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // ── Error State ───────────────────────────────────────────────────────

  if (paperError || !paper || !pkg) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          title="Paper Not Found"
          description="The requested PYQ paper could not be found."
          breadcrumbs={[
            { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
            { label: 'Papers', href: `/teacher/pyq/packages/${packageId}/papers` },
            { label: 'Edit Paper' },
          ]}
        />
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/20">
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Paper &ldquo;{paperId}&rdquo; does not exist or has been deleted.
          </p>
          <Link
            href={`/teacher/pyq/packages/${packageId}/papers`}
            className="mt-3 inline-block rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700"
          >
            Back to Papers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={paper.title}
        description="Edit PYQ paper details and configuration"
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
          { label: pkg.name, href: `/teacher/pyq/packages/${packageId}/edit` },
          { label: 'Papers', href: `/teacher/pyq/packages/${packageId}/papers` },
          { label: paper.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/pyq/packages/${packageId}/papers/${paperId}/questions`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-gray-900 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Manage Questions ({paper.totalQuestions})
            </Link>
            <StatusBadge
              status={paper.isPublished && paper.publishedAt ? 'published' : 'draft'}
            />
          </div>
        }
      />

      {/* Success banner */}
      {successMessage && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        {/* Basic Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Basic Information</h2>
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData?.title ?? ''}
                onChange={(e) => handleChange('title', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
            </div>

            {/* Exam Year + Date + Session */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Exam Year <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formData?.examYear ?? ''}
                  onChange={(e) => handleChange('examYear', e.target.value)}
                  min={1990}
                  max={2100}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
                {errors.examYear && <p className="mt-1 text-xs text-red-500">{errors.examYear}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Exam Date</label>
                <input
                  type="date"
                  value={formData?.examDate ?? ''}
                  onChange={(e) => handleChange('examDate', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Exam Session</label>
                <input
                  type="text"
                  value={formData?.examSession ?? ''}
                  onChange={(e) => handleChange('examSession', e.target.value)}
                  placeholder="e.g. January Session 1"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Scoring & Timing */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Scoring & Timing</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Total Marks</label>
              <input
                type="number"
                value={formData?.totalMarks ?? ''}
                onChange={(e) => handleChange('totalMarks', e.target.value)}
                min={1}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.totalMarks && <p className="mt-1 text-xs text-red-500">{errors.totalMarks}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Duration (minutes)</label>
              <input
                type="number"
                value={formData?.durationMin ?? ''}
                onChange={(e) => handleChange('durationMin', e.target.value)}
                min={1}
                max={600}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.durationMin && <p className="mt-1 text-xs text-red-500">{errors.durationMin}</p>}
            </div>
          </div>
        </section>

        {/* Mock Test Status Card */}
        {!mockLoading && (
          <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Mock Test</h2>
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                {mockData ? (
                  <>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{mockData.mockTest.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {mockData.mockTest.totalMarks} marks · {mockData.mockTest.durationMin} min · Status: {mockData.mockTest.status}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-500">Not generated</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Assign questions and generate from the Manage Questions page.
                    </p>
                  </>
                )}
              </div>
              <Link
                href={`/teacher/pyq/packages/${packageId}/papers/${paperId}/questions`}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                {mockData ? 'Manage Mock' : 'Set Up Mock'}
              </Link>
            </div>
          </section>
        )}

        {/* PDF Files */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">PDF Files</h2>
          <p className="mb-4 text-xs text-gray-500">
            Upload the question paper PDF and solution PDF. Both are required.
            To replace an existing PDF, select a new file — the system will
            automatically update the storage path on save.
          </p>
          <div className="space-y-6">
            <PdfUploadSection
              label="Question Paper PDF"
              state={questionPdf}
              existingPath={paper.pdfStoragePath}
              onFile={(f) => handleFileSelect('question', f)}
              onRemove={() => handleRemoveFile('question')}
              inputRef={questionInputRef}
              error={errors.questionPdf}
            />
            <PdfUploadSection
              label="Solution PDF"
              state={solutionPdf}
              existingPath={paper.solutionPdfStoragePath}
              onFile={(f) => handleFileSelect('solution', f)}
              onRemove={() => handleRemoveFile('solution')}
              inputRef={solutionInputRef}
              error={errors.solutionPdf}
            />
          </div>
        </section>

        {/* Form error */}
        {errors.form && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errors.form}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-gray-200 pt-6">
          <div className="flex items-center gap-2">
            {paper.isPublished && paper.publishedAt ? (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'unpublish' })}
                disabled={unpublishPaper.isPending}
                className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {unpublishPaper.isPending ? 'Unpublishing...' : 'Unpublish'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'publish' })}
                disabled={publishPaper.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {publishPaper.isPending ? 'Publishing...' : 'Publish'}
              </button>
            )}
            {paper.totalQuestions === 0 && (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'delete' })}
                disabled={deletePaper.isPending}
                className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {deletePaper.isPending ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/teacher/pyq/packages/${packageId}/papers`}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={updatePaper.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updatePaper.isPending ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmAction?.type === 'publish'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handlePublishToggle}
        title="Publish Paper"
        message="This paper will become visible to students who have purchased the package. Continue?"
        confirmLabel="Publish"
        variant="default"
      />

      <ConfirmDialog
        open={confirmAction?.type === 'unpublish'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handlePublishToggle}
        title="Unpublish Paper"
        message="The paper will be hidden from students. Continue?"
        confirmLabel="Unpublish"
        variant="warning"
      />

      <ConfirmDialog
        open={confirmAction?.type === 'delete'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleDelete}
        title="Delete Paper"
        message="Are you sure you want to permanently delete this paper? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
