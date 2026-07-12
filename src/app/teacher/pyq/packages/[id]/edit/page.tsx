'use client';

import { useState, useCallback, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  usePyqPackage,
  useUpdatePyqPackage,
  usePublishPyqPackage,
  useUnpublishPyqPackage,
  useDeletePyqPackage,
} from '@/hooks/pyq/usePyqPackages';
import { useStreams } from '@/hooks/academic/useStreams';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';

interface FormData {
  name: string;
  description: string;
  streamId: string;
  price: number;
  currency: string;
  thumbnailPath: string;
  yearFrom: string;
  yearTo: string;
}

const CURRENCY_OPTIONS = [
  { value: 'INR', label: '₹ INR' },
  { value: 'USD', label: '$ USD' },
];

export default function EditPyqPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: packageId } = use(params);

  const { data: pkg, isLoading: pkgLoading, isError: pkgError } = usePyqPackage(packageId);
  const updatePackage = useUpdatePyqPackage();
  const publishPackage = usePublishPyqPackage();
  const unpublishPackage = useUnpublishPyqPackage();
  const deletePackage = useDeletePyqPackage();

  const [formData, setFormData] = useState<FormData | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<{ type: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState('');

  const { data: streamsData } = useStreams(undefined, undefined, { page: 1, pageSize: 100 });
  const streams = streamsData?.data ?? [];

  // Populate form from fetched package
  useEffect(() => {
    if (pkg && !formData) {
      setFormData({
        name: pkg.name,
        description: pkg.description ?? '',
        streamId: pkg.streamId,
        price: pkg.price,
        currency: pkg.currency,
        thumbnailPath: pkg.thumbnailPath ?? '',
        yearFrom: pkg.yearFrom?.toString() ?? '',
        yearTo: pkg.yearTo?.toString() ?? '',
      });
    }
  }, [pkg, formData]);

  const handleChange = useCallback(
    (field: keyof FormData, value: string | number) => {
      setFormData((prev) => prev ? { ...prev, [field]: value } : prev);
      setErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData) return false;

    if (!formData.name.trim()) {
      newErrors.name = 'Package name is required.';
    } else if (formData.name.trim().length < 3) {
      newErrors.name = 'Package name must be at least 3 characters.';
    }

    if (!formData.streamId) {
      newErrors.streamId = 'Stream is required.';
    }

    if (formData.price < 0) {
      newErrors.price = 'Price must be 0 or greater.';
    }

    if (formData.yearFrom || formData.yearTo) {
      const yearFrom = formData.yearFrom ? parseInt(formData.yearFrom) : null;
      const yearTo = formData.yearTo ? parseInt(formData.yearTo) : null;

      if (yearFrom !== null && (isNaN(yearFrom) || yearFrom < 1990 || yearFrom > 2100)) {
        newErrors.yearFrom = 'Year must be between 1990 and 2100.';
      }
      if (yearTo !== null && (isNaN(yearTo) || yearTo < 1990 || yearTo > 2100)) {
        newErrors.yearTo = 'Year must be between 1990 and 2100.';
      }
      if (yearFrom !== null && yearTo !== null && yearTo < yearFrom) {
        newErrors.yearTo = 'Year To must be >= Year From.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData || !validate()) return;

      updatePackage.mutate(
        {
          id: packageId,
          input: {
            name: formData.name.trim(),
            description: formData.description || null,
            streamId: formData.streamId,
            price: formData.price,
            currency: formData.currency,
            thumbnailPath: formData.thumbnailPath || null,
            yearFrom: formData.yearFrom ? parseInt(formData.yearFrom) : null,
            yearTo: formData.yearTo ? parseInt(formData.yearTo) : null,
          },
        },
        {
          onSuccess: () => {
            setSuccessMessage('Package saved successfully.');
            setTimeout(() => setSuccessMessage(''), 3000);
          },
          onError: (error) => {
            setErrors({ form: error.message });
          },
        },
      );
    },
    [formData, validate, updatePackage, packageId],
  );

  const handlePublishToggle = () => {
    if (!pkg) return;
    if (pkg.isActive && pkg.publishedAt) {
      unpublishPackage.mutate(packageId, {
        onSuccess: () => setSuccessMessage('Package unpublished.'),
        onError: (error) => setErrors({ form: error.message }),
      });
    } else {
      publishPackage.mutate(packageId, {
        onSuccess: () => setSuccessMessage('Package published successfully!'),
        onError: (error) => setErrors({ form: error.message }),
      });
    }
    setConfirmAction(null);
  };

  const handleDelete = () => {
    deletePackage.mutate(packageId, {
      onSuccess: () => {
        router.push('/teacher/pyq/packages');
      },
      onError: (error) => {
        setErrors({ form: error.message });
        setConfirmAction(null);
      },
    });
  };

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
            { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
            { label: 'Edit Package' },
          ]}
        />
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/20">
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Package &ldquo;{packageId}&rdquo; does not exist or has been deleted.
          </p>
          <Link
            href="/teacher/pyq/packages"
            className="mt-3 inline-block rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700"
          >
            Back to Packages
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={pkg.name}
        description="Edit PYQ package details and configuration"
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
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
              Manage Papers ({pkg.totalPapers})
            </Link>
            <StatusBadge
              status={pkg.isActive && pkg.publishedAt ? 'published' : 'draft'}
            />
          </div>
        }
      />

      {/* Success banner */}
      {successMessage && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        {/* Basic Info */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Basic Information</h2>
          <div className="space-y-4">
            {/* Package Name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Package Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData?.name ?? ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={formData?.description ?? ''}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
            </div>

            {/* Stream */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Stream <span className="text-red-500">*</span>
              </label>
              <select
                value={formData?.streamId ?? ''}
                onChange={(e) => handleChange('streamId', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              >
                <option value="">Select a stream...</option>
                {streams.map((s) => (
                  <option key={s.streamId} value={s.streamId}>{s.name}</option>
                ))}
              </select>
              {errors.streamId && <p className="mt-1 text-xs text-red-500">{errors.streamId}</p>}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Pricing</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Price <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={formData?.price ?? 0}
                onChange={(e) => handleChange('price', Math.max(0, parseFloat(e.target.value) || 0))}
                min={0}
                step={0.01}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.price && <p className="mt-1 text-xs text-red-500">{errors.price}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Currency</label>
              <select
                value={formData?.currency ?? 'INR'}
                onChange={(e) => handleChange('currency', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Year Range */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Year Range</h2>
          <p className="mb-4 text-xs text-gray-500">
            Optional range of exam years covered by papers in this package.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Year From</label>
              <input
                type="number"
                value={formData?.yearFrom ?? ''}
                onChange={(e) => handleChange('yearFrom', e.target.value)}
                min={1990}
                max={2100}
                placeholder="e.g. 2015"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.yearFrom && <p className="mt-1 text-xs text-red-500">{errors.yearFrom}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Year To</label>
              <input
                type="number"
                value={formData?.yearTo ?? ''}
                onChange={(e) => handleChange('yearTo', e.target.value)}
                min={1990}
                max={2100}
                placeholder="e.g. 2024"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.yearTo && <p className="mt-1 text-xs text-red-500">{errors.yearTo}</p>}
            </div>
          </div>
        </section>

        {/* Thumbnail */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Thumbnail</h2>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Thumbnail Path</label>
            <input
              type="text"
              value={formData?.thumbnailPath ?? ''}
              onChange={(e) => handleChange('thumbnailPath', e.target.value)}
              placeholder="Storage path for the package cover image..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            />
          </div>
        </section>

        {/* Form error */}
        {errors.form && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errors.form}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-gray-200 pt-6">
          <div className="flex items-center gap-2">
            {pkg.isActive && pkg.publishedAt ? (
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
          <div className="flex items-center gap-3">
            <Link
              href="/teacher/pyq/packages"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={updatePackage.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updatePackage.isPending ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmAction?.type === 'publish'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handlePublishToggle}
        title="Publish Package"
        message="This package will become active and available for purchase. Continue?"
        confirmLabel="Publish"
        variant="default"
      />

      <ConfirmDialog
        open={confirmAction?.type === 'unpublish'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handlePublishToggle}
        title="Unpublish Package"
        message="The package will be hidden from the store. Existing purchases retain access. Continue?"
        confirmLabel="Unpublish"
        variant="warning"
      />

      <ConfirmDialog
        open={confirmAction?.type === 'delete'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleDelete}
        title="Delete Package"
        message="Are you sure you want to permanently delete this package? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
