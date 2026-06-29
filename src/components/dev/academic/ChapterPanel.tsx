'use client';

import { useState, useCallback, useEffect } from 'react';
import { useChapters, useCreateChapter, useUpdateChapter, useDeleteChapter } from '@/hooks/academic/useChapters';
import { useSubjects } from '@/hooks/academic/useSubjects';
import { useAuth } from '@/hooks/useAuth';
import type { Chapter, CreateChapterInput, UpdateChapterInput, ChapterFilters } from '@/types/academic';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface ChapterDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface ChapterPanelProps {
  onDebugInfo?: (info: ChapterDebugInfo) => void;
}

export default function ChapterPanel({ onDebugInfo }: ChapterPanelProps) {
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [filters, setFilters] = useState<ChapterFilters>({});
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [editRecord, setEditRecord] = useState<Chapter | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formDisplayOrder, setFormDisplayOrder] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  const { data: subjectsData } = useSubjects(
    undefined,
    { sortBy: 'name', sortDirection: 'asc' },
    { page: 1, pageSize: 100 },
  );

  const { data, isLoading, isFetching, isStale, refetch } = useChapters(
    Object.keys(filters).length ? filters : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page, pageSize },
  );
  const createMutation = useCreateChapter();
  const updateMutation = useUpdateChapter();
  const deleteMutation = useDeleteChapter();

  // Build subject name lookup
  const subjectMap = new Map<string, string>();
  if (subjectsData) {
    for (const s of subjectsData.data) {
      subjectMap.set(s.subjectId, s.name);
    }
  }

  // ── Report debug info ────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
      selectedRecord: editRecord?.chapterId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  const handleSearch = useCallback(() => {
    const newFilters: ChapterFilters = {};
    if (search.trim()) newFilters.search = search.trim();
    if (filterSubjectId) newFilters.subjectId = filterSubjectId;
    setFilters(newFilters);
    setPage(1);
    setLastHookCalled('useChapters [search]');
  }, [search, filterSubjectId]);

  const handleResetFilters = useCallback(() => {
    setSearch('');
    setFilterSubjectId('');
    setFilters({});
    setPage(1);
    setLastHookCalled('useChapters [reset]');
  }, []);

  const resetForm = useCallback(() => {
    setEditRecord(null);
    setFormName('');
    setFormDescription('');
    setFormSubjectId('');
    setFormDisplayOrder(0);
    setFormError(null);
  }, []);

  const populateForm = useCallback((chapter: Chapter) => {
    setEditRecord(chapter);
    setFormName(chapter.name);
    setFormDescription(chapter.description ?? '');
    setFormSubjectId(chapter.subjectId);
    setFormDisplayOrder(chapter.displayOrder);
    setFormError(null);
  }, []);

  const handleFormSubmit = useCallback(() => {
    setFormError(null);
    if (!formName.trim() || !formSubjectId) {
      setFormError('Name and Subject are required.');
      return;
    }

    if (editRecord) {
      const input: UpdateChapterInput = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        displayOrder: formDisplayOrder,
        updatedBy: user?.id ?? null,
      };
      setLastHookCalled('useUpdateChapter');
      updateMutation.mutate(
        { id: editRecord.chapterId, input },
        { onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); }, onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); } },
      );
    } else {
      const input: CreateChapterInput = {
        subjectId: formSubjectId,
        name: formName.trim(),
        description: formDescription.trim() || null,
        displayOrder: formDisplayOrder,
        createdBy: user?.id ?? null,
      };
      setLastHookCalled('useCreateChapter');
      createMutation.mutate(input, {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      });
    }
  }, [formName, formDescription, formSubjectId, formDisplayOrder, editRecord, user, createMutation, updateMutation, resetForm]);

  const handleDelete = useCallback((chapter: Chapter) => {
    if (!window.confirm(`Delete chapter "${chapter.name}"?`)) return;
    setLastHookCalled('useDeleteChapter');
    deleteMutation.mutate(chapter.chapterId, {
      onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: chapter.chapterId })); if (editRecord?.chapterId === chapter.chapterId) resetForm(); },
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [deleteMutation, editRecord, resetForm]);

  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Chapters</h2>
          <p className="text-xs text-gray-500 mt-0.5">Create, read, update, and delete chapters</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(data?.count ?? 0) + ' records'} variant={data ? 'info' : 'neutral'} />
        </div>
      </div>

      {!user?.instituteId && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
          <span className="text-xs text-amber-400 font-medium">⚠ Current user has no Institute assigned. Create/Update operations are disabled.</span>
        </div>
      )}

      {formError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{String(formError)}</span>
        </div>
      )}

      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[200px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Search</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chapter name..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Subject</label>
            <select value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 min-w-[140px]">
              <option value="">All Subjects</option>
              {subjectsData && subjectsData.data.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>{s.name}</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={handleSearch} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Apply</button>
          <button type="button" onClick={handleResetFilters} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Reset</button>
          <button type="button" onClick={() => { refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
      </div>

      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-200">
            {editRecord ? 'Edit Chapter: ' + editRecord.name : 'Create New Chapter'}
          </span>
          {editRecord && (
            <button type="button" onClick={resetForm} className="text-[11px] text-gray-500">Cancel</button>
          )}
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Name *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Laws of Motion" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Subject *</label>
              <select value={formSubjectId} onChange={(e) => setFormSubjectId(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                <option value="">Select Subject</option>
                {subjectsData && subjectsData.data.map((s) => (
                  <option key={s.subjectId} value={s.subjectId}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Description</label>
              <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Optional description" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Display Order</label>
              <input type="number" value={formDisplayOrder} onChange={(e) => setFormDisplayOrder(Number(e.target.value))} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={isMutating || !formName.trim() || !formSubjectId || !user?.instituteId} onClick={handleFormSubmit} className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40">
              {isMutating ? 'Saving...' : editRecord ? 'Update Chapter' : 'Create Chapter'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Name</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Description</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Subject</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Order</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data && data.data.length > 0 ? data.data.map((chapter) => (
                <tr key={chapter.chapterId} className="border-b border-gray-800">
                  <td className="px-3 py-2.5 text-gray-200 font-medium">{chapter.name}</td>
                  <td className="px-3 py-2.5 text-gray-500 max-w-[200px] truncate">{chapter.description ?? '—'}</td>
                  <td className="px-3 py-2.5 text-gray-400">{subjectMap.get(chapter.subjectId) ?? chapter.subjectId.slice(0, 8) + '...'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{chapter.displayOrder}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" onClick={() => populateForm(chapter)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300">Edit</button>
                      <button type="button" onClick={() => handleDelete(chapter)} disabled={deleteMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 disabled:opacity-40">Delete</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No chapters found'}</td>
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
    </div>
  );
}
