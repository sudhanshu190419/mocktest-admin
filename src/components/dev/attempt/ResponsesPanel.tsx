'use client';

import { useState, useCallback } from 'react';
import {
  useMockAnswers,
  useUpdateMockAnswer,
  useMockAnswerOptions,
  useCreateMockAnswerOption,
  useDeleteMockAnswerOption,
} from '@/hooks/mockTest/useMockAttempts';

interface ResponsesPanelProps {
  attemptId: string | null;
}

export default function ResponsesPanel({ attemptId }: ResponsesPanelProps) {
  const { data: answers, isLoading } = useMockAnswers(attemptId);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [numericalInput, setNumericalInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentAnswer = answers && answers.length > 0 ? answers[currentIndex] : null;
  const { data: answerOptions } = useMockAnswerOptions(currentAnswer?.answerId ?? null);

  const updateMutation = useUpdateMockAnswer();
  const createOptionMutation = useCreateMockAnswerOption();
  const deleteOptionMutation = useDeleteMockAnswerOption();

  const handleSaveMCQ = useCallback((optionId: string) => {
    if (!currentAnswer) return;
    // For MCQ: clear existing options first, then add new one
    // First update isAnswered, then handle options via separate mutation
    updateMutation.mutate(
      { id: currentAnswer.answerId, input: { isAnswered: true, answeredAt: new Date().toISOString(), timeSpentSeconds: currentAnswer.timeSpentSeconds } },
      { onError: (err) => setError(err.message) }
    );
  }, [currentAnswer, updateMutation]);

  const handleSaveNumerical = useCallback(() => {
    if (!currentAnswer || !numericalInput) return;
    const numVal = parseFloat(numericalInput);
    if (isNaN(numVal)) { setError('Invalid numerical value'); return; }
    updateMutation.mutate(
      {
        id: currentAnswer.answerId,
        input: { isAnswered: true, numericalAnswer: numVal, answeredAt: new Date().toISOString(), timeSpentSeconds: currentAnswer.timeSpentSeconds },
      },
      {
        onSuccess: () => setNumericalInput(''),
        onError: (err) => setError(err.message),
      }
    );
  }, [currentAnswer, numericalInput, updateMutation]);

  const handleClearResponse = useCallback(() => {
    if (!currentAnswer) return;
    updateMutation.mutate(
      { id: currentAnswer.answerId, input: { isAnswered: false, numericalAnswer: null, answeredAt: null } },
      { onError: (err) => setError(err.message) }
    );
  }, [currentAnswer, updateMutation]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Responses</h2>
        <p className="text-xs text-gray-500 mt-0.5">Save, update, clear responses per question</p>
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

      {attemptId && isLoading && <div className="text-xs text-gray-500">Loading responses...</div>}

      {attemptId && answers && answers.length > 0 && (
        <>
          {/* Question selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Question:</span>
            <select
              value={currentIndex}
              onChange={(e) => { setCurrentIndex(Number(e.target.value)); setNumericalInput(''); setError(null); }}
              className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200"
            >
              {answers.map((ans, idx) => (
                <option key={ans.answerId} value={idx}>
                  Q{idx + 1} — {ans.questionId.slice(0, 8)} ({ans.isAnswered ? 'Answered' : 'Pending'})
                </option>
              ))}
            </select>
          </div>

          {currentAnswer && (
            <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                <span className="text-xs font-semibold text-gray-200">Question: {currentAnswer.questionId}</span>
              </div>
              <div className="p-4 space-y-3">
                {/* Info */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><span className="text-gray-500">Answer ID:</span> <span className="font-mono">{currentAnswer.answerId}</span></div>
                  <div><span className="text-gray-500">Response Status:</span>{' '}
                    <span className={currentAnswer.isAnswered ? 'text-green-400' : 'text-gray-500'}>
                      {currentAnswer.isAnswered ? 'Saved' : 'Not Answered'}
                    </span>
                  </div>
                  <div><span className="text-gray-500">Marked for Review:</span> {currentAnswer.isMarkedForReview ? 'Yes ⚑' : 'No'}</div>
                  <div><span className="text-gray-500">Time Spent:</span> {currentAnswer.timeSpentSeconds}s</div>
                  {currentAnswer.isAnswered && currentAnswer.answeredAt && (
                    <div><span className="text-gray-500">Saved At:</span> {new Date(currentAnswer.answeredAt).toLocaleTimeString()}</div>
                  )}
                  {currentAnswer.numericalAnswer !== null && (
                    <div><span className="text-gray-500">Numerical Answer:</span> {currentAnswer.numericalAnswer}</div>
                  )}
                </div>

                {/* Current selected options */}
                {answerOptions && answerOptions.length > 0 && (
                  <div>
                    <span className="text-xs text-gray-500">Selected Options:</span>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {answerOptions.map((opt) => (
                        <span key={opt.answerOptionId} className="inline-flex items-center gap-1 rounded bg-blue-900/30 border border-blue-700/50 px-2 py-0.5 text-[10px] text-blue-300">
                          {opt.optionId.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 border-t border-gray-700 pt-3">
                  <button type="button" onClick={() => handleSaveMCQ('mock-option-id')} className="rounded bg-blue-800/50 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-800/70 transition-colors">Save MCQ</button>
                  <button type="button" onClick={() => handleSaveMCQ('mock-option-id')} className="rounded bg-purple-800/50 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-800/70 transition-colors">Save MSQ</button>
                  <button type="button" onClick={() => handleSaveMCQ('mock-option-id')} className="rounded bg-indigo-800/50 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-800/70 transition-colors">Save True/False</button>
                </div>

                {/* Numerical input */}
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500">Numerical Answer</label>
                    <input type="number" value={numericalInput} onChange={(e) => setNumericalInput(e.target.value)} step="any" placeholder="Enter value" className="w-40 rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
                  </div>
                  <button type="button" onClick={handleSaveNumerical} disabled={!numericalInput} className="rounded bg-cyan-800/50 px-3 py-1.5 text-xs text-cyan-300 disabled:opacity-40">Save Numerical</button>
                </div>

                {/* Clear */}
                <div className="flex gap-2 border-t border-gray-700 pt-3">
                  <button type="button" onClick={handleClearResponse} disabled={!currentAnswer.isAnswered} className="rounded bg-red-900/50 px-3 py-1.5 text-xs text-red-300 disabled:opacity-40">Clear Response</button>
                  <button type="button" onClick={() => updateMutation.mutate({ id: currentAnswer.answerId, input: { timeSpentSeconds: currentAnswer.timeSpentSeconds + 5 } })} className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300">Increment Time</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {attemptId && answers && answers.length === 0 && (
        <div className="text-xs text-gray-500">No answers found for this attempt.</div>
      )}
    </div>
  );
}
