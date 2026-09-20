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
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-line shadow-sm flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-sky-tint text-brand rounded-xl">
            <ChartBar size={20} weight="bold" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-ink">Section-wise Performance</h3>
            <p className="text-xs text-ink-secondary">Breakdown of accuracy and marks per subject section</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((sec, idx) => {
          return (
            <div
              key={sec.subjectId || idx}
              className="p-5 rounded-2xl bg-paper border border-line/80 flex flex-col justify-between gap-4"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm sm:text-base text-ink truncate">
                  {sec.subjectName}
                </h4>
                <div className="flex items-baseline gap-1 bg-white px-2.5 py-1 rounded-lg border border-line text-xs font-bold">
                  <span className="text-brand">{sec.score}</span>
                  <span className="text-ink-muted">/ {sec.maxScore}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-ink-secondary">Accuracy</span>
                  <span className="text-ink">{sec.accuracy}%</span>
                </div>
                <div className="w-full h-2 bg-sky-tint rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r bg-brand bg-brand rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, sec.accuracy))}%` }}
                  />
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-line/60 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs">
                  <CheckCircle size={14} weight="fill" className="text-emerald-500" />
                  <span className="font-bold text-ink">{sec.correct}</span>
                  <span className="text-caption text-ink-muted uppercase">Correct</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs">
                  <XCircle size={14} weight="fill" className="text-rose-500" />
                  <span className="font-bold text-ink">{sec.wrong}</span>
                  <span className="text-caption text-ink-muted uppercase">Wrong</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs">
                  <MinusCircle size={14} weight="fill" className="text-ink-muted" />
                  <span className="font-bold text-ink">{sec.skipped}</span>
                  <span className="text-caption text-ink-muted uppercase">Skip</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
