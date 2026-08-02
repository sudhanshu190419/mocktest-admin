'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  usePyqPackage,
  usePublishPyqPackage,
  useUnpublishPyqPackage,
  useDeletePyqPackage,
} from '@/hooks/pyq/usePyqPackages';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

/**
 * Super Admin PYQ Package detail (Phase 9C).
 *
 * Shows package metadata and offers the full Super Admin action set:
 * Edit / Publish / Unpublish / Delete (soft delete → Recycle Bin).
 * Mutations are server-side Super Admin gated (Phase 9B).
 */
export default function AdminPyqPackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id: packageId } = use(params);

  const { data: pkg, isLoading: pkgLoading, isError: pkgError } = usePyqPackage(packageId);
  const publishPackage = usePublishPyqPackage();
  const unpublishPackage = useUnpublishPyqPackage();
  const deletePackage = useDeletePyqPackage();

  const [confirmAction, setConfirmAction] = useState<{ type: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Loading state
  if (pkgLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  // Error / not found state
  if (pkgError || !pkg) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          title="Package Not Found"
          description="The requested PYQ package could not be found."
          breadcrumbs={[
            { label: 'PYQ Packages', href: '/admin/pyq-packages' },
            { label: 'Package Detail' },
          ]}
        />
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/20">
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Package &ldquo;{packageId}&rdquo; does not exist or has been deleted.
          </p>
          <Link
            href="/admin/pyq-packages"
            className="mt-3 inline-block rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700"
          >
            Back to Packages
          </Link>
        </div>
      </div>
    );
  }

  const isPublished = pkg.isActive && pkg.publishedAt;

  const handlePublishToggle = () => {
    setErrorMessage('');
    if (isPublished) {
      unpublishPackage.mutate(packageId, {
        onError: (error) => setErrorMessage(error.message),
      });
    } else {
      publishPackage.mutate(packageId, {
        onError: (error) => setErrorMessage(error.message),
      });
    }
    setConfirmAction(null);
  };

  const handleDelete = () => {
    setErrorMessage('');
    deletePackage.mutate(packageId, {
      onSuccess: () => {
        router.push('/admin/pyq-packages');
      },
      onError: (error) => {
        setErrorMessage(error.message);
        setConfirmAction(null);
      },
    });
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
    <div className="max-w-3xl">
      <PageHeader
        title={pkg.name}
        description={pkg.description ?? 'No description provided.'}
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/admin/pyq-packages' },
          { label: pkg.name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/pyq/packages/${packageId}/papers`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              View Papers ({pkg.totalPapers})
            </Link>
            <Link
              href={`/admin/pyq-packages/${packageId}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Edit
            </Link>
            <StatusBadge status={isPublished ? 'published' : 'draft'} />
          </div>
        }
      />

      {errorMessage && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* Info cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Stream</p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {pkg.streamName ?? '—'}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Price</p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {pkg.currency} {pkg.price}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Papers</p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {pkg.totalPapers}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Year Range</p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {pkg.yearFrom && pkg.yearTo
              ? `${pkg.yearFrom} – ${pkg.yearTo}`
              : pkg.yearFrom || pkg.yearTo || '—'}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Created</p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {new Date(pkg.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Published</p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {pkg.publishedAt ? new Date(pkg.publishedAt).toLocaleDateString() : '—'}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-2 border-t border-gray-200 pt-6">
        {isPublished ? (
          <button
            type="button"
            onClick={() => setConfirmAction({ type: 'unpublish' })}
            disabled={unpublishPackage.isPending}
            className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          >
            {unpublishPackage.isPending ? 'Unpublishing...' : 'Unpublish'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmAction({ type: 'publish' })}
            disabled={publishPackage.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {publishPackage.isPending ? 'Publishing...' : 'Publish'}
          </button>
        )}
        {pkg.totalPapers === 0 && (
          <button
            type="button"
            onClick={() => setConfirmAction({ type: 'delete' })}
            disabled={deletePackage.isPending}
            className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {deletePackage.isPending ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>

      {confirmConfig && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={confirmAction?.type === 'delete' ? handleDelete : handlePublishToggle}
          title={confirmConfig.title}
          message={confirmConfig.message}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant}
        />
      )}
    </div>
  );
}
