'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  IconWarning,
  IconRefresh,
} from '@/components/icons/student-icons';
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
    <div className="store-container space-y-7 pb-12">
      {/* Breadcrumbs */}
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link href="/student/overview">My Learning</Link>
        <span aria-hidden="true">/</span>
        <span>Recorded Classes</span>
      </nav>

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
        <div className="student-card border-rose-200 bg-rose-50/70 text-rose-800 flex flex-col sm:flex-row items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <IconWarning size={24} className="text-rose-600 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-bold">Failed to load recorded classes</h4>
              <p className="text-xs text-rose-600 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadData(false)}
            className="px-4 py-2 min-h-[44px] rounded-field bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors inline-flex items-center gap-2 shadow-xs"
          >
            <IconRefresh size={14} />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <StudentRecordingsSkeleton />
      ) : !error && hubData && hubData.totalCount === 0 ? (
        <StudentRecordingsEmptyState isFiltered={false} />
      ) : !error && filteredRecordings.length === 0 ? (
        <StudentRecordingsEmptyState isFiltered={true} onResetFilters={handleResetFilters} />
      ) : (
        <StudentRecordingsGrid recordings={filteredRecordings} />
      )}
    </div>
  );
}
