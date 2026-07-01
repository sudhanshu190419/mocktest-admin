'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import AttemptsPanel from '@/components/dev/attempt/AttemptsPanel';
import type { AttemptsDebugInfo } from '@/components/dev/attempt/AttemptsPanel';
import QuestionNavPanel from '@/components/dev/attempt/QuestionNavPanel';
import ResponsesPanel from '@/components/dev/attempt/ResponsesPanel';
import AutoSavePanel from '@/components/dev/attempt/AutoSavePanel';
import SubmitPanel from '@/components/dev/attempt/SubmitPanel';
import EvaluationPanel from '@/components/dev/attempt/EvaluationPanel';
import ResultSummaryPanel from '@/components/dev/attempt/ResultSummaryPanel';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import SessionInfo from '@/components/dev/SessionInfo';

type AttemptEntity = 'dashboard' | 'attempts' | 'navigation' | 'responses' | 'autosave' | 'submit' | 'evaluation' | 'results';

const ENTITY_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  attempts: 'Attempts',
  navigation: 'Question Navigation',
  responses: 'Responses',
  autosave: 'Auto Save',
  submit: 'Submit Attempt',
  evaluation: 'Evaluation',
  results: 'Result Summary',
};

type AnyDebugInfo = AttemptsDebugInfo;

export default function AttemptsPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const [activeEntity, setActiveEntity] = useState<AttemptEntity>('dashboard');
  const [debugInfo, setDebugInfo] = useState<AnyDebugInfo | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);

  const handleSelectEntity = useCallback((entity: string) => {
    setActiveEntity(entity as AttemptEntity);
    setDebugInfo(null);
  }, []);

  const handleDebugInfo = useCallback((info: AnyDebugInfo) => {
    setDebugInfo(info);
    if (info.selectedRecord) {
      setSelectedAttemptId(info.selectedRecord);
    }
  }, []);

  const lastOperation = debugInfo ? debugInfo.lastHookCalled : (ENTITY_LABELS[activeEntity] + ' view');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {activeEntity !== 'dashboard' && (
            <button
              type="button"
              onClick={() => handleSelectEntity('dashboard')}
              className="rounded bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            >
              ← Back
            </button>
          )}
          <div>
            <h1 className="text-lg font-semibold text-gray-100">{ENTITY_LABELS[activeEntity]}</h1>
            <p className="text-xs text-gray-500 mt-0.5">Attempt Engine — start, track, submit, evaluate, review</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {authLoading && <LoadingIndicator label="Auth..." />}
          <StatusBadge
            label={isAuthenticated ? 'Auth: ' + (user?.name ?? 'User') : 'Unauthenticated'}
            variant={isAuthenticated ? 'success' : 'warning'}
          />
        </div>
      </div>

      <SessionInfo />

      {/* ── Dashboard ──────────────────────────────────────────────────────── */}
      {activeEntity === 'dashboard' && (
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleSelectEntity('attempts')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔄</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Attempts</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    List, create, start, resume, pause, delete, status transitions
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('navigation')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">🧭</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Question Navigation</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Next/prev, jump, mark for review, question palette
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('responses')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">✏️</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Responses</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Save/update/clear responses, MCQ, MSQ, Numerical, True/False
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('autosave')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">💾</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Auto Save</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Manual save trigger, pending queue, retry failed saves
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('submit')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">🚀</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Submit Attempt</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Validate, submit, auto-submit (timeout), force submit (abandon)
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('evaluation')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">📊</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Evaluation</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Score breakdown, correct/incorrect/skipped, time analysis
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('results')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">📋</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Result Summary</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Full result, question analysis, topic analysis, time breakdown
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Panels ─────────────────────────────────────────────────────────── */}
      {activeEntity === 'attempts' && <AttemptsPanel onDebugInfo={handleDebugInfo} />}
      {activeEntity === 'navigation' && <QuestionNavPanel attemptId={selectedAttemptId} />}
      {activeEntity === 'responses' && <ResponsesPanel attemptId={selectedAttemptId} />}
      {activeEntity === 'autosave' && <AutoSavePanel attemptId={selectedAttemptId} />}
      {activeEntity === 'submit' && <SubmitPanel attemptId={selectedAttemptId} />}
      {activeEntity === 'evaluation' && <EvaluationPanel attemptId={selectedAttemptId} />}
      {activeEntity === 'results' && <ResultSummaryPanel attemptId={selectedAttemptId} />}

      {/* ── Debug Panel ───────────────────────────────────────────────────── */}
      <DebugPanel
        lastOperation={lastOperation}
        lastResponse={debugInfo?.lastApiResponse ?? undefined}
        info={[
          { label: 'Entity', value: ENTITY_LABELS[activeEntity] },
          { label: 'Loading', value: debugInfo ? String(debugInfo.loading) : '—' },
          { label: 'Mutation Loading', value: debugInfo ? String(debugInfo.mutationLoading) : '—' },
          { label: 'Selected Attempt', value: debugInfo?.selectedRecord ?? '—' },
          { label: 'Cache Status', value: debugInfo?.cacheStatus ?? '—' },
          { label: 'Query Status', value: debugInfo?.queryStatus ?? '—' },
          { label: 'Last Hook', value: debugInfo?.lastHookCalled ?? '—' },
          { label: 'Error', value: debugInfo?.errorMessage ?? '—' },
          { label: 'User ID', value: user?.id ?? '—' },
          { label: 'Institute ID', value: user?.instituteId ?? '—' },
          { label: 'User Role', value: user?.role ?? '—' },
        ]}
      />
    </div>
  );
}