'use client';

import type { QuestionType } from '@/types/mockTest';

interface ExplanationData {
  explanationText: string;
  explanationVideoUrl: string;
  correctNumericalAnswer: string;
  numericalTolerance: string;
  correctTextAnswer: string;
}

interface ExplanationEditorProps {
  data: ExplanationData;
  questionType: QuestionType;
  onChange: (data: ExplanationData) => void;
}

export function ExplanationEditor({ data, questionType, onChange }: ExplanationEditorProps) {
  const updateField = (field: keyof ExplanationData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  const isNumerical = questionType === 'numerical';
  const isTextBased = questionType === 'text_based';
  const isSubjective = questionType === 'subjective';

  return (
    <div className="space-y-4">
      {isTextBased && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Accepted Text Answer <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.correctTextAnswer}
            onChange={(e) => updateField('correctTextAnswer', e.target.value)}
            placeholder="e.g. Newton (or Newton | N for multiple acceptable answers)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          <p className="text-[11px] text-gray-400">
            Matching is case-insensitive. To accept multiple acceptable variations, separate them with &apos;|&apos; (e.g. Newton | N).
          </p>
        </div>
      )}

      {isSubjective && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Model Answer / Evaluation Guidance
          </label>
          <textarea
            value={data.correctTextAnswer}
            onChange={(e) => updateField('correctTextAnswer', e.target.value)}
            placeholder="Optional guidance for the teacher during manual evaluation."
            rows={3}
            className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          <p className="text-[11px] text-gray-400">
            Optional guidance for the teacher during manual evaluation.
          </p>
        </div>
      )}

      {isNumerical && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Correct Numerical Answer <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                value={data.correctNumericalAnswer}
                onChange={(e) => updateField('correctNumericalAnswer', e.target.value)}
                placeholder="e.g. 9.8"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Tolerance (Margin of Error)
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={data.numericalTolerance}
                onChange={(e) => updateField('numericalTolerance', e.target.value)}
                placeholder="e.g. 0.1 (empty = exact)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <p className="text-[11px] text-gray-400">
                Leave empty for exact match. If set, answer within this range is correct.
              </p>
            </div>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Explanation Text <span className="text-red-500">*</span>
        </label>
        <textarea
          value={data.explanationText}
          onChange={(e) => updateField('explanationText', e.target.value)}
          placeholder="Write step-by-step explanation for the correct answer..."
          rows={5}
          className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Video Solution URL (optional)
        </label>
        <input
          type="url"
          value={data.explanationVideoUrl}
          onChange={(e) => updateField('explanationVideoUrl', e.target.value)}
          placeholder="https://example.com/video-solution"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>
    </div>
  );
}
