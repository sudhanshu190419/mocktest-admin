'use client';

import React from 'react';
import { Stack } from '@phosphor-icons/react';

export interface SectionTabItem {
  name: string;
  questionCount: number;
  answeredCount: number;
  startIndex: number;
}

interface SectionTabsProps {
  sections: SectionTabItem[];
  activeSection: string;
  onSelectSection: (sectionName: string, startIndex: number) => void;
}

export const SectionTabs: React.FC<SectionTabsProps> = ({
  sections,
  activeSection,
  onSelectSection,
}) => {
  if (!sections || sections.length <= 1) return null;

  return (
    <div className="bg-slate-100 border-b border-slate-200 px-4 sm:px-6 py-2 overflow-x-auto scrollbar-none">
      <div className="max-w-7xl mx-auto flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mr-2 shrink-0">
          <Stack size={16} weight="bold" />
          <span>SECTIONS:</span>
        </div>
        <div className="flex items-center gap-2">
          {sections.map((sec) => {
            const isActive = sec.name === activeSection;
            return (
              <button
                key={sec.name}
                onClick={() => onSelectSection(sec.name, sec.startIndex)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-white hover:bg-slate-200/70 text-slate-700 border border-slate-200'
                }`}
              >
                <span>{sec.name}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-md text-[10px] font-bold ${
                    isActive ? 'bg-sky-700/80 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {sec.answeredCount}/{sec.questionCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
