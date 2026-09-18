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
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
          <Clock size={20} weight="bold" />
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900">Time & Pace Analysis</h3>
          <p className="text-xs text-slate-500">Speed and time utilization across all questions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Time Used */}
        <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/80 flex items-center gap-3.5">
          <div className="p-3 bg-amber-100 text-amber-700 rounded-xl">
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
        <div className="p-4 rounded-2xl bg-sky-50/60 border border-sky-200/80 flex items-center gap-3.5">
          <div className="p-3 bg-sky-100 text-sky-700 rounded-xl">
            <Lightning size={22} weight="fill" />
          </div>
          <div>
            <span className="text-xs font-semibold text-sky-800">Average Pace</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xl font-bold text-sky-950">{timePaceSec}s</span>
              <span className="text-xs text-sky-700 font-medium">per question</span>
            </div>
          </div>
        </div>

        {/* Question Count Pace */}
        <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-200/80 flex items-center gap-3.5">
          <div className="p-3 bg-indigo-100 text-indigo-700 rounded-xl">
            <Clock size={22} weight="bold" />
          </div>
          <div>
            <span className="text-xs font-semibold text-indigo-800">Question Density</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xl font-bold text-indigo-950">{totalQuestions}</span>
              <span className="text-xs text-indigo-700 font-medium">total questions</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
