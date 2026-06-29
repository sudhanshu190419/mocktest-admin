'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useApprovalRequests, usePendingApprovals, useApprovalHistory, useCreateApprovalRequest, useAssignReviewer, useApproveRequest, useRejectRequest, useReopenRequest, useCancelRequest } from '@/hooks/content/useApproval';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';
import type { ApprovalStatus } from '@/types/content';
import type { ApprovalQueryFilters } from '@/services/content/approvalService';

export interface ApprovalDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHook: string;
  lastResponse: string;
  errorMessage: string | null;
}

interface ApprovalPanelProps {
  onDebugInfo?: (info: ApprovalDebugInfo) => void;
}

const STATUSES: ApprovalStatus[] = ['pending', 'approved', 'rejected'];
const PAGE_SIZE = 10;

export default function ApprovalPanel({ onDebugInfo }: ApprovalPanelProps) {
  const { user } = useAuth();
  const instituteId = user?.instituteId ?? '';

  // -- Filters --
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selectedId] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [historyResourceId, setHistoryResourceId] = useState('');

  // -- Form --
  const [formResourceType, setFormResourceType] = useState<'content' | 'mock_test'>('content');
  const [formResourceId, setFormResourceId] = useState('');
  const [formApprovalId, setFormApprovalId] = useState('');
  const [formReviewerId, setFormReviewerId] = useState('');
  const [formRemarks, setFormRemarks] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const filters: ApprovalQueryFilters = { instituteId };
  if (search) filters.search = search;
  if (statusFilter) filters.approvalStatus = statusFilter;

  const { data, isLoading, isFetching, isStale, error: queryError, refetch } = useApprovalRequests(
    filters, { sortBy: 'requestedAt', sortDirection: 'desc' }, { page, pageSize: PAGE_SIZE },
  );

  const { data: pendingData, isLoading: pendingLoading } = usePendingApprovals(instituteId);
  const { data: historyData, isLoading: historyLoading } = useApprovalHistory(historyResourceId || null, formResourceType);

  const createMutation = useCreateApprovalRequest();
  const assignMutation = useAssignReviewer();
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();
  const reopenMutation = useReopenRequest();
  const cancelMutation = useCancelRequest();

  const anyMutationLoading = createMutation.isPending || assignMutation.isPending || approveMutation.isPending || rejectMutation.isPending || reopenMutation.isPending || cancelMutation.isPending;
  const errorMessage = formError ?? queryError?.message ?? null;
  const items = data?.data ?? [];
  const totalPages = data?.pageCount ?? 1;
  const pendingItems = pendingData?.data ?? [];

  const reportDebug = useCallback(() => {
    onDebugInfo?.({
      loading: isLoading || isFetching || pendingLoading || historyLoading,
      mutationLoading: anyMutationLoading,
      selectedRecord: selectedId,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isLoading ? 'loading' : isFetching ? 'fetching' : 'idle',
      lastHook: 'useApprovalRequests,usePendingApprovals,useApprovalHistory,useCreateApprovalRequest,useAssignReviewer,useApproveRequest,useRejectRequest,useReopenRequest,useCancelRequest',
      lastResponse: JSON.stringify(data ?? {}).slice(0, 200),
      errorMessage,
    });
  }, [isLoading, isFetching, pendingLoading, historyLoading, anyMutationLoading, selectedId, isStale, data, errorMessage, onDebugInfo]);

  useEffect(() => { reportDebug(); }, [reportDebug]);

  const handleCreate = () => {
    if (!formResourceId) { setFormError('Resource ID is required'); return; }
    setFormError(null);
    createMutation.mutate({ resourceType: formResourceType, resourceId: formResourceId, requestedBy: user!.id }, {
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleAssign = () => {
    if (!formApprovalId || !formReviewerId) { setFormError('Approval ID and Reviewer ID are required'); return; }
    setFormError(null);
    assignMutation.mutate({ approvalId: formApprovalId, reviewerId: formReviewerId }, {
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleApprove = (approvalId: string) => {
    approveMutation.mutate({ approvalId, reviewedBy: user!.id, remarks: formRemarks || null }, {
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleReject = (approvalId: string) => {
    if (!formRemarks.trim()) { setFormError('Remarks are required for rejection'); return; }
    setFormError(null);
    rejectMutation.mutate({ approvalId, reviewedBy: user!.id, remarks: formRemarks.trim() }, {
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleReopen = (approvalId: string) => {
    reopenMutation.mutate(approvalId, { onError: (err) => { setFormError(err.message); } });
  };

  const handleCancel = (approvalId: string) => {
    if (!window.confirm('Cancel this pending request?')) return;
    cancelMutation.mutate(approvalId, { onError: (err) => { setFormError(err.message); } });
  };

  const canEdit = !!(user?.instituteId);
  const pageInfo = String(data?.count ?? 0) + ' records';

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-400">
          ⚠ Current user has no Institute assigned. Create/Update operations are disabled.
        </div>
      )}

      {/* -- Toolbar -- */}
      <div className="flex flex-wrap items-center gap-2">
        <input className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 w-48" placeholder="Search remarks..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as ApprovalStatus | ''); setPage(1); }}>
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => refetch()} className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Refresh</button>
        <button onClick={() => setShowPending(!showPending)} className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">{showPending ? 'Hide Pending' : 'Pending Queue'}</button>
        <span className="text-[10px] text-gray-500 ml-auto">{pageInfo}</span>
      </div>

      {isLoading && <LoadingIndicator />}
      {errorMessage && <div className="text-xs text-red-400">{errorMessage}</div>}

      {/* -- Pending Queue -- */}
      {showPending && (
        <div className="rounded border border-amber-700/50 bg-gray-900 p-4 space-y-2">
          <div className="text-xs font-semibold text-gray-300">Pending Queue ({pendingItems.length})</div>
          {pendingLoading && <LoadingIndicator />}
          {pendingItems.length === 0 && !pendingLoading && <div className="text-xs text-gray-500">No pending approvals.</div>}
          {pendingItems.map((req) => (
            <div key={req.approvalId} className="flex items-center justify-between border-b border-gray-800 py-1.5 text-xs">
              <span className="text-gray-300 font-mono">{req.approvalId.slice(0, 8)}...</span>
              <span className="text-gray-400">{req.resourceType}/{req.resourceId.slice(0, 8)}...</span>
              <span className="text-gray-400">v{req.version}</span>
              <span className="text-gray-500">{new Date(req.requestedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* -- Create / Assign Form -- */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Create Approval Request</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <select className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" value={formResourceType} onChange={(e) => setFormResourceType(e.target.value as 'content' | 'mock_test')}>
            <option value="content">Content</option>
            <option value="mock_test">Mock Test</option>
          </select>
          <input className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" placeholder="Resource UUID" value={formResourceId} onChange={(e) => setFormResourceId(e.target.value)} />
          <button onClick={handleCreate} disabled={!canEdit || anyMutationLoading} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50">Submit</button>
        </div>
      </div>

      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Assign Reviewer</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" placeholder="Approval UUID" value={formApprovalId} onChange={(e) => setFormApprovalId(e.target.value)} />
          <input className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" placeholder="Reviewer Profile UUID" value={formReviewerId} onChange={(e) => setFormReviewerId(e.target.value)} />
          <button onClick={handleAssign} disabled={!canEdit || anyMutationLoading} className="rounded bg-green-700 px-3 py-1.5 text-xs text-white hover:bg-green-600 disabled:opacity-50">Assign</button>
        </div>
      </div>

      {/* -- Review / Remarks -- */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-2">
        <div className="text-xs font-semibold text-gray-300">Review Remarks</div>
        <input className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" placeholder="Remarks (required for rejection)" value={formRemarks} onChange={(e) => setFormRemarks(e.target.value)} />
      </div>

      {/* -- History -- */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-2">
        <div className="text-xs font-semibold text-gray-300">Approval History</div>
        <div className="flex gap-2">
          <input className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" placeholder="Resource UUID" value={historyResourceId} onChange={(e) => setHistoryResourceId(e.target.value)} />
        </div>
        {historyLoading && <LoadingIndicator />}
        {historyData && historyData.length > 0 && historyData.map((h) => (
          <div key={h.approvalId} className="flex items-center gap-3 border-b border-gray-800 py-1 text-xs">
            <StatusBadge label={h.status} variant={h.status === 'approved' ? 'success' : h.status === 'rejected' ? 'error' : 'warning'} />
            <span className="text-gray-400">v{h.version}</span>
            <span className="text-gray-500">{new Date(h.requestedAt).toLocaleDateString()}</span>
            {h.remarks && <span className="text-gray-500 italic">&quot;{h.remarks.slice(0, 60)}&quot;</span>}
          </div>
        ))}
        {historyData && historyData.length === 0 && !historyLoading && <div className="text-xs text-gray-500">No history found.</div>}
      </div>

      {/* -- Table -- */}
      {items.length === 0 && !isLoading && <div className="text-xs text-gray-500 py-4 text-center">No approval requests found.</div>}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                <th className="text-left py-2 pr-2">ID</th>
                <th className="text-left py-2 pr-2">Resource</th>
                <th className="text-left py-2 pr-2">Status</th>
                <th className="text-left py-2 pr-2">Reviewer</th>
                <th className="text-left py-2 pr-2">Version</th>
                <th className="text-left py-2 pr-2">Created</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((req) => (
                <tr key={req.approvalId} className="border-b border-gray-800 hover:bg-gray-900/50">
                  <td className="py-2 pr-2 text-gray-300 font-mono">{req.approvalId.slice(0, 8)}...</td>
                  <td className="py-2 pr-2 text-gray-400 font-mono">{req.resourceType}/{req.resourceId.slice(0, 8)}...</td>
                  <td className="py-2 pr-2"><StatusBadge label={req.status} variant={req.status === 'approved' ? 'success' : req.status === 'rejected' ? 'error' : 'warning'} /></td>
                  <td className="py-2 pr-2 text-gray-400 font-mono">{req.reviewedBy ? req.reviewedBy.slice(0, 8) + '...' : '—'}</td>
                  <td className="py-2 pr-2 text-gray-400">v{req.version}</td>
                  <td className="py-2 pr-2 text-gray-400">{new Date(req.requestedAt).toLocaleDateString()}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {req.status === 'pending' && <><button onClick={() => handleApprove(req.approvalId)} className="text-green-400 hover:text-green-300 mr-1">Appr</button><button onClick={() => handleReject(req.approvalId)} className="text-red-400 hover:text-red-300 mr-1">Rej</button><button onClick={() => handleCancel(req.approvalId)} className="text-gray-400 hover:text-gray-300">Can</button></>}
{' '}
                    {req.status === 'rejected' && (
                      <button onClick={() => handleReopen(req.approvalId)} className="text-blue-400 hover:text-blue-300">
                        Reopen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40">Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
