'use client';

import React from 'react';
import {
  IconFilm,
  IconSearch,
  IconClose,
  IconRefresh,
  IconClock,
  IconArrowLeft,
  IconCheckCircle,
} from '@/components/icons/student-icons';
import type {
  WatchStatusFilter,
  RecordingSortOption,
} from '@/services/student/studentRecordingWebService';

interface StudentRecordingsHeaderProps {
  totalCount: number;
  completedCount?: number;
  inProgressCount?: number;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  availableSubjects?: string[];
  selectedSubject?: string;
  onSubjectChange?: (s: string) => void;
  availableBatches?: Array<{ batchId: string; batchName: string }>;
  selectedBatch?: string;
  onBatchChange?: (b: string) => void;
  selectedWatchStatus?: WatchStatusFilter;
  onWatchStatusChange?: (status: WatchStatusFilter) => void;
  selectedSort?: RecordingSortOption;
  onSortChange?: (sort: RecordingSortOption) => void;
  onResetFilters?: () => void;
  isFiltered?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  selectedSubjectName?: string | null;
  onClearSubject?: () => void;
}

export const StudentRecordingsHeader: React.FC<StudentRecordingsHeaderProps> = ({
  totalCount,
  completedCount = 0,
  inProgressCount = 0,
  searchQuery = '',
  onSearchChange,
  availableSubjects = [],
  selectedSubject = 'all',
  onSubjectChange,
  availableBatches = [],
  selectedBatch = 'all',
  onBatchChange,
  selectedWatchStatus = 'all',
  onWatchStatusChange,
  selectedSort = 'newest',
  onSortChange,
  onResetFilters,
  isFiltered = false,
  onRefresh,
  refreshing = false,
  selectedSubjectName,
  onClearSubject,
}) => {
  const isLevel2 = Boolean(selectedSubjectName);

  const watchStatusTabs: Array<{ id: WatchStatusFilter; label: string; count?: number }> = [
    { id: 'all', label: 'All Lectures', count: totalCount },
    { id: 'in_progress', label: 'In Progress', count: inProgressCount },
    { id: 'completed', label: 'Completed', count: completedCount },
    { id: 'not_started', label: 'Unwatched' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Hero & Stats Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 bg-gradient-to-r from-sky-700 via-brand to-sky-900 rounded-sheet p-6 sm:p-8 text-white shadow-md relative overflow-hidden border border-sky-600/30">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-48 h-48 bg-sky-tint/10 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl space-y-2">
          {isLevel2 && onClearSubject ? (
            <button
              type="button"
              onClick={onClearSubject}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-xs text-white text-xs font-bold border border-white/25 transition-all mb-1 cursor-pointer"
            >
              <IconArrowLeft size={13} />
              <span>Back to All Subjects</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-xs text-white text-xs font-bold border border-white/25 shadow-2xs">
              <IconFilm size={14} className="text-white" />
              <span>Recorded Lectures Library</span>
            </div>
          )}

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-xs">
            {isLevel2 ? `${selectedSubjectName} Lectures` : 'Recorded Classes'}
          </h1>
          <p className="text-xs sm:text-sm text-sky-100/90 leading-relaxed font-normal">
            {isLevel2
              ? `Browsing recorded classes and lecture sessions for ${selectedSubjectName}.`
              : 'Revisit your completed live lectures, review key concepts, and continue watching right where you left off.'}
          </p>
        </div>

        {/* Quick Progress Counters */}
        <div className="relative z-10 flex items-center gap-3 self-start md:self-auto flex-wrap">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-card bg-white/15 backdrop-blur-md border border-white/20 shadow-xs">
            <IconClock size={20} className="text-sky-200" />
            <div>
              <span className="block text-xs font-semibold text-sky-200">
                {isLevel2 ? 'In Subject' : 'Available'}
              </span>
              <span className="text-base font-extrabold text-white">{totalCount} Lectures</span>
            </div>
          </div>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh library"
              className="p-3 rounded-card bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/20 text-white transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-xs"
              title="Refresh library"
            >
              <IconRefresh
                size={18}
                className={refreshing ? 'animate-spin' : ''}
              />
            </button>
          )}
        </div>
      </div>

      {/* Level 2 Search & Filter Controls Bar */}
      {isLevel2 && onSearchChange && (
        <div className="flex flex-col space-y-4 bg-white p-4 sm:p-5 rounded-sheet border border-line shadow-xs">
          {/* Row 1: Search & Watch Status Tabs */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
            {/* Search Bar */}
            <div className="relative flex-1 min-w-[260px]">
              <IconSearch
                size={17}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search within loaded lectures by title, topic, or instructor..."
                aria-label="Search recordings"
                className="w-full pl-10 pr-9 py-2.5 rounded-card bg-paper border border-line text-xs font-medium text-ink placeholder:text-ink-muted focus:outline-hidden focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
              />
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Clear search query"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary p-0.5 rounded-full"
                >
                  <IconClose size={14} />
                </button>
              )}
            </div>

            {/* Watch Status Segmented Filter */}
            {onWatchStatusChange && (
              <div className="flex items-center gap-1 p-1 rounded-card bg-paper border border-line/80 overflow-x-auto no-scrollbar">
                {watchStatusTabs.map((tab) => {
                  const active = selectedWatchStatus === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onWatchStatusChange(tab.id)}
                      aria-pressed={active}
                      className={`px-3 py-1.5 rounded-field text-xs font-bold transition-all whitespace-nowrap ${
                        active
                          ? 'bg-white text-brand-hover shadow-xs font-extrabold'
                          : 'text-ink-secondary hover:text-ink'
                      }`}
                    >
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Row 2: Sort Dropdown & Reset */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line">
            <div className="text-caption font-semibold text-ink-secondary">
              Showing recordings for <span className="font-bold text-ink">{selectedSubjectName}</span>
            </div>

            <div className="flex items-center gap-2.5 ml-auto flex-wrap">
              {onSortChange && (
                <div
                  className="px-3 py-1.5 rounded-field bg-paper border border-line text-xs font-semibold text-ink-secondary inline-flex items-center gap-1.5"
                  title="Recordings are ordered chronologically by newest assignment date"
                >
                  <span className="text-ink font-bold">Sort:</span>
                  <span>Newest First</span>
                </div>
              )}

              {isFiltered && onResetFilters && (
                <button
                  type="button"
                  onClick={onResetFilters}
                  className="px-3 py-1.5 rounded-field text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
