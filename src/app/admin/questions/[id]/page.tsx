'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useQuestionApprovalDetail,
  useQuestionApprovalList,
  useApproveQuestion,
  useRejectQuestion,
  usePublishQuestion,
  useArchiveQuestion,
} from '@/hooks/admin/useQuestionApproval';
import { useDeleteQuestion } from '@/hooks/mockTest/useQuestions';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { useAuth } from '@/context/AuthContext';
import { getSignedImageUrlMap } from '@/services/storage/questionImageService';
import { ReviewNavigation } from '@/components/admin/ReviewNavigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import type { QuestionApprovalDetail } from '@/services/admin/questionApprovalService';
import {
  ArrowLeft,
  CalendarBlank,
  Clock,
  CheckCircle,
  XCircle,
  CircleNotch,
  Question as QuestionIcon,
  BookOpenText,
  ChalkboardTeacher,
  UserCircle,
  Star,
  Tag,
  Books,
  FileText,
  ShieldCheck,
  Exam,
  Archive,
  Sparkle,
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

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}


/**
 * Returns a colour-consistent difficulty badge style.
 */
function getDifficultyStyle(difficulty: string): string {
  const map: Record<string, string> = {
    easy: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800',
    medium: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
    hard: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800',
  };
  return map[difficulty] ?? 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Info Row Component
// ═══════════════════════════════════════════════════════════════════════════

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </p>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
          {value}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton
// ═══════════════════════════════════════════════════════════════════════════

function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Question card skeleton */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-4 h-4 w-3/4" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
      </div>

      {/* Two-column skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-4 h-4 w-32" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              <Skeleton className="mb-4 h-4 w-24" />
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Image Gallery Sub-component
// ═══════════════════════════════════════════════════════════════════════════

function ImageGallery({
  images,
  label,
}: {
  images: { url: string | null; altText: string | null }[];
  label: string;
}) {
  if (images.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {images.map((img, idx) => (
        <div
          key={`${label}-${idx}`}
          className="group relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          {img.url ? (
            <img
              src={img.url}
              alt={img.altText ?? `${label} ${idx + 1}`}
              className="h-24 w-full object-contain p-2 transition-transform group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-24 w-full items-center justify-center bg-gray-100 dark:bg-gray-800">
              <span className="text-[10px] text-gray-400">Image unavailable</span>
            </div>
          )}
          {img.altText && (
            <p className="truncate border-t border-gray-100 px-2 py-1 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {img.altText}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Option Card Sub-component
// ═══════════════════════════════════════════════════════════════════════════

function OptionCard({
  option,
  index,
  signedUrls,
}: {
  option: QuestionApprovalDetail['options'][number];
  index: number;
  signedUrls: Map<string, string>;
}) {
  const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const label = optionLabels[index] ?? `${index + 1}`;

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        option.isCorrect
          ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-900/10'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/50'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Option label badge */}
        <div
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            option.isCorrect
              ? 'bg-emerald-500 text-white'
              : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
          }`}
        >
          {label}
        </div>

        {/* Option content */}
        <div className="min-w-0 flex-1 space-y-2">
          {option.optionText && (
            <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
              {option.optionText}
            </p>
          )}

          {/* Option images */}
          {option.images.length > 0 && (
            <ImageGallery
              images={option.images.map((img) => ({
                url: signedUrls.get(img.storagePath) ?? null,
                altText: img.altText,
              }))}
              label={`Option ${label}`}
            />
          )}
        </div>

        {/* Correct indicator */}
        {option.isCorrect && (
          <div className="flex-shrink-0">
            <CheckCircle size={20} weight="fill" className="text-emerald-500" />
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function QuestionReviewPage() {
  const params = useParams();
  const router = useRouter();
  const questionId = params.id as string;
  const { user } = useAuth();
  const adminProfileId = user?.id;
  const { canRestoreDeletedData } = usePermissions();

  const { data: question, isLoading, isError, error, refetch } = useQuestionApprovalDetail(questionId);

  // ── Pending queue for Prev/Next navigation ───────────────────────────
  const { data: pendingQueueData, isLoading: pendingQueueLoading } = useQuestionApprovalList(
    { status: 'pending_approval' },
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page: 1, pageSize: 200 },
  );
  const pendingQueue = (pendingQueueData?.data ?? []).map((q) => ({
    id: q.questionId,
    label: q.questionText,
  }));

  // ── Signed URL State ─────────────────────────────────────────────────
  const [imageUrlMap, setImageUrlMap] = useState<Map<string, string>>(new Map());

  // Generate signed URLs whenever question data loads
  useEffect(() => {
    if (!question) {
      setImageUrlMap(new Map());
      return;
    }

    const requests: { key: string; bucket: string; path: string }[] = [];

    // Stem/explanation images (from question_images table)
    for (const img of question.images) {
      requests.push({
        key: img.storagePath,
        bucket: img.storageBucket,
        path: img.storagePath,
      });
    }

    // Option images (from question_option_images table)
    for (const opt of question.options) {
      for (const oImg of opt.images) {
        requests.push({
          key: oImg.storagePath,
          bucket: oImg.storageBucket,
          path: oImg.storagePath,
        });
      }
    }

    getSignedImageUrlMap(requests).then(setImageUrlMap);
  }, [question]);

  // ── Confirmation & Feedback State ────────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject' | 'publish' | 'archive' | 'delete';
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const clearFeedback = useCallback(() => {
    setTimeout(() => {
      setActionError(null);
      setActionSuccess(null);
    }, 4000);
  }, []);

  // ── Mutation Hooks ──────────────────────────────────────────────────
  const approveMutation = useApproveQuestion();
  const rejectMutation = useRejectQuestion();
  const publishMutation = usePublishQuestion();
  const archiveMutation = useArchiveQuestion();
  const deleteMutation = useDeleteQuestion();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (action: 'approve' | 'reject' | 'publish' | 'archive' | 'delete') => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      // Soft delete — handled separately (void mutation; item moves to Recycle Bin)
      if (action === 'delete') {
        await deleteMutation.mutateAsync(questionId);
        setActionSuccess('Question moved to the Recycle Bin successfully');
        router.push('/admin/questions');
        return;
      }

      let result;
      switch (action) {
        case 'approve':
          result = await approveMutation.mutateAsync({ questionId, approvedBy: adminProfileId });
          break;
        case 'reject':
          result = await rejectMutation.mutateAsync(questionId);
          break;
        case 'publish':
          result = await publishMutation.mutateAsync({ questionId, approvedBy: adminProfileId });
          break;
        case 'archive':
          result = await archiveMutation.mutateAsync(questionId);
          break;
      }

      if (!result.success) {
        setActionError(result.error ?? 'Action failed. Please try again.');
        setActionLoading(false);
        return;
      }

      const isRestore = action === 'publish' && question?.status === 'archived';
      setActionSuccess(`Question ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'publish' ? (isRestore ? 'restored' : 'published') : 'archived'} successfully`);

      // Refetch detail to reflect updated status
      refetch();
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [question, questionId, adminProfileId, approveMutation, rejectMutation, publishMutation, archiveMutation, deleteMutation, router, refetch, clearFeedback]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type);
  }, [confirmAction, executeAction]);

  // ── Confirm Dialog Configuration ────────────────────────────────────
  const confirmDialogConfig = confirmAction ? (() => {
    const { type } = confirmAction;
    switch (type) {
      case 'approve':
        return {
          title: 'Approve Question',
          message: 'Are you sure you want to approve this question? It will be published immediately.',
          confirmLabel: 'Approve Question',
          variant: 'default' as const,
        };
      case 'reject':
        return {
          title: 'Reject Question',
          message: 'Are you sure you want to reject this question? It will be returned to draft status.',
          confirmLabel: 'Reject Question',
          variant: 'danger' as const,
        };
      case 'publish':
        const isRestore = question?.status === 'archived';
        return {
          title: isRestore ? 'Restore Question' : 'Publish Question',
          message: isRestore
            ? 'Are you sure you want to restore this question? It will be returned to published status with its approval history preserved.'
            : 'Are you sure you want to publish this question? It will be made available to students.',
          confirmLabel: isRestore ? 'Restore Question' : 'Publish Question',
          variant: 'default' as const,
        };
      case 'archive':
        return {
          title: 'Archive Question',
          message: 'Are you sure you want to archive this question? It will be removed from active use.',
          confirmLabel: 'Archive Question',
          variant: 'warning' as const,
        };
      case 'delete':
        return {
          title: 'Delete Question',
          message: 'Are you sure you want to delete this question? This item will be moved to the Recycle Bin and can be restored later.',
          confirmLabel: 'Delete Question',
          variant: 'danger' as const,
        };
    }
  })() : null;

  // ── Filter images by role ────────────────────────────────────────────
  const stemImages = question?.images.filter(
    (img) => img.imageRole === 'question' || img.imageRole === 'stem',
  ) ?? [];
  const explanationImages = question?.images.filter(
    (img) => img.imageRole === 'explanation',
  ) ?? [];

  const hasExplanation = !!question?.explanation?.explanationText;

  // ═════════════════════════════════════════════════════════════════════
  //  Loading State
  // ═════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Question Review"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Question Approval', href: '/admin/questions' },
            { label: 'Loading...' },
          ]}
        />
        <DetailPageSkeleton />
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Error State
  // ═════════════════════════════════════════════════════════════════════
  if (isError || !question) {
    return (
      <div>
        <PageHeader
          title="Question Review"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Question Approval', href: '/admin/questions' },
            { label: 'Error' },
          ]}
        />
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <XCircle size={28} weight="duotone" className="text-red-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-red-800 dark:text-red-300">
                Failed to load question details
              </p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'The question could not be found or an error occurred.'}
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/admin/questions"
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-900 dark:text-red-400"
              >
                ← Back to Question Queue
              </Link>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Render — Question Data Loaded
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title="Question Review"
        description={`${question.subjectName ?? 'Unknown Subject'} · ${question.chapterName ?? 'Unknown Chapter'}`}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Question Approval', href: '/admin/questions' },
          { label: 'Review' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge status={question.status} showDot={true} />
            <Link
              href="/admin/questions"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowLeft size={14} />
              Back to Queue
            </Link>
          </div>
        }
      />

      {/* ════════════════════════════════════════════════════════════════
          Pending Queue Navigation (Previous / Next)
         ════════════════════════════════════════════════════════════════ */}
      <ReviewNavigation
        items={pendingQueue}
        currentId={questionId}
        hrefFor={(id) => `/admin/questions/${id}`}
        itemLabel="pending question"
        loading={pendingQueueLoading}
      />

      {/* ════════════════════════════════════════════════════════════════
          Action Bar
         ════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Actions:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pending → Approve / Reject */}
          {question.status === 'pending_approval' && (
            <>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'approve' })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
              >
                {actionLoading && confirmAction?.type === 'approve' ? (
                  <CircleNotch size={14} className="animate-spin" />
                ) : (
                  <CheckCircle size={14} weight="fill" />
                )}
                {actionLoading && confirmAction?.type === 'approve' ? 'Approving...' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction({ type: 'reject' })}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-40"
              >
                {actionLoading && confirmAction?.type === 'reject' ? (
                  <CircleNotch size={14} className="animate-spin" />
                ) : (
                  <XCircle size={14} weight="fill" />
                )}
                {actionLoading && confirmAction?.type === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
            </>
          )}

          {/* Published → Archive */}
          {question.status === 'published' && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'archive' })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-40"
            >
              {actionLoading && confirmAction?.type === 'archive' ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Archive size={14} weight="fill" />
              )}
              {actionLoading && confirmAction?.type === 'archive' ? 'Archiving...' : 'Archive'}
            </button>
          )}

          {/* Archived → Restore */}
          {question.status === 'archived' && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'publish' })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
            >
              {actionLoading && confirmAction?.type === 'publish' ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Sparkle size={14} weight="fill" />
              )}
              {actionLoading && confirmAction?.type === 'publish' ? 'Restoring...' : 'Restore'}
            </button>
          )}

          {/* Draft → Approve */}
          {question.status === 'draft' && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'approve' })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
            >
              {actionLoading && confirmAction?.type === 'approve' ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <CheckCircle size={14} weight="fill" />
              )}
              {actionLoading && confirmAction?.type === 'approve' ? 'Approving...' : 'Approve'}
            </button>
          )}

          {/* Soft Delete (Super Admin only) */}
          {canRestoreDeletedData && (
            <button
              type="button"
              onClick={() => setConfirmAction({ type: 'delete' })}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-40"
            >
              {actionLoading && confirmAction?.type === 'delete' ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <XCircle size={14} weight="fill" />
              )}
              {actionLoading && confirmAction?.type === 'delete' ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>

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
          Two-Column Layout
         ════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ─── LEFT COLUMN (2/3) ────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">

          {/* ════════════════════════════════════════════════════════════
              2. Question Card
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Question
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${getDifficultyStyle(question.difficulty)}`}>
                  <Star size={12} weight="fill" className="mr-1" />
                  {question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  <Exam size={12} />
                  {question.marks} mark{question.marks !== 1 ? 's' : ''}
                  {question.negativeMarks > 0 && (
                    <> / -{question.negativeMarks}</>
                  )}
                </span>
              </div>
            </div>

            {/* Question text */}
            <p className="text-base leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
              {question.questionText}
            </p>

            {/* Stem images */}
            {stemImages.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  Question Images
                </p>
                <ImageGallery
                  images={stemImages.map((img) => ({
                    url: imageUrlMap.get(img.storagePath) ?? null,
                    altText: img.altText,
                  }))}
                  label="Question image"
                />
              </div>
            )}

            {/* Question metadata badges */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                <Tag size={12} />
                {question.questionType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">
                <Books size={12} />
                {question.subjectName ?? '—'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400">
                <BookOpenText size={12} />
                {question.chapterName ?? '—'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                <UserCircle size={12} />
                {question.teacher.name ?? 'Unknown'}
              </span>
            </div>

            {/* Timestamps */}
            <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-gray-400">
              <span className="inline-flex items-center gap-1">
                <CalendarBlank size={12} />
                Created {formatDate(question.createdAt)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={12} />
                Updated {formatDate(question.updatedAt)}
              </span>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              3. Options
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center gap-2">
              <Exam size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Options
              </h3>
              <span className="text-xs text-gray-400">({question.options.length} options)</span>
            </div>

            {question.options.length === 0 ? (
              <EmptyState
                icon={<QuestionIcon size={32} weight="thin" />}
                title="No options found"
                description="This question has no options configured."
              />
            ) : (
              <div className="space-y-3">
                {/* Sort options by orderSequence to maintain original ordering */}
                {[...question.options]
                  .sort((a, b) => a.orderSequence - b.orderSequence)
                  .map((option, idx) => (
                    <OptionCard key={option.optionId} option={option} index={idx} signedUrls={imageUrlMap} />
                  ))}
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════
              4. Explanation
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center gap-2">
              <FileText size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Explanation
              </h3>
            </div>

            {!hasExplanation ? (
              <EmptyState
                icon={<FileText size={32} weight="thin" />}
                title="No explanation provided"
                description="The teacher did not include an explanation for this question."
              />
            ) : (
              <div className="space-y-4">
                {question.explanation!.explanationText && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/30 dark:bg-blue-900/10">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                      {question.explanation!.explanationText}
                    </p>
                  </div>
                )}

                {question.explanation!.explanationVideoUrl && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                      Explanation Video
                    </p>
                    <a
                      href={question.explanation!.explanationVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {question.explanation!.explanationVideoUrl}
                    </a>
                  </div>
                )}

                {question.explanation!.correctNumericalAnswer !== null && (
                  <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-4 dark:border-purple-900/30 dark:bg-purple-900/10">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                      Correct Numerical Answer
                    </p>
                    <p className="mt-1 text-lg font-bold text-purple-700 dark:text-purple-400">
                      {question.explanation!.correctNumericalAnswer}
                      {question.explanation!.numericalTolerance != null && (
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          ± {question.explanation!.numericalTolerance}
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {/* Explanation images */}
                {explanationImages.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                      Explanation Images
                    </p>
                    <ImageGallery
                      images={explanationImages.map((img) => ({
                        url: imageUrlMap.get(img.storagePath) ?? null,
                        altText: img.altText,
                      }))}
                      label="Explanation image"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN (1/3) ────────────────────────────────────── */}
        <div className="space-y-6">

          {/* ════════════════════════════════════════════════════════════
              6. Approval Metadata
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Approval Status
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Tag size={18} />}
                label="Current Status"
                value={<StatusBadge status={question.status} showDot={true} />}
              />
              <InfoRow
                icon={<UserCircle size={18} />}
                label="Approved By"
                value={
                  question.approvalMetadata.approvedByName
                    ? question.approvalMetadata.approvedByName
                    : question.status === 'pending_approval'
                      ? <span className="text-gray-400 italic">Not approved yet</span>
                      : <span className="text-gray-400 italic">—</span>
                }
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Approved At"
                value={
                  question.approvalMetadata.approvedAt
                    ? formatDateTime(question.approvalMetadata.approvedAt)
                    : question.status === 'pending_approval'
                      ? <span className="text-gray-400 italic">Not approved yet</span>
                      : <span className="text-gray-400 italic">—</span>
                }
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              5. Teacher Information
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <ChalkboardTeacher size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Teacher Information
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<UserCircle size={18} />}
                label="Teacher Name"
                value={question.teacher.name ?? <span className="text-gray-400 italic">Unknown</span>}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="Faculty ID"
                value={
                  question.teacher.teacherId ? (
                    <span className="font-mono text-xs">{question.teacher.teacherId}</span>
                  ) : (
                    <span className="text-gray-400 italic">—</span>
                  )
                }
              />
              <InfoRow
                icon={<QuestionIcon size={18} />}
                label="Submitted"
                value={formatDateTime(question.createdAt)}
              />
            </div>

            {/* Placeholder for future department / designation fields */}
            <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-3 text-center dark:border-gray-700 dark:bg-gray-800/20">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Department and designation will appear here when teacher details are linked.
              </p>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              7. Audit Summary
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <Clock size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Audit Summary
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Created"
                value={formatDateTime(question.createdAt)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Last Updated"
                value={formatDateTime(question.updatedAt)}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="Current Status"
                value={<StatusBadge status={question.status} showDot={true} />}
              />
              <InfoRow
                icon={<Exam size={18} />}
                label="Version"
                value={`v${question.version}`}
              />
            </div>

            {/* Placeholder for future audit history */}
            <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-3 text-center dark:border-gray-700 dark:bg-gray-800/20">
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Full approval audit history will appear here (approve, reject, publish, archive events).
              </p>
            </div>
          </div>

        </div>
      </div>

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
