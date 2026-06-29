'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import AcademicDashboard from '@/components/dev/academic/AcademicDashboard';
import StreamPanel from '@/components/dev/academic/StreamPanel';
import type { StreamDebugInfo } from '@/components/dev/academic/StreamPanel';
import SubjectPanel from '@/components/dev/academic/SubjectPanel';
import type { SubjectDebugInfo } from '@/components/dev/academic/SubjectPanel';
import ChapterPanel from '@/components/dev/academic/ChapterPanel';
import type { ChapterDebugInfo } from '@/components/dev/academic/ChapterPanel';
import TopicPanel from '@/components/dev/academic/TopicPanel';
import type { TopicDebugInfo } from '@/components/dev/academic/TopicPanel';
import BatchPanel from '@/components/dev/academic/BatchPanel';
import type { BatchDebugInfo } from '@/components/dev/academic/BatchPanel';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import SessionInfo from '@/components/dev/SessionInfo';

type AcademicEntity = 'dashboard' | 'streams' | 'subjects' | 'chapters' | 'topics' | 'batches';

const ENTITY_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  streams: 'Streams',
  subjects: 'Subjects',
  chapters: 'Chapters',
  topics: 'Topics',
  batches: 'Batches',
};

type AnyDebugInfo = StreamDebugInfo | SubjectDebugInfo | ChapterDebugInfo | TopicDebugInfo | BatchDebugInfo;

export default function AcademicPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const [activeEntity, setActiveEntity] = useState<AcademicEntity>('dashboard');
  const [debugInfo, setDebugInfo] = useState<AnyDebugInfo | null>(null);

  const handleSelectEntity = useCallback((entity: string) => {
    setActiveEntity(entity as AcademicEntity);
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
            <p className="text-xs text-gray-500 mt-0.5">Academic structure &amp; batch management</p>
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

      {activeEntity === 'dashboard' && <AcademicDashboard onSelectEntity={handleSelectEntity} />}
      {activeEntity === 'streams' && <StreamPanel onDebugInfo={handleDebugInfo} />}
      {activeEntity === 'subjects' && <SubjectPanel onDebugInfo={handleDebugInfo} />}
      {activeEntity === 'chapters' && <ChapterPanel onDebugInfo={handleDebugInfo} />}
      {activeEntity === 'topics' && <TopicPanel onDebugInfo={handleDebugInfo} />}
      {activeEntity === 'batches' && <BatchPanel onDebugInfo={handleDebugInfo} />}

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
