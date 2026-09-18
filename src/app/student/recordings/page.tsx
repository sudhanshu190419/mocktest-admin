'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  WarningCircle,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchStudentRecordingsHubData,
  filterStudentRecordings,
  type StudentRecordingsHubData,
  type WatchStatusFilter,
  type RecordingSortOption,
} from '@/services/student/studentRecordingWebService';
import { StudentRecordingsHeader } from '@/components/student/recordings/StudentRecordingsHeader';
import { StudentRecordingsGrid } from '@/components/student/recordings/StudentRecordingsGrid';
import { StudentRecordingsSkeleton } from '@/components/student/recordings/StudentRecordingsSkeleton';
import { StudentRecordingsEmptyState } from '@/components/student/recordings/StudentRecordingsEmptyState';

export default function StudentRecordingsHubPage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hubData, setHubData] = useState<StudentRecordingsHubData | null>(null);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [selectedBatch, setSelectedBatch] = useState<string>('all');
  const [selectedWatchStatus, setSelectedWatchStatus] = useState<WatchStatusFilter>('all');
  const [selectedSort, setSelectedSort] = useState<RecordingSortOption>('newest');

  // ── Load Hub Data ──────────────────────────────────────────────────────────
  const loadData = useCallback(
    async (isSilent = false) => {
      if (!isSilent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const res = await fetchStudentRecordingsHubData(user?.id);
        if (res.error) {
          setError(res.error);
        } else {
          setHubData(res.data);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred while loading recordings.';
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── In-Memory Filtered & Sorted Recordings ──────────────────────────────────
  const filteredRecordings = useMemo(() => {
    if (!hubData?.recordings) return [];
    return filterStudentRecordings(hubData.recordings, {
      searchQuery,
      subject: selectedSubject,
      batchId: selectedBatch,
      watchStatus: selectedWatchStatus,
      sortBy: selectedSort,
    });
  }, [
    hubData?.recordings,
    searchQuery,
    selectedSubject,
    selectedBatch,
    selectedWatchStatus,
    selectedSort,
  ]);

  const isFiltered = useMemo(() => {
    return (
      searchQuery.trim().length > 0 ||
      selectedSubject !== 'all' ||
      selectedBatch !== 'all' ||
      selectedWatchStatus !== 'all'
    );
  }, [searchQuery, selectedSubject, selectedBatch, selectedWatchStatus]);

  const handleResetFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedSubject('all');
    setSelectedBatch('all');
    setSelectedWatchStatus('all');
    setSelectedSort('newest');
  }, []);

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Controls Section */}
      <StudentRecordingsHeader
        totalCount={hubData?.totalCount ?? 0}
        completedCount={hubData?.completedCount ?? 0}
        inProgressCount={hubData?.inProgressCount ?? 0}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        availableSubjects={hubData?.availableSubjects ?? []}
        selectedSubject={selectedSubject}
        onSubjectChange={setSelectedSubject}
        availableBatches={hubData?.availableBatches ?? []}
        selectedBatch={selectedBatch}
        onBatchChange={setSelectedBatch}
        selectedWatchStatus={selectedWatchStatus}
        onWatchStatusChange={setSelectedWatchStatus}
        selectedSort={selectedSort}
        onSortChange={setSelectedSort}
        onResetFilters={handleResetFilters}
        isFiltered={isFiltered}
        onRefresh={() => loadData(true)}
        refreshing={refreshing}
      />

      {/* Error State Banner */}
      {error && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-3xl bg-rose-50 border border-rose-200 text-rose-800 shadow-xs">
          <div className="flex items-center gap-3">
            <WarningCircle size={24} weight="fill" className="text-rose-600 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-bold">Failed to load recorded classes</h4>
              <p className="text-xs text-rose-600 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadData(false)}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors inline-flex items-center gap-2 shadow-xs"
          >
            <ArrowsClockwise size={14} weight="bold" />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <StudentRecordingsSkeleton />
      ) : !error && hubData && hubData.totalCount === 0 ? (
        /* Zero recordings in total */
        <StudentRecordingsEmptyState isFiltered={false} />
      ) : !error && filteredRecordings.length === 0 ? (
        /* Filters produced zero matches */
        <StudentRecordingsEmptyState isFiltered={true} onResetFilters={handleResetFilters} />
      ) : (
        /* Recording Cards Grid */
        <StudentRecordingsGrid recordings={filteredRecordings} />
      )}
    </div>
  );
}
