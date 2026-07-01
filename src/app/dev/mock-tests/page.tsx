'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import MockTestsPanel from '@/components/dev/mock-test/MockTestsPanel';
import type { MockTestsDebugInfo } from '@/components/dev/mock-test/MockTestsPanel';
import TestQuestionsPanel from '@/components/dev/mock-test/TestQuestionsPanel';
import type { TestQuestionsDebugInfo } from '@/components/dev/mock-test/TestQuestionsPanel';
import PublishWorkflowPanel from '@/components/dev/mock-test/PublishWorkflowPanel';
import type { PublishDebugInfo } from '@/components/dev/mock-test/PublishWorkflowPanel';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import SessionInfo from '@/components/dev/SessionInfo';

type MockTestEntity = 'dashboard' | 'mock-tests' | 'questions' | 'publish';

const ENTITY_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  'mock-tests': 'Mock Tests',
  questions: 'Test Questions',
  publish: 'Publish Workflow',
};

type AnyDebugInfo = MockTestsDebugInfo | TestQuestionsDebugInfo | PublishDebugInfo;

export default function MockTestsPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const [activeEntity, setActiveEntity] = useState<MockTestEntity>('dashboard');
  const [debugInfo, setDebugInfo] = useState<AnyDebugInfo | null>(null);

  const handleSelectEntity = useCallback((entity: string) => {
    setActiveEntity(entity as MockTestEntity);
    setDebugInfo(null);
  }, []);

  const handleDebugInfo = useCallback((info: AnyDebugInfo) => {
    setDebugInfo(info);
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
            <p className="text-xs text-gray-500 mt-0.5">Mock Tests — CRUD, question assignment, publish workflow</p>
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
              onClick={() => handleSelectEntity('mock-tests')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">📝</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Mock Tests</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    CRUD, filters, pagination, search, sorting, lifecycle (publish/archive/restore)
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('questions')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔗</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Test Questions</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Add, remove, update, bulk add, replace, reorder questions
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('publish')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">🚀</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Publish Workflow</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    11-point validation checklist, publish orchestration, unpublish with guard
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Panels ─────────────────────────────────────────────────────────── */}
      {activeEntity === 'mock-tests' && <MockTestsPanel onDebugInfo={handleDebugInfo} />}
      {activeEntity === 'questions' && <TestQuestionsPanel onDebugInfo={handleDebugInfo} />}
      {activeEntity === 'publish' && <PublishWorkflowPanel onDebugInfo={handleDebugInfo} />}

      {/* ── Debug Panel ───────────────────────────────────────────────────── */}
      <DebugPanel
        lastOperation={lastOperation}
        lastResponse={debugInfo?.lastApiResponse ?? undefined}
        info={[
          { label: 'Entity', value: ENTITY_LABELS[activeEntity] },
          { label: 'Loading', value: debugInfo ? String(debugInfo.loading) : '—' },
          { label: 'Mutation Loading', value: debugInfo ? String(debugInfo.mutationLoading) : '—' },
          { label: 'Selected Record', value: debugInfo?.selectedRecord ?? '—' },
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
