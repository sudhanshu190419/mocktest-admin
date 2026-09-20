'use client';

import React from 'react';

export const QuestionPaletteLegend: React.FC = () => {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 bg-paper rounded-field border border-line text-caption">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center font-bold text-caption shrink-0">
          ✓
        </div>
        <span className="text-ink font-medium">Answered</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-purple-600 text-white flex items-center justify-center font-bold text-caption shrink-0">
          ★
        </div>
        <span className="text-ink font-medium">Marked</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-purple-600 text-white ring-2 ring-emerald-400 flex items-center justify-center font-bold text-caption shrink-0">
          ★
        </div>
        <span className="text-ink font-medium">Ans & Marked</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-rose-600 text-white flex items-center justify-center font-bold text-caption shrink-0">
          !
        </div>
        <span className="text-ink font-medium">Not Answered</span>
      </div>

      <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
        <div className="w-5 h-5 rounded-md bg-paper border border-line text-ink-secondary flex items-center justify-center font-bold text-caption shrink-0">
          •
        </div>
        <span className="text-ink font-medium">Not Visited</span>
      </div>
    </div>
  );
};
