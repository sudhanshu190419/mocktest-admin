'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCreatePyqPackage } from '@/hooks/pyq/usePyqPackages';
import { PageHeader } from '@/components/ui/PageHeader';
import { PyqPackageForm, type PyqPackageFormValues } from '@/features/pyq/components/PyqPackageForm';

/**
 * Super Admin PYQ Package creation (Phase 9C).
 *
 * Reuses the shared PyqPackageForm. Creation is Super Admin only —
 * enforced server-side by pyqPackageService.createPackage (Phase 9B) and
 * at the UI layer via the route (manageAdmins) + sidebar gating.
 */
export default function AdminCreatePyqPackagePage() {
  const router = useRouter();
  const createPackage = useCreatePyqPackage();
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (values: PyqPackageFormValues) => {
      setFormError(null);
      createPackage.mutate(
        {
          name: values.name.trim(),
          description: values.description || null,
          streamId: values.streamId,
          price: values.price,
          currency: values.currency,
          thumbnailPath: values.thumbnailPath || null,
          yearFrom: values.yearFrom ? parseInt(values.yearFrom) : null,
          yearTo: values.yearTo ? parseInt(values.yearTo) : null,
        },
        {
          onSuccess: (pkg) => {
            router.push(`/admin/pyq-packages/${pkg.packageId}`);
          },
          onError: (error) => {
            setFormError(error.message);
          },
        },
      );
    },
    [createPackage, router],
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create PYQ Package"
        description="Configure the PYQ package settings. Papers can be added after creation."
        breadcrumbs={[
          { label: 'PYQ Packages', href: '/admin/pyq-packages' },
          { label: 'Create Package' },
        ]}
      />

      <PyqPackageForm
        isSubmitting={createPackage.isPending}
        submitLabel="Create Package"
        error={formError}
        cancelHref="/admin/pyq-packages"
        onSubmit={handleSubmit}
      />
    </div>
  );
}
