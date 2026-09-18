'use client';

import React, { useMemo } from 'react';
import type { RunnerQuestion } from '@/services/student/studentTestWebService';
import { QuestionPaletteLegend } from './QuestionPaletteLegend';

export type QuestionStatus =
  | 'answered'
  | 'marked'
  | 'answered_and_marked'
  | 'not_answered'
  | 'not_visited';

interface QuestionPaletteProps {
  questions: RunnerQuestion[];
  currentIndex: number;
  selectedOptions: Record<number, string | string[] | null>;
  markedForReview: Set<number>;
  visitedQuestions: Set<number>;
  onSelectQuestion: (index: number) => void;
  className?: string;
}

export const QuestionPalette: React.FC<QuestionPaletteProps> = ({
  questions,
  currentIndex,
  selectedOptions,
  markedForReview,
  visitedQuestions,
  onSelectQuestion,
  className = '',
}) => {
  // Helper to compute status for each question index
  const getStatus = (index: number): QuestionStatus => {
    const val = selectedOptions[index];
    const isAnswered =
      val !== null &&
      val !== undefined &&
      (typeof val === 'string' ? val.trim() !== '' : true) &&
      (!Array.isArray(val) || val.length > 0);

    const isMarked = markedForReview.has(index);
    const isVisited = visitedQuestions.has(index);

    if (isAnswered && isMarked) return 'answered_and_marked';
    if (isAnswered) return 'answered';
    if (isMarked) return 'marked';
    if (isVisited) return 'not_answered';
    return 'not_visited';
  };

  // Group by sections
  const sections = useMemo(() => {
    const map = new Map<string, Array<{ q: RunnerQuestion; globalIndex: number }>>();
    questions.forEach((q, idx) => {
      const sec = q.sectionName || q.subjectName || 'General';
      const arr = map.get(sec) || [];
      arr.push({ q, globalIndex: idx });
      map.set(sec, arr);
    });
    return Array.from(map.entries()).map(([name, items]) => ({
      name,
      items,
    }));
  }, [questions]);

  // Status badge styling helper
  const getBadgeStyle = (status: QuestionStatus, isCurrent: boolean) => {
    let bg = 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300';

    if (status === 'answered') {
      bg = 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600';
    } else if (status === 'marked') {
      bg = 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600';
    } else if (status === 'answered_and_marked') {
      bg = 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600 ring-2 ring-emerald-400';
    } else if (status === 'not_answered') {
      bg = 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500';
    }

    const ring = isCurrent ? 'ring-3 ring-sky-500 ring-offset-2 scale-105 z-10' : '';
    return `${bg} ${ring}`;
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <h3 className="font-bold text-slate-900 text-sm">Question Palette</h3>
        <span className="text-xs text-slate-500 font-medium">
          {questions.length} Questions
        </span>
      </div>

      {/* Legend */}
      <QuestionPaletteLegend />

      {/* Question Grids per Section */}
      <div className="flex flex-col gap-5 overflow-y-auto max-h-[calc(100vh-340px)] pr-1">
        {sections.map((sec) => (
          <div key={sec.name} className="flex flex-col gap-2.5">
            {sections.length > 1 && (
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {sec.name} ({sec.items.length})
              </div>
            )}
            <div className="grid grid-cols-5 gap-2">
              {sec.items.map(({ q, globalIndex }) => {
                const status = getStatus(globalIndex);
                const isCurrent = globalIndex === currentIndex;

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => onSelectQuestion(globalIndex)}
                    className={`h-9 rounded-xl font-bold text-xs border transition-all flex items-center justify-center cursor-pointer shadow-2xs ${getBadgeStyle(
                      status,
                      isCurrent
                    )}`}
                    aria-label={`Question ${q.index} - ${status}`}
                  >
                    {q.index}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
