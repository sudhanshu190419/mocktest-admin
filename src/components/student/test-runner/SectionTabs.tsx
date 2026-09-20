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
    <div className="bg-paper border-b border-line px-4 sm:px-6 py-2 overflow-x-auto scrollbar-none">
      <div className="max-w-7xl mx-auto flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-caption font-bold text-ink-secondary mr-2 shrink-0">
          <Stack size={16} weight="bold" />
          <span>SECTIONS:</span>
        </div>
        <div className="flex items-center gap-2">
          {sections.map((sec) => {
            const isActive = sec.name === activeSection;
            return (
              <button
                key={sec.name}
                type="button"
                onClick={() => onSelectSection(sec.name, sec.startIndex)}
                className={`flex items-center gap-2 min-h-[38px] px-3.5 py-1.5 rounded-field text-caption font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-brand text-white shadow-xs'
                    : 'bg-white hover:bg-sky-tint text-ink border border-line'
                }`}
              >
                <span>{sec.name}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-caption font-bold tabular-nums ${
                    isActive ? 'bg-brand-hover text-white' : 'bg-paper text-ink-secondary'
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
