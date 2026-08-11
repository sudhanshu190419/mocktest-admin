'use client';

/**
 * Admin Leave Request Detail Page (Phase 2E)
 *
 * Route: /admin/leave-requests/[leaveId]
 *
 * Renders the full review surface for one teacher leave request — summary,
 * affected occurrences, and approve/reject actions. Row clicks from the
 * Phase 2D inbox land here.
 *
 * All data comes from `useLeaveRequestDetail` (RLS: institute-scoped); all
 * writes go through `review_teacher_leave_request`.
 *
 * @module app/admin/leave-requests/[leaveId]
 */

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { LeaveRequestDetail } from '@/components/admin/leave/LeaveRequestDetail';

export default function AdminLeaveRequestDetailPage() {
  const { leaveId } = useParams<{ leaveId: string }>();

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      <PageHeader
        title="Leave Request Detail"
        description="Review the request and decide how affected classes are covered."
        breadcrumbs={[
          { label: 'Admin' },
          { label: 'Leave Requests', href: '/admin/leave-requests' },
          { label: leaveId ? leaveId.slice(0, 8) : 'Detail' },
        ]}
      />

      <LeaveRequestDetail leaveId={leaveId} />
    </div>
  );
}
