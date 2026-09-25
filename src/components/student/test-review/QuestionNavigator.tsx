'use client';

import React from 'react';
import {
  CheckCircle,
  XCircle,
  MinusCircle,
  HourglassMedium,
} from '@phosphor-icons/react';
import type { ReviewQuestionItem, ReviewQuestionStatus } from '@/services/student/studentTestResultWebService';

interface QuestionNavigatorProps {
  questions: ReviewQuestionItem[];
  currentIndex: number;
  onSelectQuestion: (index: number) => void;
}

export const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({
  questions,
  currentIndex,
  onSelectQuestion,
}) => {
  const getBadgeStyle = (status: ReviewQuestionStatus, isCurrent: boolean) => {
    let base = 'relative flex items-center justify-center rounded-field font-mono text-xs font-bold transition-all cursor-pointer h-10 ';

    if (isCurrent) {
      base += 'ring-2 ring-brand ring-offset-2 scale-105 z-10 ';
    }

    switch (status) {
      case 'correct':
        return base + 'bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-200';
      case 'incorrect':
        return base + 'bg-rose-100 text-rose-900 border border-rose-300 hover:bg-rose-200';
      case 'evaluated':
        return base + 'bg-teal-100 text-teal-900 border border-teal-300 hover:bg-teal-200';
      case 'pending':
        return base + 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200';
      case 'skipped':
      default:
        return base + 'bg-paper text-ink border border-line hover:bg-sky-tint';
    }
  };

  const getStatusIcon = (status: ReviewQuestionStatus) => {
    switch (status) {
      case 'correct':
        return <CheckCircle size={10} weight="fill" className="absolute top-1 right-1 text-emerald-600" />;
      case 'incorrect':
        return <XCircle size={10} weight="fill" className="absolute top-1 right-1 text-rose-600" />;
      case 'evaluated':
        return <CheckCircle size={10} weight="fill" className="absolute top-1 right-1 text-teal-600" />;
      case 'pending':
        return <HourglassMedium size={10} weight="bold" className="absolute top-1 right-1 text-amber-600" />;
      case 'skipped':
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-card p-4 sm:p-5 border border-line shadow-xs flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <h3 className="text-sm font-bold text-ink">Question Navigator</h3>
        <span className="text-xs text-ink-secondary font-medium">
          {questions.length} {questions.length === 1 ? 'Question' : 'Questions'}
        </span>
      </div>

      {/* Grid of questions */}
      <div className="grid grid-cols-5 gap-2 max-h-96 overflow-y-auto pr-1">
        {questions.map((q, idx) => {
          const isCurrent = idx === currentIndex;
          return (
            <button
              key={q.questionId || idx}
              type="button"
              onClick={() => onSelectQuestion(idx)}
              className={getBadgeStyle(q.status, isCurrent)}
              title={`Question ${q.index}: ${q.status.toUpperCase()}`}
            >
              <span>{q.index}</span>
              {getStatusIcon(q.status)}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-line text-caption text-ink-secondary">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-xs bg-emerald-100 border border-emerald-400" />
          <span>Correct</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-xs bg-rose-100 border border-rose-400" />
          <span>Incorrect</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-xs bg-paper border border-line" />
          <span>Skipped</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-xs bg-amber-100 border border-amber-400" />
          <span>Pending</span>
        </div>
      </div>
    </div>
  );
};
