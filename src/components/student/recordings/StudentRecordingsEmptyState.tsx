'use client';

import React from 'react';
import { FilmSlate, MagnifyingGlass } from '@phosphor-icons/react';

interface StudentRecordingsEmptyStateProps {
  isFiltered?: boolean;
  onResetFilters?: () => void;
}

export const StudentRecordingsEmptyState: React.FC<StudentRecordingsEmptyStateProps> = ({
  isFiltered = false,
  onResetFilters,
}) => {
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center justify-center p-8 sm:p-12 rounded-3xl bg-white border border-slate-200 text-center max-w-md mx-auto my-8 shadow-xs">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 mb-3 border border-amber-200">
          <MagnifyingGlass size={26} weight="bold" />
        </div>
        <h3 className="text-base font-extrabold text-slate-900">No matching recorded classes</h3>
        <p className="mt-1 text-xs text-slate-500 max-w-xs leading-relaxed">
          No lecture recordings match your current search query, subject, or watch status filters.
        </p>
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-4 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-xs"
          >
            Clear All Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 rounded-3xl bg-white border border-slate-200 text-center max-w-md mx-auto my-8 shadow-xs">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 mb-3 border border-sky-200">
        <FilmSlate size={26} weight="duotone" />
      </div>
      <h3 className="text-base font-extrabold text-slate-900">No recorded classes yet</h3>
      <p className="mt-1 text-xs text-slate-500 max-w-xs leading-relaxed">
        Completed live classes across your enrolled subjects will appear here automatically once video processing completes.
      </p>
    </div>
  );
};
