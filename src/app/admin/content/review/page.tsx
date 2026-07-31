'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useContentList, useApproveContent, useRejectContent, useArchiveContent, useRestoreContent } from '@/hooks/content/useContent';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { Content, LifecycleStatus } from '@/types/content';

const TABS: { key: LifecycleStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All Content' },
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'archived', label: 'Archived' },
];

const TYPE_ICONS: Record<string, string> = {
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

export default function AdminContentReviewPage() {
  const { instituteId } = useAuth();
  const [activeTab, setActiveTab] = useState<LifecycleStatus | 'all'>('pending_review');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const PAGE_SIZE = 20;

  const filters: any = {};
  if (instituteId) filters.instituteId = instituteId;
  if (search) filters.search = search;
  if (activeTab !== 'all') filters.status = activeTab;

  const { data: contentData, isLoading, refetch } = useContentList(
    Object.keys(filters).length ? filters : instituteId ? { instituteId } : undefined,
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );
  const items = contentData?.data ?? [];
  const totalCount = contentData?.count ?? 0;

  // Also fetch all to show counts per tab
  const { data: allData } = useContentList(
    instituteId ? { instituteId } : undefined,
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page: 1, pageSize: 1 },
  );
  const allCount = allData?.count ?? 0;

  const tabCounts = useMemo(() => {
    // Fetch exact counts isn't practical here, but we can derive from the all data
    // For the tab labels, we just show the active tab's count from the filtered query
    return {};
  }, []);

  const { mutate: approveContent } = useApproveContent();
  const { mutate: rejectContent } = useRejectContent();
  const { mutate: archiveContent } = useArchiveContent();
  const { mutate: restoreContent } = useRestoreContent();

  const [confirmAction, setConfirmAction] = useState<{ type: string; id: string; title: string } | null>(null);

  const columns: Column<Content>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      render: (c) => (
        <div className="flex items-center gap-3 max-w-[240px]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm dark:bg-gray-800">
            {TYPE_ICONS[c.contentType] ?? '📄'}
          </div>
          <div className="min-w-0">
            <Link
              href={`/admin/content/review/${c.contentId}`}
              className="truncate text-sm font-medium text-gray-900 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
              title="Open review panel"
            >
              {c.title}
            </Link>
            <p className="text-[11px] text-gray-500 capitalize">{c.contentType} · {formatFileSize(c.fileSizeBytes)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'contentType',
      header: 'Type',
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
          <Link href={`/teacher/content/${c.contentId}/preview`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">
            Preview
          </Link>

          {/* Pending Review actions */}
          {c.status === 'pending_review' && (
            <>
              <Link
                href={`/admin/content/review/${c.contentId}`}
                className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">
                Review
              </Link>
              <button type="button"
                onClick={(e) => { e.stopPropagation(); approveContent(c.contentId); }}
                className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50">
                Approve
              </button>
              <button type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmAction({ type: 'reject', id: c.contentId, title: c.title });
                }}
                className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">
                Reject
              </button>
            </>
          )}

          {/* Approved actions */}
          {c.status === 'approved' && (
            <button type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmAction({ type: 'archive', id: c.contentId, title: c.title });
              }}
              className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">
              Archive
            </button>
          )}

          {/* Archived actions */}
          {c.status === 'archived' && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); restoreContent(c.contentId); }}
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
              Restore
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Content Review"
        description="Review and manage teacher-uploaded content"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Content', href: '/admin/content' },
          { label: 'Review' },
        ]}
      />

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setActiveTab(tab.key); setPage(1); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.key === 'pending_review' && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {contentData?.count ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search content..." className="max-w-md" />
      </div>

      <DataTable<Content>
        columns={columns}
        data={items}
        keyExtractor={(c) => c.contentId}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No content found"
            description={
              activeTab === 'pending_review'
                ? 'No content pending review at the moment.'
                : search
                  ? 'Try a different search term.'
                  : `No ${activeTab !== 'all' ? activeTab.replace(/_/g, ' ') : ''} content items.`
            }
          />
        }
      />

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction?.type === 'reject') rejectContent(confirmAction.id);
          else if (confirmAction?.type === 'archive') archiveContent(confirmAction.id);
          setConfirmAction(null);
        }}
        title={
          confirmAction?.type === 'reject' ? 'Reject Content' :
          confirmAction?.type === 'archive' ? 'Archive Content' : ''
        }
        message={
          confirmAction?.type === 'reject'
            ? `Reject "${confirmAction?.title}"? The teacher can revise and resubmit it.`
            : `Archive "${confirmAction?.title}"? It will be hidden from students but data is preserved.`
        }
        confirmLabel={
          confirmAction?.type === 'reject' ? 'Reject' : 'Archive'
        }
        variant={confirmAction?.type === 'reject' ? 'danger' : 'warning'}
      />
    </div>
  );
}
