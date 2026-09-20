'use client';

import React from 'react';
import {
  FilmSlate,
  MagnifyingGlass,
  X,
  ArrowsClockwise,
  CheckCircle,
  Clock,
} from '@phosphor-icons/react';
import type {
  WatchStatusFilter,
  RecordingSortOption,
} from '@/services/student/studentRecordingWebService';

interface StudentRecordingsHeaderProps {
  totalCount: number;
  completedCount: number;
  inProgressCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  availableSubjects: string[];
  selectedSubject: string;
  onSubjectChange: (s: string) => void;
  availableBatches: Array<{ batchId: string; batchName: string }>;
  selectedBatch: string;
  onBatchChange: (b: string) => void;
  selectedWatchStatus: WatchStatusFilter;
  onWatchStatusChange: (status: WatchStatusFilter) => void;
  selectedSort: RecordingSortOption;
  onSortChange: (sort: RecordingSortOption) => void;
  onResetFilters: () => void;
  isFiltered: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

export const StudentRecordingsHeader: React.FC<StudentRecordingsHeaderProps> = ({
  totalCount,
  completedCount,
  inProgressCount,
  searchQuery,
  onSearchChange,
  availableSubjects,
  selectedSubject,
  onSubjectChange,
  availableBatches,
  selectedBatch,
  onBatchChange,
  selectedWatchStatus,
  onWatchStatusChange,
  selectedSort,
  onSortChange,
  onResetFilters,
  isFiltered,
  onRefresh,
  refreshing,
}) => {
  const watchStatusTabs: Array<{ id: WatchStatusFilter; label: string; count?: number }> = [
    { id: 'all', label: 'All Lectures', count: totalCount },
    { id: 'in_progress', label: 'In Progress', count: inProgressCount },
    { id: 'completed', label: 'Completed', count: completedCount },
    { id: 'not_started', label: 'Unwatched' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Hero & Stats Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r bg-brand bg-brand-hover bg-brand-hover rounded-3xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-48 h-48 bg-sky-tint/10 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-xs text-brand text-xs font-bold border border-white/20">
            <FilmSlate size={14} weight="fill" className="text-sky-ink" />
            <span>Recorded Lectures Library</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Recorded Classes
          </h1>
          <p className="text-xs sm:text-sm text-brand/90 leading-relaxed">
            Revisit your completed live lectures, review key concepts, and continue watching right where you left off.
          </p>
        </div>

        {/* Quick Progress Counters */}
        <div className="relative z-10 flex items-center gap-3 self-start md:self-auto flex-wrap">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15">
            <Clock size={20} weight="fill" className="text-sky-ink" />
            <div>
              <span className="block text-xs font-semibold text-brand">Available</span>
              <span className="text-base font-extrabold text-white">{totalCount} Lectures</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15">
            <CheckCircle size={20} weight="fill" className="text-emerald-300" />
            <div>
              <span className="block text-xs font-semibold text-brand">Completed</span>
              <span className="text-base font-extrabold text-white">{completedCount} Lectures</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh recordings list"
            className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 text-white transition-all active:scale-[0.98] disabled:opacity-50"
            title="Refresh library"
          >
            <ArrowsClockwise
              size={18}
              weight="bold"
              className={refreshing ? 'animate-spin' : ''}
            />
          </button>
        </div>
      </div>

      {/* Search & Filter Controls Bar */}
      <div className="flex flex-col space-y-4 bg-white p-4 sm:p-5 rounded-3xl border border-line shadow-xs">
        {/* Row 1: Search & Watch Status Tabs */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-[260px]">
            <MagnifyingGlass
              size={17}
              weight="bold"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search lectures by topic, teacher, subject..."
              aria-label="Search recordings"
              className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-paper border border-line text-xs font-medium text-ink placeholder:text-ink-muted focus:outline-hidden focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search query"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary p-0.5 rounded-full"
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>

          {/* Watch Status Segmented Filter */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-paper border border-line/80 overflow-x-auto no-scrollbar">
            {watchStatusTabs.map((tab) => {
              const active = selectedWatchStatus === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onWatchStatusChange(tab.id)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                    active
                      ? 'bg-white text-brand-hover shadow-xs font-extrabold'
                      : 'text-ink-secondary hover:text-ink'
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={`ml-1.5 px-1.5 py-0.5 rounded-full text-caption font-bold ${
                        active ? 'bg-sky-tint text-brand-hover' : 'bg-sky-tint text-ink-secondary'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: Subject Filter Pills & Sort Dropdown */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line">
          {/* Subject Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-ink-muted mr-1 hidden sm:inline">Subject:</span>
            <button
              type="button"
              onClick={() => onSubjectChange('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedSubject === 'all'
                  ? 'bg-brand text-white shadow-xs'
                  : 'bg-paper text-ink-secondary hover:bg-sky-tint/80'
              }`}
            >
              All Subjects
            </button>
            {availableSubjects.map((sub) => {
              const active = selectedSubject.toLowerCase() === sub.toLowerCase();
              return (
                <button
                  key={sub}
                  type="button"
                  onClick={() => onSubjectChange(sub)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    active
                      ? 'bg-brand text-white shadow-xs'
                      : 'bg-paper text-ink-secondary hover:bg-sky-tint/80'
                  }`}
                >
                  {sub}
                </button>
              );
            })}
          </div>

          {/* Right Controls: Batch Selector, Sort Selector, Reset Button */}
          <div className="flex items-center gap-2.5 ml-auto flex-wrap">
            {availableBatches.length > 1 && (
              <select
                value={selectedBatch}
                onChange={(e) => onBatchChange(e.target.value)}
                aria-label="Filter by batch"
                className="px-3 py-1.5 rounded-xl bg-paper border border-line text-xs font-semibold text-ink focus:outline-hidden focus:border-brand transition-colors"
              >
                <option value="all">All Batches</option>
                {availableBatches.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.batchName}
                  </option>
                ))}
              </select>
            )}

            <select
              value={selectedSort}
              onChange={(e) => onSortChange(e.target.value as RecordingSortOption)}
              aria-label="Sort recordings"
              className="px-3 py-1.5 rounded-xl bg-paper border border-line text-xs font-semibold text-ink focus:outline-hidden focus:border-brand transition-colors"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="duration_desc">Longest Duration</option>
              <option value="duration_asc">Shortest Duration</option>
            </select>

            {isFiltered && (
              <button
                type="button"
                onClick={onResetFilters}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
