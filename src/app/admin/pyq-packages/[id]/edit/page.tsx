'use client';

import { useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  usePyqPackage,
  useUpdatePyqPackage,
  usePublishPyqPackage,
  useUnpublishPyqPackage,
  useDeletePyqPackage,
} from '@/hooks/pyq/usePyqPackages';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { PyqPackageForm, type PyqPackageFormValues } from '@/features/pyq/components/PyqPackageForm';

/**
 * Super Admin PYQ Package edit (Phase 9C).
 *
 * Reuses the shared PyqPackageForm. All mutations (save / publish /
 * unpublish / delete) are server-side Super Admin gated (Phase 9B).
 */
export default function AdminEditPyqPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id: packageId } = use(params);

  const { data: pkg, isLoading: pkgLoading, isError: pkgError } = usePyqPackage(packageId);
  const updatePackage = useUpdatePyqPackage();
  const publishPackage = usePublishPyqPackage();
  const unpublishPackage = useUnpublishPyqPackage();
  const deletePackage = useDeletePyqPackage();

  const [confirmAction, setConfirmAction] = useState<{ type: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [formError, setFormError] = useState('');

  // Loading state
  if (pkgLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="space-y-8">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // Error state
  if (pkgError || !pkg) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          title="Package Not Found"
          description="The requested PYQ package could not be found."
          breadcrumbs={[
            { label: 'PYQ Packages', href: '/admin/pyq-packages' },
            { label: 'Edit Package' },
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

  const handleSave = useCallback(
    (values: PyqPackageFormValues) => {
      setFormError('');
      setSuccessMessage('');
      updatePackage.mutate(
        {
          id: packageId,
          input: {
            name: values.name.trim(),
            description: values.description || null,
            streamId: values.streamId,
            price: values.price,
            currency: values.currency,
            thumbnailPath: values.thumbnailPath || null,
            yearFrom: values.yearFrom ? parseInt(values.yearFrom) : null,
            yearTo: values.yearTo ? parseInt(values.yearTo) : null,
          },
        },
        {
          onSuccess: () => {
            setSuccessMessage('Package saved successfully.');
            setTimeout(() => setSuccessMessage(''), 3000);
          },
          onError: (error) => {
            setFormError(error.message);
          },
        },
      );
    },
    [updatePackage, packageId],
  );

  const handlePublishToggle = () => {
    setFormError('');
    if (isPublished) {
      unpublishPackage.mutate(packageId, {
        onSuccess: () => setSuccessMessage('Package unpublished.'),
        onError: (error) => setFormError(error.message),
      });
    } else {
      publishPackage.mutate(packageId, {
        onSuccess: () => setSuccessMessage('Package published successfully!'),
        onError: (error) => setFormError(error.message),
      });
    }
    setConfirmAction(null);
  };

  const handleDelete = () => {
    setFormError('');
    deletePackage.mutate(packageId, {
      onSuccess: () => {
        router.push('/admin/pyq-packages');
      },
      onError: (error) => {
        setFormError(error.message);
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
        description="Edit PYQ package details and configuration"
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/admin/pyq-packages' },
          { label: pkg.name, href: `/admin/pyq-packages/${packageId}` },
          { label: 'Edit' },
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
            <StatusBadge status={isPublished ? 'published' : 'draft'} />
          </div>
        }
      />

      <PyqPackageForm
        key={pkg.packageId}
        initialData={{
          name: pkg.name,
          description: pkg.description ?? '',
          streamId: pkg.streamId,
          price: pkg.price,
          currency: pkg.currency,
          thumbnailPath: pkg.thumbnailPath ?? '',
          yearFrom: pkg.yearFrom?.toString() ?? '',
          yearTo: pkg.yearTo?.toString() ?? '',
        }}
        isSubmitting={updatePackage.isPending}
        submitLabel="Save Changes"
        error={formError}
        successMessage={successMessage}
        cancelHref={`/admin/pyq-packages/${packageId}`}
        onSubmit={handleSave}
        footerLeft={
          <div className="flex items-center gap-2">
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
        }
      />

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
