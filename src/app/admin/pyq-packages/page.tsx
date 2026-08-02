'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useStreams } from '@/hooks/academic/useStreams';
import {
  usePyqPackages,
  usePublishPyqPackage,
  useUnpublishPyqPackage,
  useDeletePyqPackage,
} from '@/hooks/pyq/usePyqPackages';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import type { PyqPackage, PyqPackageFilters } from '@/types/pyq';

// Adapter type to avoid implicit any cast for filter records
type PyqPackageFiltersAdapter = {
  [K in keyof PyqPackageFilters]?: PyqPackageFilters[K];
} & Record<string, unknown>;

/**
 * Super Admin PYQ Package Management (Phase 9C).
 *
 * Packages are institute-owned and their mutations are Super Admin only —
 * enforced server-side by pyqPackageService (Phase 9B) and here at the UI
 * layer via the route (manageAdmins) + sidebar gating. This page reuses the
 * existing hooks/services — no new backend logic.
 */
export default function AdminPyqPackageListPage() {
  const router = useRouter();
  const { instituteId } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const PAGE_SIZE = 20;

  // Fetch streams for filter dropdown
  const { data: streamsData } = useStreams(undefined, undefined, { page: 1, pageSize: 100 });
  const streams = streamsData?.data ?? [];

  // Build filters
  const filters: Record<string, unknown> = {};
  if (instituteId) filters.instituteId = instituteId;
  if (search) filters.search = search;
  if (streamFilter) filters.streamId = streamFilter;
  if (statusFilter === 'active') filters.isActive = true;
  else if (statusFilter === 'inactive') filters.isActive = false;
  else if (statusFilter === 'published') filters.isPublished = true;
  else if (statusFilter === 'unpublished') filters.isPublished = false;

  const hasFilters = Object.keys(filters).length > 0;
  const { data: packagesData, isLoading } = usePyqPackages(
    hasFilters ? (filters as PyqPackageFiltersAdapter) : undefined,
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page, pageSize: PAGE_SIZE },
  );
  const packages = packagesData?.data ?? [];
  const totalCount = packagesData?.count ?? 0;

  const { mutate: publishPackage } = usePublishPyqPackage();
  const { mutate: unpublishPackage } = useUnpublishPyqPackage();
  const { mutate: deletePackage } = useDeletePyqPackage();

  const [confirmAction, setConfirmAction] = useState<{ type: string; id: string } | null>(null);

  const columns: Column<PyqPackage>[] = [
    {
      key: 'name',
      header: 'Package Name',
      sortable: true,
      render: (p) => (
        <div>
          <p className="text-sm font-medium text-gray-900 truncate max-w-xs">{p.name}</p>
          <p className="text-[11px] text-gray-500">
            {p.streamName ?? 'Unknown stream'} · ₹{p.price}
          </p>
        </div>
      ),
    },
    {
      key: 'streamName',
      header: 'Stream',
      render: (p) => (
        <span className="text-xs text-gray-600">{p.streamName ?? '—'}</span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      sortable: true,
      render: (p) => <span className="text-xs font-medium">₹{p.price}</span>,
    },
    {
      key: 'totalPapers',
      header: 'Papers',
      sortable: true,
      className: 'text-center',
      render: (p) => <span className="text-xs">{p.totalPapers}</span>,
    },
    {
      key: 'isActive',
      header: 'Active',
      sortable: true,
      render: (p) => <StatusBadge status={p.isActive && p.publishedAt ? 'published' : 'draft'} />,
    },
    {
      key: 'publishedAt',
      header: 'Published',
      sortable: true,
      render: (p) => (
        <span className="text-xs text-gray-500">
          {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : '—'}
        </span>
      ),
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
          <>
            <Link
              href={`/admin/pyq-packages/${p.packageId}/edit`}
              className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              Edit
            </Link>
            {p.isActive && p.publishedAt ? (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'unpublish', id: p.packageId })}
                className="rounded px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50"
              >
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'publish', id: p.packageId })}
                className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
              >
                Publish
              </button>
            )}
            {p.totalPapers === 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', id: p.packageId }); }}
                className="rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                Delete
              </button>
            )}
          </>
        </div>
      ),
    },
  ];

  const handleConfirm = () => {
    if (!confirmAction) return;
    const { type, id } = confirmAction;
    if (type === 'publish') publishPackage(id);
    else if (type === 'unpublish') unpublishPackage(id);
    else if (type === 'delete') deletePackage(id);
    setConfirmAction(null);
  };

  const confirmConfig = (() => {
    if (!confirmAction) return null;
    switch (confirmAction.type) {
      case 'publish':
        return {
          title: 'Publish Package',
          message: 'This package will become active and available for purchase. Continue?',
          confirmLabel: 'Publish',
          variant: 'default' as const,
        };
      case 'unpublish':
        return {
          title: 'Unpublish Package',
          message: 'The package will be hidden from the store. Existing purchases retain access. Continue?',
          confirmLabel: 'Unpublish',
          variant: 'warning' as const,
        };
      case 'delete':
        return {
          title: 'Delete Package',
          message:
            'This package will be moved to the Recycle Bin and can be restored later. Continue?',
          confirmLabel: 'Delete',
          variant: 'danger' as const,
        };
      default:
        return null;
    }
  })();

  return (
    <div>
      <PageHeader
        title="PYQ Packages"
        description={`${totalCount} package${totalCount !== 1 ? 's' : ''} · managed by Super Admin`}
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/admin/pyq-packages' },
          { label: 'All Packages' },
        ]}
        actions={
          <Link
            href="/admin/pyq-packages/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Package
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search packages..."
          className="min-w-[240px] flex-1"
        />
        <select
          value={streamFilter}
          onChange={(e) => { setStreamFilter(e.target.value); setPage(1); }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Streams</option>
          {streams.map((s) => (
            <option key={s.streamId} value={s.streamId}>{s.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="min-w-[140px] rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">All Status</option>
          <option value="published">Published</option>
          <option value="unpublished">Unpublished</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable<PyqPackage>
        columns={columns}
        data={packages}
        keyExtractor={(p) => p.packageId}
        onRowClick={(p) => router.push(`/admin/pyq-packages/${p.packageId}`)}
        isLoading={isLoading}
        sortable
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
        emptyState={
          <EmptyState
            title="No PYQ packages found"
            description={search ? 'Try a different search term.' : 'Get started by creating your first PYQ package.'}
            action={
              <Link
                href="/admin/pyq-packages/new"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create Package
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
