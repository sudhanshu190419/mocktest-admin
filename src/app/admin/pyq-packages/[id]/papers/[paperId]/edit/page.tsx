'use client';

import { useAuth } from '@/context/AuthContext';
import { useState, useCallback, useEffect, use } from 'react';
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
  durationMin: string;
}

const emptyForm: FormData = {
  title: '',
  examYear: '',
  examDate: '',
  examSession: '',
  durationMin: '',
};

export default function EditPyqPaperPage({
  params,
}: {
  params: Promise<{ id: string; paperId: string }>;
}) {
  const { user } = useAuth();
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

  // Populate form from fetched paper
  useEffect(() => {
    if (paper && !formData) {
      setFormData({
        title: paper.title,
        examYear: paper.examYear.toString(),
        examDate: paper.examDate ?? '',
        examSession: paper.examSession ?? '',
        durationMin: paper.durationMin?.toString() ?? '',
      });
    }
  }, [paper, formData]);

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
        totalMarks: null,
        durationMin: formData.durationMin ? parseInt(formData.durationMin) : null,
      };

      updatePaper.mutate(
        { id: paperId, input: payload as any },
        {
          onSuccess: () => {
            setSuccessMessage('Paper saved successfully.');
            setTimeout(() => setSuccessMessage(''), 3000);
          },
          onError: (error) => {
            setErrors({ form: error.message });
          },
        },
      );
    },
    [formData, validate, updatePaper, paperId],
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
          router.push(`/admin/pyq-packages/${packageId}/papers`);
        },
        onError: (error) => {
          setErrors({ form: error.message });
          setConfirmAction(null);
        },
      },
    );
  };

  // ── Access Check ──────────────────────────────────────────────────────

  if (user?.role === 'teacher') {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/20">
        <h2 className="text-base font-semibold text-rose-700 dark:text-rose-400">Access Denied</h2>
        <p className="mt-1 text-sm text-rose-600 dark:text-rose-300">Teachers do not have permission to manage PYQ packages or papers.</p>
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
            { label: 'PYQ Packages', href: '/admin/pyq-packages' },
            { label: 'Papers', href: `/admin/pyq-packages/${packageId}/papers` },
            { label: 'Edit Paper' },
          ]}
        />
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/20">
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Paper &ldquo;{paperId}&rdquo; does not exist or has been deleted.
          </p>
          <Link
            href={`/admin/pyq-packages/${packageId}/papers`}
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
          { label: 'PYQ Packages', href: '/admin/pyq-packages' },
          { label: pkg.name, href: `/admin/pyq-packages/${packageId}/papers` },
          { label: 'Papers', href: `/admin/pyq-packages/${packageId}/papers` },
          { label: paper.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/pyq-packages/${packageId}/papers/${paperId}/questions`}
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
                href={`/admin/pyq-packages/${packageId}/papers/${paperId}/questions`}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                {mockData ? 'Manage Mock' : 'Set Up Mock'}
              </Link>
            </div>
          </section>
        )}

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
              href={`/admin/pyq-packages/${packageId}/papers`}
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
        message="This paper will be moved to the Recycle Bin and can be restored later. Only papers with no mapped questions can be deleted."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
