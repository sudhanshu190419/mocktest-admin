'use client';

import { useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAttemptSubjectiveAnswers, useSaveEvaluation, useFinalizeEvaluation } from '@/hooks/teacher/useEvaluation';
import { PageHeader } from '@/components/ui/PageHeader';
import { SubjectiveAnswerCard } from '@/components/evaluation/SubjectiveAnswerCard';
import { EvaluationProgress } from '@/components/evaluation/EvaluationProgress';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

export default function AttemptEvaluationPage() {
  const params = useParams();
  const router = useRouter();
  const attemptId = params.attemptId as string;

  const { data: answers, isLoading, error } = useAttemptSubjectiveAnswers(attemptId);
  const saveMutation = useSaveEvaluation(attemptId);
  const finalizeMutation = useFinalizeEvaluation();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);

  // Maintain stable question order matching mock-test sequence (from query)
  const sortedAnswers = useMemo(() => {
    if (!answers) return [];
    return answers;
  }, [answers]);

  const evaluatedCount = useMemo(
    () => sortedAnswers.filter((a) => a.evaluationStatus === 'manual_evaluated').length,
    [sortedAnswers],
  );

  const allEvaluated = sortedAnswers.length > 0 && evaluatedCount === sortedAnswers.length;

  const currentItem = sortedAnswers[currentQuestionIndex];

  // Calculate score summary for finalize dialog
  const scoreSummary = useMemo(() => {
    if (!sortedAnswers.length) return null;
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let maxScore = 0;
    for (const a of sortedAnswers) {
      maxScore += a.questionMarks;
      if (a.evaluationStatus === 'manual_evaluated') {
        subjectiveScore += a.awardedMarks ?? 0;
      }
    }
    return { objectiveScore, subjectiveScore, maxScore };
  }, [sortedAnswers]);

  const handleSave = useCallback(
    async (answerId: string, marks: number, feedback: string) => {
      await saveMutation.mutateAsync({ answerId, awardedMarks: marks, feedback });
      // Move to next question if available
      if (currentQuestionIndex < sortedAnswers.length - 1) {
        setCurrentQuestionIndex((i) => i + 1);
      }
    },
    [saveMutation, currentQuestionIndex, sortedAnswers.length],
  );

  const handleFinalize = useCallback(async () => {
    console.error('[FINALIZE_TRACE] Calling finalizeMutation', {
      attemptId,
    });
    try {
      await finalizeMutation.mutateAsync({ attemptId });
      router.push('/teacher/evaluation');
    } catch {
      // Error is handled by the mutation
    }
  }, [finalizeMutation, attemptId, router]);

  return (
    <div>
      <PageHeader
        title="Evaluate Attempt"
        description={currentItem ? `${currentItem.studentName} — ${currentItem.testTitle}` : ''}
        breadcrumbs={[
          { label: 'Evaluation', href: '/teacher/evaluation' },
          { label: 'Attempt' },
        ]}
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load attempt details. Please try again.
          </p>
          <p className="mt-1 text-xs text-red-500">{error.message}</p>
        </div>
      ) : sortedAnswers.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-sm text-gray-500">No subjective questions found for this attempt.</p>
          <button
            type="button"
            onClick={() => router.push('/teacher/evaluation')}
            className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            ← Back to Evaluation Dashboard
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Progress */}
          <EvaluationProgress
            evaluated={evaluatedCount}
            total={sortedAnswers.length}
            currentQuestionIndex={currentQuestionIndex}
            items={sortedAnswers}
          />

          {/* Current Question */}
          {currentItem && (
            <SubjectiveAnswerCard
              key={currentItem.answerId}
              item={currentItem}
              index={currentQuestionIndex}
              total={sortedAnswers.length}
              onSave={handleSave}
              isReadOnly={
                currentItem.evaluationStatus === 'manual_evaluated' &&
                !!scoreSummary &&
                false // Allow editing until finalized — backend enforces finalization check
              }
              existingMarks={currentItem.awardedMarks}
              existingFeedback={currentItem.evaluatorFeedback}
            />
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentQuestionIndex((i) => Math.max(0, i - 1))}
              disabled={currentQuestionIndex === 0}
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              ← Previous
            </button>

            <div className="flex items-center gap-3">
              {currentQuestionIndex < sortedAnswers.length - 1 && (
                <button
                  type="button"
                  onClick={() => setCurrentQuestionIndex((i) => i + 1)}
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  Next →
                </button>
              )}

              {/* Finalize button */}
              {allEvaluated && (
                <button
                  type="button"
                  onClick={() => {
                    console.error('[FINALIZE_TRACE] Teacher clicked Finalize Evaluation', {
                      attemptId,
                    });
                    setShowFinalizeConfirm(true);
                  }}
                  disabled={finalizeMutation.isPending}
                  className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  {finalizeMutation.isPending ? 'Finalizing...' : 'Finalize Evaluation'}
                </button>
              )}
            </div>
          </div>

          {/* Error from mutations */}
          {(saveMutation.isError || finalizeMutation.isError) && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {(saveMutation.error ?? finalizeMutation.error)?.message ?? 'An error occurred.'}
            </div>
          )}
        </div>
      )}

      {/* Finalize Confirmation Dialog */}
      <ConfirmDialog
        open={showFinalizeConfirm}
        onClose={() => setShowFinalizeConfirm(false)}
        onConfirm={handleFinalize}
        title="Finalize Evaluation"
        message={`All subjective answers have been evaluated. Finalizing will calculate the student's final score. The result will remain hidden until an administrator releases it.${
          scoreSummary
            ? `\n\nFinal Score: ${scoreSummary.subjectiveScore} / ${scoreSummary.maxScore}`
            : ''
        }`}
        confirmLabel="Finalize Evaluation"
        variant="default"
        loading={finalizeMutation.isPending}
      >
        {scoreSummary && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
            <p className="font-medium text-gray-700 dark:text-gray-300">Score Summary</p>
            <p className="mt-1 text-gray-600 dark:text-gray-400">
              Subjective Score: {scoreSummary.subjectiveScore} / {scoreSummary.maxScore}
            </p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
