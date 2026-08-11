'use client';

import { useState } from 'react';
import { useAssignDoubt, useDoubtAssignableTeachers } from '@/hooks/doubt/useDoubt';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import type { StudentDoubt } from '@/types/doubt';

/**
 * DoubtAssignmentPanel
 *
 * Admin assignment UI for a doubt (Phase 7F). Lists candidate teachers —
 * batch_subject_teachers for the doubt's batch subject ∪ teachers with a
 * specialization matching the doubt's subject (mirrors assign_doubt
 * eligibility) — and assigns via the assign_doubt RPC.
 *
 * The RPC remains authoritative: it re-validates institute scope, teacher
 * eligibility/activity, and the doubt state before writing. The UI only
 * surfaces candidates and never decides authorization.
 *
 * @module components/admin/doubts/DoubtAssignmentPanel
 */
export function DoubtAssignmentPanel({ doubt }: { doubt: StudentDoubt }) {
  const locked = doubt.status === 'archived' || doubt.status === 'resolved';
  const { data: teachers, isLoading, isError, error: loadError } =
    useDoubtAssignableTeachers(doubt, !locked);

  const assignMutation = useAssignDoubt();

  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTeacherId = doubt.assignedTo ?? null;

  const selectedTeacher =
    teachers?.find((t) => t.teacherId === selectedTeacherId) ?? null;

  const handleAssign = () => {
    if (!selectedTeacherId || assignMutation.isPending) return;
    setError(null);
    assignMutation.mutate(
      { doubtId: doubt.doubtId, teacherId: selectedTeacherId },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setSelectedTeacherId('');
          setError(null);
        },
        onError: (err) => {
          setConfirmOpen(false);
          setError(err.message);
        },
      },
    );
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Teacher Assignment
        </h3>
        {doubt.assignedAt && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Assigned{' '}
            {new Date(doubt.assignedAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {/* Current assignment */}
      <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/50">
        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Current
        </p>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {doubt.assignedTeacherName ??
            (currentTeacherId ? 'Assigned' : 'Awaiting Assignment')}
        </p>
      </div>

      {locked ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {doubt.status === 'archived'
            ? 'Archived doubts cannot be assigned.'
            : 'This doubt is resolved. Reopen it to change the assigned teacher.'}
        </p>
      ) : (
        <>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : isError ? (
            <p className="text-xs text-rose-600 dark:text-rose-400">
              {loadError?.message ?? 'Could not load eligible teachers.'}
            </p>
          ) : !teachers || teachers.length === 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              No eligible teachers found. Assign a teacher to this batch
              subject from Batch Management (or add a subject specialization),
              then return here to assign them to the doubt.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {teachers.map((t) => {
                  const isCurrent = currentTeacherId === t.teacherId;
                  const selected = selectedTeacherId === t.teacherId;
                  return (
                    <button
                      key={t.teacherId}
                      type="button"
                      onClick={() => setSelectedTeacherId(t.teacherId)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/40'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                            selected
                              ? 'border-blue-600 bg-blue-600'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          {selected && (
                            <span className="h-1.5 w-1.5 rounded-full bg-white" />
                          )}
                        </span>
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                          {t.name || 'Unnamed teacher'}
                        </span>
                        <span
                          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            t.isBatchSubjectAssigned
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
                          }`}
                        >
                          {t.isBatchSubjectAssigned
                            ? 'Batch Subject'
                            : 'Subject Specialist'}
                        </span>
                      </span>
                      {isCurrent && (
                        <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          Current
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => selectedTeacher && setConfirmOpen(true)}
                disabled={!selectedTeacher || assignMutation.isPending}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {assignMutation.isPending ? 'Assigning...' : 'Assign Teacher'}
              </button>
            </>
          )}
        </>
      )}

      {error && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleAssign}
        title="Assign this teacher?"
        message={
          currentTeacherId
            ? `${selectedTeacher?.name ?? 'This teacher'} will replace the current teacher. They will be notified with a doubt_assigned notification.`
            : `${selectedTeacher?.name ?? 'This teacher'} will be notified and become the owner of this doubt.`
        }
        confirmLabel="Assign"
        variant="default"
        loading={assignMutation.isPending}
      />
    </section>
  );
}
