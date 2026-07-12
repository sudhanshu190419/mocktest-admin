'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useMockResult } from '@/hooks/mockTest/useMockResults';
import { useMockTest } from '@/hooks/mockTest/useMockTests';
import { useMockTestQuestions } from '@/hooks/mockTest/useMockTestQuestions';
import { useMockAnswers } from '@/hooks/mockTest/useMockAttempts';
import { useQuestions } from '@/hooks/mockTest/useQuestions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { formatDuration } from '@/utils/mockResults';
import type { MockAnswer } from '@/types/mockTest';

const QUESTION_TYPE_LABELS: Record<string, string> = {
  mcq: 'MCQ',
  msq: 'MSQ',
  numerical: 'Numerical',
  true_false: 'True/False',
};

export default function QuestionAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: resultId } = use(params);

  const { data: result, isLoading: resultLoading } = useMockResult(resultId);
  const { data: test } = useMockTest(result?.testId);
  const { data: assignedQuestions, isLoading: questionsLoading } = useMockTestQuestions(result?.testId);
  const { data: answers, isLoading: answersLoading } = useMockAnswers(result?.attemptId);

  // Fetch question details for type/labels
  const questionIds = useMemo(() => {
    if (!assignedQuestions) return [];
    return assignedQuestions.map((aq) => aq.questionId);
  }, [assignedQuestions]);

  const { data: questionsData } = useQuestions(
    questionIds.length > 0 ? { ids: questionIds } : undefined,
    undefined,
    { page: 1, pageSize: 200 },
  );
  const questionsMap = useMemo(() => {
    const map = new Map<string, { questionText: string; questionType: string; difficulty: string }>();
    if (questionsData?.data) {
      questionsData.data.forEach((q) => {
        map.set(q.questionId, { questionText: q.questionText, questionType: q.questionType, difficulty: q.difficulty });
      });
    }
    return map;
  }, [questionsData]);

  const answerMap = useMemo(() => {
    const map = new Map<string, MockAnswer>();
    if (answers) {
      answers.forEach((a) => map.set(a.questionId, a));
    }
    return map;
  }, [answers]);

  const isLoading = resultLoading || questionsLoading || answersLoading;

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Loading..." description="Loading question analysis..." />
        <Skeleton className="mb-4 h-40 w-full" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Result not found.</p>
        <Link href="/teacher/results" className="mt-2 inline-block text-sm text-blue-600 hover:underline">Back to Results</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Question-wise Analysis"
        description={test?.title ?? 'Test'}
        breadcrumbs={[
          { label: 'Results', href: '/teacher/results' },
          { label: `#${result.resultId.slice(0, 8)}`, href: `/teacher/results/${result.resultId}` },
          { label: 'Questions' },
        ]}
      />

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-4 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Correct</p>
          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{result.correctCount}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-red-700 dark:text-red-400">Wrong</p>
          <p className="text-xl font-bold text-red-700 dark:text-red-400">{result.wrongCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Skipped</p>
          <p className="text-xl font-bold text-gray-500">{result.skippedCount}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
          <p className="text-[11px] font-medium uppercase tracking-wider text-blue-700 dark:text-blue-400">Score</p>
          <p className="text-xl font-bold text-blue-700 dark:text-blue-400">{result.totalScore}/{result.maxScore}</p>
        </div>
      </div>

      {/* Question List */}
      <div className="space-y-3">
        {(!assignedQuestions || assignedQuestions.length === 0) ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
            <p className="text-sm text-gray-500">No questions found for this test.</p>
          </div>
        ) : (
          assignedQuestions.map((aq, idx) => {
            const qDetail = questionsMap.get(aq.questionId);
            const answer = answerMap.get(aq.questionId);
            const isCorrect = answer?.isCorrect;
            const statusClass = isCorrect === true
              ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10'
              : isCorrect === false
                ? 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10'
                : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900';

            return (
              <div key={aq.questionId} className={`rounded-lg border p-4 ${statusClass}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                        {idx + 1}
                      </span>
                      <p className="text-sm font-medium text-gray-900 line-clamp-2">
                        {qDetail?.questionText ?? `Question ${idx + 1}`}
                      </p>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-8">
                      {qDetail && (
                        <>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800">
                            {QUESTION_TYPE_LABELS[qDetail.questionType] || qDetail.questionType}
                          </span>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800">
                            {qDetail.difficulty}
                          </span>
                        </>
                      )}
                      <span className="text-xs text-gray-500">{aq.marks} marks</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {isCorrect === true && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        Correct
                      </span>
                    )}
                    {isCorrect === false && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Wrong
                      </span>
                    )}
                    {isCorrect === null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        Skipped
                      </span>
                    )}
                    {answer && answer.marksAwarded !== null && (
                      <p className="mt-0.5 text-[11px] font-medium text-gray-500">
                        {answer.marksAwarded >= 0 ? '+' : ''}{answer.marksAwarded} marks
                      </p>
                    )}
                    {answer && (
                      <p className="text-[11px] text-gray-400">{formatDuration(answer.timeSpentSeconds)}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3 border-t border-gray-200 pt-6">
        <Link href={`/teacher/results/${resultId}`}
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          Back to Result
        </Link>
      </div>
    </div>
  );
}
