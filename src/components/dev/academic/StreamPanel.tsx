'use client';

import { useState, useCallback, useEffect } from 'react';
import { useStreams, useCreateStream, useUpdateStream, useDeleteStream } from '@/hooks/academic/useStreams';
import { useAuth } from '@/hooks/useAuth';
import type { Stream, CreateStreamInput, UpdateStreamInput, StreamFilters } from '@/types/academic';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface StreamDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface StreamPanelProps {
  onDebugInfo?: (info: StreamDebugInfo) => void;
}

export default function StreamPanel({ onDebugInfo }: StreamPanelProps) {
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<boolean | undefined>(undefined);
  const [filters, setFilters] = useState<StreamFilters>({});
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [editRecord, setEditRecord] = useState<Stream | null>(null);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formDisplayOrder, setFormDisplayOrder] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  const { data, isLoading, isFetching, isStale, refetch } = useStreams(
    Object.keys(filters).length ? filters : undefined,
    { sortBy: 'displayOrder', sortDirection: 'asc' },
    { page, pageSize },
  );
  const createMutation = useCreateStream();
  const updateMutation = useUpdateStream();
  const deleteMutation = useDeleteStream();

  // ── Report debug info on every render ──────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
      selectedRecord: editRecord?.streamId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  const handleSearch = useCallback(() => {
    const newFilters: StreamFilters = {};
    if (search.trim()) newFilters.search = search.trim();
    if (filterActive !== undefined) newFilters.isActive = filterActive;
    if (user?.instituteId) newFilters.instituteId = user.instituteId;
    setFilters(newFilters);
    setPage(1);
    setLastHookCalled('useStreams [search]');
  }, [search, filterActive, user]);

  const handleResetFilters = useCallback(() => {
    setSearch('');
    setFilterActive(undefined);
    setFilters({});
    setPage(1);
    setLastHookCalled('useStreams [reset]');
  }, []);

  const resetForm = useCallback(() => {
    setEditRecord(null);
    setFormName('');
    setFormCode('');
    setFormDescription('');
    setFormIsActive(true);
    setFormDisplayOrder(0);
    setFormError(null);
  }, []);

  const populateForm = useCallback((stream: Stream) => {
    setEditRecord(stream);
    setFormName(stream.name);
    setFormCode(stream.code);
    setFormDescription(stream.description ?? '');
    setFormIsActive(stream.isActive);
    setFormDisplayOrder(stream.displayOrder);
    setFormError(null);
  }, []);

  const handleFormSubmit = useCallback(() => {
    setFormError(null);
    if (!formName.trim() || !formCode.trim()) {
      setFormError('Name and Code are required.');
      return;
    }

    if (editRecord) {
      const input: UpdateStreamInput = {
        name: formName.trim(),
        code: formCode.trim().toUpperCase(),
        description: formDescription.trim() || null,
        isActive: formIsActive,
        displayOrder: formDisplayOrder,
        updatedBy: user?.id ?? null,
      };
      setLastHookCalled('useUpdateStream');
      updateMutation.mutate(
        { id: editRecord.streamId, input },
        {
          onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
          onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
        },
      );
    } else {
      const input: CreateStreamInput = {
        instituteId: user?.instituteId ?? '',
        name: formName.trim(),
        code: formCode.trim().toUpperCase(),
        description: formDescription.trim() || null,
        isActive: formIsActive,
        displayOrder: formDisplayOrder,
        createdBy: user?.id ?? null,
      };
      setLastHookCalled('useCreateStream');
      createMutation.mutate(input, {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      });
    }
  }, [formName, formCode, formDescription, formIsActive, formDisplayOrder, editRecord, user, createMutation, updateMutation, resetForm]);

  const handleDelete = useCallback((stream: Stream) => {
    if (!window.confirm(`Delete stream "${stream.name}" (${stream.code})?`)) return;
    setLastHookCalled('useDeleteStream');
    deleteMutation.mutate(stream.streamId, {
      onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: stream.streamId })); if (editRecord?.streamId === stream.streamId) resetForm(); },
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [deleteMutation, editRecord, resetForm]);

  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Streams</h2>
          <p className="text-xs text-gray-500 mt-0.5">Create, read, update, and delete exam streams</p>
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
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code..." className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Active</label>
            <select value={filterActive === undefined ? '' : String(filterActive)} onChange={(e) => setFilterActive(e.target.value === '' ? undefined : e.target.value === 'true')} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
              <option value="">All</option>
              <option value="true">Active Only</option>
              <option value="false">Inactive Only</option>
            </select>
          </div>
          <button type="button" onClick={handleSearch} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Apply</button>
          <button type="button" onClick={handleResetFilters} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Reset</button>
          <button type="button" onClick={() => { refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
      </div>

      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-200">{editRecord ? 'Edit Stream: ' + editRecord.name : 'Create New Stream'}</span>
          {editRecord && <button type="button" onClick={resetForm} className="text-[11px] text-gray-500">Cancel</button>}
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Name *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. NEET" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Code *</label>
              <input type="text" value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="e.g. NEET" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Description</label>
              <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Optional description" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Display Order</label>
              <input type="number" value={formDisplayOrder} onChange={(e) => setFormDisplayOrder(Number(e.target.value))} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5 flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formIsActive} onChange={(e) => setFormIsActive(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-amber-600" />
                <span className="text-xs text-gray-300">Active</span>
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">          <button
            type="button"
            disabled={isMutating || !formName.trim() || !formCode.trim() || !user?.instituteId}
            onClick={handleFormSubmit}
            className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
          >
            {isMutating ? 'Saving...' : editRecord ? 'Update Stream' : 'Create Stream'}
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
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Code</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Institute</th>
                <th className="text-center px-3 py-2 text-gray-500 font-medium">Active</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Order</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Created</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data && data.data.length > 0 ? data.data.map((stream) => (
                <tr key={stream.streamId} className="border-b border-gray-800">
                  <td className="px-3 py-2.5 text-gray-200 font-medium">{stream.name}</td>
                  <td className="px-3 py-2.5 text-gray-400 font-mono">{stream.code}</td>
                  <td className="px-3 py-2.5 text-gray-400 font-mono text-[10px]">{stream.instituteId.slice(0, 8)}...</td>
                  <td className="px-3 py-2.5 text-center"><StatusBadge label={stream.isActive ? 'Yes' : 'No'} variant={stream.isActive ? 'success' : 'error'} /></td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{stream.displayOrder}</td>
                  <td className="px-3 py-2.5 text-gray-500">{new Date(stream.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" onClick={() => populateForm(stream)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300">Edit</button>
                      <button type="button" onClick={() => handleDelete(stream)} disabled={deleteMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 disabled:opacity-40">Delete</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No streams found'}</td>
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
