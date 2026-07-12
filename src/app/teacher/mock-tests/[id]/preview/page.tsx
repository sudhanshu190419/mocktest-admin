'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useMockTest } from '@/hooks/mockTest/useMockTests';
import { useMockTestQuestions } from '@/hooks/mockTest/useMockTestQuestions';
import { useQuestions } from '@/hooks/mockTest/useQuestions';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  hard: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  mcq: 'MCQ',
  msq: 'MSQ',
  numerical: 'Numerical',
  true_false: 'True/False',
};

export default function MockTestPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: testId } = use(params);

  const { data: test, isLoading: testLoading } = useMockTest(testId);
  const { data: assignedQuestions, isLoading: questionsLoading } = useMockTestQuestions(testId);

  const stats = useMemo(() => {
    if (!assignedQuestions || assignedQuestions.length === 0) {
      return null;
    }
    const totalQ = assignedQuestions.length;
    const totalMarks = assignedQuestions.reduce((sum, q) => sum + q.marks, 0);
    const avgMarks = parseFloat((totalMarks / totalQ).toFixed(1));
    return { totalQ, totalMarks, avgMarks };
  }, [assignedQuestions]);

  // Fetch question details to show type/difficulty
  const questionIds = assignedQuestions?.map((aq) => aq.questionId) ?? [];
  const { data: questionsData } = useQuestions(
    questionIds.length > 0 ? { ids: questionIds } : undefined,
    undefined,
    { page: 1, pageSize: 200 },
  );
  const questionDetails = questionsData?.data ?? [];
  const questionMap = useMemo(() => {
    const map = new Map<string, typeof questionDetails[0]>();
    questionDetails.forEach((q) => map.set(q.questionId, q));
    return map;
  }, [questionDetails]);

  if (testLoading || questionsLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Loading test preview..." />
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

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={test.title}
        description="Student-facing preview"
        breadcrumbs={[
          { label: 'Mock Tests', href: '/teacher/mock-tests' },
          { label: test.title, href: `/teacher/mock-tests/${testId}/edit` },
          { label: 'Preview' },
        ]}
        actions={<StatusBadge status={test.status} />}
      />

      {/* Test Summary Card */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Test Overview</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'Duration', value: `${test.durationMin} min` },
            { label: 'Total Marks', value: String(test.totalMarks) },
            { label: 'Questions', value: String(stats?.totalQ ?? '—') },
            { label: 'Negative Marking', value: test.negativeMarking > 0 ? `-${test.negativeMarking}` : 'None' },
            { label: 'Type', value: test.testType.replace('_', ' ') },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{s.label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Settings summary */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
          {test.shuffleQuestions && (
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">Shuffled Questions</span>
          )}
          {test.shuffleOptions && (
            <span className="rounded-full bg-purple-50 px-2.5 py-1 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">Shuffled Options</span>
          )}
          {test.calculatorAllowed && (
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400">Calculator</span>
          )}
          {test.attemptLimit && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">{test.attemptLimit} attempt(s)</span>
          )}
          {test.resultReleaseMode === 'immediate' && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">Instant Result</span>
          )}
          {test.resultReleaseMode === 'scheduled' && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">Scheduled Result</span>
          )}
        </div>

        {test.description && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 mb-1">Instructions</p>
            {test.description}
          </div>
        )}
      </div>

      {/* Question List */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Questions
          {stats && <span className="ml-2 text-sm font-normal text-gray-500">({stats.totalQ} questions · {stats.totalMarks} total marks · avg {stats.avgMarks} marks)</span>}
        </h2>

        {!assignedQuestions || assignedQuestions.length === 0 ? (
          <EmptyState
            title="No questions assigned"
            description="Add questions from the Question Bank before publishing."
            action={
              <Link href={`/teacher/mock-tests/${testId}/questions`}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Add Questions
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {assignedQuestions.map((aq, idx) => {
              const qDetail = questionMap.get(aq.questionId);
              return (
                <div key={aq.questionId}
                  className="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm dark:border-gray-700 dark:bg-gray-900">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          {idx + 1}
                        </span>
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">{qDetail?.questionText ?? `Question ${idx + 1}`}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                        {qDetail && (
                          <>
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800">
                              {QUESTION_TYPE_LABELS[qDetail.questionType] || qDetail.questionType}
                            </span>
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${DIFFICULTY_COLORS[qDetail.difficulty] || ''}`}>
                              {qDetail.difficulty}
                            </span>
                          </>
                        )}
                        <span className="text-[11px] text-gray-500">{aq.marks} marks</span>
                        {aq.sectionName && <span className="text-[11px] text-gray-500">Section: {aq.sectionName}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3 border-t border-gray-200 pt-6">
        <Link href={`/teacher/mock-tests/${testId}/edit`}
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          Edit Settings
        </Link>
        <Link href={`/teacher/mock-tests/${testId}/questions`}
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          Manage Questions
        </Link>
        {test.status === 'draft' && (
          <Link href={`/teacher/mock-tests/${testId}/publish`}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            Publish Test
          </Link>
        )}
      </div>
    </div>
  );
}
