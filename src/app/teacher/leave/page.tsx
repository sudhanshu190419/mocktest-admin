'use client';

/**
 * My Leave Requests Page (Phase 2C)
 *
 * The teacher's leave-request hub:
 *
 *   - "New Leave Request" header action opens `LeaveRequestModal`
 *   - `?open=1` auto-opens the modal (e.g. after submitting from the
 *     timetable page)
 *   - `?from=YYYY-MM-DD&to=YYYY-MM-DD` prefills the modal's date range
 *     (e.g. the visible week from the timetable page)
 *
 * All writes go through migration-115 RPCs (the modal/service layer), never
 * direct table writes. The list below reflects RLS-scoped reads of the
 * teacher's own requests.
 *
 * @module app/teacher/leave
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from '@phosphor-icons/react';
import { PageHeader } from '@/components/ui/PageHeader';
import { LeaveRequestList } from '@/components/teacher/leave/LeaveRequestList';
import { LeaveRequestModal } from '@/components/teacher/leave/LeaveRequestModal';

export default function TeacherLeavePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Query-param prefill (best-effort; the modal also defaults to today).
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const autoOpen = searchParams.get('open') === '1';

  const [modalOpen, setModalOpen] = useState(autoOpen);

  /** Open the modal, keeping the query params (prefill) in the URL. */
  function openModal() {
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    // Clear the transient ?open=1 flag so refreshing doesn't reopen it.
    if (autoOpen) router.replace('/teacher/leave');
  }

  return (
    <div className="space-y-6 pb-12 animate-fadeIn">
      <PageHeader
        title="My Leave Requests"
        description="Request leave for your upcoming classes and track admin decisions."
        breadcrumbs={[{ label: 'Teacher' }, { label: 'Leave Requests' }]}
        actions={
          <button
            onClick={openModal}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700"
          >
            <Plus size={16} weight="bold" />
            New Leave Request
          </button>
        }
      />

      <LeaveRequestList />

      <LeaveRequestModal
        isOpen={modalOpen}
        onClose={closeModal}
        defaultFrom={fromParam ?? undefined}
        defaultTo={toParam ?? undefined}
      />

    </div>
  );
}
