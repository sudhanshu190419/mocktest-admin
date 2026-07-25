'use client';

import { useState, useCallback, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMockTest, useUpdateMockTest, useDeleteMockTest, usePublishMockTest, useArchiveMockTest, useRestoreMockTest } from '@/hooks/mockTest/useMockTests';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useChapters } from '@/hooks/academic/useChapters';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

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
  attemptLimit: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  calculatorAllowed: boolean;
  resultReleaseMode: string;
  resultReleaseAt: string;
  availableFrom: string;
  availableUntil: string;
}

function toLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

export default function EditMockTestPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: testId } = use(params);

  const { data: test, isLoading, isError } = useMockTest(testId);
  const updateMockTest = useUpdateMockTest();
  const deleteMockTest = useDeleteMockTest();
  const publishTest = usePublishMockTest();
  const archiveTest = useArchiveMockTest();
  const restoreTest = useRestoreMockTest();

  const [formData, setFormData] = useState<FormData | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  // Populate form when test data loads
  useEffect(() => {
    if (test && !formData) {
      setFormData({
        title: test.title,
        description: test.description ?? '',
        testType: test.testType,
        durationMin: test.durationMin,
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

  const { data: subjectsData } = useSubjects(
    test?.streamId ? { streamId: test.streamId } : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page: 1, pageSize: 200 },
  );
  const subjects = subjectsData?.data ?? [];

  const handleChange = useCallback(
    (field: keyof FormData, value: string | number | boolean | null) => {
      setFormData((prev) => prev ? { ...prev, [field]: value } : prev);
      setErrors((prev) => ({ ...prev, [field]: '' }));
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
    if (formData.availableFrom && formData.availableUntil) {
      if (new Date(formData.availableFrom) >= new Date(formData.availableUntil)) {
        newErrors.availableUntil = 'End date must be after start date.';
      }
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
            attemptLimit: formData.attemptLimit,
            shuffleQuestions: formData.shuffleQuestions,
            shuffleOptions: formData.shuffleOptions,
            calculatorAllowed: formData.calculatorAllowed,
            resultReleaseMode: formData.resultReleaseMode,
            resultReleaseAt: formData.resultReleaseMode === 'scheduled' ? formData.resultReleaseAt || null : null,
            availableFrom: formData.availableFrom || null,
            availableUntil: formData.availableUntil || null,
          },
        },
        { onError: (error) => setErrors({ form: error.message }) },
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
    }
    setConfirmAction(null);
  }, [confirmAction, testId, updateMockTest, publishTest, archiveTest, restoreTest]);

  if (isLoading) {
    return (
      <div>
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
        <Link href="/teacher/mock-tests" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          Back to Mock Tests
        </Link>
      </div>
    );
  }

  if (!formData) return null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={test.title}
        description="Edit test settings"
        breadcrumbs={[
          { label: 'Mock Tests', href: '/teacher/mock-tests' },
          { label: test.title, href: `/teacher/mock-tests/${testId}/edit` },
        ]}
        actions={<StatusBadge status={test.status} />}
      />

      {/* Status management bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <span className="text-sm text-gray-500">Status:</span>
        <StatusBadge status={test.status} />
        <span className="mx-2 text-gray-300">|</span>
        {test.status === 'draft' && (
          <>
            <button type="button" onClick={() => setConfirmAction('submit')}
              className="rounded px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50">Submit for Approval</button>
            <button type="button" onClick={() => setConfirmAction('archive')}
              className="rounded px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">Archive</button>
          </>
        )}
        {test.status === 'pending_approval' && (
          <>
            <button type="button" onClick={() => setConfirmAction('publish')}
              className="rounded px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">Publish</button>
            <button type="button" onClick={() => updateMockTest.mutate({ id: testId, input: { status: 'draft' } })}
              className="rounded px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">Revert to Draft</button>
          </>
        )}
        {test.status === 'published' && (
          <>
            <Link href={`/teacher/mock-tests/${testId}/preview`}
              className="rounded px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">Preview</Link>
            <button type="button" onClick={() => setConfirmAction('archive')}
              className="rounded px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50">Archive</button>
          </>
        )}
        {test.status === 'archived' && (
          <button type="button" onClick={() => setConfirmAction('restore')}
            className="rounded px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">Restore to Draft</button>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Basic Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Basic Information</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Title *</label>
              <input type="text" value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800" />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
              <textarea value={formData.description} onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Test Type</label>
                <select value={formData.testType} onChange={(e) => handleChange('testType', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800">
                  {TEST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Subject</label>
                <p className="text-sm text-gray-500">{test.subjectId ? subjects.find(s => s.subjectId === test.subjectId)?.name ?? test.subjectId : 'All Subjects'}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Timing & Scoring */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Timing & Scoring</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Duration (minutes) *</label>
              <input type="number" value={formData.durationMin}
                onChange={(e) => handleChange('durationMin', Math.max(1, parseInt(e.target.value) || 1))} min={1} max={600}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800" />
              {errors.durationMin && <p className="mt-1 text-xs text-red-500">{errors.durationMin}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Attempt Limit</label>
              <input type="number" value={formData.attemptLimit ?? ''}
                onChange={(e) => handleChange('attemptLimit', e.target.value ? parseInt(e.target.value) : null)} min={1}
                placeholder="Unlimited"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800" />
              {errors.attemptLimit && <p className="mt-1 text-xs text-red-500">{errors.attemptLimit}</p>}
            </div>
          </div>
        </section>

        {/* Settings */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Test Settings</h2>
          <div className="space-y-3">
            {([
              ['shuffleQuestions', 'Shuffle Questions', 'Present questions in random order per student'],
              ['shuffleOptions', 'Shuffle Options', 'Randomize option order for MCQ/MSQ questions'],
              ['calculatorAllowed', 'Calculator Allowed', 'Show on-screen scientific calculator'],
            ] as const).map(([field, label, desc]) => (
              <label key={field} className="flex items-center gap-3">
                <input type="checkbox" checked={formData[field as keyof FormData] as boolean}
                  onChange={(e) => handleChange(field as keyof FormData, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <div>
                  <p className="text-sm font-medium text-gray-700">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Availability */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Availability & Results</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Result Release Mode</label>
              <select value={formData.resultReleaseMode} onChange={(e) => handleChange('resultReleaseMode', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800">
                {RESULT_RELEASE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {formData.resultReleaseMode === 'scheduled' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Release Date & Time</label>
                <input type="datetime-local" value={formData.resultReleaseAt}
                  onChange={(e) => handleChange('resultReleaseAt', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800" />
                {errors.resultReleaseAt && <p className="mt-1 text-xs text-red-500">{errors.resultReleaseAt}</p>}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Available From</label>
                <input type="datetime-local" value={formData.availableFrom}
                  onChange={(e) => handleChange('availableFrom', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Available Until</label>
                <input type="datetime-local" value={formData.availableUntil}
                  onChange={(e) => handleChange('availableUntil', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800" />
                {errors.availableUntil && <p className="mt-1 text-xs text-red-500">{errors.availableUntil}</p>}
              </div>
            </div>
          </div>
        </section>

        {errors.form && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errors.form}</div>
        )}

        <div className="flex items-center gap-3 border-t border-gray-200 pt-6">
          <button type="submit" disabled={updateMockTest.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {updateMockTest.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          <Link href={test.status === 'draft' ? `/teacher/mock-tests/${testId}/questions` : `/teacher/mock-tests/${testId}/preview`}
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
            {test.status === 'draft' ? 'Manage Questions' : 'Preview'}
          </Link>
          {test.status === 'archived' && (
            <button type="button" onClick={() => deleteMockTest.mutate(testId, { onSuccess: () => router.push('/teacher/mock-tests') })}
              className="ml-auto rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-300 hover:bg-red-50">
              Delete Permanently
            </button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction === 'submit' ? 'Submit for Approval' :
          confirmAction === 'publish' ? 'Publish Test' :
          confirmAction === 'archive' ? 'Archive Test' : 'Restore Test'
        }
        message={
          confirmAction === 'submit' ? 'Submit this test for admin approval. Students will not see it until approved and published.' :
          confirmAction === 'publish' ? 'Publishing makes this test available to students. Questions will be frozen.' :
          confirmAction === 'archive' ? 'Archived tests are hidden from students. Data is preserved.' :
          'Restore this test to draft status for editing.'
        }
        confirmLabel={
          confirmAction === 'submit' ? 'Submit' :
          confirmAction === 'publish' ? 'Publish' :
          confirmAction === 'archive' ? 'Archive' : 'Restore'
        }
        variant={confirmAction === 'archive' ? 'warning' : confirmAction === 'delete' ? 'danger' : 'default'}
      />
    </div>
  );
}
