'use client';

import { useState } from 'react';
import ContentDashboard from '@/components/dev/content/ContentDashboard';
import ContentPanel from '@/components/dev/content/ContentPanel';
import TagsPanel from '@/components/dev/content/TagsPanel';
import ApprovalPanel from '@/components/dev/content/ApprovalPanel';
import StorageInspector from '@/components/dev/content/StorageInspector';
import DebugPanel from '@/components/dev/DebugPanel';
import SessionInfo from '@/components/dev/SessionInfo';
import type { ContentDebugInfo } from '@/components/dev/content/ContentPanel';
import type { TagsDebugInfo } from '@/components/dev/content/TagsPanel';
import type { ApprovalDebugInfo } from '@/components/dev/content/ApprovalPanel';
import type { StorageDebugInfo } from '@/components/dev/content/StorageInspector';

type PanelId = 'content' | 'tags' | 'approvals' | 'storage' | null;

export default function ContentPage() {
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null);

  const handleBack = () => {
    setActivePanel(null);
    setDebugInfo(null);
  };

  const onDebugInfo = (info: ContentDebugInfo | TagsDebugInfo | ApprovalDebugInfo | StorageDebugInfo) => {
    setDebugInfo(info as unknown as Record<string, unknown>);
  };

  const panelTitle = activePanel
    ? { content: 'Content', tags: 'Tags', approvals: 'Approval Requests', storage: 'Storage Inspector' }[activePanel]
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Content Module</h1>
          <p className="text-xs text-gray-500 mt-1">
            Content CRUD, tags, approval workflow, lifecycle management, storage operations
          </p>
        </div>
        <SessionInfo />
      </div>

      {activePanel && (
        <button
          onClick={handleBack}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          &larr; Back to Dashboard
        </button>
      )}

      {activePanel === null && (
        <ContentDashboard activePanel={activePanel} onSelect={(p) => setActivePanel(p as PanelId)} />
      )}

      {activePanel === 'content' && <ContentPanel onDebugInfo={onDebugInfo} />}
      {activePanel === 'tags' && <TagsPanel onDebugInfo={onDebugInfo} />}
      {activePanel === 'approvals' && <ApprovalPanel onDebugInfo={onDebugInfo} />}
      {activePanel === 'storage' && <StorageInspector onDebugInfo={onDebugInfo} />}

      <div className="border-t border-gray-700/50 pt-4">
        <DebugPanel
          lastOperation={activePanel ? panelTitle + ' panel active' : 'Dashboard'}
          info={[
            { label: 'Panel', value: activePanel ?? 'Dashboard' },
            ...(debugInfo
              ? Object.entries(debugInfo).map(([k, v]) => ({
                  label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
                  value: v === null || v === undefined ? '—' : String(v),
                }))
              : []),
          ]}
        />
      </div>
    </div>
  );
}
