'use client';

import { useState, useCallback } from 'react';
import { useMockAttempt, useUpdateMockAttempt, useEvaluateAttempt } from '@/hooks/mockTest/useMockAttempts';
import { useMockAnswers } from '@/hooks/mockTest/useMockAttempts';
import { useMockTestQuestions } from '@/hooks/mockTest/useMockTestQuestions';
import StatusBadge from '@/components/dev/StatusBadge';

interface SubmitPanelProps {
  attemptId: string | null;
}

export default function SubmitPanel({ attemptId }: SubmitPanelProps) {
  const { data: attempt, isLoading: attemptLoading } = useMockAttempt(attemptId);
  const { data: questions, isLoading: questionsLoading } = useMockTestQuestions(attempt?.testId);
  const { data: answers } = useMockAnswers(attemptId);
  const updateMutation = useUpdateMockAttempt();
  const evaluateMutation = useEvaluateAttempt();

  const [error, setError] = useState<string | null>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<'idle' | 'evaluating' | 'success' | 'error'>('idle');

  const isLoading = attemptLoading || questionsLoading;
  const totalQuestions = questions?.length ?? 0;
  const unansweredCount = answers?.filter((a) => !a.isAnswered).length ?? 0;
  const answeredCount = answers?.filter((a) => a.isAnswered).length ?? 0;

  const handleValidate = useCallback(() => {
    if (!answers) return;
    const issues: string[] = [];
    if (unansweredCount > 0) issues.push(`${unansweredCount} questions unanswered`);
    if (totalQuestions === 0) issues.push('No questions in this test');
    if (issues.length > 0) {
      setError(issues.join('; '));
    } else {
      setError(null);
    }
  }, [answers, unansweredCount, totalQuestions]);

  const handleSubmit = useCallback(() => {
    if (!attemptId) return;
    handleValidate();
    setEvaluationStatus('idle');
    updateMutation.mutate(
      { id: attemptId, input: { status: 'submitted', submittedAt: new Date().toISOString() } },
      {
        onSuccess: () => {
          setError(null);
          // Trigger evaluation immediately after successful submission
          setEvaluationStatus('evaluating');
          evaluateMutation.mutate(attemptId, {
            onSuccess: () => {
              setEvaluationStatus('success');
            },
            onError: (err) => {
              setEvaluationStatus('error');
              setError(`Submission successful but evaluation failed: ${err.message}`);
            },
          });
        },
        onError: (err) => setError(err.message),
      }
    );
  }, [attemptId, updateMutation, handleValidate, evaluateMutation]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Submit Attempt</h2>
        <p className="text-xs text-gray-500 mt-0.5">Validate and submit attempt, auto-submit, force submit</p>
      </div>

      {!attemptId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400">Select an attempt from the Attempts panel first.</span>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}

      {attemptId && isLoading && <div className="text-xs text-gray-500">Loading...</div>}

      {attemptId && !isLoading && !attempt && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">Attempt not found.</span>
        </div>
      )}

      {attemptId && attempt && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="p-4 space-y-3">
            {/* Attempt status */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Status:</span>
              <StatusBadge label={attempt.status} variant={
                attempt.status === 'submitted' ? 'success' :
                attempt.status === 'timed_out' ? 'warning' :
                attempt.status === 'abandoned' ? 'error' : 'info'
              } />
            </div>

            {/* Validation results */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded border border-gray-700 bg-gray-800/30 px-3 py-2 text-center">
                <div className="text-lg font-bold text-gray-300">{totalQuestions}</div>
                <div className="text-[10px] text-gray-500 uppercase">Total Qs</div>
              </div>
              <div className="rounded border border-green-700/50 bg-green-950/20 px-3 py-2 text-center">
                <div className="text-lg font-bold text-green-400">{answeredCount}</div>
                <div className="text-[10px] text-green-500 uppercase">Answered</div>
              </div>
              <div className="rounded border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-center">
                <div className="text-lg font-bold text-amber-400">{unansweredCount}</div>
                <div className="text-[10px] text-amber-500 uppercase">Unanswered</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 border-t border-gray-700 pt-3">
              <button
                type="button"
                onClick={handleValidate}
                className="rounded bg-gray-800 px-4 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Validate Attempt
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={attempt.status !== 'in_progress' || updateMutation.isPending || evaluateMutation.isPending}
                className="rounded bg-green-900/50 px-4 py-2 text-xs text-green-300 disabled:opacity-40 hover:bg-green-900/70 transition-colors"
              >
                {updateMutation.isPending ? 'Submitting...' : evaluateMutation.isPending ? 'Evaluating...' : 'Submit Attempt'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!attemptId) return;
                  setEvaluationStatus('idle');
                  updateMutation.mutate(
                    { id: attemptId, input: { status: 'timed_out', submittedAt: new Date().toISOString() } },
                    {
                      onSuccess: () => {
                        setError(null);
                        setEvaluationStatus('evaluating');
                        evaluateMutation.mutate(attemptId, {
                          onSuccess: () => setEvaluationStatus('success'),
                          onError: (err) => {
                            setEvaluationStatus('error');
                            setError(`Auto-submit successful but evaluation failed: ${err.message}`);
                          },
                        });
                      },
                      onError: (err) => setError(err.message),
                    }
                  );
                }}
                disabled={attempt.status !== 'in_progress' || updateMutation.isPending || evaluateMutation.isPending}
                className="rounded bg-amber-900/50 px-4 py-2 text-xs text-amber-300 disabled:opacity-40 hover:bg-amber-900/70 transition-colors"
              >
                {updateMutation.isPending ? 'Submitting...' : evaluateMutation.isPending ? 'Evaluating...' : 'Auto Submit (Timeout)'}
              </button>
              {attempt.status === 'in_progress' && (
                <button
                  type="button"
                  onClick={() => {
                    if (!attemptId) return;
                    updateMutation.mutate(
                      { id: attemptId, input: { status: 'abandoned', submittedAt: new Date().toISOString() } },
                      { onError: (err) => setError(err.message) }
                    );
                  }}
                  disabled={updateMutation.isPending || evaluateMutation.isPending}
                  className="rounded bg-red-900/50 px-4 py-2 text-xs text-red-300 disabled:opacity-40 hover:bg-red-900/70 transition-colors"
                >
                  Force Submit (Abandon)
                </button>
              )}
            </div>

            {/* Evaluation status */}
            {evaluationStatus === 'evaluating' && (
              <div className="rounded border border-blue-700/50 bg-blue-950/30 px-4 py-2.5">
                <span className="text-xs text-blue-400">⏳ Evaluating attempt... (computing score, correct/incorrect/skipped)</span>
              </div>
            )}
            {evaluationStatus === 'success' && (
              <div className="rounded border border-green-700/50 bg-green-950/30 px-4 py-2.5">
                <span className="text-xs text-green-400">✓ Attempt evaluated successfully. View results in Evaluation or Result Summary.</span>
              </div>
            )}
            {evaluationStatus === 'error' && (
              <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
                <span className="text-xs text-red-400">⚠ Submission saved but evaluation encountered an error. Check the console for details.</span>
              </div>
            )}

            {/* Submission info */}
            {attempt.submittedAt && (
              <div className="border-t border-gray-700 pt-2 text-xs text-gray-500">
                <div>Submitted At: <span className="text-gray-300">{new Date(attempt.submittedAt).toLocaleString()}</span></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
