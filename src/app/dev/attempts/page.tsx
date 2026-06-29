import SectionCard from '@/components/dev/SectionCard';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import SessionInfo from '@/components/dev/SessionInfo';

export const metadata = { title: 'Attempts — Dev Console' };

export default function AttemptsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Attempts</h1>
        <p className="text-xs text-gray-500 mt-1">Mock attempt management, answer records, auto-save, time tracking</p>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge label="Placeholder" variant="warning" />
        <span className="text-xs text-gray-600">Module not yet implemented</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard title="Attempts" description="Student attempt management">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getMockAttempts, getMockAttemptById</li>
            <li>createMockAttempt, updateMockAttempt</li>
            <li>Attempt status transitions (in_progress, submitted, timed_out)</li>
          </ul>
        </SectionCard>
        <SectionCard title="Answers" description="Student answer records">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getMockAnswers, createMockAnswer</li>
            <li>updateMockAnswer — Auto-save payload</li>
            <li>getMockAnswerOptions</li>
          </ul>
        </SectionCard>
      </div>

      <div className="border-t border-gray-700/50 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Session</div>
        <SessionInfo />
      </div>

      <DebugPanel lastOperation="Module page loaded" info={[{ label: 'Module', value: 'attempts' }]} />
    </div>
  );
}
