import SectionCard from '@/components/dev/SectionCard';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import SessionInfo from '@/components/dev/SessionInfo';

export const metadata = { title: 'Settings — Dev Console' };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Settings</h1>
        <p className="text-xs text-gray-500 mt-1">Institute configuration, environment info, console preferences</p>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge label="Placeholder" variant="warning" />
        <span className="text-xs text-gray-600">Module not yet implemented</span>
      </div>

      <SectionCard title="Environment Info" description="Current runtime configuration">
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-500">Runtime</span>
            <span className="text-gray-300 font-mono">{typeof window !== 'undefined' ? 'client' : 'server'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-500">Node Env</span>
            <span className="text-gray-300 font-mono">{process.env.NODE_ENV}</span>
          </div>
          <div className="flex items-center justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-500">Supabase URL</span>
            <span className="text-gray-300 font-mono">{process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'not set'}</span>
          </div>
          <div className="flex items-center justify-between pb-1">
            <span className="text-gray-500">Console Version</span>
            <span className="text-gray-300 font-mono">v0.1.0-dev</span>
          </div>
        </div>
      </SectionCard>

      <div className="border-t border-gray-700/50 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Session</div>
        <SessionInfo />
      </div>

      <DebugPanel lastOperation="Module page loaded" info={[{ label: 'Module', value: 'settings' }]} />
    </div>
  );
}
