'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCreateMockTest } from '@/hooks/mockTest/useMockTests';
import { useStreams } from '@/hooks/academic/useStreams';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useAuth } from '@/context/AuthContext';
import { AddSubjectModal } from '@/features/question-bank/components/AddSubjectModal';
import { AddStreamModal } from '@/features/question-bank/components/AddStreamModal';
import { PageHeader } from '@/components/ui/PageHeader';
import type { Subject, Stream } from '@/types/academic';

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
  subjectId: string;
  streamId: string;
}

const emptyForm: FormData = {
  title: '',
  description: '',
  testType: 'practice',
  durationMin: 60,
  attemptLimit: null,
  shuffleQuestions: false,
  shuffleOptions: false,
  calculatorAllowed: false,
  resultReleaseMode: 'immediate',
  resultReleaseAt: '',
  availableFrom: '',
  availableUntil: '',
  subjectId: '',
  streamId: '',
};

export default function CreateMockTestPage() {
  const router = useRouter();
  const { instituteId } = useAuth();
  const createMockTest = useCreateMockTest();

  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Stream creation modal ────────────────────────────────────────────────
  const [showAddStream, setShowAddStream] = useState(false);
  const [addStreamFeedback, setAddStreamFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // ── Subject creation modal ──────────────────────────────────────────────
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [addSubjectFeedback, setAddSubjectFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const { data: streamsData } = useStreams(undefined, undefined, { page: 1, pageSize: 50 });
  const streams = streamsData?.data ?? [];
  const rawStreams: Stream[] = streamsData?.data ?? [];

  const { data: subjectsData } = useSubjects(
    formData.streamId ? { streamId: formData.streamId } : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page: 1, pageSize: 200 },
  );
  const subjects = subjectsData?.data ?? [];
  const rawSubjects: Subject[] = subjectsData?.data ?? [];

  const handleChange = useCallback(
    (field: keyof FormData, value: string | number | boolean | null) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const handleSubjectCreated = useCallback((newSubject: Subject) => {
    setShowAddSubject(false);
    setFormData((prev) => ({ ...prev, subjectId: newSubject.subjectId }));
    setAddSubjectFeedback({
      type: 'success',
      message: `✓ Subject "${newSubject.name}" created successfully.`,
    });
    setTimeout(() => setAddSubjectFeedback(null), 4000);
  }, []);

  const handleStreamCreated = useCallback((newStream: Stream) => {
    setShowAddStream(false);
    setFormData((prev) => ({ ...prev, streamId: newStream.streamId }));
    setAddStreamFeedback({
      type: 'success',
      message: `✓ Stream "${newStream.name}" created successfully.`,
    });
    setTimeout(() => setAddStreamFeedback(null), 4000);
  }, []);
  const validate = useCallback((): boolean => {
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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      if (!instituteId) {
        setErrors({ form: 'Institute not found. Please ensure you have an institute assigned to your profile.' });
        return;
      }

      createMockTest.mutate(
        {
          instituteId,
          streamId: formData.streamId,
          title: formData.title.trim(),
          description: formData.description || null,
          testType: formData.testType,
          durationMin: formData.durationMin,
          totalMarks: 1,
          negativeMarking: 0,
          attemptLimit: formData.attemptLimit,
          shuffleQuestions: formData.shuffleQuestions,
          shuffleOptions: formData.shuffleOptions,
          calculatorAllowed: formData.calculatorAllowed,
          resultReleaseMode: formData.resultReleaseMode,
          resultReleaseAt: formData.resultReleaseMode === 'scheduled' ? formData.resultReleaseAt || null : null,
          availableFrom: formData.availableFrom || null,
          availableUntil: formData.availableUntil || null,
          subjectId: formData.subjectId || null,
        },
        {
          onSuccess: (test) => {
            router.push(`/teacher/mock-tests/${test.testId}/questions`);
          },
          onError: (error) => {
            setErrors({ form: error.message });
          },
        },
      );
    },
    [formData, validate, createMockTest, router],
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create Mock Test"
        description="Configure the test settings"
        breadcrumbs={[
          { label: 'Mock Tests', href: '/teacher/mock-tests' },
          { label: 'Create Test' },
        ]}
      />

      {addStreamFeedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            addStreamFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {addStreamFeedback.message}
        </div>
      )}

      {addSubjectFeedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            addSubjectFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {addSubjectFeedback.message}
        </div>
      )}

      <AddStreamModal
        isOpen={showAddStream}
        existingStreams={rawStreams}
        onClose={() => setShowAddStream(false)}
        onCreated={handleStreamCreated}
      />

      <AddSubjectModal
        isOpen={showAddSubject}
        existingSubjects={rawSubjects}
        onClose={() => setShowAddSubject(false)}
        onCreated={handleSubjectCreated}
      />

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Basic Information</h2>
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                placeholder="e.g. NEET 2025 Full Syllabus Mock #3"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Instructions or notes for students..."
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
            </div>

            {/* Stream + Test Type + Subject */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Stream *</label>
                <select
                  value={formData.streamId}
                  onChange={(e) => {
                    if (e.target.value === '__add_new__') {
                      setShowAddStream(true);
                      return;
                    }
                    handleChange('streamId', e.target.value);
                    handleChange('subjectId', '');
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                >
                  <option value="">Select a stream...</option>
                  {streams.map((s) => (
                    <option key={s.streamId} value={s.streamId}>{s.name}</option>
                  ))}
                  <option disabled className="border-t border-gray-200" value="__divider__">──────────────</option>
                  <option value="__add_new__" className="font-medium text-blue-600 dark:text-blue-400">
                    + Add New Stream
                  </option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Test Type</label>
                <select
                  value={formData.testType}
                  onChange={(e) => handleChange('testType', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                >
                  {TEST_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Subject (optional)</label>
                <select
                  value={formData.subjectId}
                  onChange={(e) => {
                    if (e.target.value === '__add_new__') {
                      setShowAddSubject(true);
                      return;
                    }
                    handleChange('subjectId', e.target.value);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                >
                  <option value="">All Subjects</option>
                  {subjects.map((s) => (
                    <option key={s.subjectId} value={s.subjectId}>{s.name}</option>
                  ))}
                  <option disabled className="border-t border-gray-200" value="__divider__">──────────────</option>
                  <option value="__add_new__" className="font-medium text-blue-600 dark:text-blue-400">
                    + Add New Subject
                  </option>
                </select>
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
              <input
                type="number"
                value={formData.durationMin}
                onChange={(e) => handleChange('durationMin', Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={600}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.durationMin && <p className="mt-1 text-xs text-red-500">{errors.durationMin}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Attempt Limit</label>
              <input
                type="number"
                value={formData.attemptLimit ?? ''}
                onChange={(e) => handleChange('attemptLimit', e.target.value ? parseInt(e.target.value) : null)}
                min={1}
                placeholder="Unlimited"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.attemptLimit && <p className="mt-1 text-xs text-red-500">{errors.attemptLimit}</p>}
            </div>
          </div>
        </section>

        {/* Settings */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Test Settings</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={formData.shuffleQuestions}
                onChange={(e) => handleChange('shuffleQuestions', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-700">Shuffle Questions</p>
                <p className="text-xs text-gray-500">Present questions in random order per student</p>
              </div>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={formData.shuffleOptions}
                onChange={(e) => handleChange('shuffleOptions', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-700">Shuffle Options</p>
                <p className="text-xs text-gray-500">Randomize option order for MCQ/MSQ questions</p>
              </div>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={formData.calculatorAllowed}
                onChange={(e) => handleChange('calculatorAllowed', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-700">Calculator Allowed</p>
                <p className="text-xs text-gray-500">Show on-screen scientific calculator</p>
              </div>
            </label>
          </div>
        </section>

        {/* Availability */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Availability & Results</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Result Release Mode</label>
              <select
                value={formData.resultReleaseMode}
                onChange={(e) => handleChange('resultReleaseMode', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              >
                {RESULT_RELEASE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {formData.resultReleaseMode === 'scheduled' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Release Date & Time</label>
                <input
                  type="datetime-local"
                  value={formData.resultReleaseAt}
                  onChange={(e) => handleChange('resultReleaseAt', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
                {errors.resultReleaseAt && <p className="mt-1 text-xs text-red-500">{errors.resultReleaseAt}</p>}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Available From</label>
                <input
                  type="datetime-local"
                  value={formData.availableFrom}
                  onChange={(e) => handleChange('availableFrom', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Available Until</label>
                <input
                  type="datetime-local"
                  value={formData.availableUntil}
                  onChange={(e) => handleChange('availableUntil', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
                {errors.availableUntil && <p className="mt-1 text-xs text-red-500">{errors.availableUntil}</p>}
              </div>
            </div>
          </div>
        </section>

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
            disabled={createMockTest.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMockTest.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : (
              'Create Test'
            )}
          </button>
          <Link
            href="/teacher/mock-tests"
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
