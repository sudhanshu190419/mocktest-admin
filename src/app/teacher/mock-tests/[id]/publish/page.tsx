'use client';

import { useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMockTest } from '@/hooks/mockTest/useMockTests';
import { useMockTestQuestions } from '@/hooks/mockTest/useMockTestQuestions';
import { useValidateMockTestReady, usePublishMockTestWorkflow } from '@/hooks/mockTest/useMockTestPublish';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

export default function MockTestPublishPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: testId } = use(params);

  const { data: test, isLoading: testLoading } = useMockTest(testId);
  const { data: assignedQuestions, isLoading: questionsLoading } = useMockTestQuestions(testId);
  const { data: validation, isLoading: validationLoading, refetch: revalidate } = useValidateMockTestReady(testId);
  const publishWorkflow = usePublishMockTestWorkflow();

  const [showConfirm, setShowConfirm] = useState(false);

  const handlePublish = useCallback(() => {
    setShowConfirm(false);
    publishWorkflow.mutate(testId, {
      onSuccess: () => {
        router.push(`/teacher/mock-tests/${testId}/preview`);
      },
    });
  }, [testId, publishWorkflow, router]);

  const isLoading = testLoading || questionsLoading || validationLoading;

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Running pre-publish checks..." />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Mock test not found.</p>
        <Link href="/teacher/mock-tests" className="mt-2 inline-block text-sm text-blue-600 hover:underline">Back to Mock Tests</Link>
      </div>
    );
  }

  const questionCount = assignedQuestions?.length ?? 0;
  const totalMarks = assignedQuestions?.reduce((sum, q) => sum + q.marks, 0) ?? 0;

  const checks = [
    { key: 'testExists', label: 'Mock test exists', passed: validation?.details.testExists ?? false },
    { key: 'status', label: 'Status is draft or pending approval', passed: validation?.details.status === 'draft' || validation?.details.status === 'pending_approval' },
    { key: 'hasQuestions', label: 'At least 1 question assigned', passed: validation?.details.hasQuestions ?? false },
    { key: 'allQuestionsExist', label: 'All assigned questions exist', passed: validation?.details.allQuestionsExist ?? true },
    { key: 'allQuestionsPublished', label: 'All questions are published', passed: validation?.details.allQuestionsPublished ?? true },
    { key: 'validDuration', label: 'Duration > 0', passed: validation?.details.validDuration ?? true },
    { key: 'validTotalMarks', label: 'Total marks > 0', passed: validation?.details.validTotalMarks ?? true },
    { key: 'noDuplicateDisplayOrder', label: 'Unique display orders', passed: validation?.details.noDuplicateDisplayOrder ?? true },
    { key: 'validAvailabilityDates', label: 'Valid availability window', passed: validation?.details.validAvailabilityDates ?? true },
  ];

  const allPassed = checks.every((c) => c.passed);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Publish Mock Test"
        description="Run pre-flight checks before making the test available to students"
        breadcrumbs={[
          { label: 'Mock Tests', href: '/teacher/mock-tests' },
          { label: test.title, href: `/teacher/mock-tests/${testId}/edit` },
          { label: 'Publish' },
        ]}
      />

      {/* Test summary */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{test.title}</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {test.durationMin} min · {test.totalMarks} marks · {questionCount} question{questionCount !== 1 ? 's' : ''}
            </p>
          </div>
          <StatusBadge status={test.status} />
        </div>
      </div>

      {/* Validation checks */}
      <div className="mb-8 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Pre-flight Checklist</h3>
          <button type="button" onClick={() => revalidate()}
            className="text-xs font-medium text-blue-600 hover:text-blue-700">
            Re-run checks
          </button>
        </div>

        {checks.map((check) => (
          <div key={check.key}
            className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
              check.passed
                ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/10'
                : 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10'
            }`}
          >
            <span className={check.passed ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
              {check.label}
            </span>
            {check.passed ? (
              <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* Validation errors & warnings */}
      {validation && validation.errors.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <h4 className="text-sm font-semibold text-red-800 dark:text-red-400">
            {validation.errors.length} blocking error(s)
          </h4>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-red-700 dark:text-red-300">
            {validation.errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {validation && validation.warnings.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-400">
            {validation.warnings.length} warning(s)
          </h4>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-700 dark:text-amber-300">
            {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Summary */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Questions</p>
            <p className="mt-0.5 text-xl font-bold text-gray-900">{questionCount}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Total Marks</p>
            <p className="mt-0.5 text-xl font-bold text-gray-900">{totalMarks}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Duration</p>
            <p className="mt-0.5 text-xl font-bold text-gray-900">{test.durationMin} min</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Type</p>
            <p className="mt-0.5 text-xl font-bold text-gray-900 capitalize">{test.testType.replace('_', ' ')}</p>
          </div>
        </div>
      </div>

      {/* Publish button */}
      <div className="flex items-center gap-3 border-t border-gray-200 pt-6">
        <button
          type="button"
          disabled={!allPassed || publishWorkflow.isPending}
          onClick={() => setShowConfirm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {publishWorkflow.isPending ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Publishing...
            </>
          ) : (
            'Publish Test'
          )}
        </button>
        <Link href={`/teacher/mock-tests/${testId}/edit`}
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          Back to Edit
        </Link>
        <Link href={`/teacher/mock-tests/${testId}/questions`}
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          Manage Questions
        </Link>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handlePublish}
        title="Publish Mock Test"
        message="Once published, students will be able to attempt this test. Questions and settings will be frozen. Are you sure?"
        confirmLabel="Publish"
        variant="default"
      />
    </div>
  );
}
