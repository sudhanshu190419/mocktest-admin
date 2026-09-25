'use client';

import React from 'react';
import { Clock, Lightning, HourglassHigh } from '@phosphor-icons/react';

interface TimeAnalysisProps {
  totalTimeSeconds: number;
  durationMin: number;
  avgTimePerQuestion: number;
  totalQuestions: number;
}

export const TimeAnalysis: React.FC<TimeAnalysisProps> = ({
  totalTimeSeconds,
  durationMin,
  avgTimePerQuestion,
  totalQuestions,
}) => {
  const timeTakenMin = Math.round(totalTimeSeconds / 60);
  const timePaceSec = Math.round(avgTimePerQuestion);

  return (
    <div className="bg-white rounded-sheet p-6 sm:p-8 border border-line shadow-sm flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-amber-50 text-amber-600 rounded-field">
          <Clock size={20} weight="bold" />
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-bold text-ink">Time & Pace Analysis</h3>
          <p className="text-xs text-ink-secondary">Speed and time utilization across all questions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Time Used */}
        <div className="p-4 rounded-card bg-amber-50/60 border border-amber-200/80 flex items-center gap-3.5">
          <div className="p-3 bg-amber-100 text-amber-700 rounded-field">
            <HourglassHigh size={22} weight="bold" />
          </div>
          <div>
            <span className="text-xs font-semibold text-amber-800">Total Duration Used</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xl font-bold text-amber-950">{timeTakenMin} mins</span>
              <span className="text-xs text-amber-700 font-medium">/ {durationMin} mins</span>
            </div>
          </div>
        </div>

        {/* Avg Pace */}
        <div className="p-4 rounded-card bg-sky-tint/60 border border-line/80 flex items-center gap-3.5">
          <div className="p-3 bg-sky-tint text-brand-hover rounded-field">
            <Lightning size={22} weight="fill" />
          </div>
          <div>
            <span className="text-xs font-semibold text-brand-hover">Average Pace</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xl font-bold text-brand-hover">{timePaceSec}s</span>
              <span className="text-xs text-brand-hover font-medium">per question</span>
            </div>
          </div>
        </div>

        {/* Question Count Pace */}
        <div className="p-4 rounded-card bg-sky-tint/60 border border-line/80 flex items-center gap-3.5">
          <div className="p-3 bg-sky-tint text-brand-hover rounded-field">
            <Clock size={22} weight="bold" />
          </div>
          <div>
            <span className="text-xs font-semibold text-brand-hover">Question Density</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xl font-bold text-brand-hover">{totalQuestions}</span>
              <span className="text-xs text-brand-hover font-medium">total questions</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
