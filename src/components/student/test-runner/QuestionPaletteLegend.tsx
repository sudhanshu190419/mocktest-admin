'use client';

import React from 'react';

export const QuestionPaletteLegend: React.FC = () => {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
          ✓
        </div>
        <span className="text-slate-700">Answered</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-purple-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
          ★
        </div>
        <span className="text-slate-700">Marked</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-amber-500 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
          !
        </div>
        <span className="text-slate-700">Not Answered</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-slate-100 border border-slate-300 text-slate-500 flex items-center justify-center font-bold text-[10px] shrink-0">
          •
        </div>
        <span className="text-slate-700">Not Visited</span>
      </div>
    </div>
  );
};
