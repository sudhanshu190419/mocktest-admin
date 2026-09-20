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
    <div className="flex items-center justify-between gap-4 flex-wrap bg-white rounded-2xl p-4 sm:p-5 border border-line shadow-sm">
      <Link
        href="/student/tests"
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-ink hover:text-ink hover:bg-paper transition-colors"
      >
        <ArrowLeft size={16} weight="bold" />
        <span>Back to Tests</span>
      </Link>

      <div className="flex items-center gap-3 flex-wrap">
        {canRetake && (
          <Link
            href={`/student/tests/${testId}`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-paper hover:bg-sky-tint text-ink transition-colors"
          >
            <ArrowCounterClockwise size={16} weight="bold" />
            <span>Retake Test</span>
          </Link>
        )}

        <Link
          href={`/student/tests/${testId}/results/${attemptId}/review`}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-brand hover:bg-brand-hover text-white shadow-md shadow-card transition-all cursor-pointer"
        >
          <BookOpen size={18} weight="bold" />
          <span>Review Detailed Solutions</span>
        </Link>
      </div>
    </div>
  );
};
