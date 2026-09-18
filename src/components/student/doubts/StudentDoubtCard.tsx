'use client';

import React from 'react';
import Link from 'next/link';
import {
  ChatText,
  Paperclip,
  User,
  CalendarBlank,
  CaretRight,
  VideoCamera,
  FileText,
  Exam,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import type { StudentDoubt, DoubtStatus, DoubtResourceType } from '@/types/doubt';
import { getSubjectColor, getSubjectEmoji } from '@/services/student/studentCourseWebService';

interface StudentDoubtCardProps {
  doubt: StudentDoubt;
}

function formatRelativeDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  } catch {
    return 'recently';
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

export const StudentDoubtCard: React.FC<StudentDoubtCardProps> = ({ doubt }) => {
  const subjectName = doubt.subjectName || 'Academic Question';
  const subjectColor = getSubjectColor(subjectName);
  const subjectEmoji = getSubjectEmoji(subjectName);
  const statusConfig = getStatusBadgeConfig(doubt.status);
  const resourceBadge = getResourceBadge(doubt.relatedResourceType);

  const replyCount = doubt.replies?.length ?? 0;
  const attachmentCount = (doubt.attachments?.length ?? 0) + (doubt.imageUrl ? 1 : 0);

  const academicBreadcrumbs = [
    doubt.courseName,
    doubt.batchName,
    doubt.chapterName,
    doubt.topicName,
  ].filter(Boolean);

  const hierarchyText = academicBreadcrumbs.length > 0 ? academicBreadcrumbs.join(' • ') : null;

  return (
    <Link
      href={`/student/doubts/${doubt.doubtId}`}
      className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
      aria-label={`View doubt: ${doubt.title}`}
    >
      <div>
        {/* Top Header Row: Subject Pill + Status Badge */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border"
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
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${resourceBadge.color}`}
              >
                <resourceBadge.icon size={12} weight="bold" />
                <span>{resourceBadge.label}</span>
              </span>
            )}

            {doubt.reopenedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                <ArrowsClockwise size={11} weight="bold" />
                <span>Reopened ({doubt.reopenedCount}/3)</span>
              </span>
            )}
          </div>

          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border shrink-0 ${statusConfig.badgeClass}`}
          >
            <span className={`h-2 w-2 rounded-full ${statusConfig.dotColor}`} />
            <span>{statusConfig.label}</span>
          </div>
        </div>

        {/* Academic Hierarchy Breadcrumb */}
        {hierarchyText && (
          <p className="text-[11px] font-medium text-slate-400 mb-1.5 truncate">
            {hierarchyText}
          </p>
        )}

        {/* Title */}
        <h3 className="text-sm font-bold text-slate-900 group-hover:text-sky-600 transition-colors line-clamp-1 mb-1.5">
          {doubt.title}
        </h3>

        {/* Description Snippet */}
        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed mb-4">
          {doubt.description}
        </p>
      </div>

      {/* Card Footer: Metadata & Response Indicators */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3 text-xs text-slate-500">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {/* Replies Pill */}
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              replyCount > 0 ? 'text-sky-700' : 'text-slate-400'
            }`}
          >
            <ChatText size={15} weight={replyCount > 0 ? 'fill' : 'regular'} />
            <span>{replyCount > 0 ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : 'No replies yet'}</span>
          </span>

          {/* Attachments Indicator */}
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-slate-500 font-medium" title={`${attachmentCount} attached file(s)`}>
              <Paperclip size={14} weight="bold" />
              <span>{attachmentCount}</span>
            </span>
          )}

          {/* Assigned Faculty */}
          {doubt.assignedTeacherName && (
            <span className="inline-flex items-center gap-1 text-slate-600 font-medium truncate max-w-[140px]" title={`Assigned Faculty: ${doubt.assignedTeacherName}`}
            >
              <User size={13} weight="bold" className="text-slate-400 shrink-0" />
              <span className="truncate">{doubt.assignedTeacherName}</span>
            </span>
          )}
        </div>

        {/* Date + Action Icon */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
            <CalendarBlank size={13} />
            <span>{formatRelativeDate(doubt.createdAt)}</span>
          </span>
          <CaretRight size={14} weight="bold" className="text-slate-400 group-hover:text-sky-600 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </Link>
  );
};
