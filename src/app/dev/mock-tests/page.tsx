import SectionCard from '@/components/dev/SectionCard';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import SessionInfo from '@/components/dev/SessionInfo';

export const metadata = { title: 'Mock Tests — Dev Console' };

export default function MockTestsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Mock Tests</h1>
        <p className="text-xs text-gray-500 mt-1">Test CRUD, question assignment, publish/unpublish workflow</p>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge label="Placeholder" variant="warning" />
        <span className="text-xs text-gray-600">Module not yet implemented</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard title="Mock Test CRUD" description="Create, read, update, delete tests">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getMockTests, getMockTestById</li>
            <li>createMockTest, updateMockTest, deleteMockTest</li>
            <li>publishMockTest, archiveMockTest, restoreMockTest</li>
          </ul>
        </SectionCard>
        <SectionCard title="Question Assignment" description="Add, remove, reorder test questions">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getMockTestQuestions, addQuestionToMockTest</li>
            <li>updateMockTestQuestion, removeQuestionFromMockTest</li>
            <li>addQuestionsToMockTest, replaceMockTestQuestions</li>
            <li>reorderMockTestQuestions</li>
          </ul>
        </SectionCard>
        <SectionCard title="Publish Workflow" description="Validation and publish orchestration">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>validateMockTestReady — Pre-publish checklist</li>
            <li>publishMockTestWorkflow — Full publish orchestration</li>
            <li>unpublishMockTest — Revert published test to draft</li>
          </ul>
        </SectionCard>
      </div>

      <div className="border-t border-gray-700/50 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Session</div>
        <SessionInfo />
      </div>

      <DebugPanel lastOperation="Module page loaded" info={[{ label: 'Module', value: 'mock-tests' }]} />
    </div>
  );
}
