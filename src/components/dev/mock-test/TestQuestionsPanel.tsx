'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useMockTestQuestions,
  useAddQuestionToMockTest,
  useUpdateMockTestQuestion,
  useRemoveQuestionFromMockTest,
  useAddQuestionsToMockTest,
  useReplaceMockTestQuestions,
  useReorderMockTestQuestions,
} from '@/hooks/mockTest/useMockTestQuestions';
import type { MockTestQuestion } from '@/types/mockTest';
import type { QuestionAssignment, ReorderItem } from '@/services/mockTest/mockTestQuestionService';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface TestQuestionsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface TestQuestionsPanelProps {
  onDebugInfo?: (info: TestQuestionsDebugInfo) => void;
}

export default function TestQuestionsPanel({ onDebugInfo }: TestQuestionsPanelProps) {
  // ── State ──────────────────────────────────────────────────────────────
  const [testId, setTestId] = useState('');
  const [loadedTestId, setLoadedTestId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Single add form
  const [addQuestionId, setAddQuestionId] = useState('');
  const [addOrderSequence, setAddOrderSequence] = useState(1);
  const [addMarks, setAddMarks] = useState('');
  const [addNegativeMarksOverride, setAddNegativeMarksOverride] = useState('');
  const [addSectionName, setAddSectionName] = useState('');

  // Update assignment
  const [editQuestionId, setEditQuestionId] = useState<string | null>(null);
  const [editOrderSequence, setEditOrderSequence] = useState(1);
  const [editMarksOverride, setEditMarksOverride] = useState('');
  const [editNegativeMarksOverride, setEditNegativeMarksOverride] = useState('');
  const [editSectionName, setEditSectionName] = useState('');

  // Bulk add
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkQuestionsText, setBulkQuestionsText] = useState('');

  // Replace
  const [showReplaceForm, setShowReplaceForm] = useState(false);
  const [replaceQuestionsText, setReplaceQuestionsText] = useState('');

  // Reorder
  const [showReorderForm, setShowReorderForm] = useState(false);
  const [reorderItems, setReorderItems] = useState<ReorderItem[]>([]);

  // Debug
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ──────────────────────────────────────────────────────────────
  const { data: questions, isLoading, isFetching, isStale, refetch } = useMockTestQuestions(loadedTestId);
  const addMutation = useAddQuestionToMockTest();
  const updateMutation = useUpdateMockTestQuestion();
  const removeMutation = useRemoveQuestionFromMockTest();
  const bulkAddMutation = useAddQuestionsToMockTest();
  const replaceMutation = useReplaceMockTestQuestions();
  const reorderMutation = useReorderMockTestQuestions();

  const isMutating =
    addMutation.isPending || updateMutation.isPending || removeMutation.isPending ||
    bulkAddMutation.isPending || replaceMutation.isPending || reorderMutation.isPending;

  const snapshotCount = questions?.filter((q) => q.questionSnapshot !== null).length ?? 0;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: editQuestionId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleLoad = useCallback(() => {
    if (!testId.trim()) { setFormError('Test ID is required.'); return; }
    setLoadedTestId(testId.trim());
    setShowBulkForm(false);
    setShowReplaceForm(false);
    setShowReorderForm(false);
    setEditQuestionId(null);
    setFormError(null);
    setLastHookCalled('useMockTestQuestions [load]');
  }, [testId]);

  const resetAddForm = useCallback(() => {
    setAddQuestionId('');
    setAddOrderSequence(1);
    setAddMarks('');
    setAddNegativeMarksOverride('');
    setAddSectionName('');
  }, []);

  const handleAddSingle = useCallback(() => {
    setFormError(null);
    if (!loadedTestId) { setFormError('Load a test first.'); return; }
    if (!addQuestionId.trim()) { setFormError('Question ID is required.'); return; }

    setLastHookCalled('useAddQuestionToMockTest');
    addMutation.mutate(
      {
        testId: loadedTestId,
        questionId: addQuestionId.trim(),
        orderSequence: addOrderSequence,
        marks: addMarks ? Number(addMarks) : undefined,
        negativeMarksOverride: addNegativeMarksOverride ? Number(addNegativeMarksOverride) : null,
        sectionName: addSectionName.trim() || null,
      },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetAddForm(); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedTestId, addQuestionId, addOrderSequence, addMarks, addNegativeMarksOverride, addSectionName, addMutation, resetAddForm]);

  const populateEdit = useCallback((q: MockTestQuestion) => {
    setEditQuestionId(q.questionId);
    setEditOrderSequence(q.orderSequence);
    setEditMarksOverride(q.marks.toString());
    setEditNegativeMarksOverride(q.negativeMarksOverride?.toString() ?? '');
    setEditSectionName(q.sectionName ?? '');
    setFormError(null);
  }, []);

  const handleUpdate = useCallback(() => {
    if (!loadedTestId || !editQuestionId) return;
    setLastHookCalled('useUpdateMockTestQuestion');
    updateMutation.mutate(
      {
        testId: loadedTestId,
        questionId: editQuestionId,
        orderSequence: editOrderSequence,
        marksOverride: editMarksOverride ? Number(editMarksOverride) : undefined,
        negativeMarksOverride: editNegativeMarksOverride ? Number(editNegativeMarksOverride) : null,
        section: editSectionName.trim() || null,
      },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); setEditQuestionId(null); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedTestId, editQuestionId, editOrderSequence, editMarksOverride, editNegativeMarksOverride, editSectionName, updateMutation]);

  const handleRemove = useCallback((q: MockTestQuestion) => {
    if (!loadedTestId) return;
    if (!window.confirm(`Remove question ${q.questionId.slice(0, 8)}... from test?`)) return;
    setLastHookCalled('useRemoveQuestionFromMockTest');
    removeMutation.mutate(
      { testId: loadedTestId, questionId: q.questionId },
      {
        onSuccess: () => { setLastApiResponse(JSON.stringify({ removed: q.questionId })); if (editQuestionId === q.questionId) setEditQuestionId(null); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedTestId, removeMutation, editQuestionId]);

  const parseAssignmentText = useCallback((text: string): QuestionAssignment[] => {
    return text.trim().split('\n').filter(Boolean).map((line, i) => {
      const parts = line.split('|').map((p) => p.trim());
      return {
        questionId: parts[0],
        orderSequence: i + 1,
        marks: parts[1] ? Number(parts[1]) : undefined,
        negativeMarksOverride: parts[2] ? Number(parts[2]) : null,
        sectionName: parts[3] || null,
      };
    });
  }, []);

  const handleBulkAdd = useCallback(() => {
    setFormError(null);
    if (!loadedTestId) { setFormError('Load a test first.'); return; }
    if (!bulkQuestionsText.trim()) { setFormError('Enter question assignments.'); return; }

    const assignments = parseAssignmentText(bulkQuestionsText);
    if (assignments.length === 0) { setFormError('At least one question required.'); return; }

    setLastHookCalled('useAddQuestionsToMockTest');
    bulkAddMutation.mutate(
      { testId: loadedTestId, assignments },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); setBulkQuestionsText(''); setShowBulkForm(false); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedTestId, bulkQuestionsText, bulkAddMutation, parseAssignmentText]);

  const handleReplace = useCallback(() => {
    setFormError(null);
    if (!loadedTestId) { setFormError('Load a test first.'); return; }
    if (!replaceQuestionsText.trim()) { setFormError('Enter question assignments.'); return; }

    const assignments = parseAssignmentText(replaceQuestionsText);
    if (assignments.length === 0) { setFormError('At least one question required.'); return; }

    setLastHookCalled('useReplaceMockTestQuestions');
    replaceMutation.mutate(
      { testId: loadedTestId, assignments },
      {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); setReplaceQuestionsText(''); setShowReplaceForm(false); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedTestId, replaceQuestionsText, replaceMutation, parseAssignmentText]);

  const openReorder = useCallback(() => {
    if (!questions) return;
    setReorderItems(questions.map((q) => ({
      assignmentId: `${q.testId}::${q.questionId}`,
      displayOrder: q.orderSequence,
    })));
    setShowReorderForm(true);
    setShowBulkForm(false);
    setShowReplaceForm(false);
  }, [questions]);

  const handleReorder = useCallback(() => {
    if (!loadedTestId) return;
    setLastHookCalled('useReorderMockTestQuestions');
    reorderMutation.mutate(
      { testId: loadedTestId, items: reorderItems },
      {
        onSuccess: () => { setLastApiResponse(JSON.stringify({ reordered: true })); setShowReorderForm(false); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      },
    );
  }, [loadedTestId, reorderItems, reorderMutation]);

  const updateReorderItem = useCallback((index: number, displayOrder: number) => {
    setReorderItems((prev) => prev.map((item, i) => i === index ? { ...item, displayOrder } : item));
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Test Questions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Manage questions assigned to a mock test</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(questions?.length ?? 0) + ' questions'} variant={questions && questions.length > 0 ? 'info' : 'neutral'} />
          {snapshotCount > 0 && <StatusBadge label={snapshotCount + ' snapshots'} variant="success" />}
        </div>
      </div>

      {formError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{String(formError)}</span>
        </div>
      )}

      {/* ── Test ID selector ────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[300px] flex-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Mock Test UUID</label>
            <input type="text" value={testId} onChange={(e) => setTestId(e.target.value)} placeholder="Paste test UUID..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <button type="button" onClick={handleLoad} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Load Questions</button>
          <button type="button" onClick={() => { if (loadedTestId) refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
          {loadedTestId && (
            <>
              <button type="button" onClick={() => { setShowBulkForm(!showBulkForm); setShowReplaceForm(false); setShowReorderForm(false); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">
                {showBulkForm ? 'Cancel' : 'Bulk Add'}
              </button>
              <button type="button" onClick={() => { setShowReplaceForm(!showReplaceForm); setShowBulkForm(false); setShowReorderForm(false); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">
                {showReplaceForm ? 'Cancel' : 'Replace'}
              </button>
              <button type="button" onClick={() => { openReorder(); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">
                Reorder
              </button>
            </>
          )}
        </div>
        {loadedTestId && (
          <div className="mt-2 text-[11px] text-gray-500">Loaded: <span className="font-mono text-gray-400">{loadedTestId}</span></div>
        )}
      </div>

      {/* ── Add Single Question ──────────────────────────────────────────── */}
      {loadedTestId && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
            <span className="text-xs font-semibold text-gray-200">Add Single Question</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Question UUID *</label>
                <input type="text" value={addQuestionId} onChange={(e) => setAddQuestionId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Order Sequence</label>
                <input type="number" value={addOrderSequence} onChange={(e) => setAddOrderSequence(Number(e.target.value))} min={1} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Marks Override</label>
                <input type="number" value={addMarks} onChange={(e) => setAddMarks(e.target.value)} min={1} placeholder="Question default" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Neg Marks Override</label>
                <input type="number" value={addNegativeMarksOverride} onChange={(e) => setAddNegativeMarksOverride(e.target.value)} min={0} placeholder="Test default" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Section Name</label>
                <input type="text" value={addSectionName} onChange={(e) => setAddSectionName(e.target.value)} placeholder="e.g. Physics" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
              <div className="flex items-end">
                <button type="button" disabled={isMutating || !addQuestionId.trim()} onClick={handleAddSingle} className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40">
                  {addMutation.isPending ? 'Adding...' : 'Add Question'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Add Form ────────────────────────────────────────────────── */}
      {showBulkForm && loadedTestId && (
        <div className="rounded border border-green-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-green-700/50 bg-green-950/30">
            <span className="text-xs font-semibold text-green-300">Bulk Add Questions</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">
                Format: <code>questionId | marks | negMarks | section</code> (one per line)
              </label>
              <textarea
                value={bulkQuestionsText}
                onChange={(e) => setBulkQuestionsText(e.target.value)}
                rows={5}
                placeholder={'uuid-1 | 4 | 1 | Physics\nuuid-2 | 4 | 1 | Physics\nuuid-3 | 5 | 0 | Chemistry'}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 resize-y"
              />
            </div>
            <button type="button" disabled={isMutating || !bulkQuestionsText.trim()} onClick={handleBulkAdd} className="rounded bg-green-800 px-4 py-2 text-xs font-medium text-green-100 disabled:opacity-40">
              {bulkAddMutation.isPending ? 'Adding...' : 'Bulk Add Questions'}
            </button>
          </div>
        </div>
      )}

      {/* ── Replace Form ─────────────────────────────────────────────────── */}
      {showReplaceForm && loadedTestId && (
        <div className="rounded border border-orange-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-orange-700/50 bg-orange-950/30">
            <span className="text-xs font-semibold text-orange-300">Replace All Questions</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">
                Format: <code>questionId | marks | negMarks | section</code> (one per line)
              </label>
              <textarea
                value={replaceQuestionsText}
                onChange={(e) => setReplaceQuestionsText(e.target.value)}
                rows={5}
                placeholder={'uuid-1 | 4 | 1 | Physics\nuuid-2 | 4 | 1 | Chemistry\nuuid-3 | 5 | 0 | Biology'}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 resize-y"
              />
            </div>
            <button type="button" disabled={isMutating || !replaceQuestionsText.trim()} onClick={handleReplace} className="rounded bg-orange-800 px-4 py-2 text-xs font-medium text-orange-100 disabled:opacity-40">
              {replaceMutation.isPending ? 'Replacing...' : 'Replace All Questions'}
            </button>
          </div>
        </div>
      )}

      {/* ── Reorder Form ─────────────────────────────────────────────────── */}
      {showReorderForm && loadedTestId && (
        <div className="rounded border border-blue-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-blue-700/50 bg-blue-950/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-300">Reorder Questions</span>
            <button type="button" onClick={() => setShowReorderForm(false)} className="text-[11px] text-gray-500">Cancel</button>
          </div>
          <div className="p-4 space-y-3">
            {reorderItems.map((item, index) => {
              const qId = item.assignmentId.split('::')[1] ?? item.assignmentId;
              return (
                <div key={item.assignmentId} className="flex items-center gap-3">
                  <span className="text-[11px] text-gray-500 w-6">{index + 1}.</span>
                  <input
                    type="number"
                    value={item.displayOrder}
                    onChange={(e) => updateReorderItem(index, Number(e.target.value))}
                    min={1}
                    className="w-16 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
                  />
                  <span className="text-xs text-gray-400 font-mono truncate">{qId.slice(0, 8)}...</span>
                </div>
              );
            })}
            <button type="button" disabled={isMutating} onClick={handleReorder} className="rounded bg-blue-800 px-4 py-2 text-xs font-medium text-blue-100 disabled:opacity-40">
              {reorderMutation.isPending ? 'Reordering...' : 'Apply Reorder'}
            </button>
          </div>
        </div>
      )}

      {/* ── Questions Table ──────────────────────────────────────────────── */}
      {loadedTestId && (
        <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-800/50">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Order</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Question ID</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">Marks</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">Neg Marks</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Section</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Snapshot</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Added</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {questions && questions.length > 0 ? questions.map((q) => (
                  <tr key={q.questionId} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                    {editQuestionId === q.questionId ? (
                      <td colSpan={8} className="px-3 py-2 bg-blue-950/20">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-[10px] text-gray-500">Order:</label>
                          <input type="number" value={editOrderSequence} onChange={(e) => setEditOrderSequence(Number(e.target.value))} min={1} className="w-14 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200" />
                          <label className="text-[10px] text-gray-500">Marks:</label>
                          <input type="number" value={editMarksOverride} onChange={(e) => setEditMarksOverride(e.target.value)} min={1} className="w-14 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200" />
                          <label className="text-[10px] text-gray-500">Neg:</label>
                          <input type="number" value={editNegativeMarksOverride} onChange={(e) => setEditNegativeMarksOverride(e.target.value)} min={0} className="w-14 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200" />
                          <label className="text-[10px] text-gray-500">Section:</label>
                          <input type="text" value={editSectionName} onChange={(e) => setEditSectionName(e.target.value)} className="w-24 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[10px] text-gray-200" />
                          <button type="button" onClick={handleUpdate} disabled={updateMutation.isPending} className="rounded bg-green-900/50 px-2 py-1 text-[11px] text-green-300">Save</button>
                          <button type="button" onClick={() => setEditQuestionId(null)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300">X</button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-gray-400">{q.orderSequence}</td>
                        <td className="px-3 py-2.5 text-gray-300 font-mono text-[10px]">{q.questionId.slice(0, 8)}...</td>
                        <td className="px-3 py-2.5 text-right text-gray-300">{q.marks}</td>
                        <td className="px-3 py-2.5 text-right text-gray-400">{q.negativeMarksOverride ?? '(test)'}</td>
                        <td className="px-3 py-2.5 text-gray-400">{q.sectionName ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge label={q.questionSnapshot ? 'Frozen' : 'Draft'} variant={q.questionSnapshot ? 'success' : 'warning'} />
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{new Date(q.addedAt).toLocaleDateString()}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => populateEdit(q)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700">Edit</button>
                            <button type="button" onClick={() => handleRemove(q)} disabled={removeMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 disabled:opacity-40">Remove</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No questions assigned. Add one above.'}</td>
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
