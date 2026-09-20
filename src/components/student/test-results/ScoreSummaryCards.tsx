'use client';

import React from 'react';
import {
  CheckCircle,
  XCircle,
  MinusCircle,
  Target,
  Clock,
} from '@phosphor-icons/react';

interface ScoreSummaryCardsProps {
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  accuracy: number;
  accuracyInsight: string;
  totalTimeSeconds: number;
  durationMin: number;
}

export const ScoreSummaryCards: React.FC<ScoreSummaryCardsProps> = ({
  correctCount,
  incorrectCount,
  skippedCount,
  accuracy,
  accuracyInsight,
  totalTimeSeconds,
  durationMin,
}) => {
  const timeTakenMin = Math.round(totalTimeSeconds / 60);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
      {/* 1. Correct */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-emerald-200/80 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Correct</span>
          <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle size={18} weight="fill" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl sm:text-3xl font-extrabold text-emerald-950">{correctCount}</span>
          <p className="text-caption text-emerald-700 font-medium mt-0.5">Positive marks awarded</p>
        </div>
      </div>

      {/* 2. Incorrect */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-rose-200/80 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-rose-800 uppercase tracking-wider">Incorrect</span>
          <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
            <XCircle size={18} weight="fill" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl sm:text-3xl font-extrabold text-rose-950">{incorrectCount}</span>
          <p className="text-caption text-rose-700 font-medium mt-0.5">Negative penalty applied</p>
        </div>
      </div>

      {/* 3. Skipped */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-line shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-ink uppercase tracking-wider">Skipped</span>
          <div className="p-1.5 bg-paper text-ink-secondary rounded-lg">
            <MinusCircle size={18} weight="fill" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl sm:text-3xl font-extrabold text-ink">{skippedCount}</span>
          <p className="text-caption text-ink-secondary font-medium mt-0.5">Unanswered questions</p>
        </div>
      </div>

      {/* 4. Accuracy */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-line/80 shadow-xs flex flex-col justify-between col-span-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-brand-hover uppercase tracking-wider">Accuracy</span>
          <div className="p-1.5 bg-sky-tint text-brand rounded-lg">
            <Target size={18} weight="bold" />
          </div>
        </div>
        <div className="mt-3">
          <span className="text-2xl sm:text-3xl font-extrabold text-brand-hover">{accuracy}%</span>
          <p className="text-caption text-brand-hover font-medium truncate mt-0.5" title={accuracyInsight}>
            {accuracy >= 75 ? 'Strong precision' : 'Needs review'}
          </p>
        </div>
      </div>

      {/* 5. Total Time */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-amber-200/80 shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Time Taken</span>
          <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
            <Clock size={18} weight="bold" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-extrabold text-amber-950">{timeTakenMin}m</span>
            <span className="text-xs font-semibold text-amber-700">/ {durationMin}m</span>
          </div>
          <p className="text-caption text-amber-800 font-medium mt-0.5">Total duration used</p>
        </div>
      </div>
    </div>
  );
};
