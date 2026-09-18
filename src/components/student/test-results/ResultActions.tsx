'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, ArrowLeft, ArrowCounterClockwise } from '@phosphor-icons/react';

interface ResultActionsProps {
  testId: string;
  attemptId: string;
  canRetake?: boolean;
}

export const ResultActions: React.FC<ResultActionsProps> = ({
  testId,
  attemptId,
  canRetake = false,
}) => {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm">
      <Link
        href="/student/tests"
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
      >
        <ArrowLeft size={16} weight="bold" />
        <span>Back to Tests</span>
      </Link>

      <div className="flex items-center gap-3 flex-wrap">
        {canRetake && (
          <Link
            href={`/student/tests/${testId}`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
          >
            <ArrowCounterClockwise size={16} weight="bold" />
            <span>Retake Test</span>
          </Link>
        )}

        <Link
          href={`/student/tests/${testId}/results/${attemptId}/review`}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-950/20 transition-all cursor-pointer"
        >
          <BookOpen size={18} weight="bold" />
          <span>Review Detailed Solutions</span>
        </Link>
      </div>
    </div>
  );
};
