'use client';

import React, { useState, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  IconWarning,
  IconRefresh,
} from '@/components/icons/student-icons';
import {
  useStudentActiveBatchIds,
  useStudentRecordingSubjects,
  useStudentRecordingsInfinite,
} from '@/hooks/student/useStudentRecordings';
import type {
  StudentRecording,
  WatchStatusFilter,
  RecordingSortOption,
} from '@/services/student/studentRecordingWebService';
import { StudentRecordingsHeader } from '@/components/student/recordings/StudentRecordingsHeader';
import { StudentSubjectCardsGrid } from '@/components/student/recordings/StudentSubjectCardsGrid';
import { StudentRecordingsGrid } from '@/components/student/recordings/StudentRecordingsGrid';
import { StudentRecordingsSkeleton } from '@/components/student/recordings/StudentRecordingsSkeleton';
import { StudentRecordingsEmptyState } from '@/components/student/recordings/StudentRecordingsEmptyState';

function StudentRecordingsHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSubjectId = searchParams.get('subject') || null;

  // 1. Resolve Active Batch IDs (Tier 1: Synchronous React Query cache -> Tier 2: in-flight -> Tier 3: fallback)
  const {
    batchIds,
    isLoading: isBatchLoading,
    isError: isBatchError,
    error: batchError,
    refetch: refetchBatches,
  } = useStudentActiveBatchIds();

  // 2. Level 1: Fetch Subject Summaries via RPC (Only subjects with >= 1 recording)
  const {
    data: subjects = [],
    isLoading: isSubjectsLoading,
    isError: isSubjectsError,
    error: subjectsError,
    refetch: refetchSubjects,
    isFetching: isSubjectsFetching,
  } = useStudentRecordingSubjects(batchIds, {
    enabled: !isBatchLoading && batchIds.length > 0,
  });

  // Calculate total recordings across all subjects
  const totalLibraryLectures = useMemo(() => {
    return subjects.reduce((sum, s) => sum + s.recordingCount, 0);
  }, [subjects]);

  // Identify active subject
  const currentSubject = useMemo(() => {
    if (!selectedSubjectId) return null;
    return subjects.find((s) => s.subjectId === selectedSubjectId) ?? null;
  }, [subjects, selectedSubjectId]);

  // 3. Level 2: Fetch Subject Recordings via Keyset Cursor (20 per page)
  const isLevel2Active = Boolean(selectedSubjectId);
  const {
    data: recordingsData,
    isLoading: isRecordingsLoading,
    isError: isRecordingsError,
    error: recordingsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchRecordings,
    isFetching: isRecordingsFetching,
  } = useStudentRecordingsInfinite(batchIds, selectedSubjectId, {
    enabled: isLevel2Active && !isBatchLoading && batchIds.length > 0,
  });

  // Flatten and deduplicate paginated recordings across pages
  const allLoadedRecordings = useMemo(() => {
    if (!recordingsData?.pages) return [];
    const seen = new Set<string>();
    const list: StudentRecording[] = [];
    for (const page of recordingsData.pages) {
      for (const rec of page.recordings) {
        if (!seen.has(rec.recordingId)) {
          seen.add(rec.recordingId);
          list.push(rec);
        }
      }
    }
    return list;
  }, [recordingsData]);

  // Filter & Search states (Level 2 only)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedWatchStatus, setSelectedWatchStatus] = useState<WatchStatusFilter>('all');
  const [selectedSort, setSelectedSort] = useState<RecordingSortOption>('newest');

  // Filter loaded recordings
  const filteredRecordings = useMemo(() => {
    if (!allLoadedRecordings || allLoadedRecordings.length === 0) return [];
    let list = allLoadedRecordings;

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((rec) => {
        const titleMatch = rec.title.toLowerCase().includes(q);
        const teacherMatch = rec.teacherName?.toLowerCase().includes(q) ?? false;
        const descMatch = rec.description?.toLowerCase().includes(q) ?? false;
        return titleMatch || teacherMatch || descMatch;
      });
    }

    if (selectedWatchStatus === 'completed') {
      list = list.filter((rec) => rec.progress?.isCompleted === true);
    } else if (selectedWatchStatus === 'in_progress') {
      list = list.filter((rec) => !!rec.progress && !rec.progress.isCompleted && rec.progress.lastPositionSeconds > 0);
    } else if (selectedWatchStatus === 'not_started') {
      list = list.filter((rec) => !rec.progress || (!rec.progress.isCompleted && rec.progress.lastPositionSeconds === 0));
    }

    // Deterministic keyset stream order: strictly newest first (assignedAt DESC, recordingId DESC)

    return list;
  }, [allLoadedRecordings, searchQuery, selectedWatchStatus, selectedSort]);

  const isFiltered = useMemo(() => {
    return searchQuery.trim().length > 0 || selectedWatchStatus !== 'all';
  }, [searchQuery, selectedWatchStatus]);

  const handleResetFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedWatchStatus('all');
    setSelectedSort('newest');
  }, []);

  const handleSelectSubject = useCallback(
    (subjectId: string) => {
      handleResetFilters();
      router.push('/student/recordings?subject=' + encodeURIComponent(subjectId));
    },
    [router, handleResetFilters],
  );

  const handleClearSubject = useCallback(() => {
    handleResetFilters();
    router.push('/student/recordings');
  }, [router, handleResetFilters]);

  const handleRefresh = useCallback(() => {
    if (isLevel2Active) {
      refetchRecordings();
    } else {
      refetchBatches();
      refetchSubjects();
    }
  }, [isLevel2Active, refetchRecordings, refetchBatches, refetchSubjects]);

  // Loading & Error States
  const isPageLoading = isBatchLoading || (isLevel2Active ? isRecordingsLoading : isSubjectsLoading);
  const pageError = isBatchError
    ? (batchError?.message || 'Failed to verify batch memberships.')
    : isLevel2Active && isRecordingsError
    ? (recordingsError?.message || 'Failed to load recorded classes for this subject.')
    : isSubjectsError
    ? (subjectsError?.message || 'Failed to load recorded subjects.')
    : null;

  return (
    <div className="store-container space-y-7 pb-12">
      {/* Breadcrumbs */}
      <nav className="store-breadcrumb" aria-label="Breadcrumb">
        <Link href="/student/overview">My Learning</Link>
        <span aria-hidden="true">/</span>
        {isLevel2Active ? (
          <>
            <button
              type="button"
              onClick={handleClearSubject}
              className="hover:underline text-ink-secondary hover:text-ink cursor-pointer"
            >
              Recorded Classes
            </button>
            <span aria-hidden="true">/</span>
            <span className="text-ink font-semibold">
              {currentSubject?.subjectName || 'Subject Lectures'}
            </span>
          </>
        ) : (
          <span>Recorded Classes</span>
        )}
      </nav>

      {/* Header & Controls Section */}
      <StudentRecordingsHeader
        totalCount={isLevel2Active ? (currentSubject?.recordingCount ?? allLoadedRecordings.length) : totalLibraryLectures}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedWatchStatus={selectedWatchStatus}
        onWatchStatusChange={setSelectedWatchStatus}
        selectedSort={selectedSort}
        onSortChange={setSelectedSort}
        onResetFilters={handleResetFilters}
        isFiltered={isFiltered}
        onRefresh={handleRefresh}
        refreshing={isLevel2Active ? isRecordingsFetching : isSubjectsFetching}
        selectedSubjectName={currentSubject?.subjectName}
        onClearSubject={handleClearSubject}
      />

      {/* Error State Banner */}
      {pageError && (
        <div className="student-card border-rose-200 bg-rose-50/70 text-rose-800 flex flex-col sm:flex-row items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <IconWarning size={24} className="text-rose-600 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-bold">Failed to load recorded classes</h4>
              <p className="text-xs text-rose-600 mt-0.5">{pageError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-4 py-2 min-h-[44px] rounded-field bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors inline-flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <IconRefresh size={14} />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {isPageLoading ? (
        <StudentRecordingsSkeleton />
      ) : !pageError && !isLevel2Active ? (
        /* LEVEL 1: Subject Overview Cards Grid (0 individual recording rows fetched) */
        <StudentSubjectCardsGrid
          subjects={subjects}
          onSelectSubject={handleSelectSubject}
        />
      ) : !pageError && isLevel2Active && allLoadedRecordings.length === 0 ? (
        /* LEVEL 2: Empty state for this subject */
        <StudentRecordingsEmptyState isFiltered={false} />
      ) : !pageError && isLevel2Active && filteredRecordings.length === 0 ? (
        /* LEVEL 2: Empty state for search/filter within this subject */
        <StudentRecordingsEmptyState
          isFiltered={true}
          onResetFilters={handleResetFilters}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => fetchNextPage()}
          loadedCount={allLoadedRecordings.length}
        />
      ) : !pageError && isLevel2Active ? (
        /* LEVEL 2: Subject Recordings Grid with Keyset Pagination */
        <StudentRecordingsGrid
          recordings={filteredRecordings}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => fetchNextPage()}
          totalSubjectCount={currentSubject?.recordingCount}
        />
      ) : null}
    </div>
  );
}

export default function StudentRecordingsHubPage() {
  return (
    <Suspense fallback={<StudentRecordingsSkeleton />}>
      <StudentRecordingsHubContent />
    </Suspense>
  );
}
