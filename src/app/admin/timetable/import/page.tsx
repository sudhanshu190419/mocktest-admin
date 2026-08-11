'use client';

import { PageHeader } from '@/components/ui/PageHeader';
import { BulkTimetableImportPage } from '@/components/admin/timetable/bulk-import/BulkTimetableImportPage';

/**
 * Bulk Timetable Import route (`/admin/timetable/import`).
 *
 * Permission: the route prefix `/admin/timetable` maps to
 * `approveAcademicResources` in `src/lib/admin/routePermissions.ts` and the
 * admin layout (`RoleGuard` + `AdminRouteGuard`) protects this page — no
 * permission changes needed.
 */
export default function BulkTimetableImportRoute() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk Timetable Import"
        description="Upload a single Excel/CSV file containing timetable schedules and lesson plans."
        breadcrumbs={[
          { label: 'Admin' },
          { label: 'Timetable', href: '/admin/timetable' },
          { label: 'Bulk Import' },
        ]}
      />
      <BulkTimetableImportPage />
    </div>
  );
}
