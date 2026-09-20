'use client';

import React from 'react';
import {
  BookmarkSimple,
  ArrowLeft,
  ArrowRight,
  Trash,
} from '@phosphor-icons/react';

interface QuestionActionsProps {
  currentIndex: number;
  totalQuestions: number;
  isMarkedForReview: boolean;
  onClear: () => void;
  onToggleReview: () => void;
  onPrevious: () => void;
  onSaveAndNext: () => void;
  disabled?: boolean;
}

export const QuestionActions: React.FC<QuestionActionsProps> = ({
  currentIndex,
  totalQuestions,
  isMarkedForReview,
  onClear,
  onToggleReview,
  onPrevious,
  onSaveAndNext,
  disabled = false,
}) => {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalQuestions - 1;

  return (
    <div className="sticky bottom-0 z-20 bg-white border-t border-line shadow-lg px-4 sm:px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left Actions: Clear Response & Mark for Review & Next */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 sm:px-4 py-2 bg-paper hover:bg-sky-tint text-ink text-xs sm:text-sm font-semibold rounded-field border border-line transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash size={16} weight="bold" className="text-ink-secondary" />
            <span>Clear Response</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onToggleReview}
            className={`flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-field border transition-colors cursor-pointer disabled:opacity-50 ${
              isMarkedForReview
                ? 'bg-lilac text-lilac-ink border-lilac-ink/40 font-bold'
                : 'bg-white hover:bg-lilac/30 text-lilac-ink border-lilac-ink/30'
            }`}
            title="Mark question for review and move to next"
          >
            <BookmarkSimple size={16} weight={isMarkedForReview ? 'fill' : 'bold'} />
            <span>Mark for Review & Next</span>
          </button>
        </div>

        {/* Right Actions: Previous & Save & Next */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={isFirst || disabled}
            onClick={onPrevious}
            className="flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 bg-white hover:bg-paper text-ink text-xs sm:text-sm font-semibold rounded-field border border-line transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={16} weight="bold" />
            <span>Previous</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onSaveAndNext}
            className="flex items-center justify-center gap-1.5 min-h-[44px] px-5 sm:px-6 py-2 bg-brand hover:bg-brand-hover text-white text-xs sm:text-sm font-bold rounded-field shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <span>{isLast ? 'Save & Next' : 'Save & Next'}</span>
            <ArrowRight size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
};
