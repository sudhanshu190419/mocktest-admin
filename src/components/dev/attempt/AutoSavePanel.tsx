'use client';

import { useState, useCallback } from 'react';
import { useMockAnswers, useUpdateMockAnswer, useMockAttempt } from '@/hooks/mockTest/useMockAttempts';

interface AutoSavePanelProps {
  attemptId: string | null;
}

export default function AutoSavePanel({ attemptId }: AutoSavePanelProps) {
  const { data: answers, isLoading } = useMockAnswers(attemptId);
  const { data: attempt } = useMockAttempt(attemptId);
  const updateMutation = useUpdateMockAnswer();

  const [saveStatus, setSaveStatus] = useState<string>('idle');
  const [retryCount, setRetryCount] = useState(0);

  const pendingSaves = answers?.filter((a) => !a.isAnswered) ?? [];
  const savedCount = answers?.filter((a) => a.isAnswered).length ?? 0;

  const handleManualAutoSave = useCallback(() => {
    if (!answers || answers.length === 0) return;
    setSaveStatus('saving...');
    let completed = 0;

    answers.forEach((answer) => {
      updateMutation.mutate(
        { id: answer.answerId, input: { timeSpentSeconds: answer.timeSpentSeconds + 1 } },
        {
          onSuccess: () => {
            completed++;
            if (completed === answers.length) {
              setSaveStatus(`saved at ${new Date().toLocaleTimeString()}`);
              setRetryCount(0);
            }
          },
          onError: () => {
            setRetryCount((c) => c + 1);
            setSaveStatus('save failed');
          },
        }
      );
    });
  }, [answers, updateMutation]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Auto Save</h2>
        <p className="text-xs text-gray-500 mt-0.5">Manual save trigger, track pending and failed saves</p>
      </div>

      {!attemptId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400">Select an attempt from the Attempts panel first.</span>
        </div>
      )}

      {attemptId && isLoading && <div className="text-xs text-gray-500">Loading...</div>}

      {attemptId && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="p-4 space-y-3">
            {/* Status */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-gray-500">Last Save Time:</span>
                <div className="mt-0.5 font-mono text-gray-300">
                  {saveStatus === 'idle' ? '—' : saveStatus}
                </div>
              </div>
              <div>
                <span className="text-gray-500">Save Status:</span>
                <div className="mt-0.5">
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border ${
                    saveStatus === 'saved' || saveStatus.includes('saved')
                      ? 'bg-green-950/50 text-green-400 border-green-700/50'
                      : saveStatus === 'saving...'
                        ? 'bg-blue-950/50 text-blue-400 border-blue-700/50'
                        : saveStatus === 'save failed'
                          ? 'bg-red-950/50 text-red-400 border-red-700/50'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                  }`}>
                    {saveStatus === 'idle' ? 'Idle' : saveStatus}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-gray-500">Pending Queue:</span>
                <div className="mt-0.5 text-gray-300">{pendingSaves.length} unanswered</div>
              </div>
              <div>
                <span className="text-gray-500">Saved Count:</span>
                <div className="mt-0.5 text-green-400">{savedCount}/{answers?.length ?? 0}</div>
              </div>
              <div>
                <span className="text-gray-500">Retry Count:</span>
                <div className="mt-0.5 text-gray-300">{retryCount}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 border-t border-gray-700 pt-3">
              <button
                type="button"
                onClick={handleManualAutoSave}
                disabled={updateMutation.isPending || !answers}
                className="rounded bg-blue-800/50 px-4 py-2 text-xs text-blue-300 disabled:opacity-40 hover:bg-blue-800/70 transition-colors"
              >
                {updateMutation.isPending ? 'Saving...' : 'Manual Auto Save'}
              </button>
              {retryCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setSaveStatus('idle'); setRetryCount(0); }}
                  className="rounded bg-amber-800/50 px-3 py-2 text-xs text-amber-300 hover:bg-amber-800/70 transition-colors"
                >
                  Retry Failed ({retryCount})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
