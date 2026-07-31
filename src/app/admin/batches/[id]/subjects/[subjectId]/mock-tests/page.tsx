'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  useBSAssignedMockTests,
  useBSAvailableMockTests,
  useBSAssignMockTests,
  useBSRemoveMockTest,
  useBSUpdateMockTestAssignment,
} from '@/hooks/admin/useBatchSubjectMockTestAssignment';
import { useBatchSubjectDetail } from '@/hooks/admin/useBatchSubjectContentAssignment';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import type { AssignedBatchSubjectMockTest, AvailableBatchSubjectMockTest } from '@/services/admin/batchSubjectMockTestService';
import {
  ClipboardText,
  Plus,
  Trash,
  Pencil,
  Funnel,
  X,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Checks if an assignment is currently active based on availability window. */
function getAssignmentStatus(
  availableFrom: string | null,
  availableUntil: string | null,
): { label: string; color: string } {
  const now = new Date();
  if (availableFrom && new Date(availableFrom) > now) {
    return { label: 'Upcoming', color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400' };
  }
  if (availableUntil && new Date(availableUntil) < now) {
    return { label: 'Expired', color: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400' };
  }
  return { label: 'Active', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminBatchSubjectMockTestsPage() {
  const params = useParams();
  const batchId = params.id as string;
  const batchSubjectId = params.subjectId as string;

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: assignedTests, isLoading: assignedLoading } = useBSAssignedMockTests(batchSubjectId);
  const { data: subjectDetail } = useBatchSubjectDetail(batchSubjectId);

  const assignMutation = useBSAssignMockTests();
  const removeMutation = useBSRemoveMockTest();
  const updateMutation = useBSUpdateMockTestAssignment();

  // ── UI State ─────────────────────────────────────────────────────────
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Assign Modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [bulkAvailableFrom, setBulkAvailableFrom] = useState('');
  const [bulkAvailableUntil, setBulkAvailableUntil] = useState('');
  const [bulkAttemptLimit, setBulkAttemptLimit] = useState('');

  // Edit Modal state
  const [editAssignment, setEditAssignment] = useState<{
    assignmentId: string;
    availableFrom: string;
    availableUntil: string;
    attemptLimit: string;
  } | null>(null);

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'remove' | 'remove-all';
    assignmentId?: string;
    mockTestTitle?: string;
  } | null>(null);

  const { data: availableTests, isLoading: availableLoading } = useBSAvailableMockTests(
    batchSubjectId,
    subjectDetail?.subjectId ?? '',
    searchQuery,
  );

  const clearFeedback = useCallback(() => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setActionFeedback(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    setActionFeedback({ type, message });
    clearFeedback();
  }, [clearFeedback]);

  // ── Handlers: Assign ────────────────────────────────────────────────
  const handleOpenAssignModal = () => {
    setSelectedTestIds([]);
    setSearchQuery('');
    setBulkAvailableFrom('');
    setBulkAvailableUntil('');
    setBulkAttemptLimit('');
    setShowAssignModal(true);
  };

  const handleAssign = useCallback(async () => {
    if (selectedTestIds.length === 0) {
      showFeedback('error', 'Select at least one mock test to assign.');
      return;
    }

    const options: {
      availableFrom?: string | null;
      availableUntil?: string | null;
      attemptLimit?: number | null;
    } = {};
    if (bulkAvailableFrom) options.availableFrom = new Date(bulkAvailableFrom).toISOString();
    if (bulkAvailableUntil) options.availableUntil = new Date(bulkAvailableUntil).toISOString();
    if (bulkAttemptLimit) options.attemptLimit = parseInt(bulkAttemptLimit, 10);

    const result = await assignMutation.mutateAsync({
      batchSubjectId,
      testIds: selectedTestIds,
      options: Object.keys(options).length > 0 ? options : undefined,
    });

    if (result.success) {
      const data = result.data!;
      showFeedback(
        'success',
        `Assigned ${data.assigned} mock test(s).${data.skipped > 0 ? ` ${data.skipped} already assigned.` : ''}`,
      );
      setShowAssignModal(false);
    } else {
      showFeedback('error', result.error ?? 'Failed to assign mock tests.');
    }
  }, [batchSubjectId, selectedTestIds, bulkAvailableFrom, bulkAvailableUntil, bulkAttemptLimit, assignMutation, showFeedback]);

  // ── Handlers: Remove ────────────────────────────────────────────────
  const handleRemove = useCallback(async () => {
    if (!confirmAction?.assignmentId) return;

    const result = await removeMutation.mutateAsync({
      batchSubjectId,
      assignmentId: confirmAction.assignmentId,
    });

    if (result.success) {
      showFeedback('success', `"${confirmAction.mockTestTitle ?? 'Mock test'}" removed.`);
    } else {
      showFeedback('error', result.error ?? 'Failed to remove mock test.');
    }
    setConfirmAction(null);
  }, [batchSubjectId, confirmAction, removeMutation, showFeedback]);

  // ── Handlers: Edit ──────────────────────────────────────────────────
  const handleOpenEdit = (item: AssignedBatchSubjectMockTest) => {
    setEditAssignment({
      assignmentId: item.assignmentId,
      availableFrom: item.availableFrom ? new Date(item.availableFrom).toISOString().slice(0, 16) : '',
      availableUntil: item.availableUntil ? new Date(item.availableUntil).toISOString().slice(0, 16) : '',
      attemptLimit: item.attemptLimit?.toString() ?? '',
    });
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editAssignment) return;

    const input: {
      availableFrom?: string | null;
      availableUntil?: string | null;
      attemptLimit?: number | null;
    } = {};

    if (editAssignment.availableFrom) {
      input.availableFrom = new Date(editAssignment.availableFrom).toISOString();
    } else {
      input.availableFrom = null;
    }

    if (editAssignment.availableUntil) {
      input.availableUntil = new Date(editAssignment.availableUntil).toISOString();
    } else {
      input.availableUntil = null;
    }

    if (editAssignment.attemptLimit) {
      input.attemptLimit = parseInt(editAssignment.attemptLimit, 10);
    } else {
      input.attemptLimit = null;
    }

    const result = await updateMutation.mutateAsync({
      assignmentId: editAssignment.assignmentId,
      input,
    });

    if (result.success) {
      showFeedback('success', 'Assignment updated.');
      setEditAssignment(null);
    } else {
      showFeedback('error', result.error ?? 'Failed to update assignment.');
    }
  }, [editAssignment, updateMutation, showFeedback]);

  // ── Toggle selection ────────────────────────────────────────────────
  const toggleTestSelection = (testId: string) => {
    setSelectedTestIds((prev) =>
      prev.includes(testId) ? prev.filter((id) => id !== testId) : [...prev, testId],
    );
  };

  // ── Columns ─────────────────────────────────────────────────────────
  const columns: Column<AssignedBatchSubjectMockTest>[] = useMemo(
    () => [
      {
        key: 'title',
        header: 'Mock Test',
        render: (item) => (
          <div className="flex items-center gap-3 max-w-[240px]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20 dark:text-indigo-400">
              <ClipboardText size={18} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {item.title}
              </p>
              <span className="text-[10px] uppercase text-gray-500">{item.testType}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <StatusBadge status={item.status} showDot />,
      },
      {
        key: 'duration',
        header: 'Duration',
        render: (item) => (
          <span className="text-xs text-gray-600 dark:text-gray-400">{item.durationMin} min</span>
        ),
      },
      {
        key: 'totalMarks',
        header: 'Marks',
        render: (item) => (
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.totalMarks}</span>
        ),
      },
      {
        key: 'availability',
        header: 'Availability',
        render: (item) => {
          const status = getAssignmentStatus(item.availableFrom, item.availableUntil);
          return (
            <div className="flex flex-col gap-0.5">
              <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ${status.color}`}>
                {status.label}
              </span>
              <span className="text-[10px] text-gray-400">
                {item.availableFrom ? formatDate(item.availableFrom) : 'Always'} —
                {item.availableUntil ? formatDate(item.availableUntil) : 'Always'}
              </span>
            </div>
          );
        },
      },
      {
        key: 'attemptLimit',
        header: 'Attempts',
        render: (item) => (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {item.attemptLimit ?? '∞'}
          </span>
        ),
      },
      {
        key: 'assignedAt',
        header: 'Assigned',
        render: (item) => (
          <span className="text-xs text-gray-500">{formatDate(item.assignedAt)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: '120px',
        render: (item) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleOpenEdit(item)}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              title="Edit availability"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() =>
                setConfirmAction({
                  type: 'remove',
                  assignmentId: item.assignmentId,
                  mockTestTitle: item.title,
                })
              }
              className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              title="Remove assignment"
            >
              <Trash size={14} />
            </button>
          </div>
        ),
      },
    ],
    [],
  );

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      <PageHeader
        title={subjectDetail?.subjectName ? `${subjectDetail.subjectName} — Mock Tests` : 'Mock Tests'}
        description="Assign and manage mock tests for this batch subject"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Batch Management', href: '/admin/batches' },
          { label: subjectDetail?.batchName ?? 'Batch', href: `/admin/batches/${batchId}` },
          { label: 'Subjects', href: `/admin/batches/${batchId}/subjects` },
          { label: subjectDetail?.subjectName ?? 'Subject', href: `/admin/batches/${batchId}/subjects/${batchSubjectId}/content` },
          { label: 'Mock Tests' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/batches/${batchId}/subjects/${batchSubjectId}/content`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              ← Content
            </Link>
            <button
              type="button"
              onClick={handleOpenAssignModal}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:shadow-indigo-500/20"
            >
              <Plus size={14} />
              Assign Mock Tests
            </button>
          </div>
        }
      />

      {/* Action Feedback */}
      {actionFeedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            actionFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {actionFeedback.message}
        </div>
      )}

      {/* Assigned Mock Tests */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Assigned Mock Tests
            {assignedTests && assignedTests.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-500">({assignedTests.length})</span>
            )}
          </h3>
        </div>

        {assignedLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : assignedTests && assignedTests.length > 0 ? (
          <DataTable<AssignedBatchSubjectMockTest>
            columns={columns}
            data={assignedTests}
            keyExtractor={(item) => item.assignmentId}
            isLoading={false}
            emptyState={
              <EmptyState
                icon={<ClipboardText size={32} weight="thin" />}
                title="No mock tests assigned"
                description="Assign published mock tests to this batch subject."
              />
            }
          />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<ClipboardText size={32} weight="thin" />}
              title="No mock tests assigned"
              description="Assign published mock tests to this batch subject so students can practice."
              action={
                <button
                  type="button"
                  onClick={handleOpenAssignModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:shadow-indigo-500/20"
                >
                  <Plus size={14} />
                  Assign Mock Tests
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ASSIGN MODAL
          ═══════════════════════════════════════════════════════════════════ */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-3xl rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Assign Mock Tests
                </h3>
                <p className="text-xs text-gray-500">
                  Select published mock tests to assign to {subjectDetail?.subjectName ?? 'this subject'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

            {/* Search */}
            <div className="border-b border-gray-100 px-6 py-3 dark:border-gray-800">
              <div className="relative">
                <Funnel
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Search mock tests by title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-xs outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                />
              </div>
            </div>

            {/* Available Tests List */}
            <div className="max-h-64 overflow-y-auto px-6 py-3">
              {availableLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : availableTests && availableTests.length > 0 ? (
                <div className="space-y-1">
                  {availableTests.map((test) => (
                    <label
                      key={test.testId}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                        selectedTestIds.includes(test.testId)
                          ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/20'
                          : 'border-transparent bg-gray-50 hover:bg-gray-100 dark:bg-gray-800/50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTestIds.includes(test.testId)}
                        onChange={() => toggleTestSelection(test.testId)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {test.title}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {test.testType} · {test.durationMin} min · {test.totalMarks} marks
                        </p>
                      </div>
                      <StatusBadge status={test.status} showDot />
                    </label>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-gray-500">
                  {searchQuery
                    ? 'No matching mock tests found.'
                    : 'No published mock tests available for this subject.'}
                </div>
              )}
            </div>

            {/* Options */}
            <div className="border-t border-gray-100 px-6 py-3 dark:border-gray-800">
              <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                Assignment Options (optional)
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-gray-500">Available From</label>
                  <input
                    type="datetime-local"
                    value={bulkAvailableFrom}
                    onChange={(e) => setBulkAvailableFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-gray-500">Available Until</label>
                  <input
                    type="datetime-local"
                    value={bulkAvailableUntil}
                    onChange={(e) => setBulkAvailableUntil(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-gray-500">Attempt Limit</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    value={bulkAttemptLimit}
                    onChange={(e) => setBulkAttemptLimit(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4 dark:border-gray-800">
              <span className="text-xs text-gray-500">
                {selectedTestIds.length} test{selectedTestIds.length !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={selectedTestIds.length === 0 || assignMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:shadow-indigo-500/20"
                >
                  {assignMutation.isPending ? (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <Plus size={14} />
                  )}
                  Assign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          EDIT MODAL
          ═══════════════════════════════════════════════════════════════════ */}
      {editAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Edit Assignment
              </h3>
              <button
                type="button"
                onClick={() => setEditAssignment(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Available From
                  </label>
                  <input
                    type="datetime-local"
                    value={editAssignment.availableFrom}
                    onChange={(e) =>
                      setEditAssignment({ ...editAssignment, availableFrom: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setEditAssignment({ ...editAssignment, availableFrom: '' })}
                    className="mt-1 text-[10px] text-gray-400 hover:text-gray-600"
                  >
                    Clear (always available)
                  </button>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Available Until
                  </label>
                  <input
                    type="datetime-local"
                    value={editAssignment.availableUntil}
                    onChange={(e) =>
                      setEditAssignment({ ...editAssignment, availableUntil: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setEditAssignment({ ...editAssignment, availableUntil: '' })}
                    className="mt-1 text-[10px] text-gray-400 hover:text-gray-600"
                  >
                    Clear (always available)
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Attempt Limit
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="Unlimited (no limit)"
                  value={editAssignment.attemptLimit}
                  onChange={(e) =>
                    setEditAssignment({ ...editAssignment, attemptLimit: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                />
                <button
                  type="button"
                  onClick={() => setEditAssignment({ ...editAssignment, attemptLimit: '' })}
                  className="mt-1 text-[10px] text-gray-400 hover:text-gray-600"
                >
                  Clear (no limit)
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setEditAssignment(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updateMutation.isPending && (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          CONFIRM DIALOG
          ═══════════════════════════════════════════════════════════════════ */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              Remove Mock Test
            </h3>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              Are you sure you want to remove{' '}
              <strong>&ldquo;{confirmAction.mockTestTitle}&rdquo;</strong> from this batch subject?
              Students will no longer have access to this test.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={removeMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removeMutation.isPending ? (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <Trash size={14} />
                )}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
