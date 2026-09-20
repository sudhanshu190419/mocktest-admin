'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  ArrowsClockwise,
  PaperPlaneRight,
  WarningCircle,
  ChatText,
  User,
  CalendarBlank,
  Check,
  VideoCamera,
  FileText,
  Exam,
  Sparkle,
  GraduationCap,
} from '@phosphor-icons/react';
import {
  useDoubtDetail,
  useReplyToDoubt,
  useAcceptDoubtAnswer,
  useResolveDoubt,
  useReopenDoubt,
} from '@/hooks/doubt/useDoubt';
import { StudentDoubtAcademicContext } from '@/components/student/doubts/StudentDoubtAcademicContext';
import { StudentDoubtAttachmentView } from '@/components/student/doubts/StudentDoubtAttachmentView';
import { StudentConfirmDialog } from '@/components/student/StudentConfirmDialog';
import { getSubjectColor, getSubjectEmoji } from '@/services/student/studentCourseWebService';
import { doubtErrorMessage } from '@/utils/doubtErrors';
import { Skeleton, ErrorState, EmptyState, ButtonLink, useToast } from '@/components/ui/mmt';
import type { DoubtReply, DoubtStatus, DoubtResourceType } from '@/types/doubt';

function formatDateTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getResourceBadge(type: DoubtResourceType | null) {
  if (!type) return null;
  switch (type) {
    case 'live_class':
      return { label: 'Live Class', icon: VideoCamera, color: 'text-brand-hover bg-sky-tint border-line' };
    case 'content':
      return { label: 'Study Material', icon: FileText, color: 'text-brand-hover bg-sky-tint border-line' };
    case 'question':
      return { label: 'Test Question', icon: Exam, color: 'text-lilac-ink bg-lilac-tint border-purple-200' };
    case 'mock_test':
      return { label: 'Mock Test', icon: Exam, color: 'text-lilac-ink bg-lilac-tint border-purple-200' };
    case 'pyq_paper':
      return { label: 'PYQ Paper', icon: FileText, color: 'text-mint-ink bg-mint-tint border-emerald-200' };
    default:
      return null;
  }
}

/**
 * Standard Status Vocabulary (PRD §7.2):
 *  - open: "Waiting on faculty"
 *  - in_progress: "Faculty is on it"
 *  - resolved: "Resolved"
 */
function getStatusBadgeConfig(status: DoubtStatus) {
  switch (status) {
    case 'open':
      return {
        label: 'Waiting on faculty',
        dotColor: 'bg-brand',
        badgeClass: 'bg-sky-tint text-brand-hover border-line',
      };
    case 'in_progress':
      return {
        label: 'Faculty is on it',
        dotColor: 'bg-amber-500 animate-pulse',
        badgeClass: 'bg-sand text-sand-ink border-amber-200',
      };
    case 'resolved':
      return {
        label: 'Resolved',
        dotColor: 'bg-emerald-500',
        badgeClass: 'bg-mint-tint text-mint-ink border-emerald-200',
      };
    case 'archived':
      return {
        label: 'Archived',
        dotColor: 'bg-sky-tint',
        badgeClass: 'bg-paper text-ink-secondary border-line',
      };
    default:
      return {
        label: status,
        dotColor: 'bg-sky-tint',
        badgeClass: 'bg-paper text-ink-secondary border-line',
      };
  }
}

export default function StudentDoubtThreadPage() {
  const params = useParams();
  const router = useRouter();
  const doubtId = typeof params?.doubtId === 'string' ? params.doubtId : '';
  const { toast } = useToast();

  // Fetch doubt detail with 60s gentle background polling
  const {
    data: detail,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useDoubtDetail(doubtId, { refetchInterval: 60000 });

  // Mutation hooks
  const replyMutation = useReplyToDoubt();
  const acceptMutation = useAcceptDoubtAnswer();
  const resolveMutation = useResolveDoubt();
  const reopenMutation = useReopenDoubt();

  // Local UI state
  const [replyText, setReplyText] = useState<string>('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [resolveDialogOpen, setResolveDialogOpen] = useState<boolean>(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState<boolean>(false);
  const [acceptTargetReplyId, setAcceptTargetReplyId] = useState<string | null>(null);

  const doubt = detail?.doubt;
  const replies = detail?.replies ?? [];
  const attachments = detail?.attachments ?? [];

  const isActionable = doubt?.status === 'open' || doubt?.status === 'in_progress';
  const canReopen = doubt?.status === 'resolved' && doubt.reopenedCount < 3;

  // Handle sending a reply
  const handleSendReply = () => {
    if (!replyText.trim() || replyMutation.isPending || !doubtId) return;
    setReplyError(null);
    replyMutation.mutate(
      { doubtId, replyText: replyText.trim() },
      {
        onSuccess: () => {
          setReplyText('');
          setReplyError(null);
          toast('Follow-up reply posted successfully', 'success');
        },
        onError: (err) => {
          setReplyError(doubtErrorMessage(err.message));
        },
      },
    );
  };

  // Handle accept answer
  const handleAcceptConfirm = () => {
    if (!acceptTargetReplyId || !doubtId) return;
    acceptMutation.mutate(
      { doubtId, replyId: acceptTargetReplyId },
      {
        onSuccess: () => {
          setAcceptTargetReplyId(null);
          toast('Solution accepted and doubt resolved', 'success');
        },
        onError: (err) => {
          setAcceptTargetReplyId(null);
          toast(doubtErrorMessage(err.message), 'error');
        },
      },
    );
  };

  // Handle resolve doubt
  const handleResolveConfirm = () => {
    if (!doubtId) return;
    resolveMutation.mutate(
      { doubtId },
      {
        onSuccess: () => {
          setResolveDialogOpen(false);
          toast('Doubt marked as resolved', 'success');
        },
        onError: (err) => {
          setResolveDialogOpen(false);
          toast(doubtErrorMessage(err.message), 'error');
        },
      },
    );
  };

  // Handle reopen doubt
  const handleReopenConfirm = () => {
    if (!doubtId) return;
    reopenMutation.mutate(
      { doubtId },
      {
        onSuccess: () => {
          setReopenDialogOpen(false);
          toast('Doubt reopened for faculty attention', 'info');
        },
        onError: (err) => {
          setReopenDialogOpen(false);
          toast(doubtErrorMessage(err.message), 'error');
        },
      },
    );
  };

  // ── Loading Skeleton State ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="store-container space-y-6 max-w-7xl mx-auto pb-12 animate-pulse">
        <Skeleton className="h-4 w-36" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48 w-full rounded-card" />
            <Skeleton className="h-36 w-full rounded-card" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-card" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error / Not Found State ─────────────────────────────────────────
  if (isError || !doubt) {
    return (
      <div className="store-container">
        <EmptyState
          icon={WarningCircle}
          title="Doubt Not Found or Access Denied"
          detail={
            error instanceof Error
              ? doubtErrorMessage(error.message)
              : "You don't have permission to view this question, or it may have been removed."
          }
          action={
            <ButtonLink href="/student/doubts" size="md">
              <ArrowLeft size={16} weight="bold" />
              <span>Return to My Doubts</span>
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const subjectName = doubt.subjectName || 'General Academic';
  const subjectColor = getSubjectColor(subjectName);
  const subjectEmoji = getSubjectEmoji(subjectName);
  const statusConfig = getStatusBadgeConfig(doubt.status);
  const resourceBadge = getResourceBadge(doubt.relatedResourceType);

  return (
    <div className="store-container space-y-7 pb-16">
      {/* ── Top Header & Navigation Bar ─────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">My Learning</Link>
            <span aria-hidden="true">/</span>
            <Link href="/student/doubts">My Doubts</Link>
            <span aria-hidden="true">/</span>
            <span>Doubt Thread</span>
          </nav>
          <div className="flex items-center gap-2.5 flex-wrap mt-1">
            <h1 className="text-2xl sm:text-display font-extrabold text-ink tracking-tight">
              Doubt Resolution Thread
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption font-bold border ${statusConfig.badgeClass}`}
            >
              <span className={`h-2 w-2 rounded-full ${statusConfig.dotColor}`} />
              <span>{statusConfig.label}</span>
            </span>
            {doubt.reopenedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-field text-caption font-bold bg-sand text-sand-ink border border-amber-200">
                <ArrowsClockwise size={12} weight="bold" />
                <span>Reopened ({doubt.reopenedCount}/3)</span>
              </span>
            )}
          </div>
        </div>

        {/* Actions (Refresh, Resolve, Reopen) */}
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh conversation"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-field border border-line bg-surface text-ink-secondary hover:bg-paper hover:text-ink transition-colors disabled:opacity-50"
          >
            <ArrowsClockwise
              size={18}
              weight="bold"
              className={isFetching ? 'animate-spin text-brand' : ''}
            />
          </button>

          {isActionable && (
            <button
              type="button"
              onClick={() => setResolveDialogOpen(true)}
              disabled={resolveMutation.isPending}
              className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2.5 rounded-field bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-body shadow-xs transition-colors"
            >
              <CheckCircle size={16} weight="bold" />
              <span>Resolve Doubt</span>
            </button>
          )}

          {canReopen && (
            <button
              type="button"
              onClick={() => setReopenDialogOpen(true)}
              disabled={reopenMutation.isPending}
              className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2.5 rounded-field bg-amber-600 hover:bg-amber-700 text-white font-bold text-body shadow-xs transition-colors"
            >
              <ArrowsClockwise size={16} weight="bold" />
              <span>Reopen Doubt</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Two-Column Layout (Desktop) / Stacked (Mobile) ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left 2 Cols: Question Card + Replies + Composer */}
        <div className="lg:col-span-2 space-y-6">
          {/* 1. Main Question Card */}
          <div className="rounded-card border border-line bg-surface p-6 sm:p-7 shadow-card space-y-4">
            {/* Category & Tags Row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-field text-caption font-bold border"
                  style={{
                    backgroundColor: `${subjectColor}12`,
                    color: subjectColor,
                    borderColor: `${subjectColor}30`,
                  }}
                >
                  <span>{subjectEmoji}</span>
                  <span>{subjectName}</span>
                </span>

                {resourceBadge && (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-field text-caption font-bold border ${resourceBadge.color}`}
                  >
                    <resourceBadge.icon size={13} weight="bold" />
                    <span>{resourceBadge.label}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 text-caption text-ink-secondary font-medium">
                <CalendarBlank size={14} />
                <span>Asked {formatDateTime(doubt.createdAt)}</span>
              </div>
            </div>

            {/* Question Title */}
            <h2 className="text-h2 font-extrabold text-ink tracking-tight leading-snug">
              {doubt.title}
            </h2>

            {/* Question Description */}
            <div className="text-body text-ink leading-relaxed whitespace-pre-wrap bg-paper p-4 rounded-field border border-line">
              {doubt.description}
            </div>

            {/* Question Attachments */}
            {attachments.length > 0 && (
              <div className="pt-2 border-t border-line space-y-2">
                <p className="text-caption font-bold uppercase tracking-wider text-ink-secondary">
                  Attached Documents & Images ({attachments.length})
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {attachments.map((att) => (
                    <StudentDoubtAttachmentView key={att.attachmentId} attachment={att} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2. Chronological Discussion Thread */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-h3 font-bold text-ink flex items-center gap-2">
                <ChatText size={18} weight="duotone" className="text-brand" />
                <span>Discussion & Faculty Solutions ({replies.length})</span>
              </h3>
              {doubt.firstResponseAt && (
                <span className="text-caption text-ink-secondary font-medium">
                  First reply {formatDateTime(doubt.firstResponseAt)}
                </span>
              )}
            </div>

            {replies.length === 0 ? (
              <div className="p-8 rounded-card bg-surface border border-line text-center space-y-2 shadow-card">
                <div className="inline-flex p-3 rounded-field bg-sky-tint text-brand">
                  <Clock size={24} weight="duotone" />
                </div>
                <p className="text-body font-bold text-ink">
                  Awaiting Faculty Response
                </p>
                <p className="text-caption text-ink-secondary max-w-sm mx-auto leading-relaxed">
                  Your question has been routed to the subject faculty. You will receive an in-app update when an answer is provided.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {replies.map((reply: DoubtReply) => {
                  const isTeacher = reply.authorRole === 'teacher';
                  const isAdmin = reply.authorRole === 'admin';
                  const isStudent = !isTeacher && !isAdmin;

                  return (
                    <div
                      key={reply.replyId}
                      className={`rounded-card border p-5 transition-all shadow-card ${
                        reply.isAcceptedAnswer
                          ? 'bg-mint-tint/30 border-emerald-300 ring-2 ring-emerald-500/20'
                          : isTeacher
                            ? 'bg-surface border-emerald-100'
                            : isAdmin
                              ? 'bg-surface border-purple-100'
                              : 'bg-surface border-line'
                      }`}
                    >
                      {/* Author Header Row */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-field text-caption font-bold text-white shadow-xs ${
                              isTeacher
                                ? 'bg-emerald-600'
                                : isAdmin
                                  ? 'bg-purple-600'
                                  : 'bg-brand'
                            }`}
                          >
                            {(reply.authorName || (isTeacher ? 'T' : isStudent ? 'S' : 'A')).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-body font-bold text-ink">
                                {isStudent
                                  ? 'You (Student)'
                                  : reply.authorName || (isTeacher ? 'Faculty' : 'Academic Admin')}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-field text-caption font-bold uppercase tracking-wider ${
                                  isTeacher
                                    ? 'bg-mint-tint text-mint-ink border border-emerald-200'
                                    : isAdmin
                                      ? 'bg-lilac-tint text-lilac-ink border border-purple-200'
                                      : 'bg-sky-tint text-brand-hover border border-line'
                                }`}
                              >
                                {isTeacher ? 'Faculty' : isAdmin ? 'Admin' : 'Student'}
                              </span>
                            </div>
                            <p className="text-caption text-ink-secondary">
                              {formatDateTime(reply.createdAt)}
                            </p>
                          </div>
                        </div>

                        {/* Accepted Solution Badge or Action Button */}
                        <div>
                          {reply.isAcceptedAnswer ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-caption font-bold bg-emerald-600 text-white shadow-xs">
                              <Check size={13} weight="bold" />
                              <span>Accepted Solution</span>
                            </span>
                          ) : (
                            (isTeacher || isAdmin) &&
                            isActionable && (
                              <button
                                type="button"
                                onClick={() => setAcceptTargetReplyId(reply.replyId)}
                                disabled={acceptMutation.isPending}
                                className="inline-flex min-h-[36px] items-center gap-1 px-3 py-1 rounded-field text-caption font-bold text-mint-ink bg-mint-tint hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-50"
                              >
                                <Check size={13} weight="bold" />
                                <span>Accept Solution</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {/* Reply Text */}
                      <p className="text-body text-ink leading-relaxed whitespace-pre-wrap">
                        {reply.replyText}
                      </p>

                      {/* Reply Attachments */}
                      {reply.attachments && reply.attachments.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-line flex flex-wrap gap-2">
                          {reply.attachments.map((att) => (
                            <StudentDoubtAttachmentView key={att.attachmentId} attachment={att} compact />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Reply Composer */}
          <div className="rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card space-y-3">
            <h4 className="text-caption font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
              <PaperPlaneRight size={15} weight="duotone" className="text-brand" />
              <span>Write a Follow-Up Question</span>
            </h4>

            {isActionable ? (
              <>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Ask for more clarification or reply to the faculty's answer..."
                  rows={4}
                  maxLength={5000}
                  className="w-full rounded-field bg-paper p-4 text-body font-medium text-ink placeholder:text-ink-muted border border-line outline-none focus:border-brand focus:bg-surface transition-all font-sans resize-none"
                />

                {replyError && (
                  <p className="text-caption font-semibold text-rose-600">
                    {replyError}
                  </p>
                )}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-caption font-medium text-ink-secondary">
                    {replyText.length} / 5000 characters
                  </span>

                  <button
                    type="button"
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 rounded-field bg-brand hover:bg-brand-hover active:bg-brand-hover text-white font-bold text-body shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PaperPlaneRight size={15} weight="bold" />
                    <span>{replyMutation.isPending ? 'Sending...' : 'Send Reply'}</span>
                  </button>
                </div>
              </>
            ) : doubt.status === 'resolved' ? (
              <div className="p-4 rounded-field bg-mint-tint border border-emerald-200 text-mint-ink text-body leading-relaxed">
                <p className="font-bold mb-1">This doubt is marked as resolved.</p>
                <p className="text-caption text-ink-secondary">
                  If you still need further assistance, you can click <span className="font-bold text-ink">Reopen Doubt</span> in the top header (up to 3 times).
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-field bg-paper border border-line text-ink-secondary text-body">
                This doubt is archived and can no longer receive new replies.
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Col: Academic Context & Faculty Details Sidebar */}
        <div className="space-y-4">
          {/* Academic Context Card */}
          <div className="rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card">
            <StudentDoubtAcademicContext doubt={doubt} />
          </div>

          {/* Assigned Faculty Card */}
          <div className="rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card space-y-3">
            <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-secondary">
              Assigned Faculty
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-field bg-mint-tint text-mint-ink border border-emerald-200 font-bold text-sm">
                <GraduationCap size={22} weight="duotone" />
              </div>
              <div className="min-w-0">
                <p className="text-body font-bold text-ink truncate">
                  {doubt.assignedTeacherName || 'Faculty Assignment Pending'}
                </p>
                <p className="text-caption text-ink-secondary truncate">
                  {doubt.assignedTeacherName ? 'Subject Faculty Solver' : 'Auto-routing in progress'}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Support Card */}
          <div className="rounded-card border border-line bg-sky-tint p-5 space-y-2">
            <div className="flex items-center gap-2 text-brand-hover text-caption font-bold">
              <Sparkle size={16} weight="fill" className="text-brand" />
              <span>Helpful Tip</span>
            </div>
            <p className="text-caption text-ink-secondary leading-relaxed">
              Once your doubt is solved satisfactorily, click <strong>Accept Solution</strong> on the faculty reply to mark the problem resolved.
            </p>
          </div>
        </div>
      </div>

      {/* ── Confirmation Dialogs ─────────────────────────────────────── */}
      <StudentConfirmDialog
        open={resolveDialogOpen}
        onClose={() => setResolveDialogOpen(false)}
        onConfirm={handleResolveConfirm}
        title="Resolve Doubt"
        message="Are you sure you want to mark this doubt as resolved? You can reopen it later if you still need help."
        confirmLabel="Yes, Mark Resolved"
        variant="default"
        loading={resolveMutation.isPending}
      />

      <StudentConfirmDialog
        open={reopenDialogOpen}
        onClose={() => setReopenDialogOpen(false)}
        onConfirm={handleReopenConfirm}
        title="Reopen Doubt"
        message={`Are you sure you want to reopen this doubt? (${doubt.reopenedCount + 1} of 3 allowed reopens). This will alert faculty that further clarification is required.`}
        confirmLabel="Reopen Doubt"
        variant="warning"
        loading={reopenMutation.isPending}
      />

      <StudentConfirmDialog
        open={Boolean(acceptTargetReplyId)}
        onClose={() => setAcceptTargetReplyId(null)}
        onConfirm={handleAcceptConfirm}
        title="Accept Faculty Solution"
        message="Mark this answer as the accepted solution? This will resolve the doubt and credit the faculty for the resolution."
        confirmLabel="Accept as Solution"
        variant="default"
        loading={acceptMutation.isPending}
      />
    </div>
  );
}
