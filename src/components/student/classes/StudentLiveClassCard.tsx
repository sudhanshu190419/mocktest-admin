import React from 'react';
import Link from 'next/link';
import {
  Broadcast,
  Clock,
  Calendar,
  User,
  GraduationCap,
  Play,
  CheckCircle,
  XCircle,
} from '@phosphor-icons/react';
import type { StudentLiveClassItem } from '@/services/student/studentLiveClassWebService';
import {
  formatClassTimeDisplay,
  formatRelativeClassTime,
  getClassSubjectColor,
} from '@/services/student/studentLiveClassWebService';

interface StudentLiveClassCardProps {
  item: StudentLiveClassItem;
}

export const StudentLiveClassCard: React.FC<StudentLiveClassCardProps> = ({ item }) => {
  const subjectColors = getClassSubjectColor(item.subjectName);
  const timeDisplay = formatClassTimeDisplay(item.scheduledAt);
  const relativeTime = formatRelativeClassTime(item.scheduledAt, item.status);

  const isLive = item.status === 'live';
  const isScheduled = item.status === 'scheduled';
  const isCompleted = item.status === 'completed';
  const isCancelled = item.status === 'cancelled';

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-card bg-surface border transition-all duration-200 hover:shadow-card-hover ${
        isLive
          ? 'border-rose-300 shadow-card ring-1 ring-rose-500/20'
          : 'border-line shadow-card hover:border-line'
      } p-5 sm:p-6`}
    >
      <div>
        {/* Top badges: Status & Subject */}
        <div className="flex items-center justify-between gap-2 mb-3.5">
          {/* Subject tag */}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-field text-caption font-bold border ${subjectColors.bg} ${subjectColors.text} ${subjectColors.border}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${subjectColors.badge}`} />
            <span>{item.subjectName}</span>
          </span>

          {/* Status badge */}
          {isLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-caption font-extrabold uppercase">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
              </span>
              <span>Live Now</span>
            </span>
          )}

          {isScheduled && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-tint text-brand-hover border border-line text-caption font-bold">
              <Clock size={12} weight="bold" />
              <span>{relativeTime}</span>
            </span>
          )}

          {isCompleted && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-mint-tint text-mint-ink border border-emerald-200 text-caption font-bold">
              <CheckCircle size={12} weight="bold" />
              <span>Completed</span>
            </span>
          )}

          {isCancelled && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 border border-rose-200 text-caption font-bold">
              <XCircle size={12} weight="bold" />
              <span>Cancelled</span>
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-h3 font-extrabold text-ink group-hover:text-brand transition-colors line-clamp-2 leading-snug">
          {item.title}
        </h3>

        {/* Chapter & Topic */}
        {(item.chapterName || item.topicName) && (
          <p className="mt-1.5 text-body text-ink-secondary line-clamp-1 font-medium">
            <span>{item.chapterName || 'General Topic'}</span>
            {item.topicName && <span className="text-ink-muted font-normal"> · {item.topicName}</span>}
          </p>
        )}

        {/* Batch indicator */}
        <div className="mt-3 flex items-center gap-1.5 text-caption font-semibold text-ink-secondary">
          <GraduationCap size={13} weight="bold" className="text-ink-muted" />
          <span className="truncate">{item.batchName}</span>
        </div>

        {/* Meta rows */}
        <div className="mt-4 pt-3.5 border-t border-line grid grid-cols-2 gap-2 text-body text-ink-secondary">
          <div className="flex items-center gap-1.5 min-w-0">
            <User size={14} weight="bold" className="text-ink-muted shrink-0" />
            <span className="truncate font-medium">{item.teacherName || 'Faculty'}</span>
          </div>

          <div className="flex items-center gap-1.5 min-w-0 justify-end">
            <Clock size={14} weight="bold" className="text-ink-muted shrink-0" />
            <span className="font-medium">{item.durationMin} mins</span>
          </div>

          <div className="col-span-2 flex items-center gap-1.5 text-ink-secondary text-caption">
            <Calendar size={13} weight="bold" className="text-ink-muted shrink-0" />
            <span>{timeDisplay}</span>
          </div>
        </div>
      </div>

      {/* CTA Footer (≥44px hit-height) */}
      <div className="mt-5 pt-3 border-t border-line">
        {isLive && (
          <Link
            href={`/student/classes/${item.classId}`}
            className="w-full inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 rounded-field bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-body transition-colors shadow-xs active:scale-[0.98]"
          >
            <Broadcast size={15} weight="fill" />
            <span>Join Class</span>
          </Link>
        )}

        {isScheduled && (
          <button
            type="button"
            disabled
            className="w-full inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 rounded-field bg-paper text-ink-secondary font-bold text-body cursor-not-allowed border border-line"
          >
            <Clock size={14} weight="bold" />
            <span>Starts at {timeDisplay.split(', ')[1] || timeDisplay}</span>
          </button>
        )}

        {isCompleted && item.hasRecordingAvailable && (
          <Link
            href="/student/recordings"
            className="w-full inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2.5 rounded-field bg-sky-tint hover:bg-sky-tint text-brand-hover font-bold text-body transition-colors border border-line"
          >
            <Play size={14} weight="fill" />
            <span>Watch Recording</span>
          </Link>
        )}

        {isCompleted && !item.hasRecordingAvailable && (
          <div className="w-full min-h-[44px] flex items-center justify-center py-2 text-body font-semibold text-ink-secondary bg-paper rounded-field border border-line">
            Class Concluded
          </div>
        )}

        {isCancelled && (
          <div className="w-full min-h-[44px] flex items-center justify-center py-2 text-body font-semibold text-rose-600 bg-rose-50 rounded-field border border-rose-200">
            Session Cancelled
          </div>
        )}
      </div>
    </div>
  );
};
