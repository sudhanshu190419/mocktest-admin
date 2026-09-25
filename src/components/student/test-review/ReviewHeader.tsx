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
    <header className="sticky top-0 z-40 bg-ink text-sky-ink border-b border-ink px-4 sm:px-6 py-3.5 shadow-md flex flex-col gap-3 select-none">
      {/* Top row: Back button, Title, Overall Score */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/student/tests/${testId}/results/${attemptId}`}
            className="p-2 rounded-field bg-ink hover:bg-ink text-ink-muted hover:text-white transition-colors cursor-pointer"
            title="Back to Scorecard"
          >
            <ArrowLeft size={18} weight="bold" />
          </Link>
          <div className="flex flex-col min-w-0">
            <span className="text-caption font-bold uppercase tracking-wider text-brand">
              Solution & Answer Review
            </span>
            <h1 className="text-sm sm:text-base font-bold text-white truncate max-w-xs sm:max-w-md" title={testTitle}>
              {testTitle}
            </h1>
          </div>
        </div>

        {/* Score summary pill */}
        <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-ink border border-ink text-xs sm:text-sm font-bold">
          <span className="text-brand">Score:</span>
          <span className="text-white">{totalScore} / {maxScore}</span>
          <span className="text-xs text-ink-muted">({percentage}%)</span>
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
                ? 'bg-brand text-white shadow-xs'
                : 'bg-ink/80 hover:bg-ink text-ink-muted'
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
                : 'bg-ink/80 hover:bg-ink text-emerald-400'
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
                : 'bg-ink/80 hover:bg-ink text-rose-400'
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
                ? 'bg-ink-secondary text-white shadow-xs'
                : 'bg-ink/80 hover:bg-ink text-ink-muted'
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
                  : 'bg-ink/80 hover:bg-ink text-amber-400'
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
            <span className="text-xs text-ink-muted hidden sm:inline mr-1">Section:</span>
            <select
              value={activeSection}
              onChange={(e) => onSelectSection(e.target.value)}
              className="bg-ink text-sky-ink text-xs font-semibold px-2.5 py-1 rounded-lg border border-ink focus:outline-hidden focus:border-brand cursor-pointer"
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
