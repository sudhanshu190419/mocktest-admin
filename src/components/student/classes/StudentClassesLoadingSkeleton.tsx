import React from 'react';

export const StudentClassesLoadingSkeleton: React.FC = () => {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-4 w-32 bg-sky-tint rounded-md" />
          <div className="h-8 w-64 bg-sky-tint rounded-lg" />
          <div className="h-4 w-80 bg-sky-tint rounded-md" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-28 bg-sky-tint rounded-field" />
        </div>
      </div>

      {/* KPI stats skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-white rounded-sheet border border-line p-4 space-y-2">
            <div className="h-3 w-16 bg-sky-tint rounded" />
            <div className="h-6 w-10 bg-sky-tint rounded-md" />
          </div>
        ))}
      </div>

      {/* Hero card skeleton */}
      <div className="h-48 bg-ink/60 rounded-sheet border border-ink p-6 space-y-4" />

      {/* Tabs and filter bar skeleton */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="h-11 w-64 bg-sky-tint rounded-card" />
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="h-11 w-full md:w-56 bg-sky-tint rounded-card" />
          <div className="h-11 w-32 bg-sky-tint rounded-card" />
        </div>
      </div>

      {/* Card grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-64 bg-white rounded-sheet border border-line p-5 space-y-3">
            <div className="flex justify-between">
              <div className="h-5 w-20 bg-sky-tint rounded-full" />
              <div className="h-5 w-16 bg-sky-tint rounded-full" />
            </div>
            <div className="h-5 w-full bg-sky-tint rounded" />
            <div className="h-4 w-3/4 bg-sky-tint rounded" />
            <div className="h-4 w-1/2 bg-sky-tint rounded" />
            <div className="pt-4 border-t border-line flex justify-between">
              <div className="h-4 w-24 bg-sky-tint rounded" />
              <div className="h-4 w-16 bg-sky-tint rounded" />
            </div>
            <div className="h-9 w-full bg-sky-tint rounded-field" />
          </div>
        ))}
      </div>
    </div>
  );
};
