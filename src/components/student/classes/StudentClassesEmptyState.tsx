import React from 'react';
import {
  Broadcast,
  Calendar,
  Clock,
  MagnifyingGlass,
  ArrowsClockwise
} from '@phosphor-icons/react';

interface StudentClassesEmptyStateProps {
  type: 'no-live' | 'no-upcoming' | 'no-past' | 'no-results';
  onResetFilters?: () => void;
}

export const StudentClassesEmptyState: React.FC<StudentClassesEmptyStateProps> = ({
  type,
  onResetFilters,
}) => {
  if (type === 'no-live') {
    return (
      <div className="p-8 sm:p-10 rounded-3xl bg-white border border-slate-100 text-center max-w-xl mx-auto my-4 space-y-3 shadow-xs">
        <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto border border-slate-100">
          <Broadcast size={22} weight="duotone" />
        </div>
        <h3 className="text-base font-extrabold text-slate-800">No live classes right now</h3>
        <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
          You are all caught up! Check the upcoming schedule below to prepare for your next live interactive session.
        </p>
      </div>
    );
  }

  if (type === 'no-upcoming') {
    return (
      <div className="p-8 sm:p-12 rounded-3xl bg-white border border-slate-100 text-center max-w-xl mx-auto my-6 space-y-3 shadow-xs">
        <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-500 flex items-center justify-center mx-auto border border-sky-100">
          <Calendar size={22} weight="duotone" />
        </div>
        <h3 className="text-base font-extrabold text-slate-800">No upcoming classes scheduled</h3>
        <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
          New live classes will appear here automatically once your instructors schedule sessions for your enrolled batches.
        </p>
      </div>
    );
  }

  if (type === 'no-past') {
    return (
      <div className="p-8 sm:p-12 rounded-3xl bg-white border border-slate-100 text-center max-w-xl mx-auto my-6 space-y-3 shadow-xs">
        <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto border border-slate-100">
          <Clock size={22} weight="duotone" />
        </div>
        <h3 className="text-base font-extrabold text-slate-800">No completed live classes yet</h3>
        <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
          Completed classes and their on-demand recordings will be archived here once your sessions finish.
        </p>
      </div>
    );
  }

  // no-results
  return (
    <div className="p-8 sm:p-12 rounded-3xl bg-white border border-slate-100 text-center max-w-xl mx-auto my-6 space-y-4 shadow-xs">
      <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mx-auto border border-amber-100">
        <MagnifyingGlass size={22} weight="bold" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-extrabold text-slate-800">No classes matching your filters</h3>
        <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
          We could not find any live classes matching your current search query, subject, or batch selection.
        </p>
      </div>

      {onResetFilters && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
          >
            <ArrowsClockwise size={13} weight="bold" />
            <span>Reset Filters</span>
          </button>
        </div>
      )}
    </div>
  );
};
