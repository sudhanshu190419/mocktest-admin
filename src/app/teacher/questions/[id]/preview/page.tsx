'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuestion } from '@/hooks/mockTest/useQuestions';
import { useQuestionOptions } from '@/hooks/mockTest/useQuestionOptions';
import { useQuestionExplanation } from '@/hooks/mockTest/useQuestionExplanations';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/utils';

export default function QuestionPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: questionId } = use(params);
  const { data: question, isLoading } = useQuestion(questionId);
  const { data: options } = useQuestionOptions(questionId);
  const { data: explanation } = useQuestionExplanation(questionId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  if (!question) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-500">Question not found</p>
      </div>
    );
  }

  const typeLabel: Record<string, string> = {
    mcq: 'Multiple Choice (Single Correct)',
    msq: 'Multiple Choice (Multi Correct)',
    numerical: 'Numerical',
    true_false: 'True / False',
    text_based: 'Text-Based / Short Answer',
    subjective: 'Subjective / Descriptive',
  };

  const isNumerical = question.questionType === 'numerical';
  const isSubjective = question.questionType === 'subjective';
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Question Preview"
        description="This is exactly how students will see this question"
        breadcrumbs={[
          { label: 'Question Bank', href: '/teacher/questions' },
          { label: 'All Questions', href: '/teacher/questions/list' },
          { label: 'Preview' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/teacher/questions/${questionId}/edit`}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Edit</Link>
            <StatusBadge status={question.status} />
          </div>
        }
      />

      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
            {typeLabel[question.questionType] ?? question.questionType}
          </span>
          <span className="text-[11px] text-gray-500">
            Difficulty: <span className="font-medium capitalize text-gray-700">{question.difficulty}</span>
          </span>
          <span className="text-[11px] text-gray-500">
            Marks: <span className="font-medium text-gray-700">{question.marks}</span>
          </span>
          {question.negativeMarks > 0 && (
            <span className="text-[11px] text-gray-500">
              Negative: <span className="font-medium text-rose-600">-{question.negativeMarks}</span>
            </span>
          )}
        </div>

        <div className="px-6 py-6">
          <p className="text-base leading-relaxed text-gray-900 dark:text-gray-100">
            {question.questionText}
          </p>
        </div>

        {!isNumerical && !isSubjective && options && options.length > 0 && (
          <div className="space-y-3 px-6 pb-6">
            {options.map((option, index) => (
              <div
                key={option.optionId}
                className={cn(
                  'flex items-start gap-4 rounded-xl border p-4 transition-colors',
                  option.isCorrect
                    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20'
                    : 'border-gray-200 dark:border-gray-700',
                )}
              >
                <div className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  option.isCorrect ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
                )}>
                  {labels[index]}
                </div>
                <div className="flex-1 pt-1.5">
                  <p className={cn('text-sm', option.isCorrect ? 'font-medium text-emerald-800 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-300')}>
                    {option.optionText}
                  </p>
                </div>
                {option.isCorrect && (
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
                    <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {explanation && (
          <div className="border-t border-gray-100 px-6 py-5 dark:border-gray-800">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
              Explanation
            </h3>
            {explanation.explanationText && (
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{explanation.explanationText}</p>
            )}
            {explanation.correctNumericalAnswer != null && (
              <div className="mt-3 rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  <span className="font-medium">Correct Answer: </span>
                  {explanation.correctNumericalAnswer}
                  {explanation.numericalTolerance != null && explanation.numericalTolerance > 0 && (
                    <span className="ml-2 text-blue-600">(±{explanation.numericalTolerance} tolerance)</span>
                  )}
                </p>
              </div>
            )}
            {explanation.correctTextAnswer && (
              <div className="mt-3 rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  <span className="font-medium">{isSubjective ? 'Model Answer / Evaluation Guidance: ' : 'Accepted Answer: '}</span>
                  {explanation.correctTextAnswer}
                </p>
              </div>
            )}
            {explanation.explanationVideoUrl && (
              <div className="mt-3">
                <a href={explanation.explanationVideoUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700">
                  Watch Video Solution
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
