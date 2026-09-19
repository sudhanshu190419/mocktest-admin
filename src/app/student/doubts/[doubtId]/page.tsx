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
import type { DoubtReply, DoubtStatus, DoubtResourceType } from '@/types/doubt';

function formatDateTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
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
      return { label: 'Live Class', icon: VideoCamera, color: 'text-indigo-700 bg-indigo-50 border-indigo-200' };
    case 'content':
      return { label: 'Study Material', icon: FileText, color: 'text-blue-700 bg-blue-50 border-blue-200' };
    case 'question':
      return { label: 'Test Question', icon: Exam, color: 'text-purple-700 bg-purple-50 border-purple-200' };
    case 'mock_test':
      return { label: 'Mock Test', icon: Exam, color: 'text-purple-700 bg-purple-50 border-purple-200' };
    case 'pyq_paper':
      return { label: 'PYQ Paper', icon: FileText, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
    default:
      return null;
  }
}

function getStatusBadgeConfig(status: DoubtStatus) {
  switch (status) {
    case 'open':
      return {
        label: 'Open',
        dotColor: 'bg-sky-500',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
      };
    case 'in_progress':
      return {
        label: 'Faculty Reviewing',
        dotColor: 'bg-amber-500 animate-pulse',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    case 'resolved':
      return {
        label: 'Resolved',
        dotColor: 'bg-emerald-500',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'archived':
      return {
        label: 'Archived',
        dotColor: 'bg-slate-400',
        badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
      };
    default:
      return {
        label: status,
        dotColor: 'bg-slate-400',
        badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
      };
  }
}

export default function StudentDoubtThreadPage() {
  const params = useParams();
  const router = useRouter();
  const doubtId = typeof params?.doubtId === 'string' ? params.doubtId : '';

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
        },
        onError: (err) => {
          setAcceptTargetReplyId(null);
          alert(doubtErrorMessage(err.message));
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
        },
        onError: (err) => {
          setResolveDialogOpen(false);
          alert(doubtErrorMessage(err.message));
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
        },
        onError: (err) => {
          setReopenDialogOpen(false);
          alert(doubtErrorMessage(err.message));
        },
      },
    );
  };

  // ── Loading Skeleton State ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-pulse">
        <div className="h-4 w-36 bg-slate-200 rounded-md" />
        <div className="flex items-center justify-between">
          <div className="h-8 w-72 bg-slate-200 rounded-xl" />
          <div className="h-8 w-28 bg-slate-200 rounded-full" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-48 bg-white rounded-3xl border border-slate-200 p-6" />
            <div className="h-36 bg-white rounded-3xl border border-slate-200 p-6" />
          </div>
          <div className="space-y-4">
            <div className="h-48 bg-white rounded-3xl border border-slate-200 p-6" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error / Not Found State ─────────────────────────────────────────
  if (isError || !doubt) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 sm:p-12 rounded-3xl bg-white border border-rose-100 shadow-xs text-center space-y-4">
        <div className="inline-flex p-3 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100">
          <WarningCircle size={32} weight="duotone" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-900">
          Doubt Not Found or Access Denied
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
          {error instanceof Error
            ? doubtErrorMessage(error.message)
            : "You don't have permission to view this question, or it may have been removed."}
        </p>
        <div className="pt-2">
          <Link
            href="/student/doubts"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-sm transition-colors"
          >
            <ArrowLeft size={14} weight="bold" />
            <span>Return to My Doubts</span>
          </Link>
        </div>
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
            <Link href="/student/overview">Student Hub</Link>
            <span aria-hidden="true">/</span>
            <Link href="/student/doubts">My Doubts</Link>
            <span aria-hidden="true">/</span>
            <span>Doubt Thread</span>
          </nav>
          <div className="flex items-center gap-2.5 flex-wrap mt-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Doubt Resolution Thread
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${statusConfig.badgeClass}`}
            >
              <span className={`h-2 w-2 rounded-full ${statusConfig.dotColor}`} />
              <span>{statusConfig.label}</span>
            </span>
            {doubt.reopenedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
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
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50"
          >
            <ArrowsClockwise
              size={18}
              weight="bold"
              className={isFetching ? 'animate-spin text-sky-600' : ''}
            />
          </button>

          {isActionable && (
            <button
              type="button"
              onClick={() => setResolveDialogOpen(true)}
              disabled={resolveMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors"
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
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-colors"
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
          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-xs space-y-4">
            {/* Category & Tags Row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border"
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
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${resourceBadge.color}`}
                  >
                    <resourceBadge.icon size={13} weight="bold" />
                    <span>{resourceBadge.label}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 text-xs text-slate-400 font-medium">
                <CalendarBlank size={14} />
                <span>Asked {formatDateTime(doubt.createdAt)}</span>
              </div>
            </div>

            {/* Question Title */}
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight leading-snug font-sans">
              {doubt.title}
            </h2>

            {/* Question Description */}
            <div className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-sans bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
              {doubt.description}
            </div>

            {/* Question Attachments */}
            {attachments.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
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
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <ChatText size={18} weight="duotone" className="text-sky-600" />
                <span>Discussion & Faculty Solutions ({replies.length})</span>
              </h3>
              {doubt.firstResponseAt && (
                <span className="text-[11px] text-slate-400 font-medium">
                  First reply {formatDateTime(doubt.firstResponseAt)}
                </span>
              )}
            </div>

            {replies.length === 0 ? (
              <div className="p-8 rounded-3xl bg-white border border-slate-200/80 text-center space-y-2 shadow-xs">
                <div className="inline-flex p-3 rounded-2xl bg-sky-50 text-sky-600">
                  <Clock size={24} weight="duotone" />
                </div>
                <p className="text-xs font-bold text-slate-800">
                  Awaiting Faculty Response
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
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
                      className={`rounded-2xl border p-5 transition-all shadow-xs ${
                        reply.isAcceptedAnswer
                          ? 'bg-emerald-50/40 border-emerald-300 ring-2 ring-emerald-500/20'
                          : isTeacher
                            ? 'bg-white border-emerald-100/90'
                            : isAdmin
                              ? 'bg-white border-purple-100/90'
                              : 'bg-white border-slate-200/80'
                      }`}
                    >
                      {/* Author Header Row */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold text-white shadow-xs ${
                              isTeacher
                                ? 'bg-emerald-600'
                                : isAdmin
                                  ? 'bg-purple-600'
                                  : 'bg-sky-600'
                            }`}
                          >
                            {(reply.authorName || (isTeacher ? 'T' : isStudent ? 'S' : 'A')).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-900">
                                {isStudent
                                  ? 'You (Student)'
                                  : reply.authorName || (isTeacher ? 'Faculty' : 'Academic Admin')}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                  isTeacher
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : isAdmin
                                      ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                      : 'bg-sky-50 text-sky-700 border border-sky-200'
                                }`}
                              >
                                {isTeacher ? 'Faculty' : isAdmin ? 'Admin' : 'Student'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400">
                              {formatDateTime(reply.createdAt)}
                            </p>
                          </div>
                        </div>

                        {/* Accepted Solution Badge or Action Button */}
                        <div>
                          {reply.isAcceptedAnswer ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shadow-xs">
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
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-50"
                              >
                                <Check size={13} weight="bold" />
                                <span>Accept Solution</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {/* Reply Text */}
                      <p className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-sans">
                        {reply.replyText}
                      </p>

                      {/* Reply Attachments */}
                      {reply.attachments && reply.attachments.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
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
          <div className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <PaperPlaneRight size={15} weight="duotone" className="text-sky-600" />
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
                  className="w-full rounded-2xl bg-slate-50 p-4 text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 border border-slate-200 outline-none focus:border-sky-500 focus:bg-white transition-all font-sans resize-none"
                />

                {replyError && (
                  <p className="text-xs font-semibold text-rose-600">
                    {replyError}
                  </p>
                )}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    {replyText.length} / 5000 characters
                  </span>

                  <button
                    type="button"
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white font-bold text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-md hover:-translate-y-0.5"
                  >
                    <PaperPlaneRight size={15} weight="bold" />
                    <span>{replyMutation.isPending ? 'Sending...' : 'Send Reply'}</span>
                  </button>
                </div>
              </>
            ) : doubt.status === 'resolved' ? (
              <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200 text-emerald-900 text-xs leading-relaxed">
                <p className="font-bold mb-1">This doubt is marked as resolved.</p>
                <p className="text-emerald-700">
                  If you still need further assistance, you can click <span className="font-bold text-emerald-800">Reopen Doubt</span> in the top header (up to 3 times).
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-600 text-xs">
                This doubt is archived and can no longer receive new replies.
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Col: Academic Context & Faculty Details Sidebar */}
        <div className="space-y-4">
          {/* Academic Context Card */}
          <div className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs">
            <StudentDoubtAcademicContext doubt={doubt} />
          </div>

          {/* Assigned Faculty Card */}
          <div className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Assigned Faculty
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-sm">
                <GraduationCap size={22} weight="duotone" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {doubt.assignedTeacherName || 'Faculty Assignment Pending'}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {doubt.assignedTeacherName ? 'Subject Faculty Solver' : 'Auto-routing in progress'}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Support Card */}
          <div className="rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50/70 to-blue-50/40 p-5 space-y-2">
            <div className="flex items-center gap-2 text-sky-900 text-xs font-bold">
              <Sparkle size={16} weight="fill" className="text-sky-600" />
              <span>Helpful Tip</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Once your doubt is solved satisfactorily, click <strong>Accept Solution</strong> on the faculty reply to mark the problem resolved.
            </p>
          </div>
        </div>
      </div>

      {/* ── Confirmation Dialogs ─────────────────────────────────────── */}
      {/* 1. Resolve Doubt Dialog */}
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

      {/* 2. Reopen Doubt Dialog */}
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

      {/* 3. Accept Solution Dialog */}
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
