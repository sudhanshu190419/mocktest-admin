'use client';

import React, { useState, useEffect } from 'react';
import { BookmarkSimple, MagnifyingGlassPlus, X } from '@phosphor-icons/react';
import type { RunnerQuestion } from '@/services/student/studentTestWebService';
import { AnswerOptions } from './AnswerOptions';

interface QuestionDisplayProps {
  question: RunnerQuestion;
  totalQuestions: number;
  selectedOption: string | string[] | null;
  onOptionChange: (val: string | string[]) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
}

export const QuestionDisplay: React.FC<QuestionDisplayProps> = ({
  question,
  totalQuestions,
  selectedOption,
  onOptionChange,
  isBookmarked,
  onToggleBookmark,
}) => {
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  useEffect(() => {
    if (!zoomedImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomedImage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomedImage]);

  const getQuestionTypeLabel = (type: string) => {
    switch (type) {
      case 'msq':
        return 'Multiple Correct';
      case 'numerical':
        return 'Numerical Value';
      case 'true_false':
        return 'True / False';
      case 'subjective':
      case 'text_based':
        return 'Subjective';
      default:
        return 'Single Correct';
    }
  };

  return (
    <div className="bg-white rounded-card border border-line shadow-xs overflow-hidden flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 bg-paper border-b border-line">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="px-3 py-1 bg-brand text-white font-bold text-caption sm:text-sm rounded-field shadow-xs">
            Question {question.index}
          </span>
          <span className="text-caption sm:text-sm text-ink-secondary font-semibold">
            of {totalQuestions}
          </span>
          {question.sectionName && (
            <span className="hidden sm:inline-block px-2.5 py-0.5 bg-sky-tint text-ink text-caption font-semibold rounded-field">
              {question.sectionName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Scoring Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-mint text-mint-ink border border-mint-ink/30 rounded-field text-caption font-bold tabular-nums">
            <span>+{question.marks}</span>
            {question.negativeMarks > 0 && (
              <span className="text-rose-700">/-{question.negativeMarks}</span>
            )}
          </div>

          {/* Type Badge */}
          <span className="hidden md:inline px-2.5 py-1 bg-paper text-ink-secondary text-caption font-medium rounded-field border border-line">
            {getQuestionTypeLabel(question.questionType)}
          </span>

          {/* Bookmark Button */}
          <button
            type="button"
            onClick={onToggleBookmark}
            className={`min-h-[44px] min-w-[44px] p-2 rounded-field border transition-colors cursor-pointer flex items-center justify-center ${
              isBookmarked
                ? 'bg-amber-100 text-amber-900 border-amber-300'
                : 'bg-white hover:bg-paper text-ink-secondary border-line'
            }`}
            title={isBookmarked ? 'Bookmarked' : 'Bookmark Question'}
            aria-label="Bookmark"
          >
            <BookmarkSimple size={18} weight={isBookmarked ? 'fill' : 'bold'} />
          </button>
        </div>
      </div>

      {/* Main Question Stem & Options */}
      <div className="p-5 sm:p-7 flex flex-col gap-6">
        {/* Question Stem (16px / 26px typography on reading scale) */}
        <div className="text-[16px] leading-[26px] text-ink font-medium whitespace-pre-line">
          {question.text || 'Question content'}
        </div>

        {/* Question Stem Image (if present) */}
        {question.imageUrl && (
          <div className="relative group max-w-xl rounded-field overflow-hidden border border-line bg-paper p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={question.imageUrl}
              alt={question.imageAlt || 'Question diagram'}
              className="max-h-80 w-auto object-contain rounded-md"
              loading="lazy"
            />
            <button
              type="button"
              onClick={() => setZoomedImage(question.imageUrl!)}
              className="absolute bottom-3 right-3 p-2 bg-ink/80 hover:bg-ink text-white rounded-field opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-caption font-semibold cursor-pointer"
            >
              <MagnifyingGlassPlus size={14} weight="bold" />
              <span>Expand</span>
            </button>
          </div>
        )}

        {/* Answer Options Area */}
        <div className="mt-2 pt-4 border-t border-line">
          <AnswerOptions
            questionType={question.questionType}
            options={question.options}
            value={selectedOption}
            onChange={onOptionChange}
          />
        </div>
      </div>

      {/* Zoom Modal */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-4 rounded-sheet shadow-dialog overflow-auto">
            <button
              type="button"
              onClick={() => setZoomedImage(null)}
              className="absolute top-4 right-4 p-2 bg-ink text-white rounded-full hover:bg-ink/80 transition-colors"
              aria-label="Close zoomed image"
            >
              <X size={18} weight="bold" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoomedImage} alt="Expanded diagram" className="max-h-[80vh] w-auto object-contain" />
          </div>
        </div>
      )}
    </div>
  );
};
