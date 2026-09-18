'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  MinusCircle,
  ListChecks,
  HourglassMedium,
} from '@phosphor-icons/react';
import type { ReviewQuestionStatus } from '@/services/student/studentTestResultWebService';

export type ReviewFilterType = 'all' | 'correct' | 'incorrect' | 'skipped' | 'pending';

interface ReviewHeaderProps {
  testTitle: string;
  testId: string;
  attemptId: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  activeFilter: ReviewFilterType;
  onSelectFilter: (filter: ReviewFilterType) => void;
  sections: string[];
  activeSection: string;
  onSelectSection: (section: string) => void;
  counts: {
    all: number;
    correct: number;
    incorrect: number;
    skipped: number;
    pending: number;
  };
}

export const ReviewHeader: React.FC<ReviewHeaderProps> = ({
  testTitle,
  testId,
  attemptId,
  totalScore,
  maxScore,
  percentage,
  activeFilter,
  onSelectFilter,
  sections,
  activeSection,
  onSelectSection,
  counts,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-900 text-slate-100 border-b border-slate-800 px-4 sm:px-6 py-3.5 shadow-md flex flex-col gap-3 select-none">
      {/* Top row: Back button, Title, Overall Score */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/student/tests/${testId}/results/${attemptId}`}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Back to Scorecard"
          >
            <ArrowLeft size={18} weight="bold" />
          </Link>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
              Solution & Answer Review
            </span>
            <h1 className="text-sm sm:text-base font-bold text-white truncate max-w-xs sm:max-w-md" title={testTitle}>
              {testTitle}
            </h1>
          </div>
        </div>

        {/* Score summary pill */}
        <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs sm:text-sm font-bold">
          <span className="text-indigo-400">Score:</span>
          <span className="text-white">{totalScore} / {maxScore}</span>
          <span className="text-xs text-slate-400">({percentage}%)</span>
        </div>
      </div>

      {/* Bottom row: Filter Chips + Section Selector */}
      <div className="flex items-center justify-between gap-3 overflow-x-auto pb-0.5 scrollbar-none">
        {/* Status Filters */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onSelectFilter('all')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeFilter === 'all'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300'
            }`}
          >
            <ListChecks size={14} weight="bold" />
            <span>All ({counts.all})</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectFilter('correct')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeFilter === 'correct'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-800/80 hover:bg-slate-800 text-emerald-400'
            }`}
          >
            <CheckCircle size={14} weight="fill" />
            <span>Correct ({counts.correct})</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectFilter('incorrect')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeFilter === 'incorrect'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800/80 hover:bg-slate-800 text-rose-400'
            }`}
          >
            <XCircle size={14} weight="fill" />
            <span>Incorrect ({counts.incorrect})</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectFilter('skipped')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeFilter === 'skipped'
                ? 'bg-slate-600 text-white shadow-xs'
                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400'
            }`}
          >
            <MinusCircle size={14} weight="fill" />
            <span>Skipped ({counts.skipped})</span>
          </button>

          {counts.pending > 0 && (
            <button
              type="button"
              onClick={() => onSelectFilter('pending')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeFilter === 'pending'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-amber-400'
              }`}
            >
              <HourglassMedium size={14} weight="bold" />
              <span>Pending ({counts.pending})</span>
            </button>
          )}
        </div>

        {/* Section Filter Dropdown / Chips */}
        {sections.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-slate-400 hidden sm:inline mr-1">Section:</span>
            <select
              value={activeSection}
              onChange={(e) => onSelectSection(e.target.value)}
              className="bg-slate-800 text-slate-200 text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-700 focus:outline-hidden focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">All Sections</option>
              {sections.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  );
};
