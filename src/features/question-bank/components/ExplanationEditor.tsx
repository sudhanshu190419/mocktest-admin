'use client';

import { useState } from 'react';
import { MathRenderer } from '@/components/common/MathRenderer';
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
  const [previewExplanation, setPreviewExplanation] = useState(false);
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
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Explanation Text <span className="text-red-500">*</span>
          </label>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
            <button
              type="button"
              onClick={() => setPreviewExplanation(false)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                !previewExplanation
                  ? 'bg-white text-gray-900 shadow-xs dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setPreviewExplanation(true)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                previewExplanation
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              Math Preview
            </button>
          </div>
        </div>

        {previewExplanation ? (
          <div className="min-h-[120px] rounded-lg border border-blue-200 bg-blue-50/20 p-3 text-sm text-gray-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-gray-100">
            {data.explanationText ? (
              <MathRenderer content={data.explanationText} />
            ) : (
              <p className="text-xs italic text-gray-400">
                {'No explanation entered yet. Supports LaTeX e.g. \\[\\frac{dy}{dx}\\] and \\(\\ce{H2SO4}\\).'}
              </p>
            )}
          </div>
        ) : (
          <textarea
            value={data.explanationText}
            onChange={(e) => updateField('explanationText', e.target.value)}
            placeholder="Write step-by-step explanation for the correct answer... Supports LaTeX e.g. \[\frac{dy}{dx}\]"
            rows={5}
            className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        )}
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
