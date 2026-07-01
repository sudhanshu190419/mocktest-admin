'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  useMockAttempts,
  useMockAttempt,
  useCreateMockAttempt,
  useUpdateMockAttempt,
  useDeleteMockAttempt,
  useMockAnswers,
  useMockResultByAttempt,
} from '@/hooks/mockTest/useMockAttempts';
import { useAuth } from '@/hooks/useAuth';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';
import type { MockAttempt, MockAttemptFilters, MockAttemptSortOptions } from '@/types/mockTest';

const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'timed_out', 'abandoned'];
const STATUS_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  in_progress: 'info',
  submitted: 'success',
  timed_out: 'warning',
  abandoned: 'neutral',
};

export interface AttemptsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHookCalled: string;
  lastApiResponse: string | null;
  errorMessage: string | null;
}

interface AttemptsPanelProps {
  onDebugInfo?: (info: AttemptsDebugInfo) => void;
}

export default function AttemptsPanel({ onDebugInfo }: AttemptsPanelProps) {
  const { user } = useAuth();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [testId, setTestId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filters, setFilters] = useState<MockAttemptFilters>({});
  const [sortField, setSortField] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [lastHookCalled, setLastHookCalled] = useState<string>('—');
  const [lastApiResponse, setLastApiResponse] = useState<string | null>(null);
  const [formTestId, setFormTestId] = useState('');
  const [formStudentId, setFormStudentId] = useState('');

  const sort: MockAttemptSortOptions = {
    sortBy: sortField as MockAttemptSortOptions['sortBy'],
    sortDirection: sortDir,
  };

  const appliedFilters = Object.keys(filters).length > 0 ? filters : undefined;
  const { data, isLoading, isFetching, isStale, refetch } = useMockAttempts(appliedFilters, sort, { page, pageSize: 15 });
  const { data: detail, isLoading: detailLoading } = useMockAttempt(detailId);
  const { data: answers } = useMockAnswers(detailId);
  const { data: result } = useMockResultByAttempt(detailId);

  const createMutation = useCreateMockAttempt();
  const updateMutation = useUpdateMockAttempt();
  const deleteMutation = useDeleteMockAttempt();

  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  useEffect(() => {
    if (!onDebugInfo) return;
    onDebugInfo({
      loading: isLoading,
      mutationLoading: isMutating,
      selectedRecord: detailId,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isFetching ? 'fetching' : isLoading ? 'loading' : 'idle',
      lastHookCalled,
      lastApiResponse,
      errorMessage: error,
    });
  });

  const handleSearch = useCallback(() => {
    const newFilters: MockAttemptFilters = {};
    if (testId.trim()) newFilters.testId = testId.trim();
    if (studentId.trim()) newFilters.studentId = studentId.trim();
    if (filterStatus) newFilters.status = filterStatus as MockAttempt['status'];
    if (user?.instituteId) newFilters.instituteId = user.instituteId;
    setFilters(newFilters);
    setPage(1);
    setLastHookCalled('useMockAttempts [search]');
  }, [testId, studentId, filterStatus, user]);

  const handleReset = useCallback(() => {
    setTestId('');
    setStudentId('');
    setFilterStatus('');
    setFilters({});
    setPage(1);
    setLastHookCalled('useMockAttempts [reset]');
  }, []);

  const handleCreate = useCallback(() => {
    if (!formTestId.trim() || !formStudentId.trim()) {
      setError('Test ID and Student ID are required.');
      return;
    }
    if (!user?.instituteId) {
      setError('No institute ID.');
      return;
    }
    const input = {
      testId: formTestId.trim(),
      studentId: formStudentId.trim(),
      instituteId: user.instituteId,
    };
    setLastHookCalled('useCreateMockAttempt');
    createMutation.mutate(input, {
      onSuccess: (r) => { setLastApiResponse(JSON.stringify(r)); setFormTestId(''); setFormStudentId(''); setError(null); },
      onError: (err) => { setError(err.message); setLastApiResponse(err.message); },
    });
  }, [formTestId, formStudentId, user, createMutation]);

  const handleUpdateStatus = useCallback((id: string, status: MockAttempt['status']) => {
    setLastHookCalled('useUpdateMockAttempt');
    updateMutation.mutate({ id, input: { status, submittedAt: status !== 'in_progress' ? new Date().toISOString() : null } }, {
      onSuccess: (r) => setLastApiResponse(JSON.stringify(r)),
      onError: (err) => { setError(err.message); setLastApiResponse(err.message); },
    });
  }, [updateMutation]);

  const handleDelete = useCallback((id: string) => {
    if (!window.confirm('Delete this attempt?')) return;
    setLastHookCalled('useDeleteMockAttempt');
    deleteMutation.mutate(id, {
      onSuccess: () => { setLastApiResponse(JSON.stringify({ deleted: id })); if (detailId === id) setDetailId(null); },
      onError: (err) => { setError(err.message); setLastApiResponse(err.message); },
    });
  }, [deleteMutation, detailId]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100">Attempts</h2>
          <p className="text-xs text-gray-500 mt-0.5">List, start, resume, pause, delete attempts</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <LoadingIndicator label="Loading..." />}
          {isMutating && <LoadingIndicator label="Mutating..." />}
          <StatusBadge label={String(data?.count ?? 0) + ' attempts'} variant={data ? 'info' : 'neutral'} />
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-2.5">
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}

      {/* Create Form */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="text-xs font-semibold text-gray-200 mb-2">Start New Attempt</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[200px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Test ID *</label>
            <input type="text" value={formTestId} onChange={(e) => setFormTestId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <div className="space-y-1 min-w-[200px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Student ID *</label>
            <input type="text" value={formStudentId} onChange={(e) => setFormStudentId(e.target.value)} placeholder="UUID" className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <button type="button" onClick={handleCreate} disabled={isMutating || !formTestId || !formStudentId} className="rounded bg-amber-800 px-4 py-1.5 text-xs font-medium text-amber-100 disabled:opacity-40">
            {createMutation.isPending ? 'Starting...' : 'Start Attempt'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded border border-gray-700 bg-gray-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Test ID</label>
            <input type="text" value={testId} onChange={(e) => setTestId(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <div className="space-y-1 min-w-[180px]">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Student ID</label>
            <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200" />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
              <option value="">All</option>
              {ATTEMPT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500">Sort</label>
            <div className="flex gap-1">
              <select value={sortField} onChange={(e) => setSortField(e.target.value)} className="rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-200">
                <option value="createdAt">Created</option>
                <option value="startedAt">Started</option>
                <option value="submittedAt">Submitted</option>
                <option value="status">Status</option>
              </select>
              <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')} className="rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 w-16">
                <option value="desc">DESC</option>
                <option value="asc">ASC</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={handleSearch} className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white">Apply</button>
          <button type="button" onClick={handleReset} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Reset</button>
          <button type="button" onClick={() => { refetch().catch(() => {}); setLastHookCalled('useMockAttempts [refetch]'); }} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300">Refresh</button>
        </div>
      </div>

      {/* Attempts Table */}
      <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Attempt ID</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Student</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Started</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Submitted</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Attempt #</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data && data.data.length > 0 ? data.data.map((a) => (
                <tr key={a.attemptId} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => { setDetailId(a.attemptId); setLastHookCalled('useMockAttempt [detail]'); }} className="hover:text-blue-400 transition-colors font-mono text-[10px]">
                      {a.attemptId.slice(0, 8)}...
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-gray-400 font-mono text-[10px]">{a.studentId.slice(0, 8)}...</td>
                  <td className="px-3 py-2.5"><StatusBadge label={a.status} variant={STATUS_VARIANT[a.status] ?? 'neutral'} /></td>
                  <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{new Date(a.startedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-gray-500">{a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-300">#{a.attemptNumber}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {a.status === 'in_progress' && (
                        <button type="button" onClick={() => handleUpdateStatus(a.attemptId, 'submitted')} className="rounded bg-green-900/50 px-2 py-1 text-[11px] text-green-300">Submit</button>
                      )}
                      <button type="button" onClick={() => handleDelete(a.attemptId)} className="rounded bg-red-900/50 px-2 py-1 text-[11px] text-red-300 disabled:opacity-40" disabled={deleteMutation.isPending}>Del</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-600">{isLoading ? 'Loading...' : 'No attempts found'}</td></tr>
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

      {/* Detail View */}
      {detailId && (
        <div className="rounded border border-blue-700/50 bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-blue-700/50 bg-blue-950/30 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-300">Attempt Detail: {detailId}</span>
            <button type="button" onClick={() => setDetailId(null)} className="text-[11px] text-gray-500">Close</button>
          </div>
          <div className="p-4 space-y-3">
            {detailLoading ? <LoadingIndicator label="Loading detail..." /> : detail ? (
              <div className="space-y-2 text-xs text-gray-300">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  <div><span className="text-gray-500">Attempt ID:</span> <span className="font-mono">{detail.attemptId}</span></div>
                  <div><span className="text-gray-500">Test ID:</span> <span className="font-mono">{detail.testId}</span></div>
                  <div><span className="text-gray-500">Student ID:</span> <span className="font-mono">{detail.studentId}</span></div>
                  <div><span className="text-gray-500">Institute ID:</span> <span className="font-mono">{detail.instituteId}</span></div>
                  <div><span className="text-gray-500">Attempt #:</span> {detail.attemptNumber}</div>
                  <div><span className="text-gray-500">Status:</span> <StatusBadge label={detail.status} variant={STATUS_VARIANT[detail.status] ?? 'neutral'} /></div>
                  <div><span className="text-gray-500">Started:</span> {new Date(detail.startedAt).toLocaleString()}</div>
                  <div><span className="text-gray-500">Submitted:</span> {detail.submittedAt ? new Date(detail.submittedAt).toLocaleString() : '—'}</div>
                  <div><span className="text-gray-500">Time Remaining:</span> {detail.timeRemainingSeconds !== null ? `${detail.timeRemainingSeconds}s` : '—'}</div>
                </div>
                <div className="border-t border-gray-700 pt-2 mt-2">
                  <span className="text-gray-500 text-[10px] uppercase tracking-wider">Status Controls</span>
                  <div className="flex gap-2 mt-1">
                    {detail.status === 'in_progress' && (
                      <>
                        <button type="button" onClick={() => handleUpdateStatus(detail.attemptId, 'submitted')} className="rounded bg-green-900/50 px-3 py-1 text-[11px] text-green-300">Submit</button>
                        <button type="button" onClick={() => handleUpdateStatus(detail.attemptId, 'timed_out')} className="rounded bg-amber-900/50 px-3 py-1 text-[11px] text-amber-300">Time Out</button>
                        <button type="button" onClick={() => handleUpdateStatus(detail.attemptId, 'abandoned')} className="rounded bg-red-900/50 px-3 py-1 text-[11px] text-red-300">Abandon</button>
                      </>
                    )}
                  </div>
                </div>
                {/* Answers summary */}
                {answers && (
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <span className="text-gray-500 text-[10px] uppercase tracking-wider">Answers ({answers.length})</span>
                    <div className="grid grid-cols-4 gap-1 mt-1">
                      {answers.map((ans) => (
                        <div key={ans.answerId} className={`rounded px-2 py-1 text-[10px] border ${ans.isAnswered ? 'border-green-700/50 bg-green-950/20' : ans.isMarkedForReview ? 'border-amber-700/50 bg-amber-950/20' : 'border-gray-700 bg-gray-800/30'}`}>
                          <span className="font-mono">{ans.questionId.slice(0, 6)}</span>
                          <span className={`ml-1 ${ans.isAnswered ? 'text-green-400' : ans.isMarkedForReview ? 'text-amber-400' : 'text-gray-500'}`}>
                            {ans.isAnswered ? '✓' : ans.isMarkedForReview ? '⚑' : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Result summary */}
                {result && (
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <span className="text-gray-500 text-[10px] uppercase tracking-wider">Result</span>
                    <div className="grid grid-cols-4 gap-2 mt-1 text-xs">
                      <div><span className="text-gray-500">Score:</span> {result.totalScore}/{result.maxScore}</div>
                      <div><span className="text-gray-500">%:</span> {result.percentage.toFixed(1)}%</div>
                      <div><span className="text-gray-500">Rank:</span> {result.rank ?? '—'}</div>
                      <div><span className="text-gray-500">Correct:</span> {result.correctCount}</div>
                      <div><span className="text-gray-500">Wrong:</span> {result.wrongCount}</div>
                      <div><span className="text-gray-500">Skipped:</span> {result.skippedCount}</div>
                      <div><span className="text-gray-500">Released:</span>{' '}
                        <StatusBadge label={result.isReleased ? 'Yes' : 'No'} variant={result.isReleased ? 'success' : 'warning'} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-xs text-gray-500">Attempt not found or failed to load.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
