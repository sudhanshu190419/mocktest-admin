'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useQuestionOptions,
  useCreateQuestionOption,
  useUpdateQuestionOption,
  useDeleteQuestionOption,
  useReplaceQuestionOptions,
  useReorderQuestionOptions,
} from '@/hooks/mockTest/useQuestionOptions';
import { useAuth } from '@/hooks/useAuth';
import type { QuestionOption, QuestionType } from '@/types/mockTest';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface OptionsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface QuestionOptionsPanelProps {
  onDebugInfo?: (info: OptionsDebugInfo) => void;
}

export default function QuestionOptionsPanel({ onDebugInfo }: QuestionOptionsPanelProps) {
  const { user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────
  const [questionId, setQuestionId] = useState('');
  const [loadedQuestionId, setLoadedQuestionId] = useState<string | null>(null);
  const [formOptionText, setFormOptionText] = useState('');
  const [formIsCorrect, setFormIsCorrect] = useState(false);
  const [formOrderSequence, setFormOrderSequence] = useState(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [editOptionId, setEditOptionId] = useState<string | null>(null);

  // Bulk replace
  const [showReplaceForm, setShowReplaceForm] = useState(false);
  const [replaceOptionsText, setReplaceOptionsText] = useState('');
  const [replaceQuestionType, setReplaceQuestionType] = useState<QuestionType>('mcq');

  // Reorder
  const [showReorderForm, setShowReorderForm] = useState(false);
  const [reorderItems, setReorderItems] = useState<{ optionId: string; displayOrder: number }[]>([]);

  // Debug
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ──────────────────────────────────────────────────────────────
  const { data: options, isLoading, isFetching, isStale, refetch } = useQuestionOptions(loadedQuestionId);
  const createMutation = useCreateQuestionOption();
  const updateMutation = useUpdateQuestionOption();
  const deleteMutation = useDeleteQuestionOption();
  const replaceMutation = useReplaceQuestionOptions();
  const reorderMutation = useReorderQuestionOptions();

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    replaceMutation.isPending ||
    reorderMutation.isPending;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: editOptionId ?? null,
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
    setShowReplaceForm(false);
    setShowReorderForm(false);
    setEditOptionId(null);
    setFormError(null);
    setLastHookCalled('useQuestionOptions [load]');
  }, [questionId]);

  const resetForm = useCallback(() => {
    setFormOptionText('');
    setFormIsCorrect(false);
    setFormOrderSequence(options ? options.length + 1 : 1);
    setEditOptionId(null);
    setFormError(null);
  }, [options]);

  const populateEditForm = useCallback((opt: QuestionOption) => {
    setEditOptionId(opt.optionId);
    setFormOptionText(opt.optionText);
    setFormIsCorrect(opt.isCorrect);
    setFormOrderSequence(opt.orderSequence);
    setFormError(null);
  }, []);

  const handleCreateOrUpdate = useCallback(() => {
    setFormError(null);
    if (!formOptionText.trim()) { setFormError('Option text is required.'); return; }
    if (!questionId.trim()) { setFormError('Load a question first.'); return; }
    if (!user?.instituteId) { setFormError('No institute ID.'); return; }

    if (editOptionId) {
      setLastHookCalled('useUpdateQuestionOption');
      updateMutation.mutate(
        { questionId: questionId.trim(), optionId: editOptionId, input: { optionText: formOptionText.trim(), isCorrect: formIsCorrect, displayOrder: formOrderSequence } },
        { onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); }, onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); } },
      );
    } else {
      setLastHookCalled('useCreateQuestionOption');
      createMutation.mutate(
        { questionId: questionId.trim(), instituteId: user.instituteId, optionText: formOptionText.trim(), isCorrect: formIsCorrect, orderSequence: formOrderSequence },
        { onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); }, onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); } },
      );
    }
  }, [formOptionText, formIsCorrect, formOrderSequence, editOptionId, questionId, user, createMutation, updateMutation, resetForm]);

  const handleDelete = useCallback((opt: QuestionOption) => {
    if (!window.confirm(`Delete option "${opt.optionText.slice(0, 30)}..."?`)) return;
    setLastHookCalled('useDeleteQuestionOption');
    deleteMutation.mutate(
      { questionId: questionId.trim(), optionId: opt.optionId },
      { onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: opt.optionId })); if (editOptionId === opt.optionId) resetForm(); }, onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); } },
    );
  }, [questionId, deleteMutation, editOptionId, resetForm]);

  const handleReplace = useCallback(() => {
    setFormError(null);
    if (!questionId.trim()) { setFormError('Question ID is required.'); return; }
    if (!user?.instituteId) { setFormError('No institute ID.'); return; }
    if (!replaceOptionsText.trim()) { setFormError('Options text is required.'); return; }

    // Parse options: one per line, format: "text | correct" or just "text"
    const lines = replaceOptionsText.trim().split('\n').filter(Boolean);
    const parsedOptions = lines.map((line, i) => {
      const parts = line.split('|').map((p) => p.trim());
      return {
        optionText: parts[0],
        isCorrect: parts.length > 1 ? parts[1].toLowerCase() === 'true' || parts[1] === '1' : false,
        orderSequence: i + 1,
      };
    });

    if (parsedOptions.length < 2) { setFormError('At least 2 options required.'); return; }

    setLastHookCalled('useReplaceQuestionOptions');
    replaceMutation.mutate(
      { questionId: questionId.trim(), instituteId: user.instituteId, options: parsedOptions, questionType: replaceQuestionType },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); setReplaceOptionsText(''); setShowReplaceForm(false); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [questionId, user, replaceOptionsText, replaceQuestionType, replaceMutation]);

  const openReorder = useCallback(() => {
    if (!options) return;
    setReorderItems(options.map((o) => ({ optionId: o.optionId, displayOrder: o.orderSequence })));
    setShowReorderForm(true);
    setShowReplaceForm(false);
  }, [options]);

  const handleReorder = useCallback(() => {
    setFormError(null);
    if (!questionId.trim()) { setFormError('Question ID is required.'); return; }
    setLastHookCalled('useReorderQuestionOptions');
    reorderMutation.mutate(
      { questionId: questionId.trim(), items: reorderItems },
      {
        onSuccess: () => { setLastApiResponse(JSON.stringify({ reordered: true })); setShowReorderForm(false); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [questionId, reorderItems, reorderMutation]);

  const updateReorderItem = useCallback((index: number, displayOrder: number) => {
    setReorderItems((prev) => prev.map((item, i) => i === index ? { ...item, displayOrder } : item));
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Question Options</h2>
          <p className="text-xs text-gray-500 mt-0.5">Manage answer options: CRUD, replace all, reorder</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(options?.length ?? 0) + ' options'} variant={options ? 'info' : 'neutral'} />
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
          <button type="button" onClick={handleLoad} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Load Options</button>
          <button type="button" onClick={() => { if (loadedQuestionId) refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
          {loadedQuestionId && (
            <>
              <button type="button" onClick={() => { setShowReplaceForm(!showReplaceForm); setShowReorderForm(false); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">
                {showReplaceForm ? 'Cancel Replace' : 'Replace All'}
              </button>
              <button type="button" onClick={() => { openReorder(); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">
                Reorder
              </button>
            </>
          )}
        </div>
        {loadedQuestionId && (
          <div className="mt-2 text-[11px] text-gray-500">Loaded: <span className="font-mono text-gray-400">{loadedQuestionId}</span></div>
        )}
      </div>

      {/* ── Add / Edit Option ────────────────────────────────────────────── */}
      {loadedQuestionId && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-200">
              {editOptionId ? 'Edit Option' : 'Add New Option'}
            </span>
            {editOptionId && <button type="button" onClick={resetForm} className="text-[11px] text-gray-500">Cancel</button>}
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Option Text *</label>
                <input type="text" value={formOptionText} onChange={(e) => setFormOptionText(e.target.value)} placeholder="Option text..." className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer pt-2">
                  <input type="checkbox" checked={formIsCorrect} onChange={(e) => setFormIsCorrect(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-green-500" />
                  <span className="text-xs text-gray-300">Correct Option</span>
                </label>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Order Sequence</label>
                <input type="number" value={formOrderSequence} onChange={(e) => setFormOrderSequence(Number(e.target.value))} min={1} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                disabled={isMutating || !formOptionText.trim()}
                onClick={handleCreateOrUpdate}
                className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
              >
                {isMutating ? 'Saving...' : editOptionId ? 'Update Option' : 'Add Option'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Replace All Form ─────────────────────────────────────────────── */}
      {showReplaceForm && loadedQuestionId && (
        <div className="rounded border border-orange-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-orange-700/50 bg-orange-950/30">
            <span className="text-xs font-semibold text-orange-300">Replace All Options</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Question Type</label>
              <select value={replaceQuestionType} onChange={(e) => setReplaceQuestionType(e.target.value as QuestionType)} className="rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                <option value="mcq">MCQ</option>
                <option value="msq">MSQ</option>
                <option value="true_false">True/False</option>
                <option value="numerical">Numerical</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">
                Options (one per line, format: <code>text | true</code> for correct)
              </label>
              <textarea
                value={replaceOptionsText}
                onChange={(e) => setReplaceOptionsText(e.target.value)}
                rows={6}
                placeholder={'Newton\'s First Law | true\nNewton\'s Second Law\nNewton\'s Third Law\nLaw of Gravitation'}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 resize-y"
              />
            </div>
            <button
              type="button"
              disabled={isMutating || !replaceOptionsText.trim()}
              onClick={handleReplace}
              className="rounded bg-orange-800 px-4 py-2 text-xs font-medium text-orange-100 disabled:opacity-40"
            >
              {replaceMutation.isPending ? 'Replacing...' : 'Replace All Options'}
            </button>
          </div>
        </div>
      )}

      {/* ── Reorder Form ─────────────────────────────────────────────────── */}
      {showReorderForm && loadedQuestionId && (
        <div className="rounded border border-blue-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-blue-700/50 bg-blue-950/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-300">Reorder Options</span>
            <button type="button" onClick={() => setShowReorderForm(false)} className="text-[11px] text-gray-500">Cancel</button>
          </div>
          <div className="p-4 space-y-3">
            {reorderItems.map((item, index) => (
              <div key={item.optionId} className="flex items-center gap-3">
                <span className="text-[11px] text-gray-500 w-6">{index + 1}.</span>
                <input
                  type="number"
                  value={item.displayOrder}
                  onChange={(e) => updateReorderItem(index, Number(e.target.value))}
                  min={1}
                  className="w-16 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
                />
                <span className="text-xs text-gray-400 font-mono truncate">{item.optionId.slice(0, 8)}...</span>
              </div>
            ))}
            <button
              type="button"
              disabled={isMutating}
              onClick={handleReorder}
              className="rounded bg-blue-800 px-4 py-2 text-xs font-medium text-blue-100 disabled:opacity-40"
            >
              {reorderMutation.isPending ? 'Reordering...' : 'Apply Reorder'}
            </button>
          </div>
        </div>
      )}

      {/* ── Options Table ────────────────────────────────────────────────── */}
      {loadedQuestionId && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-800/50">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Order</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Option Text</th>
                  <th className="text-center px-3 py-2 text-gray-500 font-medium">Correct</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Option ID</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {options && options.length > 0 ? options.map((opt) => (
                  <tr key={opt.optionId} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    <td className="px-3 py-2.5 text-gray-400">{opt.orderSequence}</td>
                    <td className="px-3 py-2.5 text-gray-200">{opt.optionText}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${opt.isCorrect ? 'bg-green-400' : 'bg-gray-600'}`} />
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-[10px]">{opt.optionId.slice(0, 8)}...</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button type="button" onClick={() => populateEditForm(opt)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700">Edit</button>
                        <button type="button" onClick={() => handleDelete(opt)} disabled={deleteMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 disabled:opacity-40">Delete</button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No options found. Add one above.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
