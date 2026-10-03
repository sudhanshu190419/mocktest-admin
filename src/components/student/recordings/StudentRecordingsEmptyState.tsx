'use client';

import React from 'react';
import { IconFilm, IconSearch, IconRefresh } from '@/components/icons/student-icons';

interface StudentRecordingsEmptyStateProps {
  isFiltered?: boolean;
  onResetFilters?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  loadedCount?: number;
}

export const StudentRecordingsEmptyState: React.FC<StudentRecordingsEmptyStateProps> = ({
  isFiltered = false,
  onResetFilters,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  loadedCount = 0,
}) => {
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center justify-center p-8 sm:p-12 rounded-sheet bg-white border border-line text-center max-w-md mx-auto my-8 shadow-xs">
        <div className="flex h-14 w-14 items-center justify-center rounded-card bg-amber-50 text-amber-600 mb-3 border border-amber-200">
          <IconSearch size={26} />
        </div>
        <h3 className="text-base font-extrabold text-ink">No matching recorded classes</h3>
        <p className="mt-1 text-xs text-ink-secondary max-w-xs leading-relaxed">
          {loadedCount > 0
            ? `No recordings matched your search/filters in the ${loadedCount} loaded lectures.`
            : 'No lecture recordings match your current search query or watch status filters.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          {hasNextPage && onLoadMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isFetchingNextPage}
              className="px-4 py-2 min-h-[44px] rounded-field bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-colors inline-flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isFetchingNextPage ? (
                <>
                  <IconRefresh size={14} className="animate-spin" />
                  <span>Loading Older Lectures...</span>
                </>
              ) : (
                <span>Load Older Lectures (+20)</span>
              )}
            </button>
          )}
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="px-4 py-2 min-h-[44px] rounded-field bg-paper hover:bg-line text-ink text-xs font-bold transition-colors border border-line cursor-pointer"
            >
              Clear All Filters
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 rounded-sheet bg-white border border-line text-center max-w-md mx-auto my-8 shadow-xs">
      <div className="flex h-14 w-14 items-center justify-center rounded-card bg-sky-tint text-brand mb-3 border border-line">
        <IconFilm size={26} />
      </div>
      <h3 className="text-base font-extrabold text-ink">No recorded classes yet</h3>
      <p className="mt-1 text-xs text-ink-secondary max-w-xs leading-relaxed">
        Completed live classes across your enrolled subjects will appear here automatically once video processing completes.
      </p>
    </div>
  );
};
