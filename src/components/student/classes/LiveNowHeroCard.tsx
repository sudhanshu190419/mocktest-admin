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
  const timeDisplay = formatClassTimeDisplay(item.scheduledAt);
  const relativeTime = formatRelativeClassTime(item.scheduledAt, item.status);

  return (
    <div className="relative overflow-hidden rounded-card bg-surface p-6 sm:p-7 text-ink shadow-card border border-line">
      {/* Subtle top indicator bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        {/* Left column: Badge, Title, Meta */}
        <div className="space-y-3.5 max-w-2xl">
          {/* Status badge row */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-caption font-black tracking-wide uppercase">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
              </span>
              <span>LIVE NOW</span>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-tint text-brand-hover text-caption font-bold border border-line">
              <BookOpen size={13} weight="duotone" />
              <span>{item.subjectName}</span>
            </span>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-paper text-ink-secondary text-caption font-semibold border border-line">
              <GraduationCap size={13} weight="duotone" />
              <span>{item.batchName}</span>
            </span>
          </div>

          {/* Title */}
          <div>
            <h2 className="text-xl sm:text-h2 font-extrabold text-ink tracking-tight leading-snug">
              {item.title}
            </h2>
            {(item.chapterName || item.topicName) && (
              <p className="mt-1 text-body text-ink-secondary font-medium flex items-center gap-2">
                <span>{item.chapterName || 'General Chapter'}</span>
                {item.topicName && (
                  <>
                    <span className="text-ink-muted">•</span>
                    <span>{item.topicName}</span>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Meta specs row */}
          <div className="flex flex-wrap items-center gap-4 text-body text-ink-secondary">
            {item.teacherName && (
              <div className="flex items-center gap-1.5 font-medium">
                <User size={15} weight="duotone" className="text-brand" />
                <span>{item.teacherName}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Calendar size={15} weight="duotone" className="text-ink-muted" />
              <span>{timeDisplay}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock size={15} weight="duotone" className="text-ink-muted" />
              <span>{item.durationMin} mins</span>
            </div>
            <div className="flex items-center gap-1.5 text-rose-600 font-semibold">
              <Broadcast size={15} weight="fill" className="text-rose-500" />
              <span>{relativeTime}</span>
            </div>
          </div>
        </div>

        {/* Right column: CTA button (≥44px) */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 shrink-0">
          <Link
            href={`/student/classes/${item.classId}`}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 px-6 py-3 rounded-field bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-body transition-all shadow-xs active:scale-[0.98] group"
          >
            <Broadcast size={18} weight="fill" />
            <span>Join Live Class</span>
            <ArrowRight size={16} weight="bold" className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <p className="text-caption text-ink-secondary text-center lg:text-right font-medium">
            Room is active · Live interaction enabled
          </p>
        </div>
      </div>
    </div>
  );
};
