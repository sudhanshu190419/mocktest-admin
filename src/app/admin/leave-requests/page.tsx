'use client';

/**
 * Admin Leave Requests Inbox (Phase 2D)
 *
 * Review queue for teacher leave requests — filters, emergency priority,
 * pagination. Row click opens the request detail page (Phase 2E).
 *
 * All reads are institute-scoped through `useLeaveRequests`; no writes on
 * this screen.
 *
 * @module app/admin/leave-requests
 */

import { PageHeader } from '@/components/ui/PageHeader';
import { LeaveRequestsInbox } from '@/components/admin/leave/LeaveRequestsInbox';

export default function AdminLeaveRequestsPage() {
  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      <PageHeader
        title="Leave Requests"
        description="Review teacher leave requests and manage how affected classes are covered."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Leave Requests' }]}
      />

      <LeaveRequestsInbox />
    </div>
  );
}
