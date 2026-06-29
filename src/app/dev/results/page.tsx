import SectionCard from '@/components/dev/SectionCard';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import SessionInfo from '@/components/dev/SessionInfo';

export const metadata = { title: 'Results — Dev Console' };

export default function ResultsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Results</h1>
        <p className="text-xs text-gray-500 mt-1">Result computation, scoring, rank/percentile, breakdowns</p>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge label="Placeholder" variant="warning" />
        <span className="text-xs text-gray-600">Module not yet implemented</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard title="Results" description="Computed result records">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getMockResults, getMockResultById</li>
            <li>createMockResult, updateMockResult</li>
            <li>Result release workflow</li>
          </ul>
        </SectionCard>
        <SectionCard title="Breakdowns" description="Per-subject and per-chapter analytics">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>Subject breakdown aggregation</li>
            <li>Chapter breakdown aggregation</li>
            <li>Rank and percentile computation</li>
          </ul>
        </SectionCard>
      </div>

      <div className="border-t border-gray-700/50 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Session</div>
        <SessionInfo />
      </div>

      <DebugPanel lastOperation="Module page loaded" info={[{ label: 'Module', value: 'results' }]} />
    </div>
  );
}
