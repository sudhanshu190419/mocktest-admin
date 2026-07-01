'use client';

import { useCallback, useEffect } from 'react';
import { useMockResultByAttempt, useMockAttempt, useMockAnswers } from '@/hooks/mockTest/useMockAttempts';
import StatusBadge from '@/components/dev/StatusBadge';

interface EvaluationPanelProps {
  attemptId: string | null;
}

export default function EvaluationPanel({ attemptId }: EvaluationPanelProps) {
  const { data: result, isLoading: resultLoading, refetch } = useMockResultByAttempt(attemptId);
  const { data: attempt } = useMockAttempt(attemptId);
  const { data: answers } = useMockAnswers(attemptId);

  // ── Logging for debugging ──────────────────────────────────────────────
  useEffect(() => {
    console.log('Evaluation Query Result:', result ?? null);
    console.log('Attempt ID:', attemptId);
  }, [result, attemptId]);

  const totalTimeSeconds = answers?.reduce((sum, a) => sum + a.timeSpentSeconds, 0) ?? 0;
  const correctCount = answers?.filter((a) => a.isCorrect === true).length ?? 0;
  const wrongCount = answers?.filter((a) => a.isCorrect === false).length ?? 0;
  const skippedCount = answers?.filter((a) => a.isAnswered === false).length ?? 0;

  const handleRefresh = useCallback(() => {
    refetch().catch(() => {});
  }, [refetch]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Evaluation</h2>
        <p className="text-xs text-gray-500 mt-0.5">Score breakdown, correct/incorrect/skipped, time analysis</p>
      </div>

      {!attemptId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400">Select an attempt from the Attempts panel first.</span>
        </div>
      )}

      {attemptId && resultLoading && <div className="text-xs text-gray-500">Loading evaluation...</div>}

      {attemptId && resultLoading && <div className="text-xs text-gray-500">Loading evaluation...</div>}

      {attemptId && !resultLoading && !result && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-400">No evaluation result yet. Submit the attempt to trigger evaluation.</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {attemptId && result && (
        <div className="space-y-3">
          {/* Score card */}
          <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
              <span className="text-xs font-semibold text-gray-200">Score Overview</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="rounded border border-green-700/50 bg-green-950/20 px-3 py-2">
                  <div className="text-lg font-bold text-green-400">{correctCount}</div>
                  <div className="text-[10px] text-green-500 uppercase">Correct</div>
                </div>
                <div className="rounded border border-red-700/50 bg-red-950/20 px-3 py-2">
                  <div className="text-lg font-bold text-red-400">{wrongCount}</div>
                  <div className="text-[10px] text-red-500 uppercase">Incorrect</div>
                </div>
                <div className="rounded border border-gray-700 bg-gray-800/30 px-3 py-2">
                  <div className="text-lg font-bold text-gray-400">{skippedCount}</div>
                  <div className="text-[10px] text-gray-500 uppercase">Skipped</div>
                </div>
                <div className="rounded border border-blue-700/50 bg-blue-950/20 px-3 py-2">
                  <div className="text-lg font-bold text-blue-400">{result.totalScore}</div>
                  <div className="text-[10px] text-blue-500 uppercase">Score</div>
                </div>
              </div>
            </div>
          </div>

          {/* Result details */}
          <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
              <span className="text-xs font-semibold text-gray-200">Result Details</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div><span className="text-gray-500">Total Score:</span> <span className="text-gray-200 font-semibold">{result.totalScore}</span></div>
                <div><span className="text-gray-500">Max Score:</span> <span className="text-gray-200">{result.maxScore}</span></div>
                <div><span className="text-gray-500">Percentage:</span> <span className="text-gray-200">{result.percentage.toFixed(2)}%</span></div>
                <div><span className="text-gray-500">Passing:</span> {result.percentage >= 40 ? <StatusBadge label="PASS" variant="success" /> : <StatusBadge label="FAIL" variant="error" />}</div>
                <div><span className="text-gray-500">Rank:</span> <span className="text-gray-200">{result.rank ?? 'Not ranked'}</span></div>
                <div><span className="text-gray-500">Percentile:</span> <span className="text-gray-200">{result.percentile !== null ? `${result.percentile.toFixed(1)}%` : '—'}</span></div>
                <div><span className="text-gray-500">Correct:</span> <span className="text-green-400">{result.correctCount}</span></div>
                <div><span className="text-gray-500">Wrong:</span> <span className="text-red-400">{result.wrongCount}</span></div>
                <div><span className="text-gray-500">Skipped:</span> <span className="text-gray-400">{result.skippedCount}</span></div>
                <div><span className="text-gray-500">Time Taken:</span> <span className="text-gray-200">{totalTimeSeconds}s ({Math.round(totalTimeSeconds / 60)}m)</span></div>
                <div><span className="text-gray-500">Released:</span>{' '}
                  <StatusBadge label={result.isReleased ? 'Released' : 'Pending'} variant={result.isReleased ? 'success' : 'warning'} />
                </div>
                <div><span className="text-gray-500">Generated:</span> <span className="text-gray-200">{new Date(result.generatedAt).toLocaleString()}</span></div>
              </div>
            </div>
          </div>

          {/* Subject/Chapter Breakdown */}
          {result.subjectBreakdown && result.subjectBreakdown.length > 0 && (
            <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                <span className="text-xs font-semibold text-gray-200">Subject Breakdown</span>
              </div>
              <div className="p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-500 text-[10px] uppercase">
                      <th className="text-left px-2 py-1">Subject</th>
                      <th className="text-right px-2 py-1">Correct</th>
                      <th className="text-right px-2 py-1">Wrong</th>
                      <th className="text-right px-2 py-1">Skipped</th>
                      <th className="text-right px-2 py-1">Score</th>
                      <th className="text-right px-2 py-1">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.subjectBreakdown.map((sb) => (
                      <tr key={sb.subjectId} className="border-b border-gray-800">
                        <td className="px-2 py-1.5 text-gray-300">{sb.subjectName}</td>
                        <td className="px-2 py-1.5 text-right text-green-400">{sb.correct}</td>
                        <td className="px-2 py-1.5 text-right text-red-400">{sb.wrong}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{sb.skipped}</td>
                        <td className="px-2 py-1.5 text-right text-gray-200 font-medium">{sb.score}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{sb.maxScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
