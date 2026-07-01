'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import AnalyticsPanel from '@/components/dev/analytics/AnalyticsPanel';
import type { AnalyticsDebugInfo } from '@/components/dev/analytics/AnalyticsPanel';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import SessionInfo from '@/components/dev/SessionInfo';

type AnyDebugInfo = AnalyticsDebugInfo;

export default function AnalyticsPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const [debugInfo, setDebugInfo] = useState<AnyDebugInfo | null>(null);

  const handleDebugInfo = useCallback((info: AnyDebugInfo) => {
    setDebugInfo(info);
  }, []);

  const lastOperation = debugInfo ? debugInfo.lastHookCalled : 'Analytics view';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-100">Analytics</h1>
            <p className="text-xs text-gray-500 mt-0.5">Analytics Engine — student, teacher, institute, mock test analytics</p>
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

      <AnalyticsPanel onDebugInfo={handleDebugInfo} />

      <DebugPanel
        lastOperation={lastOperation}
        lastResponse={debugInfo?.lastApiResponse ?? undefined}
        info={[
          { label: 'Loading', value: debugInfo ? String(debugInfo.loading) : '—' },
          { label: 'Mutation Loading', value: debugInfo ? String(debugInfo.mutationLoading) : '—' },
          { label: 'Selected Entity', value: debugInfo?.selectedEntity ?? '—' },
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
