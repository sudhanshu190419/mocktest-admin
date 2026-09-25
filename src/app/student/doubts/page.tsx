'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  IconDoubt,
  IconPlus,
  IconSearch,
  IconFilter,
  IconClose,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
} from '@/components/icons/student-icons';
import { useMyDoubts } from '@/hooks/doubt/useDoubt';
import { StudentDoubtStats } from '@/components/student/doubts/StudentDoubtStats';
import { StudentDoubtCard } from '@/components/student/doubts/StudentDoubtCard';
import { StudentAskDoubtModal } from '@/components/student/doubts/StudentAskDoubtModal';
import { Skeleton, ErrorState, EmptyState } from '@/components/ui/mmt';
import type { ContextualDoubtParams } from '@/services/student/studentDoubtAcademicService';
import type { DoubtFilters, DoubtStatus, DoubtResourceType, StudentDoubt } from '@/types/doubt';

const PAGE_SIZE = 12;

type StatusTab = 'all' | 'open' | 'in_progress' | 'resolved';

function StudentDoubtsHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ─── Query Params State ──────────────────────────────────────────────────
  const initialStatus = (searchParams.get('status') as StatusTab) || 'all';
  const initialSearch = searchParams.get('search') || '';
  const initialSubject = searchParams.get('subject') || '';
  const isNewQuery = searchParams.get('new') === 'true';

  const [activeTab, setActiveTab] = useState<StatusTab>(initialStatus);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(initialSubject);
  const [page, setPage] = useState(1);
  const [isAskModalOpen, setIsAskModalOpen] = useState(isNewQuery);

  // Parse contextual parameters from searchParams
  const modalInitialContext = useMemo<ContextualDoubtParams>(() => {
    return {
      batchId: searchParams.get('batchId') || null,
      subjectId: searchParams.get('subjectId') || null,
      chapterId: searchParams.get('chapterId') || null,
      topicId: searchParams.get('topicId') || null,
      batchSubjectId: searchParams.get('batchSubjectId') || null,
      relatedResourceType: (searchParams.get('resourceType') as DoubtResourceType) || null,
      relatedResourceId: searchParams.get('resourceId') || null,
      prefillTitle: searchParams.get('title') || null,
    };
  }, [searchParams]);

  // Sync `isAskModalOpen` when `?new=true` changes in URL
  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setIsAskModalOpen(true);
    }
  }, [searchParams]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput]);

  // ─── Query Filters ───────────────────────────────────────────────────────
  const filters = useMemo<DoubtFilters>(() => {
    const f: DoubtFilters = {};
    if (activeTab !== 'all') {
      f.status = activeTab as DoubtStatus;
    }
    if (debouncedSearch.trim()) {
      f.search = debouncedSearch.trim();
    }
    if (selectedSubjectId) {
      f.subjectId = selectedSubjectId;
    }
    return f;
  }, [activeTab, debouncedSearch, selectedSubjectId]);

  // ─── Data Fetching ───────────────────────────────────────────────────────
  const {
    data: paginatedData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useMyDoubts(filters, { page, pageSize: PAGE_SIZE });

  const doubts = paginatedData?.data ?? [];
  const totalPages = paginatedData?.pageCount ?? 1;

  // ─── Summary Stats Query ─────────────────────────────────────────────────
  const { data: allStudentDoubtsData } = useMyDoubts(undefined, {
    page: 1,
    pageSize: 1000,
  });
  const allDoubts = allStudentDoubtsData?.data ?? [];

  const openCount = useMemo(
    () => allDoubts.filter((d: StudentDoubt) => d.status === 'open').length,
    [allDoubts],
  );
  const inProgressCount = useMemo(
    () => allDoubts.filter((d: StudentDoubt) => d.status === 'in_progress').length,
    [allDoubts],
  );
  const resolvedCount = useMemo(
    () => allDoubts.filter((d: StudentDoubt) => d.status === 'resolved').length,
    [allDoubts],
  );

  // Extract unique subjects for dropdown filter
  const availableSubjects = useMemo(() => {
    const map = new Map<string, string>();
    allDoubts.forEach((d: StudentDoubt) => {
      if (d.subjectId && d.subjectName && !map.has(d.subjectId)) {
        map.set(d.subjectId, d.subjectName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allDoubts]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleTabChange = (tab: StatusTab) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleResetFilters = () => {
    setActiveTab('all');
    setSearchInput('');
    setDebouncedSearch('');
    setSelectedSubjectId('');
    setPage(1);
  };

  const handleOpenAskModal = () => {
    setIsAskModalOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set('new', 'true');
    router.replace(`/student/doubts?${params.toString()}`, { scroll: false });
  };

  const handleCloseAskModal = () => {
    setIsAskModalOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('new');
    params.delete('batchId');
    params.delete('subjectId');
    params.delete('chapterId');
    params.delete('topicId');
    params.delete('batchSubjectId');
    params.delete('resourceType');
    params.delete('resourceId');
    params.delete('title');
    const newQuery = params.toString();
    router.replace(newQuery ? `/student/doubts?${newQuery}` : '/student/doubts', { scroll: false });
  };

  const isFiltered = activeTab !== 'all' || debouncedSearch.trim() !== '' || selectedSubjectId !== '';

  return (
    <div className="store-container space-y-7 pb-12">
      {/* ─── Header & Top Actions ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">My Learning</Link>
            <span aria-hidden="true">/</span>
            <span>Doubts & Support</span>
          </nav>
          <div className="flex items-center gap-2.5 mt-1">
            <IconDoubt size={28} className="text-brand" />
            <h1 className="text-2xl sm:text-display font-extrabold text-ink tracking-tight">
              My Academic Doubts
            </h1>
          </div>
          <p className="text-body text-ink-secondary leading-relaxed">
            Get your academic questions resolved by assigned subject faculty with step-by-step verified explanations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-field border border-line bg-surface text-ink-secondary hover:text-ink hover:bg-paper transition-all disabled:opacity-50 shadow-xs"
            title="Refresh doubts"
          >
            <IconRefresh size={18} className={isFetching ? 'animate-spin text-brand' : ''} />
          </button>

          <button
            type="button"
            onClick={handleOpenAskModal}
            className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 rounded-field bg-brand text-white font-bold text-body shadow-xs hover:bg-brand-hover active:scale-[0.98] transition-all"
          >
            <IconPlus size={18} />
            <span>Ask a Doubt</span>
          </button>
        </div>
      </div>

      {/* ─── Metric Cards ─────────────────────────────────────────────────── */}
      <StudentDoubtStats
        totalCount={allDoubts.length}
        openCount={openCount}
        inProgressCount={inProgressCount}
        resolvedCount={resolvedCount}
        activeStatus={activeTab}
        onStatusSelect={(st) => handleTabChange(st as StatusTab)}
        isLoading={isLoading}
      />

      {/* ─── Filters & Search Toolbar ─────────────────────────────────────── */}
      <div className="rounded-card border border-line bg-surface p-4 sm:p-5 shadow-card space-y-4">
        {/* Status Tabs (Vocabulary compliant) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {[
            { id: 'all', label: `All Doubts (${allDoubts.length})` },
            { id: 'open', label: `Waiting on Faculty (${openCount})` },
            { id: 'in_progress', label: `Faculty is on It (${inProgressCount})` },
            { id: 'resolved', label: `Resolved (${resolvedCount})` },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id as StatusTab)}
                className={`min-h-[44px] rounded-field px-3.5 py-1.5 text-body font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-brand text-white shadow-xs'
                    : 'bg-paper text-ink-secondary hover:bg-sky-tint'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search and Subject Dropdown */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <IconSearch
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
            />
            <input
              type="text"
              aria-label="Search doubts"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search doubts by question title, topic or description..."
              className="w-full min-h-[44px] pl-9 pr-8 rounded-field bg-paper border border-line text-body font-medium text-ink placeholder:text-ink-muted outline-none focus:border-brand focus:bg-surface transition-all"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink-secondary rounded-field"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>

          {/* Subject Filter Dropdown */}
          {availableSubjects.length > 0 && (
            <div className="sm:w-56 shrink-0">
              <select
                value={selectedSubjectId}
                onChange={(e) => {
                  setSelectedSubjectId(e.target.value);
                  setPage(1);
                }}
                className="w-full min-h-[44px] px-3 rounded-field bg-paper border border-line text-body font-medium text-ink outline-none focus:border-brand focus:bg-surface transition-all"
              >
                <option value="">All Subjects</option>
                {availableSubjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Reset Filters CTA */}
          {isFiltered && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3.5 py-2 rounded-field text-body font-bold text-ink-secondary bg-paper hover:bg-sky-tint hover:text-ink transition-colors shrink-0"
            >
              <IconClose size={14} />
              <span>Reset Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── Content States ───────────────────────────────────────────────── */}
      {isLoading && !paginatedData ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="rounded-card border border-line bg-surface p-5 shadow-card space-y-3 h-36 animate-pulse"
            >
              <Skeleton className="h-5 w-32 rounded-full" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Failed to Load Doubts"
          detail={error instanceof Error ? error.message : 'An error occurred while loading your doubts.'}
          onRetry={() => refetch()}
        />
      ) : doubts.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={IconFilter}
            title="No Doubts Match Your Filters"
            detail="We couldn't find any questions matching your current search or status filters."
            action={
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 rounded-field bg-brand text-white font-bold text-body shadow-xs hover:bg-brand-hover transition-all"
              >
                <span>Clear All Filters</span>
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={IconDoubt}
            title="No Doubts Asked Yet"
            detail="Have a question while studying? Submit your doubt with attachments and get detailed faculty solutions."
            action={
              <button
                type="button"
                onClick={handleOpenAskModal}
                className="inline-flex min-h-[44px] items-center gap-2 px-5 py-2.5 rounded-field bg-brand text-white font-bold text-body shadow-xs hover:bg-brand-hover transition-all"
              >
                <IconPlus size={16} />
                <span>Ask Your First Doubt</span>
              </button>
            }
          />
        )
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {doubts.map((doubt: StudentDoubt) => (
              <StudentDoubtCard key={doubt.doubtId} doubt={doubt} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-line">
              <p className="text-caption font-medium text-ink-secondary">
                Showing <span className="font-bold text-ink tabular-nums">{(page - 1) * PAGE_SIZE + 1}</span> to{' '}
                <span className="font-bold text-ink tabular-nums">
                  {Math.min(page * PAGE_SIZE, paginatedData?.count ?? 0)}
                </span>{' '}
                of <span className="font-bold text-ink tabular-nums">{paginatedData?.count ?? 0}</span> doubts
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || isFetching}
                  className="inline-flex min-h-[44px] items-center gap-1 px-3 py-1.5 rounded-field border border-line bg-surface text-caption font-bold text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <IconChevronLeft size={14} />
                  <span>Prev</span>
                </button>

                <span className="px-2 text-caption font-bold text-ink tabular-nums">
                  {page} / {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isFetching}
                  className="inline-flex min-h-[44px] items-center gap-1 px-3 py-1.5 rounded-field border border-line bg-surface text-caption font-bold text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <span>Next</span>
                  <IconChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ask a Doubt Modal */}
      <StudentAskDoubtModal
        isOpen={isAskModalOpen}
        onClose={handleCloseAskModal}
        initialContext={modalInitialContext}
      />
    </div>
  );
}

export default function StudentDoubtsHubPage() {
  return (
    <Suspense
      fallback={
        <div className="store-container space-y-6 pb-12 animate-pulse">
          <Skeleton className="h-8 w-64 rounded-field" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-card" />
            ))}
          </div>
        </div>
      }
    >
      <StudentDoubtsHubContent />
    </Suspense>
  );
}
