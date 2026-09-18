import React from 'react';
import Link from 'next/link';
import {
  Broadcast,
  User,
  Clock,
  Calendar,
  ArrowRight,
  BookOpen,
  GraduationCap
} from '@phosphor-icons/react';
import type { StudentLiveClassItem } from '@/services/student/studentLiveClassWebService';
import {
  formatClassTimeDisplay,
  formatRelativeClassTime,
  getClassSubjectColor,
} from '@/services/student/studentLiveClassWebService';

interface LiveNowHeroCardProps {
  item: StudentLiveClassItem;
}

export const LiveNowHeroCard: React.FC<LiveNowHeroCardProps> = ({ item }) => {
  const subjectColors = getClassSubjectColor(item.subjectName);
  const timeDisplay = formatClassTimeDisplay(item.scheduledAt);
  const relativeTime = formatRelativeClassTime(item.scheduledAt, item.status);

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 sm:p-8 text-white shadow-xl border border-slate-700/50">
      {/* Decorative ambient background glows */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-rose-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-indigo-500/15 blur-3xl" />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        {/* Left column: Badge, Title, Meta */}
        <div className="space-y-4 max-w-2xl">
          {/* Status badge row */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-black tracking-wide uppercase shadow-xs">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
              </span>
              <span>LIVE NOW</span>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-semibold backdrop-blur-xs border border-white/10">
              <BookOpen size={13} weight="bold" />
              <span>{item.subjectName}</span>
            </span>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-200 text-xs font-medium border border-indigo-400/20">
              <GraduationCap size={13} weight="bold" />
              <span>{item.batchName}</span>
            </span>
          </div>

          {/* Title */}
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-snug">
              {item.title}
            </h2>
            {(item.chapterName || item.topicName) && (
              <p className="mt-1 text-xs sm:text-sm text-slate-300 font-medium flex items-center gap-2">
                <span>{item.chapterName || 'General Chapter'}</span>
                {item.topicName && (
                  <>
                    <span className="text-slate-500">•</span>
                    <span className="text-slate-400">{item.topicName}</span>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Meta specs row */}
          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-slate-300">
            {item.teacherName && (
              <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                <User size={15} weight="bold" className="text-indigo-400" />
                <span>{item.teacherName}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-slate-300">
              <Calendar size={15} weight="bold" className="text-slate-400" />
              <span>{timeDisplay}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <Clock size={15} weight="bold" className="text-slate-400" />
              <span>{item.durationMin} mins</span>
            </div>
            <div className="flex items-center gap-1.5 text-rose-300 font-medium">
              <Broadcast size={15} weight="fill" className="text-rose-400" />
              <span>{relativeTime}</span>
            </div>
          </div>
        </div>

        {/* Right column: CTA button */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-3 shrink-0">
          <Link
            href={`/student/classes/${item.classId}`}
            className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-black text-sm transition-all duration-200 shadow-lg shadow-rose-600/30 active:scale-95 group"
          >
            <Broadcast size={18} weight="fill" className="animate-pulse" />
            <span>Join Live Class</span>
            <ArrowRight size={16} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <p className="text-[11px] text-slate-400 text-center lg:text-right font-medium">
            Room is active • Live interaction enabled
          </p>
        </div>
      </div>
    </div>
  );
};
