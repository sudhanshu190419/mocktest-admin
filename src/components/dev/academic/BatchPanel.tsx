'use client';

import { useState, useCallback, useEffect } from 'react';
import { useBatches, useCreateBatch, useUpdateBatch, useDeleteBatch } from '@/hooks/academic/useBatches';
import { useStreams } from '@/hooks/academic/useStreams';
import { useAuth } from '@/hooks/useAuth';
import type { Batch, CreateBatchInput, UpdateBatchInput, BatchFilters, BatchStatus } from '@/types/academic';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';

export interface BatchDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface BatchPanelProps {
  onDebugInfo?: (info: BatchDebugInfo) => void;
}

const BATCH_STATUSES: BatchStatus[] = ['upcoming', 'active', 'completed', 'archived'];

export default function BatchPanel({ onDebugInfo }: BatchPanelProps) {
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [filterStreamId, setFilterStreamId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [filters, setFilters] = useState<BatchFilters>({});
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [editRecord, setEditRecord] = useState<Batch | null>(null);
  const [formName, setFormName] = useState('');
  const [formBatchCode, setFormBatchCode] = useState('');
  const [formAcademicYear, setFormAcademicYear] = useState('');
  const [formStreamId, setFormStreamId] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formMaxSeats, setFormMaxSeats] = useState('');
  const [formStatus, setFormStatus] = useState<BatchStatus>('upcoming');
  const [formError, setFormError] = useState<string | null>(null);
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);

  const { data: streamsData } = useStreams(
    user?.instituteId ? { instituteId: user.instituteId } : undefined,
    { sortBy: 'name', sortDirection: 'asc' },
    { page: 1, pageSize: 100 },
  );

  const { data, isLoading, isFetching, isStale, refetch } = useBatches(
    Object.keys(filters).length ? filters : undefined,
    { sortBy: 'startDate', sortDirection: 'desc' },
    { page, pageSize },
  );
  const createMutation = useCreateBatch();
  const updateMutation = useUpdateBatch();
  const deleteMutation = useDeleteBatch();

  // ── Report debug info ────────────────────────────────────────────────
  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
      selectedRecord: editRecord?.batchId ?? null,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: formError,
    });
  });

  const handleSearch = useCallback(() => {
    const newFilters: BatchFilters = {};
    if (search.trim()) newFilters.search = search.trim();
    if (filterStreamId) newFilters.streamId = filterStreamId;
    if (filterStatus) newFilters.status = filterStatus as BatchStatus;
    if (includeDeleted) newFilters.includeDeleted = true;
    if (user?.instituteId) newFilters.instituteId = user.instituteId;
    setFilters(newFilters);
    setPage(1);
    setLastHookCalled('useBatches [search]');
  }, [search, filterStreamId, filterStatus, includeDeleted, user]);

  const handleResetFilters = useCallback(() => {
    setSearch('');
    setFilterStreamId('');
    setFilterStatus('');
    setIncludeDeleted(false);
    setFilters({});
    setPage(1);
    setLastHookCalled('useBatches [reset]');
  }, []);

  const resetForm = useCallback(() => {
    setEditRecord(null);
    setFormName('');
    setFormBatchCode('');
    setFormAcademicYear('');
    setFormStreamId('');
    setFormStartDate('');
    setFormEndDate('');
    setFormMaxSeats('');
    setFormStatus('upcoming');
    setFormError(null);
  }, []);

  const populateForm = useCallback((batch: Batch) => {
    setEditRecord(batch);
    setFormName(batch.name);
    setFormBatchCode(batch.batchCode);
    setFormAcademicYear(batch.academicYear);
    setFormStreamId(batch.streamId);
    setFormStartDate(batch.startDate.slice(0, 10));
    setFormEndDate(batch.endDate.slice(0, 10));
    setFormMaxSeats(batch.maxSeats !== null ? String(batch.maxSeats) : '');
    setFormStatus(batch.status);
    setFormError(null);
  }, []);

  const handleFormSubmit = useCallback(() => {
    setFormError(null);
    if (!formName.trim() || !formBatchCode.trim() || !formStreamId || !formStartDate || !formEndDate) {
      setFormError('Name, Batch Code, Stream, Start Date, and End Date are required.');
      return;
    }

    if (editRecord) {
      const input: UpdateBatchInput = {
        name: formName.trim(),
        batchCode: formBatchCode.trim(),
        academicYear: formAcademicYear.trim() || undefined,
        startDate: formStartDate,
        endDate: formEndDate,
        maxSeats: formMaxSeats ? Number(formMaxSeats) : null,
        status: formStatus,
        updatedBy: user?.id ?? null,
      };
      setLastHookCalled('useUpdateBatch');
      updateMutation.mutate(
        { id: editRecord.batchId, input },
        { onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); }, onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); } },
      );
    } else {
      const input: CreateBatchInput = {
        instituteId: user?.instituteId ?? '',
        streamId: formStreamId,
        name: formName.trim(),
        batchCode: formBatchCode.trim(),
        academicYear: formAcademicYear.trim() || String(new Date().getFullYear()) + '-' + String(new Date().getFullYear() + 1).slice(2),
        startDate: formStartDate,
        endDate: formEndDate,
        maxSeats: formMaxSeats ? Number(formMaxSeats) : null,
        status: formStatus,
        createdBy: user?.id ?? null,
      };
      setLastHookCalled('useCreateBatch');
      createMutation.mutate(input, {
        onSuccess: (result) => { setLastApiResponse(JSON.stringify(result)); resetForm(); },
        onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
      });
    }
  }, [formName, formBatchCode, formAcademicYear, formStreamId, formStartDate, formEndDate, formMaxSeats, formStatus, editRecord, user, createMutation, updateMutation, resetForm]);

  const handleDelete = useCallback((batch: Batch) => {
    if (!window.confirm('Soft-delete batch "' + batch.name + '" (' + batch.batchCode + ')?')) return;
    setLastHookCalled('useDeleteBatch');
    deleteMutation.mutate(batch.batchId, {
      onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: batch.batchId })); if (editRecord?.batchId === batch.batchId) resetForm(); },
      onError: (err) => { setFormError(err.message); setLastApiResponse(err.message); },
    });
  }, [deleteMutation, editRecord, resetForm]);

  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const statusVariant = (status: BatchStatus): 'success' | 'warning' | 'info' | 'neutral' => {
    switch (status) {
      case 'active': return 'success';
      case 'upcoming': return 'info';
      case 'completed': return 'warning';
      case 'archived': return 'neutral';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Batches</h2>
          <p className="text-xs text-gray-500 mt-0.5">Create, read, update, and soft-delete batches</p>
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
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Stream</label>
            <select value={filterStreamId} onChange={(e) => setFilterStreamId(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200 min-w-[140px]">
              <option value="">All Streams</option>
              {streamsData && streamsData.data.map((s) => (
                <option key={s.streamId} value={s.streamId}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
              <option value="">All</option>
              {BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 flex items-end pb-1.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} className="rounded border-gray-700 bg-gray-950 text-amber-600" />
              <span className="text-[11px] text-gray-400">Include Deleted</span>
            </label>
          </div>
          <button type="button" onClick={handleSearch} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Apply</button>
          <button type="button" onClick={handleResetFilters} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Reset</button>
          <button type="button" onClick={() => { refetch().catch(() => {}); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
      </div>

      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-200">
            {editRecord ? 'Edit Batch: ' + editRecord.name : 'Create New Batch'}
          </span>
          {editRecord && (
            <button type="button" onClick={resetForm} className="text-[11px] text-gray-500">Cancel</button>
          )}
        </div>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Name *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. NEET 2026 Morning" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Batch Code *</label>
              <input type="text" value={formBatchCode} onChange={(e) => setFormBatchCode(e.target.value)} placeholder="e.g. NEET26-MOR-A" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Stream *</label>
              <select value={formStreamId} onChange={(e) => setFormStreamId(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                <option value="">Select Stream</option>
                {streamsData && streamsData.data.map((s) => (
                  <option key={s.streamId} value={s.streamId}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Academic Year</label>
              <input type="text" value={formAcademicYear} onChange={(e) => setFormAcademicYear(e.target.value)} placeholder="e.g. 2025-26" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Status</label>
              <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as BatchStatus)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200">
                {BATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Max Seats</label>
              <input type="number" value={formMaxSeats} onChange={(e) => setFormMaxSeats(e.target.value)} placeholder="Empty = unlimited" className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Start Date *</label>
              <input type="date" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">End Date *</label>
              <input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={isMutating || !formName.trim() || !formBatchCode.trim() || !formStreamId || !formStartDate || !formEndDate || !user?.instituteId} onClick={handleFormSubmit} className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 disabled:opacity-40">
              {isMutating ? 'Saving...' : editRecord ? 'Update Batch' : 'Create Batch'}
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
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Year</th>
                <th className="text-center px-3 py-2 text-gray-500 font-medium">Status</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Seats</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Start</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">End</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data && data.data.length > 0 ? data.data.map((batch) => (
                <tr key={batch.batchId} className="border-b border-gray-800">
                  <td className="px-3 py-2.5 text-gray-200 font-medium">{batch.name}</td>
                  <td className="px-3 py-2.5 text-gray-400 font-mono">{batch.batchCode}</td>
                  <td className="px-3 py-2.5 text-gray-400">{batch.academicYear}</td>
                  <td className="px-3 py-2.5 text-center">
                    <StatusBadge label={batch.status} variant={statusVariant(batch.status)} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{batch.maxSeats ?? '∞'}</td>
                  <td className="px-3 py-2.5 text-gray-500">{new Date(batch.startDate).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-gray-500">{new Date(batch.endDate).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" onClick={() => populateForm(batch)} className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300">Edit</button>
                      <button type="button" onClick={() => handleDelete(batch)} disabled={deleteMutation.isPending} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 disabled:opacity-40">Del</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No batches found'}</td>
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
