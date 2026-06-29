'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, useAttachTag, useDetachTag, useReplaceTags } from '@/hooks/content/useTags';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';
import type { Tag, TagFilters } from '@/types/content';

export interface TagsDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHook: string;
  lastResponse: string;
  errorMessage: string | null;
}

interface TagsPanelProps {
  onDebugInfo?: (info: TagsDebugInfo) => void;
}

const PAGE_SIZE = 10;

export default function TagsPanel({ onDebugInfo }: TagsPanelProps) {
  const { user } = useAuth();
  const instituteId = user?.instituteId ?? '';

  // -- Filters --
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  // -- Form --
  const [formMode, setFormMode] = useState<'create' | 'rename'>('create');
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // -- Tag relation form --
  const [relContentId, setRelContentId] = useState('');
  const [relTagId, setRelTagId] = useState('');
  const [relReplaceTagIds, setRelReplaceTagIds] = useState('');
  const [relError, setRelError] = useState<string | null>(null);

  const filters: TagFilters = { instituteId };
  if (search) filters.search = search;

  const { data, isLoading, isFetching, isStale, error: queryError, refetch } = useTags(
    filters, { sortBy: 'name', sortDirection: 'asc' }, { page, pageSize: PAGE_SIZE },
  );

  const createMutation = useCreateTag();
  const updateMutation = useUpdateTag();
  const deleteMutation = useDeleteTag();
  const attachMutation = useAttachTag();
  const detachMutation = useDetachTag();
  const replaceMutation = useReplaceTags();

  const anyMutationLoading = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || attachMutation.isPending || detachMutation.isPending || replaceMutation.isPending;
  const errorMessage = formError ?? relError ?? queryError?.message ?? null;
  const items = data?.data ?? [];
  const totalPages = data?.pageCount ?? 1;

  const reportDebug = useCallback(() => {
    onDebugInfo?.({
      loading: isLoading || isFetching,
      mutationLoading: anyMutationLoading,
      selectedRecord: selectedTagId,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isLoading ? 'loading' : isFetching ? 'fetching' : 'idle',
      lastHook: 'useTags,useCreateTag,useUpdateTag,useDeleteTag,useAttachTag,useDetachTag,useReplaceTags',
      lastResponse: JSON.stringify(data ?? {}).slice(0, 200),
      errorMessage,
    });
  }, [isLoading, isFetching, anyMutationLoading, selectedTagId, isStale, data, errorMessage, onDebugInfo]);

  useEffect(() => { reportDebug(); }, [reportDebug]);

  const handleCreate = () => {
    if (!formName.trim()) { setFormError('Name is required'); return; }
    setFormError(null);
    createMutation.mutate({ instituteId, name: formName.trim(), createdBy: user!.id }, {
      onSuccess: () => { resetForm(); },
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleRename = () => {
    if (!selectedTagId || !formName.trim()) { setFormError('Name is required'); return; }
    setFormError(null);
    updateMutation.mutate({ id: selectedTagId, input: { name: formName.trim() } }, {
      onSuccess: () => { resetForm(); },
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Delete this tag permanently?')) return;
    deleteMutation.mutate(id, {
      onSuccess: () => { if (selectedTagId === id) { setSelectedTagId(null); } },
    });
  };

  const handleAttach = () => {
    if (!relContentId || !relTagId) { setRelError('Content ID and Tag ID are required'); return; }
    setRelError(null);
    attachMutation.mutate({ contentId: relContentId, tagId: relTagId, taggedBy: user!.id }, {
      onError: (err) => { setRelError(err.message); },
    });
  };

  const handleDetach = () => {
    if (!relContentId || !relTagId) { setRelError('Content ID and Tag ID are required'); return; }
    setRelError(null);
    detachMutation.mutate({ contentId: relContentId, tagId: relTagId }, {
      onError: (err) => { setRelError(err.message); },
    });
  };

  const handleReplace = () => {
    if (!relContentId || !relReplaceTagIds.trim()) { setRelError('Content ID and tag IDs are required'); return; }
    setRelError(null);
    const tagIds = relReplaceTagIds.split(',').map((s) => s.trim()).filter(Boolean);
    replaceMutation.mutate({ contentId: relContentId, tagIds, taggedBy: user!.id }, {
      onError: (err) => { setRelError(err.message); },
    });
  };

  const resetForm = () => {
    setShowForm(false);
    setFormMode('create');
    setFormName('');
    setFormError(null);
    setSelectedTagId(null);
  };

  const openEdit = (tag: Tag) => {
    setFormMode('rename');
    setFormName(tag.name);
    setSelectedTagId(tag.tagId);
    setShowForm(true);
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
        <input className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 w-48" placeholder="Search tag name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <button onClick={() => refetch()} className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Refresh</button>
        <button onClick={() => { resetForm(); setShowForm(true); }} disabled={!canEdit} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50">+ New Tag</button>
        <span className="text-[10px] text-gray-500 ml-auto">{pageInfo}</span>
      </div>

      {isLoading && <LoadingIndicator />}
      {errorMessage && <div className="text-xs text-red-400">{errorMessage}</div>}

      {/* -- Tag Form -- */}
      {showForm && (
        <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
          <div className="text-xs font-semibold text-gray-300">{formMode === 'create' ? 'Create Tag' : 'Rename Tag'}</div>
          <input className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" placeholder="Tag name" value={formName} onChange={(e) => setFormName(e.target.value)} />
          {formError && <div className="text-xs text-red-400">{formError}</div>}
          <div className="flex gap-2">
            <button onClick={formMode === 'create' ? handleCreate : handleRename} disabled={!canEdit || anyMutationLoading} className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50">{formMode === 'create' ? 'Create' : 'Rename'}</button>
            <button onClick={resetForm} className="rounded border border-gray-700 px-4 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Cancel</button>
          </div>
        </div>
      )}

      {/* -- Tag Relation Testing -- */}
      <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-300">Tag Relations</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500">Content ID</label>
            <input className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" placeholder="Content UUID" value={relContentId} onChange={(e) => setRelContentId(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500">Tag ID</label>
            <input className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" placeholder="Tag UUID" value={relTagId} onChange={(e) => setRelTagId(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleAttach} disabled={!canEdit} className="rounded bg-green-700 px-3 py-1 text-xs text-white hover:bg-green-600">Attach</button>
          <button onClick={handleDetach} disabled={!canEdit} className="rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600">Detach</button>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Replace Tags (comma-separated IDs)</label>
          <div className="flex gap-2 mt-1">
            <input className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100" placeholder="tag-id-1, tag-id-2, ..." value={relReplaceTagIds} onChange={(e) => setRelReplaceTagIds(e.target.value)} />
            <button onClick={handleReplace} disabled={!canEdit} className="rounded bg-blue-700 px-3 py-1 text-xs text-white hover:bg-blue-600">Replace</button>
          </div>
        </div>
        {relError && <div className="text-xs text-red-400">{relError}</div>}
      </div>

      {/* -- Table -- */}
      {items.length === 0 && !isLoading && <div className="text-xs text-gray-500 py-4 text-center">No tags found.</div>}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                <th className="text-left py-2 pr-2">Name</th>
                <th className="text-left py-2 pr-2">Content Count</th>
                <th className="text-left py-2 pr-2">Created At</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tag) => (
                <tr key={tag.tagId} className="border-b border-gray-800 hover:bg-gray-900/50">
                  <td className="py-2 pr-2 text-gray-100"><StatusBadge label={tag.name} variant="info" /></td>
                  <td className="py-2 pr-2 text-gray-400">—</td>
                  <td className="py-2 pr-2 text-gray-400">{new Date(tag.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => openEdit(tag)} className="text-blue-400 hover:text-blue-300 mr-2">Rename</button>
                    <button onClick={() => handleDelete(tag.tagId)} className="text-red-400 hover:text-red-300">Del</button>
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
