'use client';

import React from 'react';
import {
  BookmarkSimple,
  ArrowLeft,
  ArrowRight,
  Trash,
  Check,
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
    <div className="sticky bottom-0 z-20 bg-white border-t border-slate-200 shadow-lg px-4 sm:px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left Actions: Clear & Mark for Review */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold rounded-xl border border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash size={16} weight="bold" className="text-slate-500" />
            <span>Clear Response</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onToggleReview}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl border transition-colors cursor-pointer disabled:opacity-50 ${
              isMarkedForReview
                ? 'bg-purple-100 text-purple-800 border-purple-300'
                : 'bg-white hover:bg-purple-50 text-purple-700 border-purple-200'
            }`}
          >
            <BookmarkSimple size={16} weight={isMarkedForReview ? 'fill' : 'bold'} />
            <span>{isMarkedForReview ? 'Marked for Review' : 'Mark for Review'}</span>
          </button>
        </div>

        {/* Right Actions: Previous & Save & Next */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={isFirst || disabled}
            onClick={onPrevious}
            className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs sm:text-sm font-semibold rounded-xl border border-slate-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={16} weight="bold" />
            <span>Previous</span>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onSaveAndNext}
            className="flex items-center gap-1.5 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <span>{isLast ? 'Save & Complete' : 'Save & Next'}</span>
            <ArrowRight size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
};
