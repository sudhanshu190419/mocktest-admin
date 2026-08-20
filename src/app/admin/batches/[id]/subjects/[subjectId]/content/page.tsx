'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useBatchSubjectDetail, useBatchSubjectContent, useAvailableBatchSubjectContent, useBatchSubjectContentStats, useAssignBatchSubjectContent, useRemoveBatchSubjectContent, useRemoveBatchSubjectContents, useUpdateBatchSubjectContentAssignment, useReorderBatchSubjectContent } from '@/hooks/admin/useBatchSubjectContentAssignment';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SearchBar } from '@/components/ui/SearchBar';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import type { AssignedBatchSubjectContent, AvailableBatchSubjectContent } from '@/services/admin/batchSubjectContentService';
import {
  BookOpen,
  Trash,
  PlusCircle,
  FileText,
  ArrowUp,
  ArrowDown,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function getContentIcon(contentType: string): React.ReactNode {
  const icons: Record<string, React.ReactNode> = {
    pdf: <FileText size={14} />,
    video: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    notes: <BookOpen size={14} />,
    assignment: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  };
  return icons[contentType] ?? <FileText size={14} />;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function BatchSubjectContentPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;
  const batchSubjectId = params.subjectId as string;

  // ── Query Hooks ─────────────────────────────────────────────────────
  const { data: subjectDetail, isLoading: detailLoading } = useBatchSubjectDetail(batchSubjectId);
  const { data: assignedContent, isLoading: assignedLoading, refetch: refetchAssigned } = useBatchSubjectContent(batchSubjectId);

  // ── State ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const subjectId = subjectDetail?.subjectId ?? '';

  const { data: availableContent, isLoading: availableLoading } = useAvailableBatchSubjectContent(
    batchSubjectId,
    subjectId,
    debouncedSearch || undefined,
  );

  const { data: stats, isLoading: statsLoading } = useBatchSubjectContentStats(batchSubjectId, subjectId);

  // ── UI State ─────────────────────────────────────────────────────────
  const [showAvailable, setShowAvailable] = useState(false);
  const [selectedContentIds, setSelectedContentIds] = useState<Set<string>>(new Set());
  const [selectedAssignedIds, setSelectedAssignedIds] = useState<Set<string>>(new Set());
  const [sectionName, setSectionName] = useState('');
  const [editItem, setEditItem] = useState<{
    batchSubjectContentId: string;
    title: string;
    sectionName: string;
    isOptional: boolean;
  } | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    type: 'assign' | 'remove-single' | 'remove-bulk';
    contentId?: string;
    contentTitle?: string;
    count?: number;
  } | null>(null);

  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearFeedback = useCallback(() => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setActionFeedback(null), 4000);
  }, []);

  // Search debounce
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [search]);

  // Clean up feedback timeout
  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────
  const assignMutation = useAssignBatchSubjectContent();
  const removeMutation = useRemoveBatchSubjectContent();
  const removeBulkMutation = useRemoveBatchSubjectContents();
  const updateMutation = useUpdateBatchSubjectContentAssignment();
  const reorderMutation = useReorderBatchSubjectContent();

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleAssign = async () => {
    if (!selectedContentIds.size) return;

    const result = await assignMutation.mutateAsync({
      batchSubjectId,
      contentIds: Array.from(selectedContentIds),
      sectionName: sectionName || null,
    });

    if (result.success) {
      setActionFeedback({
        type: 'success',
        message: `${result.data?.assigned ?? selectedContentIds.size} content item(s) assigned successfully.`,
      });
      setSelectedContentIds(new Set());
      setSectionName('');
      setShowAvailable(false);
    } else {
      setActionFeedback({
        type: 'error',
        message: result.error ?? 'Failed to assign content.',
      });
    }
    setConfirmAction(null);
    clearFeedback();
  };

  const handleRemoveSingle = async () => {
    if (!confirmAction?.contentId) return;

    const result = await removeMutation.mutateAsync({
      batchSubjectId,
      contentId: confirmAction.contentId,
    });

    if (result.success) {
      setActionFeedback({
        type: 'success',
        message: `"${confirmAction.contentTitle ?? 'Content'}" removed successfully.`,
      });
    } else {
      setActionFeedback({
        type: 'error',
        message: result.error ?? 'Failed to remove content.',
      });
    }
    setConfirmAction(null);
    clearFeedback();
  };

  const handleRemoveBulk = async () => {
    if (!selectedAssignedIds.size) return;

    const result = await removeBulkMutation.mutateAsync({
      batchSubjectId,
      contentIds: Array.from(selectedAssignedIds),
    });

    if (result.success) {
      setActionFeedback({
        type: 'success',
        message: `${selectedAssignedIds.size} content item(s) removed successfully.`,
      });
      setSelectedAssignedIds(new Set());
    } else {
      setActionFeedback({
        type: 'error',
        message: result.error ?? 'Failed to remove content.',
      });
    }
    setConfirmAction(null);
    clearFeedback();
  };

  const handleToggleOptional = async (item: AssignedBatchSubjectContent) => {
    await updateMutation.mutateAsync({
      batchSubjectContentId: item.batchSubjectContentId,
      updates: { isOptional: !item.isOptional },
    });
  };

  const handleReorder = async (items: AssignedBatchSubjectContent[], fromIndex: number, toIndex: number) => {
    const newItems = [...items];
    const [moved] = newItems.splice(fromIndex, 1);
    newItems.splice(toIndex, 0, moved);

    const reorderList = newItems.map((item, index) => ({
      batchSubjectContentId: item.batchSubjectContentId,
      orderSequence: index + 1,
    }));

    await reorderMutation.mutateAsync({ reorderList });
  };

  // ── Content Columns ─────────────────────────────────────────────────
  const assignedColumns: Column<AssignedBatchSubjectContent>[] = useMemo(() => [
    {
      key: 'orderSequence',
      header: '#',
      width: '48px',
      render: (item) => (
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
          {item.orderSequence}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (item) => (
        <div className="flex items-center gap-3 max-w-[200px]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            <div className="flex items-center justify-center">{getContentIcon(item.contentType)}</div>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {item.title}
            </p>
            <span className="text-[10px] text-gray-500 uppercase">{item.contentType}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'chapterName',
      header: 'Chapter',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.chapterName ?? '—'}
        </span>
      ),
    },
    {
      key: 'sectionName',
      header: 'Section',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.sectionName ?? '—'}
        </span>
      ),
    },
    {
      key: 'isOptional',
      header: 'Required',
      render: (item) => (
        <button
          type="button"
          onClick={() => handleToggleOptional(item)}
          disabled={updateMutation.isPending}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
            item.isOptional
              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400'
          }`}
        >
          {item.isOptional ? 'Optional' : 'Required'}
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <StatusBadge status={item.status} showDot={true} />,
    },
    {
      key: 'assignedAt',
      header: 'Assigned',
      render: (item) => (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {item.assignedAt ? formatDate(item.assignedAt) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (item) => {
        const items = assignedContent ?? [];
        const index = items.findIndex((c) => c.batchSubjectContentId === item.batchSubjectContentId);
        const canMoveUp = index > 0;
        const canMoveDown = index >= 0 && index < items.length - 1;

        return (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleReorder(items, index, index - 1)}
              disabled={!canMoveUp || reorderMutation.isPending}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 dark:hover:bg-gray-800"
              title="Move up"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => handleReorder(items, index, index + 1)}
              disabled={!canMoveDown || reorderMutation.isPending}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 dark:hover:bg-gray-800"
              title="Move down"
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              onClick={() =>
                setEditItem({
                  batchSubjectContentId: item.batchSubjectContentId,
                  title: item.title,
                  sectionName: item.sectionName ?? '',
                  isOptional: item.isOptional,
                })
              }
              className="rounded p-1 text-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
              title="Edit"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() =>
                setConfirmAction({
                  type: 'remove-single',
                  contentId: item.contentId,
                  contentTitle: item.title,
                })
              }
              disabled={removeMutation.isPending}
              className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-900/20"
              title="Remove"
            >
              <Trash size={14} />
            </button>
          </div>
        );
      },
    },
  ], [assignedContent, reorderMutation.isPending, removeMutation.isPending, updateMutation.isPending]);

  const availableColumns: Column<AvailableBatchSubjectContent>[] = useMemo(() => [
    {
      key: 'title',
      header: 'Title',
      render: (item) => (
        <div className="flex items-center gap-3 max-w-[200px]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            <div className="flex items-center justify-center">{getContentIcon(item.contentType)}</div>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {item.title}
            </p>
            <span className="text-[10px] text-gray-500 uppercase">{item.contentType}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'chapterName',
      header: 'Chapter',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.chapterName ?? '—'}
        </span>
      ),
    },
    {
      key: 'teacherName',
      header: 'Teacher',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.teacherName ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <StatusBadge status={item.status} showDot={true} />,
    },
  ], []);

  // ── Confirm Dialog Props ─────────────────────────────────────────────
  const getConfirmProps = () => {
    if (!confirmAction) return { open: false, title: '', message: '', variant: 'default' as const, confirmLabel: '' };

    switch (confirmAction.type) {
      case 'assign':
        return {
          open: true,
          title: 'Assign Content',
          message: `Assign ${confirmAction.count ?? selectedContentIds.size} content item(s) to "${subjectDetail?.subjectName ?? 'this subject'}"?`,
          confirmLabel: 'Assign',
          variant: 'default' as const,
        };
      case 'remove-single':
        return {
          open: true,
          title: 'Remove Content',
          message: `Remove "${confirmAction.contentTitle ?? 'this content'}" from "${subjectDetail?.subjectName ?? 'this subject'}"? It can be re-assigned later.`,
          confirmLabel: 'Remove',
          variant: 'danger' as const,
        };
      case 'remove-bulk':
        return {
          open: true,
          title: 'Remove Content',
          message: `Remove ${confirmAction.count ?? selectedAssignedIds.size} content item(s) from "${subjectDetail?.subjectName ?? 'this subject'}"?`,
          confirmLabel: 'Remove All',
          variant: 'danger' as const,
        };
    }
  };

  const confirmProps = getConfirmProps();
  const isConfirmLoading =
    (confirmAction?.type === 'assign' && assignMutation.isPending) ||
    (confirmAction?.type === 'remove-single' && removeMutation.isPending) ||
    (confirmAction?.type === 'remove-bulk' && removeBulkMutation.isPending);

  const handleConfirm = () => {
    switch (confirmAction?.type) {
      case 'assign':
        handleAssign();
        break;
      case 'remove-single':
        handleRemoveSingle();
        break;
      case 'remove-bulk':
        handleRemoveBulk();
        break;
    }
  };

  // ═════════════════════════════════════════════════════════════════════
  //  Loading State
  // ═════════════════════════════════════════════════════════════════════
  if (detailLoading) {
    return (
      <div>
        <PageHeader title="Loading..." breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Batches', href: '/admin/batches' }, { label: 'Loading...' }]} />
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!subjectDetail) {
    return (
      <div>
        <PageHeader title="Not Found" breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Batches', href: '/admin/batches' }]} />
        <EmptyState title="Batch Subject not found" description="This batch subject may have been deleted or the ID is invalid." />
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title={subjectDetail.subjectName}
        description={`${subjectDetail.batchName} · ${subjectDetail.subjectCode}`}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Batch Management', href: '/admin/batches' },
          { label: subjectDetail.batchName, href: `/admin/batches/${batchId}` },
          { label: 'Subjects', href: `/admin/batches/${batchId}/subjects` },
          { label: subjectDetail.subjectName },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/batches/${batchId}/subjects`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              ← All Subjects
            </Link>
            <button
              type="button"
              onClick={() => setShowAvailable(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              <PlusCircle size={16} />
              Assign Content
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats?.assignedCount ?? 0}</p>
          <p className="text-xs text-gray-500">Total Content</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-emerald-600">{stats?.requiredCount ?? 0}</p>
          <p className="text-xs text-gray-500">Required</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-amber-600">{stats?.optionalCount ?? 0}</p>
          <p className="text-xs text-gray-500">Optional</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="text-2xl font-bold text-blue-600">{stats?.availableCount ?? 0}</p>
          <p className="text-xs text-gray-500">Available</p>
        </div>
      </div>

      {/* Assigned Content Table */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Assigned Content
            </h3>
            {selectedAssignedIds.size > 0 && (
              <button
                type="button"
                onClick={() =>
                  setConfirmAction({
                    type: 'remove-bulk',
                    count: selectedAssignedIds.size,
                  })
                }
                disabled={removeBulkMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
              >
                <Trash size={12} />
                Remove {selectedAssignedIds.size} selected
              </button>
            )}
          </div>
        </div>

        {assignedLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : assignedContent && assignedContent.length > 0 ? (
          <DataTable<AssignedBatchSubjectContent>
            columns={assignedColumns}
            data={assignedContent}
            keyExtractor={(item) => item.batchSubjectContentId}
            isLoading={false}
            selectedIds={selectedAssignedIds}
            onSelectionChange={setSelectedAssignedIds}
            emptyState={
              <EmptyState
                icon={<BookOpen size={32} weight="thin" />}
                title="No content assigned"
                description="Assign content to this subject using the button above."
              />
            }
          />
        ) : (
          <div className="p-4">
            <EmptyState
              icon={<BookOpen size={32} weight="thin" />}
              title="No content assigned"
              description="Assign content to this subject using the 'Assign Content' button above."
              action={
                <button
                  type="button"
                  onClick={() => setShowAvailable(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <PlusCircle size={16} />
                  Assign Content
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* ═════════════════════════════════════════════════════════════════
          Available Content Modal (Dialog)
         ═════════════════════════════════════════════════════════════════ */}
      {showAvailable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Assign Content to {subjectDetail.subjectName}
                </h3>
                <p className="text-xs text-gray-500">
                  Select content items to assign. Only approved content matching this subject is shown.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowAvailable(false); setSelectedContentIds(new Set()); }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="border-b border-gray-100 p-4 dark:border-gray-800">
              <SearchBar
                value={search}
                onChange={(v) => setSearch(v)}
                placeholder="Search available content..."
                className="w-full"
              />
            </div>

            {/* Section name input */}
            <div className="border-b border-gray-100 p-4 dark:border-gray-800">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                Section Name (optional)
              </label>
              <input
                type="text"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="e.g. Week 1, Module A, Chapter 1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
              />
            </div>

            {/* Available content table */}
            <div className="flex-1 overflow-y-auto p-4">
              {availableLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : availableContent && availableContent.length > 0 ? (
                <DataTable<AvailableBatchSubjectContent>
                  columns={availableColumns}
                  data={availableContent}
                  keyExtractor={(item) => item.contentId}
                  isLoading={false}
                  selectedIds={selectedContentIds}
                  onSelectionChange={setSelectedContentIds}
                  emptyState={
                    <EmptyState
                      icon={<BookOpen size={32} weight="thin" />}
                      title="No available content"
                      description="All available content for this subject has already been assigned."
                    />
                  }
                />
              ) : (
                <EmptyState
                  icon={<BookOpen size={32} weight="thin" />}
                  title="No available content"
                  description="All available content for this subject has already been assigned."
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-gray-200 p-4 dark:border-gray-700">
              <span className="text-sm text-gray-500">
                {selectedContentIds.size} content item(s) selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setShowAvailable(false); setSelectedContentIds(new Set()); }}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({
                      type: 'assign',
                      count: selectedContentIds.size,
                    })
                  }
                  disabled={selectedContentIds.size === 0 || assignMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {assignMutation.isPending ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Assigning...
                    </>
                  ) : (
                    'Assign'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════
          Edit Item Modal
         ═════════════════════════════════════════════════════════════════ */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">
              Edit: {editItem.title}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Section Name
                </label>
                <input
                  type="text"
                  value={editItem.sectionName}
                  onChange={(e) =>
                    setEditItem({ ...editItem, sectionName: e.target.value })
                  }
                  placeholder="e.g. Week 1, Module A"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editItem.isOptional}
                  onChange={(e) =>
                    setEditItem({ ...editItem, isOptional: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Mark as optional (supplementary material)
                </span>
              </label>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditItem(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!editItem) return;
                  await updateMutation.mutateAsync({
                    batchSubjectContentId: editItem.batchSubjectContentId,
                    updates: {
                      sectionName: editItem.sectionName || null,
                      isOptional: editItem.isOptional,
                    },
                  });
                  setEditItem(null);
                  setActionFeedback({
                    type: 'success',
                    message: `"${editItem.title}" updated successfully.`,
                  });
                  clearFeedback();
                }}
                disabled={updateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmProps.open}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
        title={confirmProps.title}
        message={confirmProps.message}
        confirmLabel={confirmProps.confirmLabel}
        variant={confirmProps.variant}
        loading={isConfirmLoading}
      />
    </div>
  );
}
