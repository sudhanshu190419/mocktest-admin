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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-sky-600 via-sky-700 to-indigo-800 rounded-3xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-48 h-48 bg-indigo-400/10 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-xs text-sky-100 text-xs font-bold border border-white/20">
            <FilmSlate size={14} weight="fill" className="text-sky-300" />
            <span>Recorded Lectures Library</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Recorded Classes
          </h1>
          <p className="text-xs sm:text-sm text-sky-100/90 leading-relaxed">
            Revisit your completed live lectures, review key concepts, and continue watching right where you left off.
          </p>
        </div>

        {/* Quick Progress Counters */}
        <div className="relative z-10 flex items-center gap-3 self-start md:self-auto flex-wrap">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15">
            <Clock size={20} weight="fill" className="text-sky-300" />
            <div>
              <span className="block text-xs font-semibold text-sky-200">Available</span>
              <span className="text-base font-extrabold text-white">{totalCount} Lectures</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15">
            <CheckCircle size={20} weight="fill" className="text-emerald-300" />
            <div>
              <span className="block text-xs font-semibold text-sky-200">Completed</span>
              <span className="text-base font-extrabold text-white">{completedCount} Lectures</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh recordings list"
            className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
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
      <div className="flex flex-col space-y-4 bg-white p-4 sm:p-5 rounded-3xl border border-sky-100 shadow-xs">
        {/* Row 1: Search & Watch Status Tabs */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-[260px]">
            <MagnifyingGlass
              size={17}
              weight="bold"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search lectures by topic, teacher, subject..."
              aria-label="Search recordings"
              className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search query"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>

          {/* Watch Status Segmented Filter */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-slate-100 border border-slate-200/80 overflow-x-auto no-scrollbar">
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
                      ? 'bg-white text-sky-700 shadow-xs font-extrabold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        active ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-600'
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
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          {/* Subject Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-400 mr-1 hidden sm:inline">Subject:</span>
            <button
              type="button"
              onClick={() => onSubjectChange('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedSubject === 'all'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
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
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
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
                className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-sky-500 transition-colors"
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
              className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-sky-500 transition-colors"
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
