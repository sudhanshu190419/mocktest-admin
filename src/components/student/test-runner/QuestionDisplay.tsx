'use client';

import React, { useState } from 'react';
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-sky-600 text-white font-bold text-xs sm:text-sm rounded-lg shadow-xs">
            Question {question.index}
          </span>
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">
            of {totalQuestions}
          </span>
          {question.sectionName && (
            <span className="px-2.5 py-0.5 bg-slate-200 text-slate-700 text-xs font-semibold rounded-md">
              {question.sectionName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Scoring Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-bold">
            <span>+{question.marks}</span>
            {question.negativeMarks > 0 && (
              <span className="text-rose-700">/-{question.negativeMarks}</span>
            )}
          </div>

          {/* Type Badge */}
          <span className="hidden md:inline px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg border border-slate-200">
            {getQuestionTypeLabel(question.questionType)}
          </span>

          {/* Bookmark Button */}
          <button
            onClick={onToggleBookmark}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isBookmarked
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-white hover:bg-slate-100 text-slate-400 border-slate-200'
            }`}
            title={isBookmarked ? 'Bookmarked' : 'Bookmark Question'}
            aria-label="Bookmark"
          >
            <BookmarkSimple size={16} weight={isBookmarked ? 'fill' : 'bold'} />
          </button>
        </div>
      </div>

      {/* Main Question Stem & Options */}
      <div className="p-5 sm:p-7 flex flex-col gap-6">
        {/* Question Text */}
        <div className="text-base sm:text-lg text-slate-900 font-medium leading-relaxed whitespace-pre-line">
          {question.text || 'Question content'}
        </div>

        {/* Question Stem Image (if present) */}
        {question.imageUrl && (
          <div className="relative group max-w-xl rounded-xl overflow-hidden border border-slate-200 bg-slate-50 p-2">
            <img
              src={question.imageUrl}
              alt={question.imageAlt || 'Question diagram'}
              className="max-h-80 w-auto object-contain rounded-lg"
              loading="lazy"
            />
            <button
              onClick={() => setZoomedImage(question.imageUrl!)}
              className="absolute bottom-3 right-3 p-2 bg-slate-900/70 hover:bg-slate-900 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs font-semibold cursor-pointer"
            >
              <MagnifyingGlassPlus size={14} weight="bold" />
              <span>Expand</span>
            </button>
          </div>
        )}

        {/* Answer Options Area */}
        <div className="mt-2 pt-4 border-t border-slate-100">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-4 rounded-2xl shadow-2xl overflow-auto">
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-4 right-4 p-2 bg-slate-900 text-white rounded-full hover:bg-slate-800 transition-colors"
            >
              <X size={18} weight="bold" />
            </button>
            <img src={zoomedImage} alt="Expanded diagram" className="max-h-[80vh] w-auto object-contain" />
          </div>
        </div>
      )}
    </div>
  );
};
