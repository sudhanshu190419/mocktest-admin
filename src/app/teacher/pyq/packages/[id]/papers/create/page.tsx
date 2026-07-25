'use client';

import { useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePyqPackage } from '@/hooks/pyq/usePyqPackages';
import { useCreatePyqPaper } from '@/hooks/pyq/usePyqPapers';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useAuth } from '@/context/AuthContext';

interface FormData {
  title: string;
  examYear: string;
  examDate: string;
  examSession: string;
  durationMin: string;
}

const emptyForm: FormData = {
  title: '',
  examYear: '',
  examDate: '',
  examSession: '',
  durationMin: '',
};

interface PdfUploadState {
  file: File | null;
  status: 'idle' | 'uploading' | 'done' | 'error';
  progress: number;
  error: string | null;
}

export default function CreatePyqPaperPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: packageId } = use(params);
  const { instituteId, teacherProfile } = useAuth();

  const { data: pkg, isLoading: pkgLoading } = usePyqPackage(packageId);
  const createPaper = useCreatePyqPaper();

  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // PDF upload state — stored as File objects, uploaded during save
  const [questionPdf, setQuestionPdf] = useState<PdfUploadState>({ file: null, status: 'idle', progress: 0, error: null });
  const [solutionPdf, setSolutionPdf] = useState<PdfUploadState>({ file: null, status: 'idle', progress: 0, error: null });

  const questionInputRef = useRef<HTMLInputElement>(null);
  const solutionInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (type: 'question' | 'solution', file: File | null) => {
      if (!file) return;
      if (file.type !== 'application/pdf') {
        if (type === 'question') {
          setQuestionPdf((prev) => ({ ...prev, file: null, status: 'error', error: 'Only PDF files are accepted.' }));
        } else {
          setSolutionPdf((prev) => ({ ...prev, file: null, status: 'error', error: 'Only PDF files are accepted.' }));
        }
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
      setFormData((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const validate = useCallback((): boolean => {
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

    if (formData.durationMin) {
      const duration = parseInt(formData.durationMin);
      if (isNaN(duration) || duration <= 0 || duration > 600) {
        newErrors.durationMin = 'Duration must be between 1 and 600 minutes.';
      }
    }

    if (!questionPdf.file) {
      newErrors.questionPdf = 'Question paper PDF is required.';
    }

    if (!solutionPdf.file) {
      newErrors.solutionPdf = 'Solution PDF is required.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, questionPdf.file, solutionPdf.file]);

  // Both PDFs must be selected before save can proceed
  const canSave = !createPaper.isPending && questionPdf.file && solutionPdf.file;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      // Mark both as uploading
      setQuestionPdf((prev) => ({ ...prev, status: 'uploading', progress: 0 }));
      setSolutionPdf((prev) => ({ ...prev, status: 'uploading', progress: 0 }));

      createPaper.mutate(
        {
          packageId,
          title: formData.title.trim(),
          examYear: parseInt(formData.examYear),
          examDate: formData.examDate || null,
          examSession: formData.examSession || null,
          totalMarks: null,
          durationMin: formData.durationMin ? parseInt(formData.durationMin) : null,
          questionPdfFile: questionPdf.file!,
          solutionPdfFile: solutionPdf.file!,
          onProgress: (_loaded, _total) => {
            // Progress callback - updates happen at upload completion
          },
        },
        {
          onSuccess: () => {
            setQuestionPdf((prev) => ({ ...prev, status: 'done', progress: 100 }));
            setSolutionPdf((prev) => ({ ...prev, status: 'done', progress: 100 }));
            router.push(`/teacher/pyq/packages/${packageId}/papers`);
          },
          onError: (error) => {
            setQuestionPdf((prev) => ({ ...prev, status: 'error', error: error.message }));
            setSolutionPdf((prev) => ({ ...prev, status: 'error', error: error.message }));
            setErrors({ form: error.message });
          },
        },
      );
    },
    [formData, questionPdf.file, solutionPdf.file, validate, createPaper, packageId, router],
  );

  function PdfUploadSection({
    label,
    state,
    onFile,
    onRemove,
    inputRef,
    error,
  }: {
    label: string;
    state: PdfUploadState;
    onFile: (file: File | null) => void;
    onRemove: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
    error?: string;
  }) {
    return (
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {label} <span className="text-red-500">*</span>
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
              <span className="font-medium">Click or drag to upload</span>
              <span className="mt-1 text-xs text-gray-400">PDF only, max 100 MB</span>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            if (e.target.files?.[0]) onFile(e.target.files[0]);
          }}
          className="hidden"
        />
        {(error || state.error) && (
          <p className="mt-1 text-xs text-red-500">{error || state.error}</p>
        )}
      </div>
    );
  }

  // Loading state
  if (pkgLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-sm text-rose-600">Package not found.</p>
        <Link href="/teacher/pyq/packages" className="mt-2 inline-block text-xs text-blue-600 hover:underline">
          Back to Packages
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create Paper"
        description={`Add a new exam paper to "${pkg.name}"`}
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
          { label: pkg.name, href: `/teacher/pyq/packages/${packageId}/edit` },
          { label: 'Papers', href: `/teacher/pyq/packages/${packageId}/papers` },
          { label: 'Create Paper' },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-8">
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
                value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                placeholder="e.g. NEET 2023 Official Paper"
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
                  value={formData.examYear}
                  onChange={(e) => handleChange('examYear', e.target.value)}
                  min={1990}
                  max={2100}
                  placeholder="e.g. 2024"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
                {errors.examYear && <p className="mt-1 text-xs text-red-500">{errors.examYear}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Exam Date</label>
                <input
                  type="date"
                  value={formData.examDate}
                  onChange={(e) => handleChange('examDate', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Exam Session</label>
                <input
                  type="text"
                  value={formData.examSession}
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
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Duration (minutes)</label>
              <input
                type="number"
                value={formData.durationMin}
                onChange={(e) => handleChange('durationMin', e.target.value)}
                min={1}
                max={600}
                placeholder="e.g. 180"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.durationMin && <p className="mt-1 text-xs text-red-500">{errors.durationMin}</p>}
            </div>
          </div>
        </section>

        {/* PDF Uploads */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">PDF Files</h2>
          <p className="mb-4 text-xs text-gray-500">
            Upload the question paper PDF and solution PDF. Both are required.
            Files are uploaded automatically when you save the paper.
          </p>
          <div className="space-y-6">
            <PdfUploadSection
              label="Question Paper PDF"
              state={questionPdf}
              onFile={(f) => handleFileSelect('question', f)}
              onRemove={() => handleRemoveFile('question')}
              inputRef={questionInputRef}
              error={errors.questionPdf}
            />
            <PdfUploadSection
              label="Solution PDF"
              state={solutionPdf}
              onFile={(f) => handleFileSelect('solution', f)}
              onRemove={() => handleRemoveFile('solution')}
              inputRef={solutionInputRef}
              error={errors.solutionPdf}
            />
          </div>
        </section>

        {/* Info banner */}
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-400">
          <strong>Note:</strong> New papers are created as <strong>unpublished</strong> (hidden from students).
          You can publish the paper after configuring questions.
        </div>

        {/* Form error */}
        {errors.form && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errors.form}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 border-t border-gray-200 pt-6">
          <button
            type="submit"
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createPaper.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : (
              'Create Paper'
            )}
          </button>
          <Link
            href={`/teacher/pyq/packages/${packageId}/papers`}
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
