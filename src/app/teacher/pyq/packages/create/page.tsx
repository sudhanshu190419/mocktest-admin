'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCreatePyqPackage } from '@/hooks/pyq/usePyqPackages';
import { useStreams } from '@/hooks/academic/useStreams';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';

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

const emptyForm: FormData = {
  name: '',
  description: '',
  streamId: '',
  price: 0,
  currency: 'INR',
  thumbnailPath: '',
  yearFrom: '',
  yearTo: '',
};

const CURRENCY_OPTIONS = [
  { value: 'INR', label: '₹ INR' },
  { value: 'USD', label: '$ USD' },
];

export default function CreatePyqPackagePage() {
  const router = useRouter();
  const { instituteId } = useAuth();
  const createPackage = useCreatePyqPackage();

  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: streamsData } = useStreams(undefined, undefined, { page: 1, pageSize: 100 });
  const streams = streamsData?.data ?? [];

  const handleChange = useCallback(
    (field: keyof FormData, value: string | number) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: '' }));
    },
    [],
  );

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

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

    // Validate year range
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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      createPackage.mutate(
        {
          name: formData.name.trim(),
          description: formData.description || null,
          streamId: formData.streamId,
          price: formData.price,
          currency: formData.currency,
          thumbnailPath: formData.thumbnailPath || null,
          yearFrom: formData.yearFrom ? parseInt(formData.yearFrom) : null,
          yearTo: formData.yearTo ? parseInt(formData.yearTo) : null,
        },
        {
          onSuccess: (pkg) => {
            router.push(`/teacher/pyq/packages/${pkg.packageId}/edit`);
          },
          onError: (error) => {
            setErrors({ form: error.message });
          },
        },
      );
    },
    [formData, validate, createPackage, router],
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create PYQ Package"
        description="Configure the PYQ package settings. Papers can be added after creation."
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/teacher/pyq/packages' },
          { label: 'Create Package' },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-8">
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
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="e.g. NEET PYQ 2015–2024 Complete Bundle"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Marketing description shown on the package detail page..."
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
                value={formData.streamId}
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
                value={formData.price}
                onChange={(e) => handleChange('price', Math.max(0, parseFloat(e.target.value) || 0))}
                min={0}
                step={0.01}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
              {errors.price && <p className="mt-1 text-xs text-red-500">{errors.price}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Currency</label>
              <select
                value={formData.currency}
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
                value={formData.yearFrom}
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
                value={formData.yearTo}
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
              value={formData.thumbnailPath}
              onChange={(e) => handleChange('thumbnailPath', e.target.value)}
              placeholder="Storage path for the package cover image..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            />
            <p className="mt-1 text-xs text-gray-500">
              Set this after uploading the image. Leave empty to add later.
            </p>
          </div>
        </section>

        {/* Info banner */}
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-400">
          <strong>Note:</strong> New packages are created as <strong>inactive</strong> (not available for purchase).
          You can publish the package after adding papers.
        </div>

        {/* Form error */}
        {errors.form && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errors.form}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 border-t border-gray-200 pt-6">
          <button
            type="submit"
            disabled={createPackage.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createPackage.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : (
              'Create Package'
            )}
          </button>
          <Link
            href="/teacher/pyq/packages"
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
