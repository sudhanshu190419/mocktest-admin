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

  // Status badge styling helper matching NTA semantics
  const getBadgeStyle = (status: QuestionStatus, isCurrent: boolean) => {
    let bg = 'bg-paper hover:bg-sky-tint text-ink border-line';

    if (status === 'answered') {
      bg = 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 font-bold';
    } else if (status === 'marked') {
      bg = 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600 font-bold';
    } else if (status === 'answered_and_marked') {
      bg = 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600 ring-2 ring-emerald-400 font-bold';
    } else if (status === 'not_answered') {
      bg = 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 font-bold';
    }

    const ring = isCurrent ? 'ring-2 ring-brand ring-offset-2 scale-105 font-extrabold z-10' : '';
    return `${bg} ${ring}`;
  };

  return (
    <div className={`bg-white rounded-card border border-line shadow-xs p-4 flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between pb-3 border-b border-line">
        <h3 className="font-bold text-ink text-sm">Question Palette</h3>
        <span className="text-caption text-ink-secondary font-semibold">
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
              <div className="text-caption font-bold text-ink-secondary uppercase tracking-wider">
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
                    className={`h-10 rounded-field font-bold text-caption border transition-all flex items-center justify-center cursor-pointer shadow-xs ${getBadgeStyle(
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
