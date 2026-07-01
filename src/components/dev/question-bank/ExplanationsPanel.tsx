'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useQuestionExplanation,
  useCreateQuestionExplanation,
  useUpdateQuestionExplanation,
  useDeleteQuestionExplanation,
  useUpsertQuestionExplanation,
} from '@/hooks/mockTest/useQuestionExplanations';
import { useAuth } from '@/hooks/useAuth';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface ExplanationsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface ExplanationsPanelProps {
  onDebugInfo?: (info: ExplanationsDebugInfo) => void;
}

export default function ExplanationsPanel({ onDebugInfo }: ExplanationsPanelProps) {
  const { user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────
  const [questionId, setQuestionId] = useState('');
  const [loadedQuestionId, setLoadedQuestionId] = useState<string | null>(null);
  const [formExplanationText, setFormExplanationText] = useState('');
  const [formVideoUrl, setFormVideoUrl] = useState('');
  const [formNumericalAnswer, setFormNumericalAnswer] = useState('');
  const [formTolerance, setFormTolerance] = useState('');
  const [formUseUpsert, setFormUseUpsert] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Debug
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // Form key — bumped on each load to reset form state cleanly
  const [formKey, setFormKey] = useState(0);

  // ── Hooks ──────────────────────────────────────────────────────────────
  const { data: explanation, isLoading, isFetching, isStale, refetch } = useQuestionExplanation(loadedQuestionId);
  const createMutation = useCreateQuestionExplanation();
  const updateMutation = useUpdateQuestionExplanation();
  const deleteMutation = useDeleteQuestionExplanation();
  const upsertMutation = useUpsertQuestionExplanation();

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    upsertMutation.isPending;

  const loadedExplanation = explanation ?? null;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: loadedExplanation?.explanationId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleLoad = useCallback(() => {
    if (!questionId.trim()) { setFormError('Question ID is required.'); return; }
    setLoadedQuestionId(questionId.trim());
    // Reset form and bump key
    setFormExplanationText('');
    setFormVideoUrl('');
    setFormNumericalAnswer('');
    setFormTolerance('');
    setFormKey((k) => k + 1);
    setFormError(null);
    setLastHookCalled('useQuestionExplanation [load]');
  }, [questionId]);

  /** Copy loaded explanation data into the form fields. */
  const populateFromLoaded = useCallback(() => {
    if (!loadedExplanation) return;
    setFormExplanationText(loadedExplanation.explanationText ?? '');
    setFormVideoUrl(loadedExplanation.explanationVideoUrl ?? '');
    setFormNumericalAnswer(loadedExplanation.correctNumericalAnswer?.toString() ?? '');
    setFormTolerance(loadedExplanation.numericalTolerance?.toString() ?? '');
    setLastHookCalled('populateFromLoaded');
  }, [loadedExplanation]);

  const resetForm = useCallback(() => {
    setFormExplanationText('');
    setFormVideoUrl('');
    setFormNumericalAnswer('');
    setFormTolerance('');
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    setFormError(null);
    if (!questionId.trim()) { setFormError('Load a question first.'); return; }
    if (!user?.instituteId) { setFormError('No institute ID.'); return; }

    if (formUseUpsert) {
      setLastHookCalled('useUpsertQuestionExplanation');
      upsertMutation.mutate(
        {
          questionId: questionId.trim(),
          instituteId: user.instituteId,
          explanationText: formExplanationText.trim() || null,
          videoUrl: formVideoUrl.trim() || null,
          correctNumericalAnswer: formNumericalAnswer ? Number(formNumericalAnswer) : null,
          numericalTolerance: formTolerance ? Number(formTolerance) : null,
        },
        {
          onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); },
          onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
        },
      );
    } else if (loadedExplanation) {
      setLastHookCalled('useUpdateQuestionExplanation');
      updateMutation.mutate(
        {
          questionId: questionId.trim(),
          explanationId: loadedExplanation.explanationId,
          input: {
            explanationText: formExplanationText.trim() || null,
            videoUrl: formVideoUrl.trim() || null,
            correctNumericalAnswer: formNumericalAnswer ? Number(formNumericalAnswer) : null,
            numericalTolerance: formTolerance ? Number(formTolerance) : null,
          },
        },
        {
          onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); },
          onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
        },
      );
    } else {
      if (!formExplanationText.trim()) { setFormError('Explanation text is required for creation.'); return; }
      setLastHookCalled('useCreateQuestionExplanation');
      createMutation.mutate(
        {
          questionId: questionId.trim(),
          instituteId: user.instituteId,
          explanationText: formExplanationText.trim(),
          videoUrl: formVideoUrl.trim() || null,
          correctNumericalAnswer: formNumericalAnswer ? Number(formNumericalAnswer) : null,
          numericalTolerance: formTolerance ? Number(formTolerance) : null,
        },
        {
          onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); },
          onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
        },
      );
    }
  }, [questionId, user, formUseUpsert, loadedExplanation, formExplanationText, formVideoUrl, formNumericalAnswer, formTolerance, upsertMutation, updateMutation, createMutation]);

  const handleDelete = useCallback(() => {
    if (!loadedExplanation) return;
    if (!window.confirm('Delete this explanation?')) return;
    setLastHookCalled('useDeleteQuestionExplanation');
    deleteMutation.mutate(
      { questionId: questionId.trim(), explanationId: loadedExplanation.explanationId },
      {
        onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: true })); resetForm(); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedExplanation, questionId, deleteMutation, resetForm]);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Explanations</h2>
          <p className="text-xs text-gray-500 mt-0.5">Manage question explanations: create, update, delete, upsert</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          {loadedExplanation && <StatusBadge label="Has Explanation" variant="success" />}
        </div>
      </div>

      {formError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{String(formError)}</span>
        </div>
      )}

      {/* ── Question ID selector ────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[300px] flex-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Question UUID</label>
            <input type="text" value={questionId} onChange={(e) => setQuestionId(e.target.value)} placeholder="Paste question UUID..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <button type="button" onClick={handleLoad} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Load Explanation</button>
          <button type="button" onClick={() => { if (loadedQuestionId) refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
        {loadedQuestionId && (
          <div className="mt-2 text-[11px] text-gray-500">Loaded: <span className="font-mono text-gray-400">{loadedQuestionId}</span></div>
        )}
      </div>

      {/* ── Explanation Form ─────────────────────────────────────────────── */}
      {loadedQuestionId && (
        <div key={formKey} className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
            <span className="text-xs font-semibold text-gray-200">
              {loadedExplanation ? 'Edit Explanation' : 'Create Explanation'}
            </span>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formUseUpsert} onChange={(e) => setFormUseUpsert(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-amber-600" />
                <span className="text-xs text-gray-300">Use Upsert (recommended)</span>
              </label>
              {loadedExplanation && (
                <>
                  <span className="text-[11px] text-gray-500">
                    Explanation ID: <span className="font-mono">{loadedExplanation.explanationId}</span>
                  </span>
                  <button
                    type="button"
                    onClick={populateFromLoaded}
                    className="rounded bg-blue-900/50 px-2 py-1 text-[11px] text-blue-300 hover:bg-blue-900/70"
                  >
                    Load into form
                  </button>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Explanation Text</label>
              <textarea
                value={formExplanationText}
                onChange={(e) => setFormExplanationText(e.target.value)}
                rows={4}
                placeholder="Step-by-step solution..."
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Video URL</label>
                <input type="text" value={formVideoUrl} onChange={(e) => setFormVideoUrl(e.target.value)} placeholder="https://..." className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Correct Numerical Answer</label>
                <input type="number" value={formNumericalAnswer} onChange={(e) => setFormNumericalAnswer(e.target.value)} placeholder="e.g. 42" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Numerical Tolerance</label>
                <input type="number" value={formTolerance} onChange={(e) => setFormTolerance(e.target.value)} placeholder="e.g. 0.5" step="0.01" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={isMutating || !user?.instituteId}
                onClick={handleSubmit}
                className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
              >
                {isMutating ? 'Saving...' : loadedExplanation ? 'Update / Upsert' : 'Create Explanation'}
              </button>
              {loadedExplanation && (
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={handleDelete}
                  className="rounded bg-red-900/50 px-4 py-2 text-xs font-medium text-red-300 disabled:opacity-40"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Current Explanation Display ──────────────────────────────────── */}
      {loadedExplanation && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
            <span className="text-xs font-semibold text-gray-200">Current Explanation</span>
          </div>
          <div className="p-4 space-y-2 text-xs text-gray-300">
            <div><span className="text-gray-500">Explanation ID:</span> <span className="font-mono">{loadedExplanation.explanationId}</span></div>
            <div><span className="text-gray-500">Explanation Text:</span></div>
            <pre className="bg-gray-950 rounded p-2 text-gray-300 whitespace-pre-wrap">{loadedExplanation.explanationText ?? '(no text)'}</pre>
            <div><span className="text-gray-500">Video URL:</span> {loadedExplanation.explanationVideoUrl ?? '(none)'}</div>
            <div><span className="text-gray-500">Correct Numerical Answer:</span> {loadedExplanation.correctNumericalAnswer ?? '(not set)'}</div>
            <div><span className="text-gray-500">Numerical Tolerance:</span> {loadedExplanation.numericalTolerance ?? '(not set / exact match)'}</div>
            <div><span className="text-gray-500">Created:</span> {new Date(loadedExplanation.createdAt).toLocaleString()}</div>
            <div><span className="text-gray-500">Updated:</span> {new Date(loadedExplanation.updatedAt).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}
