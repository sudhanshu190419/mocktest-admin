'use client';

import { useState, useCallback } from 'react';
import type { PendingEvaluationItem } from '@/services/evaluation/manualEvaluationService';

interface SubjectiveAnswerCardProps {
  item: PendingEvaluationItem;
  index: number;
  total: number;
  onSave: (answerId: string, marks: number, feedback: string) => Promise<void>;
  isReadOnly?: boolean;
  /** If already evaluated, show existing marks/feedback as defaults. */
  existingMarks?: number | null;
  existingFeedback?: string | null;
}

export function SubjectiveAnswerCard({
  item,
  index,
  total,
  onSave,
  isReadOnly = false,
  existingMarks,
  existingFeedback,
}: SubjectiveAnswerCardProps) {
  const [marks, setMarks] = useState<string>(
    existingMarks !== null && existingMarks !== undefined
      ? String(existingMarks)
      : '',
  );
  const [feedback, setFeedback] = useState<string>(
    existingFeedback ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const parsedMarks = parseFloat(marks);
  const isValid =
    !isNaN(parsedMarks) &&
    parsedMarks >= 0 &&
    parsedMarks <= item.questionMarks &&
    Number.isFinite(parsedMarks);

  const handleSave = useCallback(async () => {
    if (!isValid) {
      setError(`Marks must be between 0 and ${item.questionMarks}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(item.answerId, parsedMarks, feedback.trim() || '');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save evaluation.');
    } finally {
      setSaving(false);
    }
  }, [isValid, parsedMarks, feedback, onSave, item.answerId, item.questionMarks]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Question {index + 1} of {total}
          {item.evaluationStatus === 'manual_evaluated' && (
            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              Evaluated
            </span>
          )}
        </h3>
        <span className="text-xs font-medium text-gray-500">
          {item.questionMarks} marks
        </span>
      </div>

      {/* Question */}
      <div className="mb-4 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
        <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">
          {item.questionText}
        </p>
      </div>

      {/* Student Answer */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Student Answer
        </label>
        <div className="min-h-[80px] max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          {item.textAnswer || (
            <span className="italic text-gray-400">No answer submitted</span>
          )}
        </div>
      </div>

      {/* Model Answer / Evaluation Guidance */}
      {item.correctTextAnswer && (
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Model Answer / Evaluation Guidance
          </label>
          <div className="min-h-[60px] max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            {item.correctTextAnswer}
          </div>
        </div>
      )}

      {/* Marks Input */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Award Marks (0 – {item.questionMarks})
        </label>
        {isReadOnly ? (
          <span className="inline-block rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {existingMarks ?? '—'} / {item.questionMarks}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={item.questionMarks}
              step={0.5}
              value={marks}
              onChange={(e) => {
                setMarks(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              disabled={isReadOnly || saving}
              className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <span className="text-sm text-gray-500">/ {item.questionMarks}</span>
          </div>
        )}
        {error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      {/* Feedback */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Feedback (optional)
        </label>
        {isReadOnly ? (
          <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
            {existingFeedback || '—'}
          </p>
        ) : (
          <textarea
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
              setSuccess(false);
            }}
            disabled={isReadOnly || saving}
            rows={3}
            placeholder="Optional feedback for the student..."
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        )}
      </div>

      {/* Save button */}
      {!isReadOnly && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isValid}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Evaluation'}
          </button>
          {success && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              ✓ Saved
            </span>
          )}
        </div>
      )}
    </div>
  );
}
