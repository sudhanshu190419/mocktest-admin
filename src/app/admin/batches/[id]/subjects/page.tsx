'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useBatchDetail } from '@/hooks/admin/useBatchManagement';
import { useBatchSubjects, useAvailableSubjects, useAssignSubjectsToBatch, useRemoveBatchSubject } from '@/hooks/admin/useBatchSubjectContentAssignment';
import { useCreateSubject } from '@/hooks/academic/useSubjects';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useAuth } from '@/context/AuthContext';
import {
  BookOpen,
  FileText,
  ClipboardText,
  ChalkboardTeacher,
  Video,
  Plus,
  Trash,
  MagnifyingGlass,
  CheckSquare,
  Square,
  X,
  CircleNotch,
  WarningCircle,
} from '@phosphor-icons/react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ConfirmRemoveState {
  batchSubjectId: string;
  subjectName: string;
  error?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function BatchSubjectsPage() {
  const params = useParams();
  const batchId = params.id as string;
  const { instituteId } = useAuth();

  const { data: batch, isLoading: batchLoading } = useBatchDetail(batchId);
  const { data: assignedSubjects, isLoading: subjectsLoading, refetch: refetchAssigned } = useBatchSubjects(batchId);
  const { data: availableSubjects, isLoading: availableLoading, refetch: refetchAvailable } = useAvailableSubjects(batchId);

  const assignMutation = useAssignSubjectsToBatch();
  const removeMutation = useRemoveBatchSubject();
  const createSubjectMutation = useCreateSubject();

  const isLoading = batchLoading || subjectsLoading;

  // ── Available subjects selection ──────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [availableSearch, setAvailableSearch] = useState('');

  // ── Remove confirmation ───────────────────────────────────────────────────
  const [confirmRemove, setConfirmRemove] = useState<ConfirmRemoveState | null>(null);

  // ── Create subject dialog ────────────────────────────────────────────────
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectCode, setNewSubjectCode] = useState('');

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(message: string, type: 'success' | 'error') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // ── Filtered available subjects ───────────────────────────────────────────
  const filteredAvailable = useMemo(() => {
    if (!availableSubjects) return [];
    if (!availableSearch.trim()) return availableSubjects;
    const term = availableSearch.toLowerCase();
    return availableSubjects.filter(
      (s) => s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term),
    );
  }, [availableSubjects, availableSearch]);

  // ── Toggle selection ──────────────────────────────────────────────────────
  function toggleSelect(subjectId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        next.add(subjectId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredAvailable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAvailable.map((s) => s.subjectId)));
    }
  }

  // ── Assign selected ───────────────────────────────────────────────────────
  async function handleAssignSelected() {
    if (selectedIds.size === 0) return;
    try {
      const result = await assignMutation.mutateAsync({ batchId, subjectIds: [...selectedIds] });
      setSelectedIds(new Set());
      setAvailableSearch('');
      showToast(`${result.data?.assigned ?? 0} subject(s) assigned successfully.`, 'success');
      await Promise.all([refetchAssigned(), refetchAvailable()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to assign subjects.', 'error');
    }
  }

  // ── Remove subject ────────────────────────────────────────────────────────
  async function handleRemove() {
    if (!confirmRemove) return;
    try {
      await removeMutation.mutateAsync({ batchSubjectId: confirmRemove.batchSubjectId, force: false });
      setConfirmRemove(null);
      showToast(`"${confirmRemove.subjectName}" removed from batch.`, 'success');
      await Promise.all([refetchAssigned(), refetchAvailable()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove subject.';
      // If it has dependencies, show the error in the confirmation dialog
      setConfirmRemove((prev) => prev ? { ...prev, error: msg } : null);
      if (!msg.includes('Cannot remove')) {
        showToast(msg, 'error');
      }
    }
  }

  async function handleForceRemove() {
    if (!confirmRemove) return;
    try {
      await removeMutation.mutateAsync({ batchSubjectId: confirmRemove.batchSubjectId, force: true });
      setConfirmRemove(null);
      showToast(`"${confirmRemove.subjectName}" removed from batch (with dependencies).`, 'success');
      await Promise.all([refetchAssigned(), refetchAvailable()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove subject.', 'error');
    }
  }

  // ── Create subject + assign to batch ──────────────────────────────────────
  async function handleCreateSubject() {
    if (!instituteId || !batch?.streamId) return;
    const name = newSubjectName.trim();
    const code = newSubjectCode.trim().toUpperCase();
    if (!name || !code) return;

    try {
      const newSubject = await createSubjectMutation.mutateAsync({
        streamId: batch.streamId,
        name,
        code,
      });

      // Immediately assign to this batch
      await assignMutation.mutateAsync({ batchId, subjectIds: [newSubject.subjectId] });

      setShowCreateDialog(false);
      setNewSubjectName('');
      setNewSubjectCode('');
      showToast(`Subject "${name}" created and assigned to batch.`, 'success');
      await Promise.all([refetchAssigned(), refetchAvailable()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create subject.', 'error');
    }
  }

  // ── Derived counts ────────────────────────────────────────────────────────
  const assignedCount = assignedSubjects?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={batch?.batchName ? `${batch.batchName} — Subjects` : 'Batch Subjects'}
        description="Manage subjects within this batch. Assign subjects from the stream or create new ones."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Batch Management', href: '/admin/batches' },
          { label: batch?.batchName ?? 'Batch', href: `/admin/batches/${batchId}` },
          { label: 'Subjects' },
        ]}
        actions={
          <Link
            href={`/admin/batches/${batchId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            ← Back to Batch
          </Link>
        }
      />

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed right-6 top-6 z-50 animate-slide-in rounded-xl px-5 py-3 shadow-lg ${
            toast.type === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {toast.type === 'success' ? '✅' : '⚠️'} {toast.message}
          </div>
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* ── Not loading ─────────────────────────────────────────────────── */}
      {!isLoading && (
        <>
          {/* ════════════════════════════════════════════════════════════════ */}
          {/* SECTION 1 — Assigned Subjects                                 */}
          {/* ════════════════════════════════════════════════════════════════ */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  Assigned Subjects
                </h2>
                <p className="text-xs text-gray-500">
                  {assignedCount} subject{assignedCount !== 1 ? 's' : ''} assigned to this batch
                </p>
              </div>
            </div>

            {assignedCount === 0 ? (
              <EmptyState
                icon={<BookOpen size={36} weight="thin" />}
                title="No subjects assigned"
                description="This batch doesn't have any subjects yet. Assign subjects from the stream using the section below."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {assignedSubjects?.map((subject) => {
                  const isFullSyllabus = subject.subjectCode === 'FULL_SYLL';

                  return (
                    <div
                      key={subject.batchSubjectId}
                      className="group relative rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-600"
                    >
                      {/* Subject header */}
                      <div className="mb-3 flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                            isFullSyllabus
                              ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                              : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                          }`}
                        >
                          {isFullSyllabus ? (
                            <ClipboardText size={20} weight="duotone" />
                          ) : (
                            <BookOpen size={20} weight="duotone" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {subject.subjectName}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {isFullSyllabus ? 'Full Syllabus' : `Code: ${subject.subjectCode}`}
                          </p>
                        </div>
                      </div>

                      {/* Counts */}
                      <div className="mb-3 grid grid-cols-2 gap-1.5 text-xs">
                        <div className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          <FileText size={13} weight="bold" />
                          <span>{subject.contentCount} content</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          <ClipboardText size={13} weight="bold" />
                          <span>{subject.mockTestCount} tests</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          <ChalkboardTeacher size={13} weight="bold" />
                          <span>{subject.teacherCount} teachers</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          <Video size={13} weight="bold" />
                          <span>{subject.liveClassCount} classes</span>
                        </div>
                      </div>

                      {/* Action links */}
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-3 dark:border-gray-700">
                        <Link
                          href={`/admin/batches/${batchId}/subjects/${subject.batchSubjectId}/content`}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
                        >
                          <FileText size={13} />
                          Content
                        </Link>
                        <Link
                          href={`/admin/batches/${batchId}/subjects/${subject.batchSubjectId}/mock-tests`}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
                        >
                          <ClipboardText size={13} />
                          Mock Tests
                        </Link>
                        <div className="relative inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-600 opacity-60 dark:bg-amber-900/20 dark:text-amber-400" title="Coming soon">
                          <ChalkboardTeacher size={13} />
                          Teacher
                        </div>
                        <div className="relative inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-600 opacity-60 dark:bg-teal-900/20 dark:text-teal-400" title="Coming soon">
                          <Video size={13} />
                          Live Class
                        </div>
                        <button
                          onClick={() =>
                            setConfirmRemove({
                              batchSubjectId: subject.batchSubjectId,
                              subjectName: subject.subjectName,
                            })
                          }
                          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                        >
                          <Trash size={13} />
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Summary bar */}
            {assignedCount > 0 && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    Total: <strong className="text-gray-900 dark:text-gray-100">{assignedCount}</strong>
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    Active: <strong className="text-emerald-600">{assignedSubjects?.filter((s) => s.isActive).length}</strong>
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    Inactive: <strong className="text-gray-500">{assignedSubjects?.filter((s) => !s.isActive).length}</strong>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* SECTION 2 — Available Subjects                                 */}
          {/* ════════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Available Subjects
                  </h2>
                  <p className="text-xs text-gray-500">
                    Subjects from the <strong>{batch?.streamName ?? 'selected'}</strong> stream
                    {availableLoading ? '...' : ` — ${availableSubjects?.length ?? 0} available`}
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  <Plus size={15} weight="bold" />
                  Create Subject
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="border-b border-gray-100 px-6 py-3 dark:border-gray-700">
              <div className="relative">
                <MagnifyingGlass
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  value={availableSearch}
                  onChange={(e) => setAvailableSearch(e.target.value)}
                  placeholder="Search subjects..."
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:focus:border-blue-500"
                />
                {availableSearch && (
                  <button
                    onClick={() => setAvailableSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Available subjects list */}
            {availableLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : filteredAvailable.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <BookOpen size={32} weight="thin" className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  {availableSearch
                    ? 'No subjects match your search.'
                    : 'All subjects from this stream are already assigned to this batch.'}
                </p>
              </div>
            ) : (
              <>
                {/* Select all bar */}
                <div className="flex items-center justify-between border-b border-gray-50 px-6 py-2 dark:border-gray-800">
                  <button
                    onClick={toggleSelectAll}
                    className="inline-flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    {selectedIds.size === filteredAvailable.length ? (
                      <CheckSquare size={16} weight="fill" className="text-blue-600" />
                    ) : (
                      <Square size={16} />
                    )}
                    {selectedIds.size === filteredAvailable.length ? 'Deselect all' : 'Select all'}
                    <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800">
                      {filteredAvailable.length}
                    </span>
                  </button>

                  {selectedIds.size > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">
                        {selectedIds.size} selected
                      </span>
                      <button
                        onClick={handleAssignSelected}
                        disabled={assignMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        {assignMutation.isPending ? (
                          <CircleNotch size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} weight="bold" />
                        )}
                        Add Selected
                      </button>
                    </div>
                  )}
                </div>

                {/* Subjects checkboxes */}
                <div className="max-h-80 overflow-y-auto p-2">
                  {filteredAvailable.map((subject) => {
                    const isSelected = selectedIds.has(subject.subjectId);
                    const isFullSyllabus = subject.code === 'FULL_SYLL';

                    return (
                      <button
                        key={subject.subjectId}
                        onClick={() => toggleSelect(subject.subjectId)}
                        className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <div className="flex-shrink-0">
                          {isSelected ? (
                            <CheckSquare size={18} weight="fill" className="text-blue-600" />
                          ) : (
                            <Square size={18} className="text-gray-300 dark:text-gray-600" />
                          )}
                        </div>
                        <div
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
                            isFullSyllabus
                              ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                              : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                          }`}
                        >
                          {isFullSyllabus ? (
                            <ClipboardText size={15} weight="duotone" />
                          ) : (
                            <BookOpen size={15} weight="duotone" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {subject.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Code: {subject.code}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Bottom action bar */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-100 px-6 py-3 dark:border-gray-700">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {selectedIds.size} subject{selectedIds.size !== 1 ? 's' : ''} selected
                    </span>
                    <button
                      onClick={handleAssignSelected}
                      disabled={assignMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      {assignMutation.isPending ? (
                        <CircleNotch size={16} className="animate-spin" />
                      ) : (
                        <Plus size={16} weight="bold" />
                      )}
                      Add to Batch
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Remove Confirmation Dialog                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-900/20">
                  <WarningCircle size={22} weight="bold" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Remove Subject</h3>
                  <p className="text-xs text-gray-500">{confirmRemove.subjectName}</p>
                </div>
              </div>
              <button
                onClick={() => setConfirmRemove(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4">
              {confirmRemove.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">
                    {confirmRemove.error}
                  </p>
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    If you want to remove this subject and all its assigned resources, click &quot;Force Remove&quot; below.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Are you sure you want to remove <strong>{confirmRemove.subjectName}</strong> from this batch?
                  This will not delete the subject from the stream — only the assignment to this batch.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-700">
              <button
                onClick={() => setConfirmRemove(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              {confirmRemove.error ? (
                <button
                  onClick={handleForceRemove}
                  disabled={removeMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {removeMutation.isPending ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Trash size={16} />
                  )}
                  Force Remove
                </button>
              ) : (
                <button
                  onClick={handleRemove}
                  disabled={removeMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {removeMutation.isPending ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Trash size={16} />
                  )}
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Create Subject Dialog                                             */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/20">
                  <BookOpen size={22} weight="bold" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Create Subject</h3>
                  <p className="text-xs text-gray-500">
                    Will be created in <strong>{batch?.streamName ?? 'the stream'}</strong> and assigned to this batch
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateSubject();
              }}
              className="space-y-4 p-6"
            >
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Subject Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="e.g. Physics, Chemistry"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  required
                  minLength={2}
                  maxLength={100}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Subject Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newSubjectCode}
                  onChange={(e) => setNewSubjectCode(e.target.value.toUpperCase())}
                  placeholder="e.g. PHY, CHEM"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 uppercase"
                  required
                  minLength={2}
                  maxLength={20}
                />
              </div>

              {createSubjectMutation.isError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
                  {createSubjectMutation.error instanceof Error
                    ? createSubjectMutation.error.message
                    : 'Failed to create subject.'}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateDialog(false);
                    setNewSubjectName('');
                    setNewSubjectCode('');
                  }}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    createSubjectMutation.isPending ||
                    !newSubjectName.trim() ||
                    !newSubjectCode.trim()
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {createSubjectMutation.isPending ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <Plus size={16} weight="bold" />
                  )}
                  Create & Assign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
