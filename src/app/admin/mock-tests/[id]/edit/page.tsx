'use client';

import { useState, useCallback, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useMockTest,
  useUpdateMockTest,
  useDeleteMockTest,
  usePublishMockTest,
  useArchiveMockTest,
  useRestoreMockTest,
} from '@/hooks/mockTest/useMockTests';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { toLocalDatetime, toUtcIsoString } from '@/utils/dateTime';
import { Lock, ArrowLeft, FloppyDisk, Sparkle, Archive, ArrowsCounterClockwise, Trash } from '@phosphor-icons/react';

const TEST_TYPES = [
  { value: 'practice', label: 'Practice' },
  { value: 'mock', label: 'Mock Test' },
  { value: 'chapter_test', label: 'Chapter Test' },
  { value: 'pyq_paper', label: 'PYQ Paper' },
];

const RESULT_RELEASE_MODES = [
  { value: 'immediate', label: 'Immediate — after submission' },
  { value: 'scheduled', label: 'Scheduled — at a set time' },
  { value: 'manual', label: 'Manual — admin releases results' },
];

interface FormData {
  title: string;
  description: string;
  testType: string;
  durationMin: number;
  passingMarks: number | null;
  attemptLimit: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  calculatorAllowed: boolean;
  resultReleaseMode: string;
  resultReleaseAt: string;
  availableFrom: string;
  availableUntil: string;
}

export default function AdminEditMockTestPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: testId } = use(params);
  const { canRestoreDeletedData } = usePermissions();

  const { data: test, isLoading, isError } = useMockTest(testId);
  const updateMockTest = useUpdateMockTest();
  const deleteMockTest = useDeleteMockTest();
  const publishTest = usePublishMockTest();
  const archiveTest = useArchiveMockTest();
  const restoreTest = useRestoreMockTest();

  const [formData, setFormData] = useState<FormData | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Populate form when test data loads
  useEffect(() => {
    if (test && !formData) {
      setFormData({
        title: test.title,
        description: test.description ?? '',
        testType: test.testType,
        durationMin: test.durationMin,
        passingMarks: test.passingMarks ?? null,
        attemptLimit: test.attemptLimit,
        shuffleQuestions: test.shuffleQuestions,
        shuffleOptions: test.shuffleOptions,
        calculatorAllowed: test.calculatorAllowed,
        resultReleaseMode: test.resultReleaseMode,
        resultReleaseAt: toLocalDatetime(test.resultReleaseAt),
        availableFrom: toLocalDatetime(test.availableFrom),
        availableUntil: toLocalDatetime(test.availableUntil),
      });
    }
  }, [test, formData]);

  const handleChange = useCallback(
    (field: keyof FormData, value: string | number | boolean | null) => {
      setFormData((prev) => (prev ? { ...prev, [field]: value } : prev));
      setErrors((prev) => ({ ...prev, [field]: '' }));
      setSuccessBanner(null);
    },
    [],
  );

  const validate = useCallback((): boolean => {
    if (!formData) return false;
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) newErrors.title = 'Title is required.';
    else if (formData.title.trim().length < 3) newErrors.title = 'Title must be at least 3 characters.';
    if (formData.durationMin <= 0) newErrors.durationMin = 'Duration must be greater than 0.';
    if (formData.durationMin > 600) newErrors.durationMin = 'Duration cannot exceed 600 minutes.';

    if (formData.attemptLimit !== null && formData.attemptLimit < 1) {
      newErrors.attemptLimit = 'Attempt limit must be at least 1.';
    }
    if (formData.resultReleaseMode === 'scheduled' && !formData.resultReleaseAt) {
      newErrors.resultReleaseAt = 'Release date is required for scheduled release.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData || !validate()) return;

      updateMockTest.mutate(
        {
          id: testId,
          input: {
            title: formData.title.trim(),
            description: formData.description || null,
            durationMin: formData.durationMin,
            passingMarks: formData.passingMarks,
            attemptLimit: formData.attemptLimit,
            shuffleQuestions: formData.shuffleQuestions,
            shuffleOptions: formData.shuffleOptions,
            calculatorAllowed: formData.calculatorAllowed,
            resultReleaseMode: formData.resultReleaseMode,
            resultReleaseAt:
              formData.resultReleaseMode === 'scheduled'
                ? toUtcIsoString(formData.resultReleaseAt)
                : null,
            availableFrom: toUtcIsoString(formData.availableFrom),
            availableUntil: toUtcIsoString(formData.availableUntil),
          },
        },
        {
          onSuccess: () => {
            setSuccessBanner('Mock test settings saved successfully.');
          },
          onError: (error) => setErrors({ form: error.message }),
        },
      );
    },
    [formData, validate, updateMockTest, testId],
  );

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return;
    switch (confirmAction) {
      case 'submit':
        updateMockTest.mutate({ id: testId, input: { status: 'pending_approval' } });
        break;
      case 'publish':
        publishTest.mutate(testId);
        break;
      case 'archive':
        archiveTest.mutate(testId);
        break;
      case 'restore':
        restoreTest.mutate(testId);
        break;
      case 'delete':
        deleteMockTest.mutate(testId, { onSuccess: () => router.push('/admin/mock-tests') });
        break;
    }
    setConfirmAction(null);
  }, [confirmAction, testId, updateMockTest, publishTest, archiveTest, restoreTest, deleteMockTest, router]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Loading..." description="Loading test details..." />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !test) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Mock test not found.</p>
        <Link href="/admin/mock-tests" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          Back to Mock Tests
        </Link>
      </div>
    );
  }

  if (!formData) return null;

  const isPublished = test.status === 'published';

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`Edit — ${test.title}`}
        description="Configure mock test settings, timers, scoring, and release schedules"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Mock Tests', href: '/admin/mock-tests' },
          { label: test.title, href: `/admin/mock-tests/${testId}` },
          { label: 'Edit' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/mock-tests/${testId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowLeft size={14} />
              View Details
            </Link>
            <StatusBadge status={test.status} />
          </div>
        }
      />

      {/* Published Notice */}
      {isPublished && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            <Lock size={22} weight="fill" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Published Mock Test — Questions Locked
            </h4>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              This test is published and active. You may update operational settings (timing, pass threshold, release schedule), but questions and options are frozen to protect attempt integrity.
            </p>
          </div>
          <Link
            href={`/admin/mock-tests/${testId}/questions`}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-gray-900 dark:text-amber-300"
          >
            View Questions
          </Link>
        </div>
      )}

      {/* Status Management Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <span className="text-xs font-medium text-gray-500">Status:</span>
        <StatusBadge status={test.status} />
        <span className="mx-2 text-gray-300 dark:text-gray-700">|</span>

        {test.status === 'draft' && (
          <>
            <button
              type="button"
              onClick={() => setConfirmAction('publish')}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Sparkle size={13} weight="fill" />
              Publish Directly
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction('archive')}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <Archive size={13} />
              Archive
            </button>
          </>
        )}

        {test.status === 'pending_approval' && (
          <>
            <button
              type="button"
              onClick={() => setConfirmAction('publish')}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Sparkle size={13} weight="fill" />
              Approve & Publish
            </button>
            <button
              type="button"
              onClick={() => updateMockTest.mutate({ id: testId, input: { status: 'draft' } })}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <ArrowsCounterClockwise size={13} />
              Revert to Draft
            </button>
          </>
        )}

        {test.status === 'published' && (
          <button
            type="button"
            onClick={() => setConfirmAction('archive')}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <Archive size={13} />
            Archive Test
          </button>
        )}

        {test.status === 'archived' && (
          <button
            type="button"
            onClick={() => setConfirmAction('restore')}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-400"
          >
            <ArrowsCounterClockwise size={13} />
            Restore to Draft
          </button>
        )}
      </div>

      {successBanner && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {successBanner}
        </div>
      )}

      {errors.form && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {errors.form}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Basic Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Basic Information</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                placeholder="e.g., JEE Advanced Full Syllabus Mock 1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                placeholder="Brief guidelines or syllabus covered by this test..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">Test Type</label>
                <select
                  value={formData.testType}
                  onChange={(e) => handleChange('testType', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {TEST_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Academic Scope
                </label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  Stream: <span className="font-medium text-gray-900 dark:text-gray-100">{(test as any).streamName ?? test.streamId}</span>
                  {(test as any).subjectName && (
                    <> · Subject: <span className="font-medium text-gray-900 dark:text-gray-100">{(test as any).subjectName}</span></>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Timing & Cutoff */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Timing & Scoring</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Duration (minutes) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={formData.durationMin}
                onChange={(e) => handleChange('durationMin', Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={600}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              {errors.durationMin && <p className="mt-1 text-xs text-red-500">{errors.durationMin}</p>}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">Passing Marks</label>
              <input
                type="number"
                value={formData.passingMarks ?? ''}
                onChange={(e) =>
                  handleChange('passingMarks', e.target.value === '' ? null : Math.max(0, parseInt(e.target.value) || 0))
                }
                min={0}
                placeholder="No cutoff"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <p className="mt-1 text-[11px] text-gray-500">Leave blank if no minimum passing cutoff applies.</p>
              {errors.passingMarks && <p className="mt-1 text-xs text-red-500">{errors.passingMarks}</p>}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">Attempt Limit</label>
              <input
                type="number"
                value={formData.attemptLimit ?? ''}
                onChange={(e) => handleChange('attemptLimit', e.target.value ? parseInt(e.target.value) : null)}
                min={1}
                placeholder="Unlimited"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <p className="mt-1 text-[11px] text-gray-500">Leave empty for unlimited attempts.</p>
              {errors.attemptLimit && <p className="mt-1 text-xs text-red-500">{errors.attemptLimit}</p>}
            </div>
          </div>
        </section>

        {/* Security & Experience Settings */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Test Engine Settings</h2>
          <div className="space-y-3">
            {[
              ['shuffleQuestions', 'Shuffle Questions', 'Present questions in random order per student'],
              ['shuffleOptions', 'Shuffle Options', 'Randomize option order for MCQ/MSQ questions'],
              ['calculatorAllowed', 'Calculator Allowed', 'Show on-screen scientific calculator'],
            ].map(([field, label, desc]) => (
              <label key={field} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(formData[field as keyof FormData])}
                  onChange={(e) => handleChange(field as keyof FormData, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-xs font-medium text-gray-900 dark:text-gray-100">{label}</p>
                  <p className="text-[11px] text-gray-500">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Result Release */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Result Release Policy</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Result Release Mode
              </label>
              <select
                value={formData.resultReleaseMode}
                onChange={(e) => handleChange('resultReleaseMode', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {RESULT_RELEASE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Tests containing subjective questions always require evaluation completion prior to result release.
              </p>
            </div>

            {formData.resultReleaseMode === 'scheduled' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Scheduled Release Date & Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={formData.resultReleaseAt}
                  onChange={(e) => handleChange('resultReleaseAt', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
                {errors.resultReleaseAt && <p className="mt-1 text-xs text-red-500">{errors.resultReleaseAt}</p>}
              </div>
            )}
          </div>
        </section>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-6 dark:border-gray-700">
          <button
            type="submit"
            disabled={updateMockTest.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FloppyDisk size={16} />
            {updateMockTest.isPending ? 'Saving...' : 'Save Changes'}
          </button>

          <Link
            href={`/admin/mock-tests/${testId}/questions`}
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-700"
          >
            {isPublished ? 'View Questions (Locked)' : 'Manage Questions'}
          </Link>

          {test.status === 'archived' && canRestoreDeletedData && (
            <button
              type="button"
              onClick={() => setConfirmAction('delete')}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:bg-gray-800 dark:ring-red-800"
            >
              <Trash size={15} />
              Move to Recycle Bin
            </button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction === 'publish'
            ? 'Publish Mock Test'
            : confirmAction === 'archive'
            ? 'Archive Mock Test'
            : confirmAction === 'delete'
            ? 'Delete Mock Test'
            : 'Restore Mock Test'
        }
        message={
          confirmAction === 'publish'
            ? 'Publishing will lock questions and make the test available for student batch assignment. Continue?'
            : confirmAction === 'archive'
            ? 'Archived tests are hidden from active rosters but attempt history is preserved.'
            : confirmAction === 'delete'
            ? 'This mock test will be moved to the Recycle Bin.'
            : 'Restore this test to draft status for editing.'
        }
        confirmLabel={
          confirmAction === 'publish'
            ? 'Publish Test'
            : confirmAction === 'archive'
            ? 'Archive'
            : confirmAction === 'delete'
            ? 'Move to Recycle Bin'
            : 'Restore to Draft'
        }
        variant={confirmAction === 'delete' || confirmAction === 'archive' ? 'danger' : 'default'}
      />
    </div>
  );
}
