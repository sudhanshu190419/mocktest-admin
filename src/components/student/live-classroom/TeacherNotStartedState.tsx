'use client';

import React from 'react';
import Link from 'next/link';
import { Broadcast, Clock, Calendar, ArrowLeft, User, ArrowsClockwise } from '@phosphor-icons/react';
import { formatClassTimeDisplay } from '@/services/student/studentLiveClassWebService';

interface TeacherNotStartedStateProps {
  title: string;
  subjectName: string;
  teacherName?: string | null;
  scheduledAt: string;
  durationMin: number;
  onRefresh?: () => void;
  isChecking?: boolean;
}

export const TeacherNotStartedState: React.FC<TeacherNotStartedStateProps> = ({
  title,
  subjectName,
  teacherName,
  scheduledAt,
  durationMin,
  onRefresh,
  isChecking,
}) => {
  const timeDisplay = formatClassTimeDisplay(scheduledAt);

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="max-w-lg w-full p-8 sm:p-10 rounded-3xl bg-ink border border-ink text-center text-white space-y-6 shadow-2xl">
        <div className="relative w-16 h-16 rounded-3xl bg-brand/20 text-sky-ink flex items-center justify-center mx-auto border border-brand/30">
          <Broadcast size={30} weight="duotone" className="text-sky-ink" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 text-xs font-bold uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            <span>Waiting for Instructor</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white leading-snug">
            {title}
          </h2>
          <p className="text-xs sm:text-sm text-ink-muted font-medium">
            {subjectName} {teacherName ? `• ${teacherName}` : ''}
          </p>
        </div>

        {/* Schedule box */}
        <div className="p-4 rounded-2xl bg-ink/60 border border-ink/60 grid grid-cols-2 gap-3 text-xs text-ink-muted text-left">
          <div className="flex items-center gap-2">
            <Calendar size={15} weight="bold" className="text-ink-muted" />
            <span>{timeDisplay}</span>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Clock size={15} weight="bold" className="text-ink-muted" />
            <span>{durationMin} mins</span>
          </div>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed max-w-md mx-auto">
          The instructor has not started broadcasting yet. You will connect automatically as soon as the live stream begins.
        </p>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isChecking}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand hover:bg-brand text-white font-bold text-xs transition-colors shadow-md disabled:opacity-50"
            >
              <ArrowsClockwise size={14} weight="bold" className={isChecking ? 'animate-spin' : ''} />
              <span>{isChecking ? 'Checking...' : 'Check Live Status'}</span>
            </button>
          )}

          <Link
            href="/student/classes"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-ink hover:bg-ink text-ink-muted font-bold text-xs transition-colors border border-ink"
          >
            <ArrowLeft size={14} weight="bold" />
            <span>Back to Classes</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
