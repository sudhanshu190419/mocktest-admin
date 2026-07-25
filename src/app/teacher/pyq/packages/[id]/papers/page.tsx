'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePyqPackage } from '@/hooks/pyq/usePyqPackages';
import {
  usePyqPapers,
  usePublishPyqPaper,
  useUnpublishPyqPaper,
  useDeletePyqPaper,
} from '@/hooks/pyq/usePyqPapers';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import type { PyqPaper } from '@/types/pyq';

export default function PyqPaperListPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: packageId } = use(params);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [publishedFilter, setPublishedFilter] = useState('');
  const PAGE_SIZE = 20;

  // Fetch package metadata (for breadcrumbs and header)
  const { data: pkg, isLoading: pkgLoading } = usePyqPackage(packageId);

  // Build filters
  const filters: Record<string, unknown> = {};
  if (search) filters.search = search;
  if (yearFilter) filters.examYear = parseInt(yearFilter);
  if (publishedFilter === 'published') filters.isPublished = true;
  else if (publishedFilter === 'unpublished') filters.isPublished = false;

  const hasFilters = Object.keys(filters).length > 0;
  const { data: papersData, isLoading } = usePyqPapers(
    packageId,
    hasFilters ? (filters as any) : undefined,
    { sortBy: 'examYear', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );
  const papers = papersData?.data ?? [];
  const totalCount = papersData?.count ?? 0;

  const { mutate: publishPaper } = usePublishPyqPaper();
  const { mutate: unpublishPaper } = useUnpublishPyqPaper();
  const deletePaper = useDeletePyqPaper();

  const [confirmAction, setConfirmAction] = useState<{ type: string; id: string } | null>(null);

  const columns: Column<PyqPaper>[] = [
    {
      key: 'title',
      header: 'Paper Title',
      sortable: true,
      render: (p) => (
        <div>
          <p className="text-sm font-medium text-gray-900 truncate max-w-xs">{p.title}</p>
          <p className="text-[11px] text-gray-500">
            {p.examYear}{p.examSession ? ` · ${p.examSession}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'examYear',
      header: 'Year',
      sortable: true,
      render: (p) => <span className="text-xs font-medium">{p.examYear}</span>,
    },
    {
      key: 'examSession',
      header: 'Session',
      render: (p) => <span className="text-xs text-gray-600">{p.examSession ?? '—'}</span>,
    },
    {
      key: 'totalQuestions',
      header: 'Questions',
      sortable: true,
      className: 'text-center',
      render: (p) => <span className="text-xs">{p.totalQuestions}</span>,
    },
    {
      key: 'durationMin',
      header: 'Duration',
      sortable: true,
      render: (p) => <span className="text-xs">{p.durationMin != null ? `${p.durationMin} min` : '—'}</span>,
    },
    {
      key: 'isPublished',
      header: 'Published',
      sortable: true,
      render: (p) => <StatusBadge status={p.isPublished && p.publishedAt ? 'published' : 'draft'} />,
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      render: (p) => (
        <span className="text-xs text-gray-500">
          {new Date(p.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Link
            href={`/teacher/pyq/packages/${packageId}/papers/${p.paperId}/edit`}
            className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            Edit
          </Link>
          <Link
            href={`/teacher/pyq/packages/${packageId}/papers/${p.paperId}/questions`}
            className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            Questions
          </Link>
          {p.isPublished && p.publishedAt ? (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'unpublish', id: p.paperId })}
              className="rounded px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
            >
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'publish', id: p.paperId })}
              className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
            >
              Publish
            </button>
          )}
          {p.totalQuestions === 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', id: p.paperId }); }}
              className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  const handleConfirm = () => {
    if (!confirmAction) return;
    const { type, id } = confirmAction;
    if (type === 'publish') publishPaper(id);
    else if (type === 'unpublish') unpublishPaper(id);
    else if (type === 'delete') deletePaper.mutate({ paperId: id, packageId });
    setConfirmAction(null);
  };

  const confirmConfig = (() => {
    if (!confirmAction) return null;
    switch (confirmAction.type) {
      case 'publish':
        return {
          title: 'Publish Paper',
          message: 'This paper will become visible to students who have purchased the package. Continue?',
          confirmLabel: 'Publish',
          variant: 'default' as const,
        };
      case 'unpublish':
        return {
          title: 'Unpublish Paper',
          message: 'The paper will be hidden from students. Continue?',
          confirmLabel: 'Unpublish',
          variant: 'warning' as const,
        };
      case 'delete':
        return {
          title: 'Delete Paper',
          message: 'Are you sure you want to permanently delete this paper? This action cannot be undone.',
          confirmLabel: 'Delete',
          variant: 'danger' as const,
        };
      default:
        return null;
    }
  })();

  // Loading state
  if (pkgLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-sm text-rose-600">Package not found.</p>
        <Link href="/teacher/pyq/packages" className="mt-2 inline-block text-xs text-blue-600 hover:underline">
          Back to Packages
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={pkg.name}
        description={`${totalCount} paper${totalCount !== 1 ? 's' : ''} in this package`}
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
          { label: pkg.name, href: `/teacher/pyq/packages/${packageId}/edit` },
          { label: 'Papers' },
        ]}
        actions={
          <Link
            href={`/teacher/pyq/packages/${packageId}/papers/create`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Paper
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search papers..."
          className="min-w-[240px] flex-1"
        />
        <input
          type="number"
          value={yearFilter}
          onChange={(e) => { setYearFilter(e.target.value); setPage(1); }}
          placeholder="Filter by year..."
          min={1990}
          max={2100}
          className="min-w-[120px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <select
          value={publishedFilter}
          onChange={(e) => { setPublishedFilter(e.target.value); setPage(1); }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Status</option>
          <option value="published">Published</option>
          <option value="unpublished">Unpublished</option>
        </select>
      </div>

      <DataTable<PyqPaper>
        columns={columns}
        data={papers}
        keyExtractor={(p) => p.paperId}
        onRowClick={(p) => router.push(`/teacher/pyq/packages/${packageId}/papers/${p.paperId}/edit`)}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No papers found"
            description={search ? 'Try a different search term.' : 'Get started by creating your first paper in this package.'}
            action={
              <Link
                href={`/teacher/pyq/packages/${packageId}/papers/create`}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create Paper
              </Link>
            }
          />
        }
      />

      {confirmConfig && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleConfirm}
          title={confirmConfig.title}
          message={confirmConfig.message}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant}
        />
      )}
    </div>
  );
}
