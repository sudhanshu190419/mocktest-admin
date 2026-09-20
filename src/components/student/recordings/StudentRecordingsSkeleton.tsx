'use client';

import React from 'react';

export const StudentRecordingsSkeleton: React.FC = () => {
  const placeholders = Array.from({ length: 6 });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6 animate-pulse">
      {placeholders.map((_, i) => (
        <div
          key={i}
          className="flex flex-col justify-between rounded-3xl bg-white border border-line p-0 overflow-hidden shadow-xs"
        >
          <div className="h-40 w-full bg-sky-tint" />
          <div className="p-5 space-y-4">
            <div className="space-y-2">
              <div className="h-4 bg-sky-tint rounded-md w-3/4" />
              <div className="h-3 bg-paper rounded-md w-1/2" />
            </div>
            <div className="space-y-2 pt-2 border-t border-line">
              <div className="h-3 bg-paper rounded-md w-2/3" />
              <div className="h-3 bg-paper rounded-md w-1/2" />
            </div>
            <div className="h-9 bg-paper rounded-2xl w-full pt-1" />
          </div>
        </div>
      ))}
    </div>
  );
};
