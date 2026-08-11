'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { ImportSummary } from '@/types/bulkTimetableImport';

interface BulkTimetableConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  summary: ImportSummary;
  loading: boolean;
}

/**
 * Pre-import confirmation. RPC 114 (`bulk_import_timetable`) is fully atomic
 * — the wording and the summary lines reflect that nothing is partially
 * applied.
 */
export function BulkTimetableConfirm({
  open,
  onClose,
  onConfirm,
  summary,
  loading,
}: BulkTimetableConfirmProps) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Confirm Bulk Import"
      message="This will create/update the timetable and lesson plans below. This action cannot be partially completed — either everything imports or nothing does."
      confirmLabel="Import Timetable"
      cancelLabel="Cancel"
      variant="warning"
      loading={loading}
    >
      <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-800/50 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Timetable slots
          </p>
          <p className="mt-0.5 font-semibold text-gray-900 dark:text-gray-100">
            {summary.slotsToCreate} new · {summary.slotsToReuse} reused · {summary.slotsToExtend}{' '}
            extended
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Lesson plans
          </p>
          <p className="mt-0.5 font-semibold text-gray-900 dark:text-gray-100">
            {summary.plansToCreate} new · {summary.plansToUpdate} updated
          </p>
        </div>
      </div>
    </ConfirmDialog>
  );
}
