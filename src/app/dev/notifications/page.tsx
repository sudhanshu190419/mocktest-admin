'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import NotificationsPanel from '@/components/dev/notifications/NotificationsPanel';
import type { NotificationsDebugInfo } from '@/components/dev/notifications/NotificationsPanel';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import SessionInfo from '@/components/dev/SessionInfo';

type NotificationEntity = 'dashboard' | 'notifications';

const ENTITY_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  notifications: 'Notifications Console',
};

export default function NotificationsPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  const [activeEntity, setActiveEntity] = useState<NotificationEntity>('dashboard');
  const [debugInfo, setDebugInfo] = useState<NotificationsDebugInfo | null>(null);

  const handleSelectEntity = useCallback((entity: string) => {
    setActiveEntity(entity as NotificationEntity);
    setDebugInfo(null);
  }, []);

  const handleDebugInfo = useCallback((info: NotificationsDebugInfo) => {
    setDebugInfo(info);
  }, []);

  const lastOperation = debugInfo ? debugInfo.lastHookCalled : (ENTITY_LABELS[activeEntity] + ' view');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-100">Notifications</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Notification Engine — create, read, mark, delete, announce
            </p>
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
              onClick={() => handleSelectEntity('notifications')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔔</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Notifications Console</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    All notifications, unread, create, bulk, mark read, delete, filters, pagination
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('notifications')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">📢</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Announcements</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    List, publish, target by role, filters
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('notifications')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">✉️</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Create Notification</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Single notification, bulk send, custom types, priorities
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectEntity('notifications')}
              className="rounded-lg border border-gray-700 bg-gray-900 p-4 hover:border-gray-500 hover:bg-gray-800 transition-colors text-left"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">📋</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-100">Dashboard</h3>
                  <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
                    Stats: total, unread, read, announcements, today, high priority
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Notifications Console ─────────────────────────────────────────── */}
      {activeEntity === 'notifications' && <NotificationsPanel onDebugInfo={handleDebugInfo} />}

      {/* ── Debug Panel ───────────────────────────────────────────────────── */}
      <DebugPanel
        lastOperation={lastOperation}
        lastResponse={debugInfo?.lastApiResponse ?? undefined}
        info={[
          { label: 'Entity', value: 'Notifications' },
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
