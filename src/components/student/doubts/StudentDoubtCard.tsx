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
    return date.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return 'recently';
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
 * PRD §7.2 Standard Status Vocabulary:
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
      className="group relative flex flex-col justify-between rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card transition-all duration-200 hover:border-line hover:shadow-card-hover"
      aria-label={`View doubt: ${doubt.title}`}
    >
      <div>
        {/* Top Header Row: Subject Pill + Status Badge */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-field text-caption font-bold border"
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
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-field text-caption font-bold border ${resourceBadge.color}`}
              >
                <resourceBadge.icon size={12} weight="bold" />
                <span>{resourceBadge.label}</span>
              </span>
            )}

            {doubt.reopenedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-field text-caption font-bold bg-sand text-sand-ink border border-amber-200">
                <ArrowsClockwise size={11} weight="bold" />
                <span>Reopened ({doubt.reopenedCount}/3)</span>
              </span>
            )}
          </div>

          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-bold border shrink-0 ${statusConfig.badgeClass}`}
          >
            <span className={`h-2 w-2 rounded-full ${statusConfig.dotColor}`} />
            <span>{statusConfig.label}</span>
          </div>
        </div>

        {/* Academic Hierarchy Breadcrumb */}
        {hierarchyText && (
          <p className="text-caption font-medium text-ink-muted mb-1.5 truncate">
            {hierarchyText}
          </p>
        )}

        {/* Title */}
        <h3 className="text-h3 font-bold text-ink group-hover:text-brand transition-colors line-clamp-1 mb-1.5">
          {doubt.title}
        </h3>

        {/* Description Snippet */}
        <p className="text-body text-ink-secondary line-clamp-2 leading-relaxed mb-4">
          {doubt.description}
        </p>
      </div>

      {/* Card Footer: Metadata & Response Indicators */}
      <div className="pt-3 border-t border-line flex items-center justify-between gap-3 text-caption text-ink-secondary">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {/* Replies Pill */}
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              replyCount > 0 ? 'text-brand-hover' : 'text-ink-muted'
            }`}
          >
            <ChatText size={15} weight={replyCount > 0 ? 'fill' : 'regular'} />
            <span>{replyCount > 0 ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : 'No replies yet'}</span>
          </span>

          {/* Attachments Indicator */}
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-ink-secondary font-medium" title={`${attachmentCount} attached file(s)`}>
              <Paperclip size={14} weight="bold" />
              <span>{attachmentCount}</span>
            </span>
          )}

          {/* Assigned Faculty */}
          {doubt.assignedTeacherName && (
            <span className="inline-flex items-center gap-1 text-ink-secondary font-medium truncate max-w-[140px]" title={`Assigned Faculty: ${doubt.assignedTeacherName}`}>
              <User size={13} weight="bold" className="text-ink-muted shrink-0" />
              <span className="truncate">{doubt.assignedTeacherName}</span>
            </span>
          )}
        </div>

        {/* Date + Action Icon */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-caption text-ink-muted font-medium">
            <CalendarBlank size={13} />
            <span>{formatRelativeDate(doubt.createdAt)}</span>
          </span>
          <CaretRight size={14} weight="bold" className="text-ink-muted group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </Link>
  );
};
