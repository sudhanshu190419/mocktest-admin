'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useContentList, useDeleteContent, usePublishContent, useArchiveContent, useRestoreContent } from '@/hooks/content/useContent';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { Content } from '@/types/content';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' },
];

const TYPE_OPTIONS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'video', label: 'Video' },
  { value: 'notes', label: 'Notes' },
  { value: 'assignment', label: 'Assignment' },
];

const CONTENT_TYPE_ICONS: Record<string, string> = {
  pdf: '📄',
  video: '🎥',
  notes: '📝',
  assignment: '📋',
};

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TeacherContentListPage() {
  const router = useRouter();
  const { instituteId } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const PAGE_SIZE = 20;

  const filters: any = {};
  if (instituteId) filters.instituteId = instituteId;
  if (search) filters.search = search;
  if (statusFilter) filters.status = statusFilter;
  if (typeFilter) filters.contentType = typeFilter;

  const { data: contentData, isLoading } = useContentList(
    Object.keys(filters).length ? filters : instituteId ? { instituteId } : undefined,
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );
  const items = contentData?.data ?? [];
  const totalCount = contentData?.count ?? 0;

  const { mutate: deleteContent } = useDeleteContent();
  const { mutate: publishContent } = usePublishContent();
  const { mutate: archiveContent } = useArchiveContent();
  const { mutate: restoreContent } = useRestoreContent();

  const [confirmAction, setConfirmAction] = useState<{ type: string; id: string } | null>(null);

  const columns: Column<Content>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      render: (c) => (
        <div className="flex items-center gap-3 max-w-[240px]">
          {/* Type icon */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm dark:bg-gray-800">
            {CONTENT_TYPE_ICONS[c.contentType] ?? '📄'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{c.title}</p>
            <p className="text-[11px] text-gray-500 capitalize">{c.contentType} · {formatFileSize(c.fileSizeBytes)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'contentType',
      header: 'Type',
      sortable: true,
      render: (c) => (
        <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400 uppercase">
          {c.contentType}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: 'viewCount',
      header: 'Views',
      sortable: true,
      render: (c) => <span className="text-xs text-gray-500">{c.viewCount.toLocaleString()}</span>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      render: (c) => <span className="text-xs text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <div className="flex items-center gap-1">
          <Link href={`/teacher/content/${c.contentId}/edit`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">Edit</Link>
          <Link href={`/teacher/content/${c.contentId}/preview`}
            className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Preview</Link>
          {c.status === 'draft' && (
            <button type="button" onClick={() => setConfirmAction({ type: 'publish', id: c.contentId })}
              className="rounded px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50">Submit</button>
          )}
          {c.status === 'approved' && (
            <button type="button" onClick={() => setConfirmAction({ type: 'archive', id: c.contentId })}
              className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">Archive</button>
          )}
          {c.status === 'archived' && (
            <button type="button" onClick={() => restoreContent(c.contentId)}
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Restore</button>
          )}
          {(c.status === 'draft' || c.status === 'rejected') && (
            <button type="button" onClick={() => {
              if (confirm('Delete this content permanently?')) deleteContent(c.contentId);
            }}
              className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
          )}
        </div>
      ),
    },
  ];

  const confirmConfig = confirmAction?.type === 'publish'
    ? { title: 'Submit for Review', message: 'Submit this content for admin approval? It will be reviewed by an admin before being made available.', confirmLabel: 'Submit', variant: 'default' as const }
    : { title: 'Archive Content', message: 'Archived content is hidden from students. You can restore it later.', confirmLabel: 'Archive', variant: 'warning' as const };

  return (
    <div>
      <PageHeader
        title="My Content"
        description={`${totalCount} item${totalCount !== 1 ? 's' : ''} created`}
        breadcrumbs={[{ label: 'My Content', href: '/teacher/content' }, { label: 'All Content' }]}
        actions={
          <Link href="/teacher/content/create"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Upload Content
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search content..." className="min-w-[240px] flex-1" />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <option value="">All Types</option>
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <DataTable<Content>
        columns={columns}
        data={items}
        keyExtractor={(c) => c.contentId}
        onRowClick={(c) => router.push(`/teacher/content/${c.contentId}/edit`)}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No content found"
            description={search ? 'Try a different search term.' : 'Get started by uploading your first content item.'}
            action={
              <Link href="/teacher/content/create"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Upload Content
              </Link>
            }
          />
        }
      />

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.type === 'publish') publishContent(confirmAction.id);
          else if (confirmAction?.type === 'archive') archiveContent(confirmAction.id);
          setConfirmAction(null);
        }}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.confirmLabel}
        variant={confirmConfig.variant}
      />
    </div>
  );
}
