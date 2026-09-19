'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChatCircleDots,
  Plus,
  MagnifyingGlass,
  Funnel,
  X,
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
  WarningCircle,
} from '@phosphor-icons/react';
import { useMyDoubts } from '@/hooks/doubt/useDoubt';
import { StudentDoubtStats } from '@/components/student/doubts/StudentDoubtStats';
import { StudentDoubtCard } from '@/components/student/doubts/StudentDoubtCard';
import { StudentAskDoubtModal } from '@/components/student/doubts/StudentAskDoubtModal';
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
            <Link href="/student/overview">Student Hub</Link>
            <span aria-hidden="true">/</span>
            <span>Doubts & Support</span>
          </nav>
          <div className="flex items-center gap-2.5 mt-1">
            <ChatCircleDots size={28} weight="duotone" style={{ color: 'var(--color-store-blue)' }} />
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              My Academic Doubts
            </h1>
          </div>
          <p className="student-hero-lead">
            Get your academic questions resolved by assigned subject faculty with step-by-step verified explanations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all disabled:opacity-50 shadow-xs"
            title="Refresh doubts"
          >
            <ArrowsClockwise size={18} className={isFetching ? 'animate-spin text-store-blue' : ''} />
          </button>

          <button
            type="button"
            onClick={handleOpenAskModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-bold text-xs sm:text-sm shadow-xs hover:opacity-90 transition-all"
            style={{ backgroundColor: 'var(--color-store-blue)' }}
          >
            <Plus size={18} weight="bold" />
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
      <div className="student-card space-y-4">
        {/* Status Tabs */}
        <div className="student-filter-strip mb-0 pb-0">
          {[
            { id: 'all', label: 'All Doubts' },
            { id: 'open', label: 'Open' },
            { id: 'in_progress', label: 'In Progress' },
            { id: 'resolved', label: 'Resolved' },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id as StatusTab)}
                className={`student-filter-btn ${active ? 'active' : ''}`}
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
            <MagnifyingGlass
              size={16}
              weight="bold"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search doubts by question title, topic or description..."
              className="w-full h-10 pl-9 pr-8 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-store-blue focus:bg-white transition-all"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md"
              >
                <X size={14} weight="bold" />
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
                className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 outline-none focus:border-store-blue focus:bg-white transition-all"
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
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 transition-colors shrink-0"
            >
              <X size={14} weight="bold" />
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
              className="student-card animate-pulse space-y-3 h-36"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="student-card border-rose-200 bg-rose-50 p-6 text-center space-y-3">
          <div className="inline-flex p-2.5 rounded-full bg-rose-100 text-rose-600">
            <WarningCircle size={24} weight="duotone" />
          </div>
          <h3 className="text-sm font-bold text-rose-900">
            Failed to Load Doubts
          </h3>
          <p className="text-xs text-rose-700 max-w-md mx-auto">
            {error instanceof Error ? error.message : 'An error occurred while loading your doubts.'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : doubts.length === 0 ? (
        isFiltered ? (
          <div className="student-card text-center p-10 space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-slate-100 text-slate-400">
              <Funnel size={28} weight="duotone" />
            </div>
            <h3 className="text-base font-extrabold text-slate-900">
              No Doubts Match Your Filters
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              We couldn't find any questions matching your current search or status filters.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-4 py-2 rounded-xl text-white text-xs font-bold shadow-xs transition-colors"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className="student-card text-center p-12 sm:p-16 space-y-4 max-w-lg mx-auto">
            <div className="inline-flex p-4 rounded-3xl" style={{ background: 'var(--color-store-sky)', color: 'var(--color-store-blue)' }}>
              <ChatCircleDots size={36} weight="duotone" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900">
                No Doubts Asked Yet
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Have a question while studying? Submit your doubt with attachments and get detailed faculty solutions.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenAskModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-bold text-xs shadow-xs hover:opacity-90 transition-all"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
            >
              <Plus size={16} weight="bold" />
              <span>Ask Your First Doubt</span>
            </button>
          </div>
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
            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-500">
                Showing <span className="font-bold text-slate-800 tabular-nums">{(page - 1) * PAGE_SIZE + 1}</span> to{' '}
                <span className="font-bold text-slate-800 tabular-nums">
                  {Math.min(page * PAGE_SIZE, paginatedData?.count ?? 0)}
                </span>{' '}
                of <span className="font-bold text-slate-800 tabular-nums">{paginatedData?.count ?? 0}</span> doubts
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || isFetching}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <CaretLeft size={14} weight="bold" />
                  <span>Prev</span>
                </button>

                <span className="px-2 text-xs font-bold text-slate-700 tabular-nums">
                  {page} / {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isFetching}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <span>Next</span>
                  <CaretRight size={14} weight="bold" />
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
          <div className="h-8 w-64 bg-slate-200 rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-slate-200 rounded-2xl" />
            ))}
          </div>
        </div>
      }
    >
      <StudentDoubtsHubContent />
    </Suspense>
  );
}
