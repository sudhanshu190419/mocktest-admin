'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  useQuestionApprovalCounts,
  useQuestionApprovalList,
  useApproveQuestion,
  useRejectQuestion,
  usePublishQuestion,
  useArchiveQuestion,
  useBulkApproveQuestions,
  useBulkRejectQuestions,
  useBulkPublishQuestions,
  useBulkArchiveQuestions,
} from '@/hooks/admin/useQuestionApproval';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useDeleteQuestion } from '@/hooks/mockTest/useQuestions';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MetricCard } from '@/components/analytics/MetricCard';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import type { QuestionApprovalListItem } from '@/services/admin/questionApprovalService';
import {
  ArrowsClockwise,
  Clock,
  CheckCircle,
  Sparkle,
  Archive,
  FileText,
  Question as QuestionIcon,
  XCircle,
  CircleNotch,
  Plus,
  UploadSimple,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

const DIFFICULTY_OPTIONS = [
  { value: '', label: 'All Difficulties' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: 'Newest First' },
  { value: 'createdAt_asc', label: 'Oldest First' },
  { value: 'difficulty_asc', label: 'Difficulty (Easy First)' },
  { value: 'difficulty_desc', label: 'Difficulty (Hard First)' },
  { value: 'status_asc', label: 'Status (A-Z)' },
  { value: 'status_desc', label: 'Status (Z-A)' },
  { value: 'questionType_asc', label: 'Type (A-Z)' },
  { value: 'questionType_desc', label: 'Type (Z-A)' },
  { value: 'updatedAt_desc', label: 'Recently Updated' },
  { value: 'updatedAt_asc', label: 'Least Recently Updated' },
];

// Placeholder options — extend with dynamic data loading when available.
const SUBJECT_OPTIONS = [
  { value: '', label: 'All Subjects' },
];

const CHAPTER_OPTIONS = [
  { value: '', label: 'All Chapters' },
];

const TEACHER_OPTIONS = [
  { value: '', label: 'All Teachers' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const days = Math.floor((now - then) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function getSortValue(sortKey: string): { sortBy: 'createdAt' | 'updatedAt' | 'questionType' | 'difficulty' | 'status'; sortDirection: 'asc' | 'desc' } {
  const [field, dir] = sortKey.split('_') as [string, 'asc' | 'desc'];
  return { sortBy: field as any, sortDirection: dir ?? 'desc' };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '…';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton Components
// ═══════════════════════════════════════════════════════════════════════════

function SummaryCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <Skeleton className="mb-2 h-3 w-16" />
          <Skeleton className="mb-1 h-6 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function QuestionApprovalPage() {
  const router = useRouter();
  const { user } = useAuth();
  const adminProfileId = user?.id;
  const { canRestoreDeletedData } = usePermissions();


  // ── Filter State ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [chapterFilter, setChapterFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [sortKey, setSortKey] = useState('createdAt_desc');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Debounce search input to avoid rapid re-fetching
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(value), 400);
  }, []);

  // Reset page when any filter changes
  const handleFilterChange = useCallback((setter: (val: string) => void, value: string) => {
    setter(value);
    setPage(1);
  }, []);

  // ── Selection & Confirmation State ───────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject' | 'publish' | 'archive' | 'delete';
    question: QuestionApprovalListItem | null;
    bulk?: boolean;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Clear feedback after timeout
  const clearFeedback = useCallback(() => {
    setTimeout(() => {
      setActionError(null);
      setActionSuccess(null);
    }, 4000);
  }, []);

  // ── Data Fetching ────────────────────────────────────────────────────
  const sort = getSortValue(sortKey);

  const filters = useMemo(() => ({
    status: statusFilter || undefined,
    subjectId: subjectFilter || undefined,
    chapterId: chapterFilter || undefined,
    teacherId: teacherFilter || undefined,
    search: debouncedSearch || undefined,
  }), [statusFilter, subjectFilter, chapterFilter, teacherFilter, debouncedSearch]);

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useQuestionApprovalCounts();

  const {
    data: questionList,
    isLoading: listLoading,
    isError,
    error,
    refetch: refetchList,
  } = useQuestionApprovalList(filters, sort, { page, pageSize });

  const isLoading = countsLoading || listLoading;

  const handleRefresh = useCallback(() => {
    refetchCounts();
    refetchList();
  }, [refetchCounts, refetchList]);

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const approveMutation = useApproveQuestion();
  const rejectMutation = useRejectQuestion();
  const publishMutation = usePublishQuestion();
  const archiveMutation = useArchiveQuestion();
  const bulkApproveMutation = useBulkApproveQuestions();
  const bulkRejectMutation = useBulkRejectQuestions();
  const bulkPublishMutation = useBulkPublishQuestions();
  const bulkArchiveMutation = useBulkArchiveQuestions();
  const deleteMutation = useDeleteQuestion();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (
    action: 'approve' | 'reject' | 'publish' | 'archive' | 'delete',
    question?: QuestionApprovalListItem | null,
    bulk?: boolean,
  ) => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      // Soft delete — handled separately (void mutation; item moves to Recycle Bin)
      if (action === 'delete') {
        const questionIds = bulk ? Array.from(selectedIds) : [question!.questionId];
        for (const id of questionIds) {
          await deleteMutation.mutateAsync(id);
        }
        setActionSuccess(`${questionIds.length} question${questionIds.length > 1 ? 's' : ''} moved to the Recycle Bin successfully`);
        if (bulk) setSelectedIds(new Set());
        refetchList();
        refetchCounts();
        return;
      }

      if (bulk) {
        const questionIds = Array.from(selectedIds);

        let result;
        switch (action) {
          case 'approve':
            result = await bulkApproveMutation.mutateAsync({ questionIds, approvedBy: adminProfileId });
            break;
          case 'reject':
            result = await bulkRejectMutation.mutateAsync(questionIds);
            break;
          case 'publish':
            result = await bulkPublishMutation.mutateAsync({ questionIds, approvedBy: adminProfileId });
            break;
          case 'archive':
            result = await bulkArchiveMutation.mutateAsync(questionIds);
            break;
        }

        if (!result.success) {
          setActionError(result.error ?? 'Action failed. Please try again.');
          return;
        }
        const count = questionIds.length;
        const isBulkRestore = action === 'publish' && Array.from(selectedIds).some(id => {
          const q = questionList?.data?.find(d => d.questionId === id);
          return q?.status === 'archived';
        });
        setActionSuccess(`${count} question${count > 1 ? 's' : ''} ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'publish' ? (isBulkRestore ? 'restored' : 'published') : 'archived'} successfully`);
        setSelectedIds(new Set());
      } else {
        let result;
        switch (action) {
          case 'approve':
            result = await approveMutation.mutateAsync({ questionId: question!.questionId, approvedBy: adminProfileId });
            break;
          case 'reject':
            result = await rejectMutation.mutateAsync(question!.questionId);
            break;
          case 'publish':
            result = await publishMutation.mutateAsync({ questionId: question!.questionId, approvedBy: adminProfileId });
            break;
          case 'archive':
            result = await archiveMutation.mutateAsync(question!.questionId);
            break;
        }

        if (!result.success) {
          setActionError(result.error ?? 'Action failed. Please try again.');
          return;
        }
        const isSingleRestore = action === 'publish' && question?.status === 'archived';
        setActionSuccess(`Question ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'publish' ? (isSingleRestore ? 'restored' : 'published') : 'archived'} successfully`);
      }
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [
    selectedIds,
    adminProfileId,
    approveMutation,
    rejectMutation,
    publishMutation,
    archiveMutation,
    bulkApproveMutation,
    bulkRejectMutation,
    bulkPublishMutation,
    bulkArchiveMutation,
    deleteMutation,
    refetchList,
    refetchCounts,
    clearFeedback,
  ]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type, confirmAction.question, confirmAction.bulk);
  }, [confirmAction, executeAction]);

  // ── Bulk Action Options ─────────────────────────────────────────────
  const bulkActionOptions = useMemo(() => {
    if (selectedIds.size === 0 || !questionList?.data) return null;

    let hasPending = false;
    let hasPublished = false;
    let hasDraft = false;
    let hasArchived = false;

    for (const q of questionList.data) {
      if (!selectedIds.has(q.questionId)) continue;
      switch (q.status) {
        case 'pending_approval': hasPending = true; break;
        case 'published': hasPublished = true; break;
        case 'draft': hasDraft = true; break;
        case 'archived': hasArchived = true; break;
      }
    }

    // Only show bulk actions if ALL selected items have the same status
    const totalFlags = [hasPending, hasPublished, hasDraft, hasArchived].filter(Boolean).length;
    if (totalFlags !== 1) return null;

    const deleteOption = canRestoreDeletedData
      ? [{ type: 'delete' as const, label: 'Delete Selected', variant: 'danger' as const }]
      : [];

    if (hasPending) {
      return [
        { type: 'approve' as const, label: 'Approve Selected', variant: 'emerald' as const },
        { type: 'reject' as const, label: 'Reject Selected', variant: 'rose' as const },
        ...deleteOption,
      ];
    }
    if (hasPublished) {
      return [
        { type: 'archive' as const, label: 'Archive Selected', variant: 'rose' as const },
        ...deleteOption,
      ];
    }
    if (hasDraft) {
      return [
        { type: 'approve' as const, label: 'Approve Selected', variant: 'emerald' as const },
        ...deleteOption,
      ];
    }
    if (hasArchived) {
      return [
        { type: 'publish' as const, label: 'Restore Selected', variant: 'emerald' as const },
        ...deleteOption,
      ];
    }
    return null;
  }, [selectedIds, questionList?.data, canRestoreDeletedData]);

  // ── Confirm Dialog Configuration ────────────────────────────────────
  const confirmDialogConfig = useMemo(() => {
    if (!confirmAction) return null;
    const { type, question, bulk } = confirmAction;
    const count = bulk ? selectedIds.size : 1;
    const label = bulk ? `${count} selected question${count > 1 ? 's' : ''}` : (question?.questionText ? truncateText(question.questionText, 60) : 'this question');

    switch (type) {
      case 'approve':
        return {
          title: bulk ? `Approve ${count} Questions` : 'Approve Question',
          message: `Are you sure you want to approve ${label}? The question${count > 1 ? 's will' : ' will'} be published immediately.`,
          confirmLabel: bulk ? `Approve ${count} Questions` : 'Approve Question',
          variant: 'default' as const,
        };
      case 'reject':
        return {
          title: bulk ? `Reject ${count} Questions` : 'Reject Question',
          message: `Are you sure you want to reject ${label}? The question${count > 1 ? 's will' : ' will'} be returned to draft status.`,
          confirmLabel: bulk ? `Reject ${count} Questions` : 'Reject Question',
          variant: 'danger' as const,
        };
      case 'publish':
        const isRestore = !bulk && question?.status === 'archived';
        return {
          title: bulk ? `${count} Questions` : (isRestore ? 'Restore Question' : 'Publish Question'),
          message: isRestore
            ? `Are you sure you want to restore ${label}? The question${count > 1 ? 's will' : ' will'} be returned to published status with its approval history preserved.`
            : `Are you sure you want to publish ${label}? The question${count > 1 ? 's will' : ' will'} be made available to students.`,
          confirmLabel: bulk ? `Restore ${count} Questions` : (isRestore ? 'Restore Question' : 'Publish Question'),
          variant: 'default' as const,
        };
      case 'archive':
        return {
          title: bulk ? `Archive ${count} Questions` : 'Archive Question',
          message: `Are you sure you want to archive ${label}? The question${count > 1 ? 's will' : ' will'} be removed from active use.`,
          confirmLabel: bulk ? `Archive ${count} Questions` : 'Archive Question',
          variant: 'warning' as const,
        };
      case 'delete':
        return {
          title: bulk ? `Delete ${count} Questions` : 'Delete Question',
          message: `Are you sure you want to delete ${label}? This item will be moved to the Recycle Bin and can be restored later.`,
          confirmLabel: bulk ? `Delete ${count} Questions` : 'Delete Question',
          variant: 'danger' as const,
        };
      default:
        return null;
    }
  }, [confirmAction, selectedIds.size]);

  // ── Summary Cards ────────────────────────────────────────────────────
  const summaryCards = useMemo(() => {
    if (!counts) return [];
    return [
      { label: 'Pending Approval', value: counts.pendingApproval, color: 'amber' as const, icon: <Clock size={20} weight="duotone" /> },
      { label: 'Approved', value: counts.approved, color: 'emerald' as const, icon: <CheckCircle size={20} weight="duotone" /> },
      { label: 'Published', value: counts.published, color: 'blue' as const, icon: <Sparkle size={20} weight="duotone" /> },
      { label: 'Archived', value: counts.archived, color: 'rose' as const, icon: <Archive size={20} weight="duotone" /> },
      { label: 'Rejected (Draft)', value: counts.rejected, color: 'gray' as const, icon: <FileText size={20} weight="duotone" /> },
    ];
  }, [counts]);

  // ── Table Columns ────────────────────────────────────────────────────
  const columns: Column<QuestionApprovalListItem>[] = useMemo(() => [
    {
      key: 'questionPreview',
      header: 'Question Preview',
      className: 'max-w-xs',
      render: (item) => (
        <div className="max-w-xs">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {truncateText(item.questionText, 80)}
          </p>
          <p className="text-[11px] text-gray-400">
            {item.questionType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
        </div>
      ),
    },
    {
      key: 'subjectName',
      header: 'Subject',
      render: (item) => (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {item.subjectName ?? '—'}
        </span>
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
      key: 'difficulty',
      header: 'Difficulty',
      render: (item) => {
        const colorMap: Record<string, string> = {
          easy: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
          medium: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
          hard: 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-400',
        };
        const style = colorMap[item.difficulty] ?? 'text-gray-600 bg-gray-50 dark:bg-gray-800/30 dark:text-gray-400';
        return (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>
            {item.difficulty.charAt(0).toUpperCase() + item.difficulty.slice(1)}
          </span>
        );
      },
    },
    {
      key: 'questionType',
      header: 'Type',
      render: (item) => (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {item.questionType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => (
        <StatusBadge status={item.status} showDot={true} />
      ),
    },
    {
      key: 'createdAt',
      header: 'Submitted',
      render: (item) => (
        <div className="text-xs text-gray-500">
          <p>{formatDate(item.createdAt)}</p>
          <p className="text-[10px] text-gray-400">{formatTimeAgo(item.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'w-32 text-right',
      render: (_item) => (
        <div className="flex items-center justify-end gap-1">
          {/* Pending → Approve / Reject */}
          {_item.status === 'pending_approval' && (
            <>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'approve', question: _item })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
              >
                {actionLoading && confirmAction?.question?.questionId === _item.questionId && confirmAction?.type === 'approve' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Approve
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'reject', question: _item })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
              >
                {actionLoading && confirmAction?.question?.questionId === _item.questionId && confirmAction?.type === 'reject' ? (
                  <CircleNotch size={10} className="animate-spin" />
                ) : null}
                Reject
              </button>
            </>
          )}

          {/* Published → Archive */}
          {_item.status === 'published' && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'archive', question: _item })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-40 dark:hover:bg-orange-900/20"
            >
              {actionLoading && confirmAction?.question?.questionId === _item.questionId && confirmAction?.type === 'archive' ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : null}
              Archive
            </button>
          )}

          {/* Archived → Restore */}
          {_item.status === 'archived' && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'publish', question: _item })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
            >
              {actionLoading && confirmAction?.question?.questionId === _item.questionId && confirmAction?.type === 'publish' ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : null}
              Restore
            </button>
          )}

          {/* Draft → Approve */}
          {_item.status === 'draft' && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'approve', question: _item })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-40 dark:hover:bg-emerald-900/20"
            >
              {actionLoading && confirmAction?.question?.questionId === _item.questionId && confirmAction?.type === 'approve' ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : null}
              Approve
            </button>
          )}

          {/* Soft Delete (Super Admin only) */}
          {canRestoreDeletedData && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmAction({ type: 'delete', question: _item }); }}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/20"
            >
              {actionLoading && confirmAction?.question?.questionId === _item.questionId && confirmAction?.type === 'delete' ? (
                <CircleNotch size={10} className="animate-spin" />
              ) : null}
              Delete
            </button>
          )}
        </div>
      ),
    },
  ], [actionLoading, confirmAction, canRestoreDeletedData]);

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title="Question Approval"
        description="Review, approve, publish and archive teacher-submitted questions."
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Question Approval' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowsClockwise size={14} className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/admin/questions/import')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <UploadSimple size={14} weight="bold" />
              Bulk Upload
            </button>
            <button
              type="button"
              onClick={() => router.push('/admin/questions/create')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-blue-700"
            >
              <Plus size={14} weight="bold" />
              Create Question
            </button>
          </div>
        }
      />

      {/* ════════════════════════════════════════════════════════════════
          Error State
         ════════════════════════════════════════════════════════════════ */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 flex-shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Failed to load question data
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                {error instanceof Error ? error.message : 'An unexpected error occurred.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Summary Cards
         ════════════════════════════════════════════════════════════════ */}
      {countsLoading ? (
        <SummaryCardsSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((stat) => (
            <MetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value.toLocaleString()}
              icon={stat.icon}
              color={stat.color}
            />
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Filters Bar
         ════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-end gap-3">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search question text..."
          className="min-w-[200px] flex-1"
        />
        <Select
          value={subjectFilter}
          onChange={(v) => handleFilterChange(setSubjectFilter, v)}
          options={SUBJECT_OPTIONS}
          placeholder="All Subjects"
          label="Subject"
          className="min-w-[140px]"
        />
        <Select
          value={chapterFilter}
          onChange={(v) => handleFilterChange(setChapterFilter, v)}
          options={CHAPTER_OPTIONS}
          placeholder="All Chapters"
          label="Chapter"
          className="min-w-[140px]"
        />
        <Select
          value={teacherFilter}
          onChange={(v) => handleFilterChange(setTeacherFilter, v)}
          options={TEACHER_OPTIONS}
          placeholder="All Teachers"
          label="Teacher"
          className="min-w-[140px]"
        />
        <Select
          value={statusFilter}
          onChange={(v) => handleFilterChange(setStatusFilter, v)}
          options={STATUS_OPTIONS}
          placeholder="All Statuses"
          label="Status"
          className="min-w-[150px]"
        />
        <Select
          value={difficultyFilter}
          onChange={(v) => handleFilterChange(setDifficultyFilter, v)}
          options={DIFFICULTY_OPTIONS}
          placeholder="All Difficulties"
          label="Difficulty"
          className="min-w-[140px]"
        />
        <Select
          value={sortKey}
          onChange={(v) => handleFilterChange(setSortKey, v)}
          options={SORT_OPTIONS}
          placeholder="Sort by"
          label="Sort"
          className="min-w-[150px]"
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════
          Bulk Action Bar
         ════════════════════════════════════════════════════════════════ */}
      {selectedIds.size > 0 && bulkActionOptions && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {selectedIds.size} selected
          </span>
          <div className="flex flex-wrap gap-2">
            {bulkActionOptions.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() =>
                  setConfirmAction({
                    type: opt.type,
                    question: null,
                    bulk: true,
                  })
                }
                disabled={actionLoading}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                  opt.variant === 'emerald'
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : opt.variant === 'rose'
                      ? 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400'
                      : opt.variant === 'danger'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800/30 dark:text-gray-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Success Banner
         ════════════════════════════════════════════════════════════════ */}
      {actionSuccess && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <CheckCircle size={18} className="text-emerald-600" weight="fill" />
          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            {actionSuccess}
          </span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Error Banner
         ════════════════════════════════════════════════════════════════ */}
      {actionError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <XCircle size={18} className="text-red-600" weight="fill" />
          <span className="text-sm font-medium text-red-800 dark:text-red-300">
            {actionError}
          </span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          Question Table
         ════════════════════════════════════════════════════════════════ */}
      <DataTable
        columns={columns}
        data={questionList?.data ?? []}
        keyExtractor={(item) => item.questionId}
        isLoading={listLoading}
        onRowClick={(item) => router.push(`/admin/questions/${item.questionId}`)}
        emptyState={
          <EmptyState
            icon={<QuestionIcon size={40} weight="thin" />}
            title="No questions found"
            description={
              debouncedSearch || statusFilter || subjectFilter || chapterFilter || teacherFilter || difficultyFilter
                ? 'Try adjusting your search or filters.'
                : 'Teacher-submitted questions awaiting approval will appear here.'
            }
          />
        }
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        page={page}
        pageSize={pageSize}
        totalCount={questionList?.count ?? 0}
        onPageChange={setPage}
      />

      {/* ════════════════════════════════════════════════════════════════
          Confirmation Dialog
         ════════════════════════════════════════════════════════════════ */}
      {confirmDialogConfig && (
        <ConfirmDialog
          open={!!confirmAction}
          onClose={() => {
            if (!actionLoading) setConfirmAction(null);
          }}
          onConfirm={handleConfirm}
          title={confirmDialogConfig.title}
          message={confirmDialogConfig.message}
          confirmLabel={confirmDialogConfig.confirmLabel}
          variant={confirmDialogConfig.variant}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
