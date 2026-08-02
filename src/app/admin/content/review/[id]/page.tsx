'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useContent,
  useApproveContent,
  useRejectContent,
  useDeleteContent,
} from '@/hooks/content/useContent';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { useContentList } from '@/hooks/content/useContent';
import { useApprovalHistory } from '@/hooks/content/useApproval';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ReviewNavigation } from '@/components/admin/ReviewNavigation';
import {
  ArrowLeft,
  CalendarBlank,
  Clock,
  CheckCircle,
  XCircle,
  CircleNotch,
  FileText,
  VideoCamera,
  FilePdf,
  NotePencil,
  ClipboardText,
  ShieldCheck,
  Eye,
  ArrowSquareOut,
  Tag,
  Repeat,
  UserCircle,
  HardDrives,
  Sparkle,
} from '@phosphor-icons/react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

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

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s}s` : `${s}s`;
}

const CONTENT_TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pdf: { label: 'PDF', icon: <FilePdf size={18} weight="duotone" />, color: 'bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400' },
  video: { label: 'Video', icon: <VideoCamera size={18} weight="duotone" />, color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' },
  notes: { label: 'Notes', icon: <NotePencil size={18} weight="duotone" />, color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' },
  assignment: { label: 'Assignment', icon: <ClipboardText size={18} weight="duotone" />, color: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' },
};

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
        <p className="break-words text-sm font-medium text-gray-900 dark:text-gray-100">
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
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-4 h-4 w-3/4" />
      </div>
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
//  Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminContentReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contentId = params.id as string;
  const { canRestoreDeletedData } = usePermissions();

  const { data: content, isLoading, isError, error, refetch } = useContent(contentId);

  // ── Pending queue for Prev/Next navigation ───────────────────────────
  const { data: pendingQueueData, isLoading: pendingQueueLoading } = useContentList(
    { status: 'pending_review' },
    { sortBy: 'createdAt', sortDirection: 'desc' },
    { page: 1, pageSize: 200 },
  );
  const pendingQueue = (pendingQueueData?.data ?? []).map((c) => ({
    id: c.contentId,
    label: c.title,
  }));

  // ── Previous decisions (approval history for this resource) ──────────
  const { data: approvalHistory } = useApprovalHistory(contentId, 'content');

  // ── Confirmation & Feedback State ────────────────────────────────────
  const [confirmAction, setConfirmAction] = useState<{ type: 'approve' | 'reject' | 'delete' } | null>(null);
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
  const approveMutation = useApproveContent();
  const rejectMutation = useRejectContent();
  const deleteMutation = useDeleteContent();

  // ── Action Executor ─────────────────────────────────────────────────
  const executeAction = useCallback(async (action: 'approve' | 'reject' | 'delete') => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      // Soft delete — handled separately (void mutation; item moves to Recycle Bin)
      if (action === 'delete') {
        await deleteMutation.mutateAsync(contentId);
        setActionSuccess('Content moved to the Recycle Bin successfully');
        router.push('/admin/content/review');
        return;
      }

      if (action === 'approve') {
        await approveMutation.mutateAsync(contentId);
        setActionSuccess('Content approved successfully');
      } else {
        await rejectMutation.mutateAsync(contentId);
        setActionSuccess('Content rejected. The teacher can revise and resubmit it.');
      }
      refetch();
    } catch (err: any) {
      setActionError(err?.message ?? 'An unexpected error occurred.');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
      clearFeedback();
    }
  }, [contentId, approveMutation, rejectMutation, deleteMutation, router, refetch, clearFeedback]);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    executeAction(confirmAction.type);
  }, [confirmAction, executeAction]);

  const confirmDialogConfig = confirmAction
    ? confirmAction.type === 'approve'
      ? {
          title: 'Approve Content',
          message: 'Are you sure you want to approve this content? It will become visible to students immediately.',
          confirmLabel: 'Approve Content',
          variant: 'default' as const,
        }
      : confirmAction.type === 'reject'
        ? {
            title: 'Reject Content',
            message: 'Are you sure you want to reject this content? The teacher can revise and resubmit it.',
            confirmLabel: 'Reject Content',
            variant: 'danger' as const,
          }
        : {
            title: 'Delete Content',
            message: 'Are you sure you want to delete this content? This item will be moved to the Recycle Bin and can be restored later.',
            confirmLabel: 'Delete Content',
            variant: 'danger' as const,
          }
    : null;

  // ═════════════════════════════════════════════════════════════════════
  //  Loading State
  // ═════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Content Review"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Content Review', href: '/admin/content/review' },
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
  if (isError || !content) {
    return (
      <div>
        <PageHeader
          title="Content Review"
          breadcrumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Content Review', href: '/admin/content/review' },
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
                Failed to load content details
              </p>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'The content could not be found or an error occurred.'}
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/admin/content/review"
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-700 dark:bg-gray-900 dark:text-red-400"
              >
                ← Back to Content Review
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

  const typeMeta = CONTENT_TYPE_META[content.contentType] ?? CONTENT_TYPE_META.pdf;
  const version = approvalHistory?.[0]?.version ?? 1;
  const submissions = approvalHistory?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* ════════════════════════════════════════════════════════════════
          Page Header
         ════════════════════════════════════════════════════════════════ */}
      <PageHeader
        title="Content Review"
        description={content.title}
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Content Review', href: '/admin/content/review' },
          { label: 'Review' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge status={content.status} showDot={true} />
            <Link
              href="/admin/content/review"
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
        currentId={contentId}
        hrefFor={(id) => `/admin/content/review/${id}`}
        itemLabel="pending content"
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
          {content.status === 'pending_review' && (
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
          <Link
            href={`/teacher/content/${contentId}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Eye size={14} />
            Open Preview
          </Link>
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
          {/* Content header card */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-start gap-4">
              <div className={`flex h-16 w-20 shrink-0 items-center justify-center rounded-lg ${typeMeta.color}`}>
                {typeMeta.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {content.title}
                  </h3>
                  <StatusBadge status={content.status} showDot={true} />
                  {content.isFreePreview && (
                    <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                      Free Preview
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {content.description || 'No description provided.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${typeMeta.color}`}>
                    {typeMeta.icon}
                    {typeMeta.label}
                  </span>
                  <span>{formatFileSize(content.fileSizeBytes)}</span>
                  {content.contentType === 'video' && (
                    <span>{formatDuration(content.durationSeconds)}</span>
                  )}
                  {content.pageCount && (
                    <span>{content.pageCount} pages</span>
                  )}
                </div>
              </div>
            </div>

            {/* File info badges */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                <Tag size={12} />
                {content.mimeType}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                <UserCircle size={12} />
                {content.originalFileName}
              </span>
            </div>
          </div>

          {/* File Information */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <HardDrives size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                File Information
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<FileText size={18} />}
                label="Original Name"
                value={content.originalFileName}
              />
              <InfoRow
                icon={<Tag size={18} />}
                label="MIME Type"
                value={content.mimeType}
              />
              <InfoRow
                icon={<HardDrives size={18} />}
                label="Size"
                value={formatFileSize(content.fileSizeBytes)}
              />
              {content.contentType === 'video' && (
                <InfoRow
                  icon={<VideoCamera size={18} />}
                  label="Duration"
                  value={formatDuration(content.durationSeconds)}
                />
              )}
              {content.pageCount && (
                <InfoRow
                  icon={<FilePdf size={18} />}
                  label="Pages"
                  value={`${content.pageCount}`}
                />
              )}
              <InfoRow
                icon={<Eye size={18} />}
                label="Views"
                value={content.viewCount.toLocaleString()}
              />
              <InfoRow
                icon={<ArrowSquareOut size={18} />}
                label="Downloads"
                value={content.downloadCount.toLocaleString()}
              />
            </div>
          </div>

          {/* Previous Decisions */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <Repeat size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Previous Decisions
              </h3>
              {submissions > 0 && (
                <span className="text-xs text-gray-400">({submissions} submission{submissions > 1 ? 's' : ''})</span>
              )}
            </div>

            {!approvalHistory || approvalHistory.length === 0 ? (
              <EmptyState
                title="No previous submissions"
                description="This is the first time this content has been submitted for review."
              />
            ) : (
              <div className="space-y-3">
                {approvalHistory.map((req) => (
                  <div
                    key={req.approvalId}
                    className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-800/20"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {/* Map approval status → badge status: bare 'pending' has no
                            dedicated style, use pending_review (amber) for consistency */}
                        <StatusBadge
                          status={req.status === 'pending' ? 'pending_review' : req.status}
                          showDot={true}
                        />
                        <span className="text-[11px] font-medium text-gray-500">
                          v{req.version}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400">
                        {req.status === 'pending'
                          ? `Submitted ${formatDateTime(req.requestedAt)}`
                          : `Reviewed ${formatDateTime(req.reviewedAt ?? req.requestedAt)}`}
                      </span>
                    </div>
                    {req.remarks && (
                      <p className="mt-2 text-xs italic text-gray-600 dark:text-gray-400">
                        “{req.remarks}”
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT COLUMN (1/3) ────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Review Summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Review Summary
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              <InfoRow
                icon={<Tag size={18} />}
                label="Current Status"
                value={<StatusBadge status={content.status} showDot={true} />}
              />
              <InfoRow
                icon={<CalendarBlank size={18} />}
                label="Submitted On"
                value={formatDateTime(content.createdAt)}
              />
              <InfoRow
                icon={<Clock size={18} />}
                label="Last Updated"
                value={formatDateTime(content.updatedAt)}
              />
              <InfoRow
                icon={<Repeat size={18} />}
                label="Current Version"
                value={`v${version}`}
              />
              <InfoRow
                icon={<ClipboardText size={18} />}
                label="Total Submissions"
                value={submissions > 0 ? `${submissions}` : 'First submission'}
              />
            </div>
          </div>

          {/* Decision Panel */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2">
              <Sparkle size={18} weight="duotone" className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Review Decision
              </h3>
            </div>
            {content.status === 'pending_review' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'approve' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
                >
                  {actionLoading && confirmAction?.type === 'approve' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle size={16} weight="fill" />
                  )}
                  {actionLoading && confirmAction?.type === 'approve' ? 'Approving...' : 'Approve Content'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'reject' })}
                  disabled={actionLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-40"
                >
                  {actionLoading && confirmAction?.type === 'reject' ? (
                    <CircleNotch size={16} className="animate-spin" />
                  ) : (
                    <XCircle size={16} weight="fill" />
                  )}
                  {actionLoading && confirmAction?.type === 'reject' ? 'Rejecting...' : 'Reject Content'}
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center dark:border-gray-700">
                <p className="text-xs text-gray-400">
                  {content.status === 'approved'
                    ? 'This content has been approved.'
                    : content.status === 'rejected'
                      ? 'This content has been rejected. The teacher can revise and resubmit it.'
                      : 'This content is not awaiting review.'}
                </p>
              </div>
            )}
            <div className="mt-3">
              <Link
                href={`/teacher/content/${contentId}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Eye size={16} />
                Open Full Preview
              </Link>
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
