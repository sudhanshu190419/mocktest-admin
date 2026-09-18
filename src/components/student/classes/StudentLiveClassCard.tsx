import React from 'react';
import Link from 'next/link';
import {
  Broadcast,
  Clock,
  Calendar,
  User,
  BookOpen,
  GraduationCap,
  Play,
  CheckCircle,
  XCircle,
  ArrowRight,
  Sparkle
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
      className={`group relative flex flex-col justify-between rounded-3xl bg-white border transition-all duration-200 hover:shadow-md ${
        isLive
          ? 'border-rose-200 shadow-xs ring-2 ring-rose-500/10'
          : 'border-slate-100 shadow-xs hover:border-slate-200'
      } p-5 sm:p-6`}
    >
      <div>
        {/* Top badges: Status & Subject */}
        <div className="flex items-center justify-between gap-2 mb-3.5">
          {/* Subject tag */}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${subjectColors.bg} ${subjectColors.text} ${subjectColors.border}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${subjectColors.badge}`} />
            <span>{item.subjectName}</span>
          </span>

          {/* Status badge */}
          {isLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-extrabold uppercase">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
              </span>
              <span>Live Now</span>
            </span>
          )}

          {isScheduled && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-bold">
              <Clock size={12} weight="bold" />
              <span>{relativeTime}</span>
            </span>
          )}

          {isCompleted && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
              <CheckCircle size={12} weight="bold" />
              <span>Completed</span>
            </span>
          )}

          {isCancelled && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 border border-rose-200 text-xs font-bold">
              <XCircle size={12} weight="bold" />
              <span>Cancelled</span>
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-base font-extrabold text-slate-900 group-hover:text-sky-600 transition-colors line-clamp-2 leading-snug">
          {item.title}
        </h3>

        {/* Chapter & Topic */}
        {(item.chapterName || item.topicName) && (
          <p className="mt-1.5 text-xs text-slate-500 line-clamp-1 font-medium">
            <span>{item.chapterName || 'General Topic'}</span>
            {item.topicName && <span className="text-slate-400 font-normal"> • {item.topicName}</span>}
          </p>
        )}

        {/* Batch indicator */}
        <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          <GraduationCap size={13} weight="bold" className="text-slate-400" />
          <span className="truncate">{item.batchName}</span>
        </div>

        {/* Meta rows */}
        <div className="mt-4 pt-3.5 border-t border-slate-100/80 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 min-w-0">
            <User size={14} weight="bold" className="text-slate-400 shrink-0" />
            <span className="truncate font-medium">{item.teacherName || 'Faculty'}</span>
          </div>

          <div className="flex items-center gap-1.5 min-w-0 justify-end">
            <Clock size={14} weight="bold" className="text-slate-400 shrink-0" />
            <span className="font-medium">{item.durationMin} mins</span>
          </div>

          <div className="col-span-2 flex items-center gap-1.5 text-slate-500 text-[11px]">
            <Calendar size={13} weight="bold" className="text-slate-400 shrink-0" />
            <span>{timeDisplay}</span>
          </div>
        </div>
      </div>

      {/* CTA Footer */}
      <div className="mt-5 pt-3 border-t border-slate-100">
        {isLive && (
          <Link
            href={`/student/classes/${item.classId}`}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs transition-colors shadow-sm active:scale-95"
          >
            <Broadcast size={15} weight="fill" className="animate-pulse" />
            <span>Join Class</span>
          </Link>
        )}

        {isScheduled && (
          <button
            type="button"
            disabled
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-400 font-bold text-xs cursor-not-allowed border border-slate-200/60"
          >
            <Clock size={14} weight="bold" />
            <span>Starts at {timeDisplay.split(', ')[1] || timeDisplay}</span>
          </button>
        )}

        {isCompleted && item.hasRecordingAvailable && (
          <Link
            href="/student/recordings"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold text-xs transition-colors border border-sky-200"
          >
            <Play size={14} weight="fill" />
            <span>Watch Recording</span>
          </Link>
        )}

        {isCompleted && !item.hasRecordingAvailable && (
          <div className="w-full text-center py-2 text-xs font-semibold text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
            Class Concluded
          </div>
        )}

        {isCancelled && (
          <div className="w-full text-center py-2 text-xs font-semibold text-rose-400 bg-rose-50/50 rounded-xl border border-rose-100">
            Session Cancelled
          </div>
        )}
      </div>
    </div>
  );
};
