'use client';

import React from 'react';
import { Sparkle, CheckCircle, WarningCircle, Target } from '@phosphor-icons/react';
import type { SubjectBreakdownItem } from '@/services/student/studentTestResultWebService';

interface PerformanceInsightsProps {
  accuracy: number;
  accuracyInsight: string;
  sections: SubjectBreakdownItem[];
  incorrectCount: number;
  skippedCount: number;
}

export const PerformanceInsights: React.FC<PerformanceInsightsProps> = ({
  accuracy,
  accuracyInsight,
  sections,
  incorrectCount,
  skippedCount,
}) => {
  // Determine strongest and weakest section safely if sections exist
  let strongestSection: SubjectBreakdownItem | null = null;
  let weakestSection: SubjectBreakdownItem | null = null;

  if (sections.length > 0) {
    const sorted = [...sections].sort((a, b) => b.accuracy - a.accuracy);
    strongestSection = sorted[0];
    if (sorted.length > 1) {
      weakestSection = sorted[sorted.length - 1];
    }
  }

  return (
    <div className="bg-gradient-to-br bg-ink bg-ink text-white rounded-3xl p-6 sm:p-8 border border-brand-hover/50 shadow-md flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-amber-400 text-ink rounded-lg">
          <Sparkle size={18} weight="fill" />
        </div>
        <h3 className="text-base sm:text-lg font-bold text-white">Performance Insights</h3>
      </div>

      <p className="text-xs sm:text-sm text-brand leading-relaxed">
        {accuracyInsight}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {strongestSection && (
          <div className="p-3.5 rounded-xl bg-ink/80 border border-ink flex items-start gap-2.5">
            <CheckCircle size={18} weight="fill" className="text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-bold text-emerald-300">Strongest Area</span>
              <p className="text-xs text-ink-muted mt-0.5">
                <strong className="text-white">{strongestSection.subjectName}</strong> ({strongestSection.accuracy}% accuracy)
              </p>
            </div>
          </div>
        )}

        {weakestSection && (
          <div className="p-3.5 rounded-xl bg-ink/80 border border-ink flex items-start gap-2.5">
            <WarningCircle size={18} weight="fill" className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-bold text-amber-300">Recommended Focus</span>
              <p className="text-xs text-ink-muted mt-0.5">
                <strong className="text-white">{weakestSection.subjectName}</strong> ({weakestSection.accuracy}% accuracy)
              </p>
            </div>
          </div>
        )}

        {incorrectCount > 0 && (
          <div className="p-3.5 rounded-xl bg-ink/80 border border-ink flex items-start gap-2.5">
            <Target size={18} weight="bold" className="text-sky-ink shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-bold text-sky-ink">Negative Marks Reduction</span>
              <p className="text-xs text-ink-muted mt-0.5">
                Review the <strong className="text-white">{incorrectCount} incorrect</strong> questions in the solution explorer to prevent future negative markings.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
