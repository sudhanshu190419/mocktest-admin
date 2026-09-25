'use client';

import React from 'react';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';

interface ReviewActionsProps {
  currentIndex: number;
  totalQuestions: number;
  onPrevious: () => void;
  onNext: () => void;
}

export const ReviewActions: React.FC<ReviewActionsProps> = ({
  currentIndex,
  totalQuestions,
  onPrevious,
  onNext,
}) => {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalQuestions - 1;

  return (
    <div className="sticky bottom-0 z-30 bg-white/95 backdrop-blur-md border-t border-line py-3.5 px-4 sm:px-6 shadow-md flex items-center justify-between">
      <button
        type="button"
        onClick={onPrevious}
        disabled={isFirst}
        className="flex items-center gap-1.5 px-4 py-2 rounded-field text-xs sm:text-sm font-bold bg-paper hover:bg-sky-tint text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <ArrowLeft size={16} weight="bold" />
        <span>Previous</span>
      </button>

      <span className="text-xs font-bold text-ink-secondary">
        Question {currentIndex + 1} of {totalQuestions}
      </span>

      <button
        type="button"
        onClick={onNext}
        disabled={isLast}
        className="flex items-center gap-1.5 px-4 py-2 rounded-field text-xs sm:text-sm font-bold bg-brand hover:bg-brand-hover text-white shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <span>Next</span>
        <ArrowRight size={16} weight="bold" />
      </button>
    </div>
  );
};
