'use client';

import { useMockResultByAttempt, useMockAttempt, useMockAnswers } from '@/hooks/mockTest/useMockAttempts';
import StatusBadge from '@/components/dev/StatusBadge';

interface ResultSummaryPanelProps {
  attemptId: string | null;
}

export default function ResultSummaryPanel({ attemptId }: ResultSummaryPanelProps) {
  const { data: result, isLoading: resultLoading, refetch } = useMockResultByAttempt(attemptId);
  const { data: attempt } = useMockAttempt(attemptId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Result Summary</h2>
        <p className="text-xs text-gray-500 mt-0.5">Full result with question analysis and time breakdown</p>
      </div>

      {!attemptId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400">Select an attempt from the Attempts panel first.</span>
        </div>
      )}

      {attemptId && resultLoading && <div className="text-xs text-gray-500">Loading result...</div>}

      {attemptId && !result && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400">No result available for this attempt. Submit the attempt first.</span>
        </div>
      )}

      {attemptId && result && (
        <div className="space-y-3">
          {/* Header with refresh */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">Attempt: <span className="font-mono text-gray-300">{attemptId}</span></div>
            <button
              type="button"
              onClick={() => refetch().catch(() => {})}
              className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Refresh Result
            </button>
          </div>

          {/* Summary card */}
          <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
              <span className="text-xs font-semibold text-gray-200">Summary</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div><span className="text-gray-500">Attempt ID:</span> <span className="font-mono text-gray-300">{result.attemptId}</span></div>
                <div><span className="text-gray-500">Test ID:</span> <span className="font-mono text-gray-300">{result.testId}</span></div>
                <div><span className="text-gray-500">Student:</span> <span className="font-mono text-gray-300">{result.studentId}</span></div>
                <div><span className="text-gray-500">Institute:</span> <span className="font-mono text-gray-300">{result.instituteId}</span></div>
              </div>
            </div>
          </div>

          {/* Score */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded border border-gray-700 bg-gray-900 p-3 text-center">
              <div className="text-2xl font-bold text-gray-100">{result.totalScore}</div>
              <div className="text-[10px] text-gray-500 uppercase mt-1">Score</div>
            </div>
            <div className="rounded border border-gray-700 bg-gray-900 p-3 text-center">
              <div className="text-2xl font-bold text-gray-100">{result.maxScore}</div>
              <div className="text-[10px] text-gray-500 uppercase mt-1">Passing Marks</div>
            </div>
            <div className="rounded border border-gray-700 bg-gray-900 p-3 text-center">
              <div className="text-2xl font-bold text-gray-100">{result.percentage.toFixed(1)}%</div>
              <div className="text-[10px] text-gray-500 uppercase mt-1">Percentage</div>
            </div>
          </div>

          {/* Result verdict */}
          <div className="text-center">
            {result.percentage >= 40 ? (
              <StatusBadge label="PASSED" variant="success" />
            ) : (
              <StatusBadge label="FAILED" variant="error" />
            )}
          </div>

          {/* Question Analysis */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded border border-green-700/50 bg-green-950/20 p-3 text-center">
              <div className="text-lg font-bold text-green-400">{result.correctCount}</div>
              <div className="text-[10px] text-green-500 uppercase">Correct</div>
            </div>
            <div className="rounded border border-red-700/50 bg-red-950/20 p-3 text-center">
              <div className="text-lg font-bold text-red-400">{result.wrongCount}</div>
              <div className="text-[10px] text-red-500 uppercase">Wrong</div>
            </div>
            <div className="rounded border border-gray-700 bg-gray-800/30 p-3 text-center">
              <div className="text-lg font-bold text-gray-400">{result.skippedCount}</div>
              <div className="text-[10px] text-gray-500 uppercase">Skipped</div>
            </div>
          </div>

          {/* Time Analysis */}
          <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
              <span className="text-xs font-semibold text-gray-200">Time Analysis</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div><span className="text-gray-500">Total Time:</span> <span className="text-gray-200">{result.totalTimeSeconds}s ({Math.round(result.totalTimeSeconds / 60)}m {result.totalTimeSeconds % 60}s)</span></div>
                <div><span className="text-gray-500">Avg Time/Question:</span> <span className="text-gray-200">{result.avgTimePerQuestion.toFixed(1)}s</span></div>
              </div>
            </div>
          </div>

          {/* Topic Analysis */}
          {result.chapterBreakdown && result.chapterBreakdown.length > 0 && (
            <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                <span className="text-xs font-semibold text-gray-200">Topic Analysis</span>
              </div>
              <div className="p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-500 text-[10px] uppercase">
                      <th className="text-left px-2 py-1">Chapter</th>
                      <th className="text-right px-2 py-1">Correct</th>
                      <th className="text-right px-2 py-1">Wrong</th>
                      <th className="text-right px-2 py-1">Skipped</th>
                      <th className="text-right px-2 py-1">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.chapterBreakdown.map((cb) => (
                      <tr key={cb.chapterId} className="border-b border-gray-800">
                        <td className="px-2 py-1.5 text-gray-300">{cb.chapterName}</td>
                        <td className="px-2 py-1.5 text-right text-green-400">{cb.correct}</td>
                        <td className="px-2 py-1.5 text-right text-red-400">{cb.wrong}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500">{cb.skipped}</td>
                        <td className="px-2 py-1.5 text-right text-gray-200 font-medium">{cb.score}/{cb.maxScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result metadata */}
          <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
              <span className="text-xs font-semibold text-gray-200">Result Metadata</span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div><span className="text-gray-500">Rank:</span> <span className="text-gray-200">{result.rank ?? '—'}</span></div>
                <div><span className="text-gray-500">Percentile:</span> <span className="text-gray-200">{result.percentile !== null ? `${result.percentile.toFixed(1)}%` : '—'}</span></div>
                <div><span className="text-gray-500">Released:</span>{' '}
                  <StatusBadge label={result.isReleased ? 'Yes' : 'No'} variant={result.isReleased ? 'success' : 'warning'} />
                </div>
                <div><span className="text-gray-500">Generated:</span> <span className="text-gray-200">{new Date(result.generatedAt).toLocaleString()}</span></div>
                <div><span className="text-gray-500">Released At:</span> <span className="text-gray-200">{result.releasedAt ? new Date(result.releasedAt).toLocaleString() : '—'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
