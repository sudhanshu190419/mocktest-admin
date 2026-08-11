'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDoubtDetail, useReplyToDoubt, useResolveDoubt } from '@/hooks/doubt/useDoubt';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { DoubtAcademicContext } from '@/components/teacher/doubts/DoubtAcademicContext';
import { StudentDoubtContext } from '@/components/teacher/doubts/StudentDoubtContext';
import { DoubtAttachmentView } from '@/components/teacher/doubts/DoubtAttachmentView';
import type { DoubtReply, DoubtStatus } from '@/types/doubt';

const ROLE_LABEL: Record<string, string> = {
  student: 'Student',
  teacher: 'Teacher',
  admin: 'Admin',
};

const ROLE_STYLE: Record<string, string> = {
  student: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  teacher: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  admin: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ReplyBubble({ reply }: { reply: DoubtReply }) {
  const role = reply.authorRole ?? 'student';
  return (
    <div className="flex gap-3">
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          role === 'teacher'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            : role === 'admin'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
        }`}
      >
        {(reply.authorName ?? (role === 'teacher' ? 'T' : 'S')).charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {reply.authorName ?? (role === 'teacher' ? 'Teacher' : 'Student')}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROLE_STYLE[role] ?? ROLE_STYLE.student}`}>
            {ROLE_LABEL[role] ?? 'Student'}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {formatDateTime(reply.createdAt)}
          </span>
          {reply.isAcceptedAnswer && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              ✓ Accepted Answer
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {reply.replyText}
        </p>
        {reply.imageUrl && (
          <a
            href={reply.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            View image
          </a>
        )}
        {reply.attachments && reply.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {reply.attachments.map((a) => (
              <DoubtAttachmentView key={a.attachmentId} attachment={a} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function isActionable(status: DoubtStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

export default function TeacherDoubtDetailPage() {
  const params = useParams<{ doubtId: string }>();
  const router = useRouter();
  const doubtId = params?.doubtId;

  // Fresh state matters here: the student can reopen / follow up on the
  // mobile app while this page is open. Poll gently (60s) + refetch on
  // focus so the resolved message disappears and the composer returns
  // without a manual refresh. The DB remains authoritative.
  const { data: detail, isLoading, isError } = useDoubtDetail(doubtId, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const { mutate: replyToDoubt, isPending: replyPending } = useReplyToDoubt();
  const { mutate: resolveDoubt, isPending: resolvePending } = useResolveDoubt();

  const [replyText, setReplyText] = useState('');
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doubt = detail?.doubt;
  const replies = detail?.replies ?? [];
  const attachments = detail?.attachments ?? [];

  const handleSendReply = () => {
    const text = replyText.trim();
    if (!text || replyPending || !doubtId) return;
    setError(null);
    replyToDoubt(
      { doubtId, replyText: text },
      {
        onSuccess: () => {
          setReplyText('');
          setError(null);
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  const handleResolve = () => {
    if (!doubtId) return;
    setError(null);
    resolveDoubt(
      { doubtId },
      {
        onSuccess: () => {
          setConfirmResolve(false);
          setError(null);
        },
        onError: (err) => {
          setConfirmResolve(false);
          setError(err.message);
        },
      },
    );
  };

  // Loading
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-64" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-56" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  // Not found / RLS-denied (same UI — we never leak why)
  if (isError || !doubt) {
    return (
      <div>
        <PageHeader title="Doubt Detail" breadcrumbs={[{ label: 'Doubts', href: '/teacher/doubts' }, { label: 'Doubt' }]} />
        <EmptyState
          title="Doubt not found"
          description="This doubt may have been removed, or you don't have access to it."
          action={
            <button
              type="button"
              onClick={() => router.push('/teacher/doubts')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Back to Doubts
            </button>
          }
        />
      </div>
    );
  }

  const status = doubt.status;
  const isArchived = status === 'archived';
  const canResolve = isActionable(status); // authorization enforced by RPC/RLS

  return (
    <div>
      <PageHeader
        title="Doubt Detail"
        description={`${doubt.subjectName ?? 'Subject'} • ${doubt.title}`}
        breadcrumbs={[{ label: 'Doubts', href: '/teacher/doubts' }, { label: 'Doubt Detail' }]}
        actions={<StatusBadge status={status} />}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── LEFT: Question + Conversation + Reply ─────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Student's question */}
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Student&apos;s Question
              </h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {formatDateTime(doubt.createdAt)}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {doubt.title}
            </h3>
            {doubt.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {doubt.description}
              </p>
            )}
            {attachments.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {attachments.map((a) => (
                  <DoubtAttachmentView key={a.attachmentId} attachment={a} />
                ))}
              </div>
            )}
          </section>

          {/* Conversation */}
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Conversation{replies.length > 0 ? ` (${replies.length})` : ''}
            </h2>
            {replies.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No replies yet. Be the first to respond to this doubt.
              </p>
            ) : (
              <div className="space-y-5">
                {replies.map((r) => (
                  <ReplyBubble key={r.replyId} reply={r} />
                ))}
              </div>
            )}
          </section>

          {/* Reply composer */}
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Reply
            </h2>
            {isArchived ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                This doubt is archived and can no longer be modified.
              </p>
            ) : status === 'resolved' ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This doubt is resolved. A new reply is not required — if the
                student reopens it, you will be notified.
              </p>
            ) : (
              <>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={4}
                  placeholder="Write your response..."
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || replyPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {replyPending ? 'Sending...' : 'Reply'}
                  </button>
                  {canResolve && (
                    <button
                      type="button"
                      onClick={() => setConfirmResolve(true)}
                      disabled={resolvePending}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                    >
                      {resolvePending ? 'Resolving...' : 'Resolve'}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                  Sending a reply moves the doubt to In Progress. Resolving
                  notifies the student that the doubt is answered.
                </p>
              </>
            )}
          </section>
        </div>

        {/* ── RIGHT: Academic context + student + status ────────────────── */}
        <div className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <DoubtAcademicContext doubt={doubt} />
            {doubt.batchSubjectId == null && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                This is a legacy doubt without batch context.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <StudentDoubtContext doubt={doubt} />
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Handling
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Status</dt>
                <dd>
                  <StatusBadge status={status} />
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Assigned Teacher</dt>
                <dd className="font-medium text-gray-800 dark:text-gray-200">
                  {doubt.assignedTeacherName ?? (doubt.assignedTo ? 'Assigned' : 'Awaiting Assignment')}
                </dd>
              </div>
              {doubt.firstResponseAt && (
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">First Response</dt>
                  <dd className="text-gray-800 dark:text-gray-200">{formatDateTime(doubt.firstResponseAt)}</dd>
                </div>
              )}
              {doubt.resolvedAt && (
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Resolved</dt>
                  <dd className="text-gray-800 dark:text-gray-200">{formatDateTime(doubt.resolvedAt)}</dd>
                </div>
              )}
            </dl>
          </section>

          <Link
            href="/teacher/doubts"
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Back to Doubts
          </Link>
        </div>
      </div>

      <ConfirmDialog
        open={confirmResolve}
        onClose={() => setConfirmResolve(false)}
        onConfirm={handleResolve}
        title="Resolve this doubt?"
        message="The student will be notified that the doubt has been resolved."
        confirmLabel="Resolve"
        variant="default"
        loading={resolvePending}
      />
    </div>
  );
}
