'use client';

import { useState, useCallback, useMemo } from 'react';
import { useMockAttempt, useMockAnswers, useUpdateMockAnswer, useCreateMockAnswerOption } from '@/hooks/mockTest/useMockAttempts';
import { useMockTestQuestions } from '@/hooks/mockTest/useMockTestQuestions';
import { useQuestion } from '@/hooks/mockTest/useQuestions';
import { useQuestionOptions } from '@/hooks/mockTest/useQuestionOptions';

import { createMockAnswer, deleteMockAnswerOptionsByAnswerId } from '@/services/mockTest/mockAttemptService';
import type { Question, QuestionOption, MockAnswer } from '@/types/mockTest';

interface QuestionNavPanelProps {
  attemptId: string | null;
}

// ─── Question Display Child Component ─────────────────────────────────────
// Extracted with a `key` prop so local state resets naturally on navigation.
interface QuestionDisplayProps {
  question: Question;
  options: QuestionOption[] | undefined;
  currentAnswer: MockAnswer | null;
  attemptId: string;
  instituteId: string;
  questionNumber: number;
  totalQuestions: number;
}

function QuestionDisplay({
  question,
  options,
  currentAnswer,
  attemptId,
  instituteId,
  questionNumber,
  totalQuestions,
}: QuestionDisplayProps) {
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [numericalInput, setNumericalInput] = useState<string>(
    currentAnswer?.numericalAnswer !== null && currentAnswer?.numericalAnswer !== undefined
      ? String(currentAnswer.numericalAnswer)
      : ''
  );
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const updateAnswerMutation = useUpdateMockAnswer();
  const createOptionMutation = useCreateMockAnswerOption();



  const questionTypeLabel: Record<string, string> = {
    mcq: 'Single Correct (MCQ)',
    msq: 'Multiple Correct (MSQ)',
    numerical: 'Numerical',
    true_false: 'True/False',
  };

  const handleToggleOption = useCallback((optionId: string) => {
    setSelectedOptions((prev) => {
      const next = new Set(prev);
      if (question.questionType === 'mcq' || question.questionType === 'true_false') {
        return new Set([optionId]);
      }
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  }, [question.questionType]);

  const handleSaveResponse = useCallback(async () => {
    setLocalError(null);
    setSaveStatus(null);

    const isMcqOrTrueFalse = question.questionType === 'mcq' || question.questionType === 'true_false';
    const isMsq = question.questionType === 'msq';
    const isNumerical = question.questionType === 'numerical';

    let isAnswered = false;
    if (isMcqOrTrueFalse || isMsq) {
      isAnswered = selectedOptions.size > 0;
    } else if (isNumerical) {
      isAnswered = numericalInput.trim() !== '';
    }

    if (!isAnswered) {
      setLocalError('No answer selected. Select an option or enter a value before saving.');
      return;
    }

    try {
      let answerId = currentAnswer?.answerId ?? null;

      if (!answerId) {
        const result = await createMockAnswer({
          attemptId,
          questionId: question.questionId,
          instituteId,
        });
        if (!result.success || !result.data) {
          setLocalError(result.error ?? 'Failed to create answer record.');
          return;
        }
        answerId = result.data.answerId;
      }

      await updateAnswerMutation.mutateAsync({
        id: answerId,
        input: {
          isAnswered: true,
          answeredAt: new Date().toISOString(),
          timeSpentSeconds: currentAnswer?.timeSpentSeconds ?? 0,
        },
      });

      if (isMcqOrTrueFalse || isMsq) {
        await deleteMockAnswerOptionsByAnswerId(answerId);
        for (const optionId of selectedOptions) {
          await createOptionMutation.mutateAsync({ answerId, optionId });
        }
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save response.');
      setSaveStatus('error');
    }
  }, [question, selectedOptions, numericalInput, currentAnswer, attemptId, instituteId, updateAnswerMutation, createOptionMutation]);

  const handleMarkForReview = useCallback(() => {
    if (!currentAnswer) return;
    updateAnswerMutation.mutate({
      id: currentAnswer.answerId,
      input: { isMarkedForReview: !currentAnswer.isMarkedForReview },
    });
  }, [currentAnswer, updateAnswerMutation]);

  return (
    <div className="space-y-3">
      {/* Question Card */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4">
        <div className="text-xs text-gray-500 mb-2">
          Question {questionNumber} of {totalQuestions}
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] mb-3">
          <span className="rounded bg-blue-950/40 px-2 py-0.5 text-blue-300">
            {questionTypeLabel[question.questionType] ?? question.questionType}
          </span>
          <span className="rounded bg-purple-950/40 px-2 py-0.5 text-purple-300">
            {question.difficulty}
          </span>
          <span className="rounded bg-gray-800 px-2 py-0.5 text-gray-400">
            {question.marks} mark{question.marks !== 1 ? 's' : ''}
          </span>
          {question.negativeMarks > 0 && (
            <span className="rounded bg-red-950/40 px-2 py-0.5 text-red-300">
              -{question.negativeMarks} for wrong
            </span>
          )}
        </div>

        <div className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">
          {question.questionText}
        </div>

        {(question.questionType === 'mcq' ||
          question.questionType === 'msq' ||
          question.questionType === 'true_false') && (
          <div className="space-y-2 border-t border-gray-700 pt-3 mt-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              {question.questionType === 'msq' ? 'Select all that apply' : 'Select one'}
            </div>
            {options && options.length > 0 ? (
              options.map((option, idx) => {
                const isSelected = selectedOptions.has(option.optionId);
                const letter = String.fromCharCode(65 + idx);
                return (
                  <button
                    key={option.optionId}
                    type="button"
                    onClick={() => handleToggleOption(option.optionId)}
                    className={`w-full flex items-start gap-3 rounded border px-3 py-2.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                        : 'border-gray-700 bg-gray-800/30 text-gray-300 hover:border-gray-500 hover:bg-gray-800'
                    }`}
                  >
                    <span className={`flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full border text-[10px] ${
                      isSelected
                        ? 'border-blue-500 bg-blue-700 text-white'
                        : 'border-gray-600 text-gray-500'
                    }`}>
                      {question.questionType === 'msq'
                        ? (isSelected ? '✓' : letter)
                        : (isSelected ? '●' : letter)
                      }
                    </span>
                    <span className="pt-0.5">{option.optionText}</span>
                  </button>
                );
              })
            ) : (
              <div className="text-xs text-gray-500 italic">No options loaded for this question.</div>
            )}
          </div>
        )}

        {question.questionType === 'numerical' && (
          <div className="border-t border-gray-700 pt-3 mt-3">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Enter your answer
            </label>
            <input
              type="number"
              step="any"
              value={numericalInput}
              onChange={(e) => setNumericalInput(e.target.value)}
              placeholder="Type your numeric answer..."
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-blue-600 focus:outline-none"
            />
          </div>
        )}

        <div className="border-t border-gray-700 pt-2 mt-3 text-[10px] text-gray-600 font-mono">
          ID: {question.questionId}
        </div>
      </div>

      {localError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2">
          <span className="text-xs text-red-400">{localError}</span>
        </div>
      )}
      {saveStatus === 'success' && (
        <div className="rounded border border-green-700/50 bg-green-950/30 px-4 py-2">
          <span className="text-xs text-green-400">Response saved successfully!</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleMarkForReview}
          disabled={!currentAnswer}
          className="rounded bg-amber-800/50 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-40 hover:bg-amber-800/70 transition-colors"
        >
          {currentAnswer?.isMarkedForReview ? 'Clear Review' : 'Mark for Review'}
        </button>
        <button
          type="button"
          onClick={handleSaveResponse}
          disabled={updateAnswerMutation.isPending || createOptionMutation.isPending}
          className="rounded bg-blue-700 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-600 transition-colors ml-auto"
        >
          {updateAnswerMutation.isPending || createOptionMutation.isPending ? 'Saving...' : 'Save Response'}
        </button>
      </div>

      {currentAnswer && (
        <div className="flex gap-4 text-[10px] text-gray-500">
          <span className={currentAnswer.isAnswered ? 'text-green-400' : 'text-gray-600'}>
            {currentAnswer.isAnswered ? '✓ Answered' : 'Not answered'}
          </span>
          {currentAnswer.isMarkedForReview && (
            <span className="text-amber-400">⚑ Marked for Review</span>
          )}
          <span>{currentAnswer.timeSpentSeconds}s spent</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function QuestionNavPanel({ attemptId }: QuestionNavPanelProps) {
  const { data: attempt, isLoading: attemptLoading } = useMockAttempt(attemptId);
  const { data: questions, isLoading: questionsLoading } = useMockTestQuestions(attempt?.testId);
  const { data: answers, isLoading: answersLoading } = useMockAnswers(attemptId);

  const isLoading = attemptLoading || questionsLoading || answersLoading;

  const [currentIndex, setCurrentIndex] = useState(0);

  const totalQuestions = questions?.length ?? 0;
  const currentAssignment = questions && questions.length > 0 ? questions[currentIndex] : null;
  const currentQuestionId = currentAssignment?.questionId ?? null;

  const { data: currentQuestion, isLoading: questionLoading } = useQuestion(currentQuestionId);

  const optsEnabled = currentQuestion?.questionType && currentQuestion.questionType !== 'numerical' ? currentQuestionId : null;
  console.log('🔥 optsEnabled:', optsEnabled, 'questionType:', currentQuestion?.questionType, 'questionId:', currentQuestionId);
  const { data: currentOptions, isLoading: optionsLoading } = useQuestionOptions(optsEnabled);
  console.log('🔥 currentOptions:', currentOptions, 'optionsLoading:', optionsLoading);

  const answerMap = useMemo(
    () => (answers ? new Map(answers.map((a) => [a.questionId, a])) : new Map()),
    [answers]
  );

  const currentAnswer = currentQuestionId ? (answerMap.get(currentQuestionId) ?? null) : null;

  const answered = answers?.filter((a) => a.isAnswered).length ?? 0;
  const reviewed = answers?.filter((a) => a.isMarkedForReview).length ?? 0;
  const remaining = totalQuestions - answered;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Question Navigation</h2>
        <p className="text-xs text-gray-500 mt-0.5">Navigate questions, mark for review, track status</p>
      </div>

      {!attemptId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400">Select an attempt from the Attempts panel first.</span>
        </div>
      )}

      {attemptId && isLoading && (
        <div className="text-xs text-gray-500">Loading...</div>
      )}

      {attemptId && !isLoading && !attempt && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">Attempt not found.</span>
        </div>
      )}

      {attempt && questions !== undefined && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded border border-green-700/50 bg-green-950/20 px-3 py-2 text-center">
              <div className="text-lg font-bold text-green-400">{answered}</div>
              <div className="text-[10px] text-green-500 uppercase">Answered</div>
            </div>
            <div className="rounded border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-center">
              <div className="text-lg font-bold text-amber-400">{reviewed}</div>
              <div className="text-[10px] text-amber-500 uppercase">Review</div>
            </div>
            <div className="rounded border border-gray-700 bg-gray-800/30 px-3 py-2 text-center">
              <div className="text-lg font-bold text-gray-400">{remaining}</div>
              <div className="text-[10px] text-gray-500 uppercase">Remaining</div>
            </div>
            <div className="rounded border border-blue-700/50 bg-blue-950/20 px-3 py-2 text-center">
              <div className="text-lg font-bold text-blue-400">{totalQuestions}</div>
              <div className="text-[10px] text-blue-500 uppercase">Total</div>
            </div>
          </div>

          {totalQuestions === 0 && (
            <div className="rounded border border-gray-700 bg-gray-800/50 px-4 py-3">
              <span className="text-xs text-gray-500">No questions assigned to this test.</span>
            </div>
          )}

          {totalQuestions > 0 && (
            <>
              {questionLoading || optionsLoading ? (
                <div className="rounded border border-gray-700 bg-gray-900 p-8 text-center">
                  <div className="text-xs text-gray-500">Loading question...</div>
                </div>
              ) : currentQuestion ? (
                <QuestionDisplay
                  key={currentQuestion.questionId}
                  question={currentQuestion}
                  options={currentOptions}
                  currentAnswer={currentAnswer}
                  attemptId={attemptId!}
                  instituteId={attempt.instituteId}
                  questionNumber={currentIndex + 1}
                  totalQuestions={totalQuestions}
                />
              ) : (
                <div className="rounded border border-gray-700 bg-gray-900 p-8 text-center">
                  <div className="text-xs text-gray-500">Question not found.</div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  disabled={currentIndex <= 0}
                  className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition-colors"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentIndex((i) => Math.min(totalQuestions - 1, i + 1))}
                  disabled={currentIndex >= totalQuestions - 1}
                  className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition-colors"
                >
                  Next →
                </button>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-gray-500">Jump To Question</label>
                <div className="flex gap-1 flex-wrap">
                  {questions.map((q, idx) => {
                    const matchingAnswer = answerMap.get(q.questionId);
                    return (
                      <button
                        key={q.questionId}
                        type="button"
                        onClick={() => setCurrentIndex(idx)}
                        className={`w-7 h-7 rounded text-[10px] font-medium transition-colors ${
                          idx === currentIndex
                            ? 'bg-blue-700 text-white'
                            : matchingAnswer?.isAnswered
                              ? 'bg-green-900/50 text-green-300 border border-green-700/50'
                              : matchingAnswer?.isMarkedForReview
                                ? 'bg-amber-900/50 text-amber-300 border border-amber-700/50'
                                : 'bg-gray-800 text-gray-400 border border-gray-700'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
