import SectionCard from '@/components/dev/SectionCard';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import SessionInfo from '@/components/dev/SessionInfo';

export const metadata = { title: 'Question Bank — Dev Console' };

export default function QuestionBankPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Question Bank</h1>
        <p className="text-xs text-gray-500 mt-1">Question CRUD, options, explanations, images, status transitions</p>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge label="Placeholder" variant="warning" />
        <span className="text-xs text-gray-600">Module not yet implemented</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SectionCard title="Questions" description="Question CRUD and lifecycle">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getQuestions, getQuestionById</li>
            <li>createQuestion, updateQuestion, deleteQuestion</li>
            <li>publishQuestion, archiveQuestion, restoreQuestion</li>
          </ul>
        </SectionCard>
        <SectionCard title="Options" description="Answer option management">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getQuestionOptions, createQuestionOption</li>
            <li>updateQuestionOption, deleteQuestionOption</li>
            <li>replaceQuestionOptions, reorderQuestionOptions</li>
          </ul>
        </SectionCard>
        <SectionCard title="Explanations" description="Solution walkthrough management">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getQuestionExplanation, upsertQuestionExplanation</li>
            <li>createQuestionExplanation, updateQuestionExplanation</li>
            <li>deleteQuestionExplanation</li>
          </ul>
        </SectionCard>
        <SectionCard title="Images" description="Question image upload and management">
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>getQuestionImages, uploadQuestionImage</li>
            <li>updateQuestionImage, deleteQuestionImage</li>
            <li>replaceQuestionImages, reorderQuestionImages</li>
          </ul>
        </SectionCard>
      </div>

      <div className="border-t border-gray-700/50 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Session</div>
        <SessionInfo />
      </div>

      <DebugPanel lastOperation="Module page loaded" info={[{ label: 'Module', value: 'question-bank' }]} />
    </div>
  );
}
