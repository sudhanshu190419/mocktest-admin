'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useContents, useCreateContent, useUpdateContent, useDeleteContent, usePublishContent, useApproveContent, useRejectContent, useArchiveContent, useRestoreContent } from '@/hooks/content/useContent';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import StatusBadge from '@/components/dev/StatusBadge';
import type { ContentType, LifecycleStatus } from '@/types/content';
import type { ContentQueryFilters } from '@/services/content/contentService';

export interface ContentDebugInfo {
  loading: boolean;
  mutationLoading: boolean;
  selectedRecord: string | null;
  cacheStatus: string;
  queryStatus: string;
  lastHook: string;
  lastResponse: string;
  errorMessage: string | null;
}

interface ContentPanelProps {
  onDebugInfo?: (info: ContentDebugInfo) => void;
}

const CONTENT_TYPES: ContentType[] = ['pdf', 'video', 'notes', 'assignment'];
const STATUSES: LifecycleStatus[] = ['draft', 'pending_review', 'approved', 'rejected', 'archived'];
const PAGE_SIZE = 10;

export default function ContentPanel({ onDebugInfo }: ContentPanelProps) {
  const { user } = useAuth();
  const instituteId = user?.instituteId ?? '';

  // -- Filters --
  const [search, setSearch] = useState('');
  const [contentTypeFilter, setContentTypeFilter] = useState<ContentType | ''>('');
  const [statusFilter, setStatusFilter] = useState<LifecycleStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  // -- Form --
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formContentType, setFormContentType] = useState<ContentType>('pdf');
  const [formChapterId, setFormChapterId] = useState('');
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formThumbnail, setFormThumbnail] = useState<File | null>(null);
  const [formIsFree, setFormIsFree] = useState(false);
  const [formPageCount, setFormPageCount] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // -- Derived field visibility (ck_content_type_specific) --
  const showPageCount = formContentType === 'pdf';
  const showDuration = formContentType === 'video';
  const needsPageCount = formContentType === 'pdf';
  const needsDuration = formContentType === 'video';

  // -- Build filters --
  const filters: ContentQueryFilters = { instituteId };
  if (search) filters.search = search;
  if (contentTypeFilter) filters.contentType = contentTypeFilter;
  if (statusFilter) filters.status = statusFilter;

  const { data, isLoading, isFetching, isStale, error: queryError, refetch } = useContents(
    filters, { sortBy: 'createdAt', sortDirection: 'desc' }, { page, pageSize: PAGE_SIZE },
  );

  const createMutation = useCreateContent();
  const updateMutation = useUpdateContent();
  const deleteMutation = useDeleteContent();
  const publishMutation = usePublishContent();
  const approveMutation = useApproveContent();
  const rejectMutation = useRejectContent();
  const archiveMutation = useArchiveContent();
  const restoreMutation = useRestoreContent();

  const anyMutationLoading = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || publishMutation.isPending || approveMutation.isPending || rejectMutation.isPending || archiveMutation.isPending || restoreMutation.isPending;
  const errorMessage = formError ?? queryError?.message ?? null;
  const items = data?.data ?? [];
  const totalPages = data?.pageCount ?? 1;

  // -- Debug reporting --
  const reportDebug = useCallback(() => {
    const payloadTeacherId = user?.id ?? '—';
    const profileId = user?.id ?? '—';
    const teacherIdsMatch = 'Same (both are profiles.profile_id)';
    onDebugInfo?.({
      loading: isLoading || isFetching,
      mutationLoading: anyMutationLoading,
      selectedRecord: selectedContentId,
      cacheStatus: isStale ? 'stale' : 'fresh',
      queryStatus: isLoading ? 'loading' : isFetching ? 'fetching' : 'idle',
      lastHook: 'useContents,useCreateContent,useUpdateContent,useDeleteContent,usePublishContent,useApproveContent,useRejectContent,useArchiveContent,useRestoreContent',
      lastResponse: JSON.stringify(data ?? {}).slice(0, 200),
      errorMessage,
    });
  }, [isLoading, isFetching, anyMutationLoading, selectedContentId, isStale, data, errorMessage, onDebugInfo, user?.id]);

  useEffect(() => { reportDebug(); }, [reportDebug]);

  // -- Actions --
  const handleCreate = () => {
    if (!formTitle.trim()) { setFormError('Title is required'); return; }
    if (!formFile) { setFormError('File is required'); return; }
    if (needsPageCount) {
      const pc = parseInt(formPageCount, 10);
      if (!pc || pc <= 0) { setFormError('Page Count must be a positive number for PDF content.'); return; }
    }
    if (needsDuration) {
      const ds = parseInt(formDuration, 10);
      if (!ds || ds <= 0) { setFormError('Duration (seconds) must be a positive number for Video content.'); return; }
    }
    setFormError(null);

    const payload = {
      instituteId,
      teacherId: user!.id,
      chapterId: formChapterId || '00000000-0000-0000-0000-000000000000',
      title: formTitle.trim(),
      description: formDesc || null,
      contentType: formContentType,
      file: formFile,
      thumbnailFile: formThumbnail ?? undefined,
      isFreePreview: formIsFree,
      pageCount: needsPageCount ? parseInt(formPageCount, 10) : null,
      durationSeconds: needsDuration ? parseInt(formDuration, 10) : formContentType === 'assignment' ? null : undefined,
    };

    console.group('CONTENT CREATE DEBUG — Dev Console');
    console.log('Step 1: Dev Console → useCreateContent (payload):');
    console.log('  instituteId:', payload.instituteId);
    console.log('  teacherId (user.id/profiles.profile_id):', payload.teacherId);
    console.log('  chapterId:', payload.chapterId);
    console.log('  contentType:', payload.contentType);
    console.log('  title:', payload.title);
    console.log('  pageCount:', payload.pageCount);
    console.log('  durationSeconds:', payload.durationSeconds);
    console.log('  isFreePreview:', payload.isFreePreview);
    console.log('Auth session:');
    console.log('  user.id (profileId):', user?.id);
    console.log('  user.email:', user?.email);
    console.log('  user.role:', user?.role);
    console.log('  user.instituteId:', user?.instituteId);
    console.log('  user.name:', user?.name);
    console.log('--- teacherId check ---');
    console.log('  Payload teacherId === user.id:', payload.teacherId === user?.id);
    console.log('  Note: If teacherId references teacher_details.teacher_id,');
    console.log('  this will FAIL RLS because teacherId = profiles.profile_id,');
    console.log('  NOT teacher_details.teacher_id.');
    console.groupEnd();

    createMutation.mutate(payload, {
      onSuccess: () => { resetForm(); },
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleUpdate = () => {
    if (!selectedContentId) return;
    if (!formTitle.trim()) { setFormError('Title is required'); return; }
    if (needsPageCount) {
      const pc = parseInt(formPageCount, 10);
      if (!pc || pc <= 0) { setFormError('Page Count must be a positive number for PDF content.'); return; }
    }
    if (needsDuration) {
      const ds = parseInt(formDuration, 10);
      if (!ds || ds <= 0) { setFormError('Duration (seconds) must be a positive number for Video content.'); return; }
    }
    setFormError(null);
    updateMutation.mutate({
      id: selectedContentId,
      input: {
        title: formTitle.trim(),
        description: formDesc || null,
        file: formFile ?? undefined,
        thumbnailFile: formThumbnail ?? undefined,
        isFreePreview: formIsFree,
        pageCount: needsPageCount ? parseInt(formPageCount, 10) : null,
        durationSeconds: needsDuration ? parseInt(formDuration, 10) : formContentType === 'assignment' ? null : undefined,
      },
    }, {
      onSuccess: () => { resetForm(); },
      onError: (err) => { setFormError(err.message); },
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Delete this content permanently?')) return;
    deleteMutation.mutate(id, {
      onSuccess: () => { if (selectedContentId === id) setSelectedContentId(null); },
    });
  };

  const handleLifecycle = (action: string, id: string) => {
    const mutMap: Record<string, { mutate: (id: string) => void }> = {
      publish: publishMutation,
      approve: approveMutation,
      reject: rejectMutation,
      archive: archiveMutation,
      restore: restoreMutation,
    };
    mutMap[action]?.mutate(id);
  };

  const resetForm = () => {
    setShowForm(false);
    setFormMode('create');
    setFormTitle('');
    setFormDesc('');
    setFormContentType('pdf');
    setFormChapterId('');
    setFormFile(null);
    setFormThumbnail(null);
    setFormIsFree(false);
    setFormPageCount('');
    setFormDuration('');
    setFormError(null);
    setSelectedContentId(null);
  };

  const openEdit = (item: typeof items[0]) => {
    setFormMode('edit');
    setFormTitle(item.title);
    setFormDesc(item.description ?? '');
    setFormContentType(item.contentType);
    setFormChapterId(item.chapterId);
    setFormIsFree(item.isFreePreview);
    setFormFile(null);
    setFormThumbnail(null);
    setFormPageCount(item.pageCount ? String(item.pageCount) : '');
    setFormDuration(item.durationSeconds ? String(item.durationSeconds) : '');
    setFormError(null);
    setSelectedContentId(item.contentId);
    setShowForm(true);
  };

  const statusVariant = (s: LifecycleStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
      draft: 'neutral', pending_review: 'warning', approved: 'success', rejected: 'error', archived: 'info',
    };
    return map[s] ?? 'neutral';
  };

  const canEdit = !!(user?.instituteId);
  const pageInfo = String(data?.count ?? 0) + ' records';

  return (
    <div className="space-y-4">
      {/* -- Institute guard -- */}
      {!canEdit && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-400">
          ⚠ Current user has no Institute assigned. Create/Update operations are disabled.
        </div>
      )}

      {/* -- Toolbar -- */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 w-48"
          placeholder="Search title/description..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100" value={contentTypeFilter} onChange={(e) => { setContentTypeFilter(e.target.value as ContentType | ''); setPage(1); }}>
          <option value="">All Types</option>
          {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as LifecycleStatus | ''); setPage(1); }}>
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={() => refetch()}
          className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >Refresh</button>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          disabled={!canEdit}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >+ New Content</button>
        <span className="text-[10px] text-gray-500 ml-auto">{pageInfo}</span>
      </div>

      {/* -- Loading / Error -- */}
      {isLoading && <LoadingIndicator />}
      {errorMessage && <div className="text-xs text-red-400">{errorMessage}</div>}

      {/* -- Form -- */}
      {showForm && (
        <div className="rounded border border-gray-700 bg-gray-900 p-4 space-y-3">
          <div className="text-xs font-semibold text-gray-300">{formMode === 'create' ? 'Create Content' : 'Update Content'}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Title *</label>
              <input className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Content Type</label>
              <select className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" value={formContentType} onChange={(e) => setFormContentType(e.target.value as ContentType)}>
                {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Description</label>
              <input className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Chapter ID</label>
              <input className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" value={formChapterId} onChange={(e) => setFormChapterId(e.target.value)} placeholder="UUID" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Free Preview</label>
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={formIsFree} onChange={(e) => setFormIsFree(e.target.checked)} className="accent-blue-500" />
                <span className="text-xs text-gray-400">{formIsFree ? 'Yes' : 'No'}</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500">File *</label>
              <input type="file" className="w-full text-xs text-gray-400 mt-1 file:mr-2 file:rounded file:border-0 file:bg-gray-700 file:px-2 file:py-1 file:text-xs file:text-gray-200" onChange={(e) => setFormFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Thumbnail (optional)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="w-full text-xs text-gray-400 mt-1 file:mr-2 file:rounded file:border-0 file:bg-gray-700 file:px-2 file:py-1 file:text-xs file:text-gray-200" onChange={(e) => setFormThumbnail(e.target.files?.[0] ?? null)} />
            </div>
            {showPageCount && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-gray-500">Page Count * <span className="text-amber-400">(PDF only)</span></label>
                <input type="number" min="1" step="1" className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" placeholder="e.g. 45" value={formPageCount} onChange={(e) => setFormPageCount(e.target.value)} />
              </div>
            )}
            {showDuration && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-gray-500">Duration (seconds) * <span className="text-amber-400">(Video only)</span></label>
                <input type="number" min="1" step="1" className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 mt-1" placeholder="e.g. 3600" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} />
              </div>
            )}
          </div>
          {formError && <div className="text-xs text-red-400">{formError}</div>}
          <div className="flex gap-2">
            <button
              onClick={formMode === 'create' ? handleCreate : handleUpdate}
              disabled={!canEdit || anyMutationLoading}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
            >{formMode === 'create' ? 'Create' : 'Update'}</button>
            <button onClick={resetForm} className="rounded border border-gray-700 px-4 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Cancel</button>
          </div>
        </div>
      )}

      {/* -- Table -- */}
      {items.length === 0 && !isLoading && (
        <div className="text-xs text-gray-500 py-4 text-center">No content found.</div>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                <th className="text-left py-2 pr-2">Title</th>
                <th className="text-left py-2 pr-2">Type</th>
                <th className="text-left py-2 pr-2">Status</th>
                <th className="text-left py-2 pr-2">File</th>
                <th className="text-left py-2 pr-2">Created</th>
                <th className="text-left py-2 pr-2">Published</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.contentId} className="border-b border-gray-800 hover:bg-gray-900/50">
                  <td className="py-2 pr-2 text-gray-100 max-w-[200px] truncate">{item.title}</td>
                  <td className="py-2 pr-2"><StatusBadge label={item.contentType} variant="info" /></td>
                  <td className="py-2 pr-2"><StatusBadge label={item.status} variant={statusVariant(item.status)} /></td>
                  <td className="py-2 pr-2 text-gray-400 max-w-[120px] truncate">{item.originalFileName}</td>
                  <td className="py-2 pr-2 text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-2 text-gray-400">{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : '—'}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(item)} className="text-blue-400 hover:text-blue-300 mr-2">Edit</button>
                    <button onClick={() => handleDelete(item.contentId)} className="text-red-400 hover:text-red-300 mr-2">Del</button>
                    {item.status === 'draft' && <button onClick={() => handleLifecycle('publish', item.contentId)} className="text-amber-400 hover:text-amber-300 mr-1">Pub</button>}
                    {item.status === 'pending_review' && <><button onClick={() => handleLifecycle('approve', item.contentId)} className="text-green-400 hover:text-green-300 mr-1">Appr</button><button onClick={() => handleLifecycle('reject', item.contentId)} className="text-red-400 hover:text-red-300 mr-1">Rej</button></>}
                    {item.status === 'approved' && <button onClick={() => handleLifecycle('archive', item.contentId)} className="text-gray-400 hover:text-gray-300 mr-1">Arch</button>}
                    {item.status === 'archived' && <button onClick={() => handleLifecycle('restore', item.contentId)} className="text-blue-400 hover:text-blue-300 mr-1">Rest</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* -- Pagination -- */}
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
