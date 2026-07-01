'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useQuestions,
  useQuestion,
  useCreateQuestion,
  useUpdateQuestion,
  useDeleteQuestion,
  usePublishQuestion,
  useArchiveQuestion,
  useRestoreQuestion,
} from '@/hooks/mockTest/useQuestions';
import { useAuth } from '@/hooks/useAuth';
import type {
  Question,
  CreateQuestionInput,
  UpdateQuestionInput,
  QuestionFilters,
  QuestionSortOptions,
  QuestionType,
  DifficultyLevel,
  QuestionStatus,
} from '@/types/mockTest';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface QuestionsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface QuestionsPanelProps {
  onDebugInfo?: (info: QuestionsDebugInfo) => void;
}

const QUESTION_TYPES: QuestionType[] = ['mcq', 'msq', 'numerical', 'true_false'];
const DIFFICULTIES: DifficultyLevel[] = ['easy', 'medium', 'hard'];
const STATUSES: QuestionStatus[] = ['draft', 'pending_approval', 'published', 'archived'];
const SORT_FIELDS = [
  { value: 'createdAt', label: 'Created At' },
  { value: 'updatedAt', label: 'Updated At' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'status', label: 'Status' },
  { value: 'questionType', label: 'Type' },
  { value: 'marks', label: 'Marks' },
  { value: 'version', label: 'Version' },
  { value: 'timesAttempted', label: 'Times Attempted' },
  { value: 'approvedAt', label: 'Approved At' },
] as const;

const STATUS_VARIANT: Record<QuestionStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  draft: 'info',
  pending_approval: 'warning',
  published: 'success',
  archived: 'neutral',
};

export default function QuestionsPanel({ onDebugInfo }: QuestionsPanelProps) {
  const { user } = useAuth();

  // ── Filter/Pagination/Sort state ──────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [filterChapterId, setFilterChapterId] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterQuestionType, setFilterQuestionType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCreatedBy, setFilterCreatedBy] = useState('');
  const [filters, setFilters] = useState<QuestionFilters>({});
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // ── Form state ────────────────────────────────────────────────────────
  const [editRecord, setEditRecord] = useState<Question | null>(null);
  const [detailQuestionId, setDetailQuestionId] = useState<string | null>(null);
  const [formQuestionText, setFormQuestionText] = useState('');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formChapterId, setFormChapterId] = useState('');
  const [formDifficulty, setFormDifficulty] = useState<DifficultyLevel>('medium');
  const [formQuestionType, setFormQuestionType] = useState<QuestionType>('mcq');
  const [formMarks, setFormMarks] = useState(4);
  const [formNegativeMarks, setFormNegativeMarks] = useState(0);
  const [formIsOriginal, setFormIsOriginal] = useState(true);
  const [formParentQuestionId, setFormParentQuestionId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // ── Debug state ───────────────────────────────────────────────────────
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  // ── Hooks ─────────────────────────────────────────────────────────────
  const sort: QuestionSortOptions = { sortBy: sortField as QuestionSortOptions['sortBy'], sortDirection: sortDir };
  const appliedFilters = Object.keys(filters).length > 0 ? filters : undefined;
  const { data, isLoading, isFetching, isStale, refetch } = useQuestions(
    appliedFilters,
    sort,
    { page, pageSize },
  );
  const { data: detailQuestion, isLoading: detailLoading } = useQuestion(detailQuestionId);
  const createMutation = useCreateQuestion();
  const updateMutation = useUpdateQuestion();
  const deleteMutation = useDeleteQuestion();
  const publishMutation = usePublishQuestion();
  const archiveMutation = useArchiveQuestion();
  const restoreMutation = useRestoreQuestion();

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    publishMutation.isPending ||
    archiveMutation.isPending ||
    restoreMutation.isPending;

  // ── Report debug info ─────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: editRecord?.questionId ?? detailQuestionId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  // ── Filter handlers ───────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const newFilters: QuestionFilters = {};
    if (search.trim()) newFilters.search = search.trim();
    if (filterSubjectId) newFilters.subjectId = filterSubjectId;
    if (filterChapterId) newFilters.chapterId = filterChapterId;
    if (filterDifficulty) newFilters.difficulty = filterDifficulty as DifficultyLevel;
    if (filterQuestionType) newFilters.questionType = filterQuestionType as QuestionType;
    if (filterStatus) newFilters.status = filterStatus as QuestionStatus;
    if (filterCreatedBy) newFilters.createdBy = filterCreatedBy;
    if (user?.instituteId) newFilters.instituteId = user.instituteId;
    setFilters(newFilters);
    setPage(1);
    setLastHookCalled('useQuestions [search]');
  }, [search, filterSubjectId, filterChapterId, filterDifficulty, filterQuestionType, filterStatus, filterCreatedBy, user]);

  const handleResetFilters = useCallback(() => {
    setSearch('');
    setFilterSubjectId('');
    setFilterChapterId('');
    setFilterDifficulty('');
    setFilterQuestionType('');
    setFilterStatus('');
    setFilterCreatedBy('');
    setFilters({});
    setPage(1);
    setLastHookCalled('useQuestions [reset]');
  }, []);

  // ── Form handlers ─────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setEditRecord(null);
    setDetailQuestionId(null);
    setFormQuestionText('');
    setFormSubjectId('');
    setFormChapterId('');
    setFormDifficulty('medium');
    setFormQuestionType('mcq');
    setFormMarks(4);
    setFormNegativeMarks(0);
    setFormIsOriginal(true);
    setFormParentQuestionId('');
    setFormError(null);
  }, []);

  const populateForm = useCallback((q: Question) => {
    setEditRecord(q);
    setDetailQuestionId(null);
    setFormQuestionText(q.questionText);
    setFormSubjectId(q.subjectId);
    setFormChapterId(q.chapterId);
    setFormDifficulty(q.difficulty);
    setFormQuestionType(q.questionType);
    setFormMarks(q.marks);
    setFormNegativeMarks(q.negativeMarks);
    setFormIsOriginal(!q.parentQuestionId);
    setFormParentQuestionId(q.parentQuestionId ?? '');
    setFormError(null);
  }, []);

  const handleFormSubmit = useCallback(() => {
    setFormError(null);
    if (!formQuestionText.trim()) { setFormError('Question text is required.'); return; }
    if (formQuestionText.trim().length < 10) { setFormError('Question text must be at least 10 characters.'); return; }
    if (!formSubjectId) { setFormError('Subject ID is required.'); return; }
    if (!formChapterId) { setFormError('Chapter ID is required.'); return; }

    if (editRecord) {
      const input: UpdateQuestionInput = {
        questionText: formQuestionText.trim(),
        subjectId: formSubjectId,
        chapterId: formChapterId,
        difficulty: formDifficulty,
        marks: formMarks,
        negativeMarks: formNegativeMarks,
        parentQuestionId: formIsOriginal ? null : (formParentQuestionId || null),
      };
      setLastHookCalled('useUpdateQuestion');
      updateMutation.mutate(
        { id: editRecord.questionId, input },
        {
          onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
          onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
        },
      );
    } else {
      if (!user?.instituteId) { setFormError('No institute ID available. Sign in to create.'); return; }
      if (!user?.id) { setFormError('No user ID available. Sign in to create.'); return; }
      const input: CreateQuestionInput = {
        instituteId: user.instituteId,
        subjectId: formSubjectId,
        chapterId: formChapterId,
        createdBy: user.id,
        questionType: formQuestionType,
        difficulty: formDifficulty,
        questionText: formQuestionText.trim(),
        marks: formMarks,
        negativeMarks: formNegativeMarks,
        parentQuestionId: formIsOriginal ? null : (formParentQuestionId || null),
      };
      setLastHookCalled('useCreateQuestion');
      createMutation.mutate(input, {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      });
    }
  }, [formQuestionText, formSubjectId, formChapterId, formDifficulty, formQuestionType, formMarks, formNegativeMarks, formIsOriginal, formParentQuestionId, editRecord, user, createMutation, updateMutation, resetForm]);

  const handleDelete = useCallback((q: Question) => {
    if (!window.confirm(`Permanently delete question "${q.questionId.slice(0, 8)}..."?`)) return;
    setLastHookCalled('useDeleteQuestion');
    deleteMutation.mutate(q.questionId, {
      onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: q.questionId })); if (editRecord?.questionId === q.questionId) resetForm(); },
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [deleteMutation, editRecord, resetForm]);

  const handlePublish = useCallback((q: Question) => {
    setLastHookCalled('usePublishQuestion');
    publishMutation.mutate(q.questionId, {
      onSuccess: (result) => setLastApiResponse(JSON.stringify(result)),
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [publishMutation]);

  const handleArchive = useCallback((q: Question) => {
    setLastHookCalled('useArchiveQuestion');
    archiveMutation.mutate(q.questionId, {
      onSuccess: (result) => setLastApiResponse(JSON.stringify(result)),
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [archiveMutation]);

  const handleRestore = useCallback((q: Question) => {
    setLastHookCalled('useRestoreQuestion');
    restoreMutation.mutate(q.questionId, {
      onSuccess: (result) => setLastApiResponse(JSON.stringify(result)),
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [restoreMutation]);

  const handleViewDetail = useCallback((questionId: string) => {
    setDetailQuestionId(questionId);
    setEditRecord(null);
    setLastHookCalled('useQuestion [detail]');
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Questions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Create, read, update, delete, publish, archive, restore</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(data?.count ?? 0) + ' questions'} variant={data ? 'info' : 'neutral'} />
        </div>
      </div>

      {!user?.instituteId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400 font-medium">⚠ No Institute assigned. Create/Update operations disabled.</span>
        </div>
      )}

      {formError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{String(formError)}</span>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Search</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Question text..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Subject ID</label>
            <input type="text" value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[200px]" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Chapter ID</label>
            <input type="text" value={filterChapterId} onChange={(e) => setFilterChapterId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[200px]" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Difficulty</label>
            <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
              <option value="">All</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Type</label>
            <select value={filterQuestionType} onChange={(e) => setFilterQuestionType(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
              <option value="">All</option>
              {QUESTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Created By</label>
            <input type="text" value={filterCreatedBy} onChange={(e) => setFilterCreatedBy(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 w-[200px]" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Sort</label>
            <div className="flex gap-1">
              <select value={sortField} onChange={(e) => setSortField(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
                {SORT_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')} className="rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 w-16">
                <option value="desc">DESC</option>
                <option value="asc">ASC</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={handleSearch} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Apply</button>
          <button type="button" onClick={handleResetFilters} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Reset</button>
          <button type="button" onClick={() => { refetch().catch(() => {}); setLastHookCalled('useQuestions [refetch]'); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
      </div>

      {/* ── Create / Edit Form ──────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-200">
            {editRecord ? `Edit Question: ${editRecord.questionId.slice(0, 8)}...` : 'Create New Question'}
          </span>
          {editRecord && <button type="button" onClick={resetForm} className="text-[11px] text-gray-500">Cancel</button>}
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Question Text *</label>
              <textarea
                value={formQuestionText}
                onChange={(e) => setFormQuestionText(e.target.value)}
                placeholder="Enter question stem (minimum 10 chars)..."
                rows={3}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 resize-y"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Subject ID *</label>
              <input type="text" value={formSubjectId} onChange={(e) => setFormSubjectId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Chapter ID *</label>
              <input type="text" value={formChapterId} onChange={(e) => setFormChapterId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Difficulty</label>
              <select value={formDifficulty} onChange={(e) => setFormDifficulty(e.target.value as DifficultyLevel)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Question Type</label>
              <select value={formQuestionType} onChange={(e) => setFormQuestionType(e.target.value as QuestionType)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                {QUESTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Marks</label>
              <input type="number" value={formMarks} onChange={(e) => setFormMarks(Number(e.target.value))} min={1} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Negative Marks</label>
              <input type="number" value={formNegativeMarks} onChange={(e) => setFormNegativeMarks(Number(e.target.value))} min={0} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5 flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formIsOriginal} onChange={(e) => setFormIsOriginal(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-amber-600" />
                <span className="text-xs text-gray-300">Original question (no parent)</span>
              </label>
            </div>
            {!formIsOriginal && (
              <div className="space-y-1.5">
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Parent Question UUID</label>
                <input type="text" value={formParentQuestionId} onChange={(e) => setFormParentQuestionId(e.target.value)} placeholder="UUID of parent version" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={isMutating || !formQuestionText.trim() || !formSubjectId || !formChapterId || !user?.instituteId}
              onClick={handleFormSubmit}
              className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
            >
              {isMutating ? 'Saving...' : editRecord ? 'Update Question' : 'Create Question'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Questions Table ──────────────────────────────────────────────── */}
      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Question Text</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Type</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Difficulty</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Marks</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Neg</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Ver</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Attempts</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Created</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data && data.data.length > 0 ? data.data.map((q) => (
                <tr key={q.questionId} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2.5 text-gray-200 max-w-[300px] truncate font-medium" title={q.questionText}>
                    <button type="button" onClick={() => handleViewDetail(q.questionId)} className="hover:text-blue-400 transition-colors text-left">
                      {q.questionText.slice(0, 80)}{q.questionText.length > 80 ? '...' : ''}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-gray-400">{q.questionType}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge label={q.difficulty} variant={q.difficulty === 'hard' ? 'error' : q.difficulty === 'medium' ? 'warning' : 'info'} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge label={q.status} variant={STATUS_VARIANT[q.status]} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-300">{q.marks}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{q.negativeMarks}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{q.version}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{q.timesAttempted}</td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{new Date(q.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => populateForm(q)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700">Edit</button>
                      {q.status === 'pending_approval' && (
                        <button type="button" onClick={() => handlePublish(q)} disabled={publishMutation.isPending} className="rounded bg-green-900/50 px-2 py-1 text-[11px] text-green-300 hover:bg-green-900/70 disabled:opacity-40">Pub</button>
                      )}
                      {q.status === 'published' && (
                        <button type="button" onClick={() => handleArchive(q)} disabled={archiveMutation.isPending} className="rounded bg-amber-900/50 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/70 disabled:opacity-40">Arc</button>
                      )}
                      {q.status === 'archived' && (
                        <button type="button" onClick={() => handleRestore(q)} disabled={restoreMutation.isPending} className="rounded bg-blue-900/50 px-2 py-1 text-[11px] text-blue-300 hover:bg-blue-900/70 disabled:opacity-40">Res</button>
                      )}
                      <button type="button" onClick={() => handleDelete(q)} disabled={deleteMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70 disabled:opacity-40">Del</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No questions found'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && data.pageCount > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-700 bg-gray-800/30">
            <span className="text-[11px] text-gray-500">Page {data.page} of {data.pageCount} ({data.count} total)</span>
            <div className="flex gap-1.5">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300 disabled:opacity-40">Prev</button>
              <button type="button" disabled={page >= data.pageCount} onClick={() => setPage((p) => p + 1)} className="rounded bg-gray-800 px-2.5 py-1 text-[11px] text-gray-300 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Question Detail ──────────────────────────────────────────────── */}
      {detailQuestionId && (
        <div className="rounded border border-blue-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-blue-700/50 bg-blue-950/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-300">Question Detail: {detailQuestionId}</span>
            <button type="button" onClick={() => setDetailQuestionId(null)} className="text-[11px] text-gray-500">Close</button>
          </div>
          <div className="p-4">
            {detailLoading ? (
              <LoadingIndicator label="Loading detail..." />
            ) : detailQuestion ? (
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="text-gray-500">ID:</span> <span className="font-mono">{detailQuestion.questionId}</span></div>
                <div><span className="text-gray-500">Institute:</span> <span className="font-mono">{detailQuestion.instituteId}</span></div>
                <div><span className="text-gray-500">Subject:</span> <span className="font-mono">{detailQuestion.subjectId}</span></div>
                <div><span className="text-gray-500">Chapter:</span> <span className="font-mono">{detailQuestion.chapterId}</span></div>
                <div><span className="text-gray-500">Created By:</span> <span className="font-mono">{detailQuestion.createdBy}</span></div>
                <div><span className="text-gray-500">Parent:</span> <span className="font-mono">{detailQuestion.parentQuestionId ?? '(original)'}</span></div>
                <div><span className="text-gray-500">Question Type:</span> {detailQuestion.questionType}</div>
                <div><span className="text-gray-500">Difficulty:</span> {detailQuestion.difficulty}</div>
                <div><span className="text-gray-500">Status:</span> <StatusBadge label={detailQuestion.status} variant={STATUS_VARIANT[detailQuestion.status]} /></div>
                <div><span className="text-gray-500">Version:</span> {detailQuestion.version}</div>
                <div><span className="text-gray-500">Marks:</span> {detailQuestion.marks}</div>
                <div><span className="text-gray-500">Negative Marks:</span> {detailQuestion.negativeMarks}</div>
                <div><span className="text-gray-500">Times Attempted:</span> {detailQuestion.timesAttempted}</div>
                <div><span className="text-gray-500">Avg Time (s):</span> {detailQuestion.averageTimeSeconds ?? '—'}</div>
                <div><span className="text-gray-500">Created:</span> {new Date(detailQuestion.createdAt).toLocaleString()}</div>
                <div><span className="text-gray-500">Updated:</span> {new Date(detailQuestion.updatedAt).toLocaleString()}</div>
                <div><span className="text-gray-500">Approved At:</span> {detailQuestion.approvedAt ? new Date(detailQuestion.approvedAt).toLocaleString() : '—'}</div>
                <div className="pt-2 border-t border-gray-700"><span className="text-gray-500">Question Text:</span></div>
                <pre className="bg-gray-950 rounded p-2 text-gray-300 whitespace-pre-wrap">{detailQuestion.questionText}</pre>
              </div>
            ) : (
              <span className="text-xs text-gray-500">Question not found or failed to load.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
