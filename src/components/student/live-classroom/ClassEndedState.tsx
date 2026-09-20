'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle, Play, ArrowLeft } from '@phosphor-icons/react';

interface ClassEndedStateProps {
  title: string;
  subjectName: string;
  teacherName?: string | null;
  hasRecording?: boolean;
}

export const ClassEndedState: React.FC<ClassEndedStateProps> = ({
  title,
  subjectName,
  teacherName,
  hasRecording,
}) => {
  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="max-w-lg w-full p-8 sm:p-10 rounded-3xl bg-ink border border-ink text-center text-white space-y-5 shadow-2xl">
        <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
          <CheckCircle size={32} weight="fill" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-bold uppercase tracking-wider">
            Lecture Concluded
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white leading-snug">
            {title}
          </h2>
          <p className="text-xs sm:text-sm text-ink-muted font-medium">
            {subjectName} • {teacherName || 'Faculty'}
          </p>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed max-w-md mx-auto">
          This live lecture has concluded. Your attendance was recorded automatically via the classroom session.
        </p>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/student/classes"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-ink hover:bg-ink text-white font-bold text-xs transition-colors border border-ink"
          >
            <ArrowLeft size={14} weight="bold" />
            <span>Return to Classes</span>
          </Link>

          {hasRecording && (
            <Link
              href="/student/recordings"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-brand hover:bg-brand text-white font-bold text-xs transition-colors shadow-lg shadow-card"
            >
              <Play size={14} weight="fill" />
              <span>Watch Recording</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
