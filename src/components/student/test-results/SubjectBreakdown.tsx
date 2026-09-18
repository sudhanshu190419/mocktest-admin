'use client';

import React from 'react';
import { ChartBar, CheckCircle, XCircle, MinusCircle } from '@phosphor-icons/react';
import type { SubjectBreakdownItem } from '@/services/student/studentTestResultWebService';

interface SubjectBreakdownProps {
  sections: SubjectBreakdownItem[];
}

export const SubjectBreakdown: React.FC<SubjectBreakdownProps> = ({ sections }) => {
  if (!sections || sections.length === 0) return null;

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <ChartBar size={20} weight="bold" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">Section-wise Performance</h3>
            <p className="text-xs text-slate-500">Breakdown of accuracy and marks per subject section</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((sec, idx) => {
          return (
            <div
              key={sec.subjectId || idx}
              className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between gap-4"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm sm:text-base text-slate-900 truncate">
                  {sec.subjectName}
                </h4>
                <div className="flex items-baseline gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-bold">
                  <span className="text-indigo-600">{sec.score}</span>
                  <span className="text-slate-400">/ {sec.maxScore}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-600">Accuracy</span>
                  <span className="text-slate-900">{sec.accuracy}%</span>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, sec.accuracy))}%` }}
                  />
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs">
                  <CheckCircle size={14} weight="fill" className="text-emerald-500" />
                  <span className="font-bold text-slate-700">{sec.correct}</span>
                  <span className="text-[10px] text-slate-400 uppercase">Correct</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs">
                  <XCircle size={14} weight="fill" className="text-rose-500" />
                  <span className="font-bold text-slate-700">{sec.wrong}</span>
                  <span className="text-[10px] text-slate-400 uppercase">Wrong</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs">
                  <MinusCircle size={14} weight="fill" className="text-slate-400" />
                  <span className="font-bold text-slate-700">{sec.skipped}</span>
                  <span className="text-[10px] text-slate-400 uppercase">Skip</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
