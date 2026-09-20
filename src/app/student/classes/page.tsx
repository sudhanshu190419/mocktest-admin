'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Broadcast,
  Calendar,
  Clock,
  BookOpen,
  MagnifyingGlass,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  FilmReel
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchStudentLiveClassesHubData,
  filterStudentLiveClasses,
  type StudentLiveClassesData,
} from '@/services/student/studentLiveClassWebService';
import { LiveNowHeroCard } from '@/components/student/classes/LiveNowHeroCard';
import { StudentLiveClassCard } from '@/components/student/classes/StudentLiveClassCard';
import { StudentClassesEmptyState } from '@/components/student/classes/StudentClassesEmptyState';
import { StudentClassesLoadingSkeleton } from '@/components/student/classes/StudentClassesLoadingSkeleton';
import { ErrorState } from '@/components/ui/mmt';

type HubTab = 'live_upcoming' | 'past';

export default function StudentLiveClassesHubPage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StudentLiveClassesData | null>(null);

  // Filter states
  const [activeTab, setActiveTab] = useState<HubTab>('live_upcoming');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [selectedBatch, setSelectedBatch] = useState<string>('all');

  // Load hub data
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const res = await fetchStudentLiveClassesHubData(user?.id);
      if (res.error) {
        setError(res.error);
      } else {
        setData(res.data);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load live classes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 30-second stale time background refresh polling
  useEffect(() => {
    const interval = setInterval(() => {
      loadData(true);
    }, 30000);

    return () => clearInterval(interval);
  }, [loadData]);

  // Reset all filters helper
  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedSubject('all');
    setSelectedBatch('all');
  };

  const hasActiveFilters = searchQuery.trim() !== '' || selectedSubject !== 'all' || selectedBatch !== 'all';

  // Partitioned datasets for current tab
  const currentTabRawClasses = useMemo(() => {
    if (!data) return [];
    if (activeTab === 'live_upcoming') {
      return [...data.liveNow, ...data.upcoming];
    }
    return data.completed;
  }, [data, activeTab]);

  // Filtered dataset
  const filteredClasses = useMemo(() => {
    return filterStudentLiveClasses(currentTabRawClasses, {
      searchQuery,
      selectedSubject,
      selectedBatch,
    });
  }, [currentTabRawClasses, searchQuery, selectedSubject, selectedBatch]);

  // Primary Live Now class for Hero banner
  const primaryLiveClass = data?.liveNow?.[0] || null;

  return (
    <div className="store-container space-y-7 pb-16">
      {/* ─── Breadcrumb & Top Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">My Learning</Link>
            <span aria-hidden="true">/</span>
            <span>Live Classes</span>
          </nav>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl sm:text-display font-extrabold text-ink tracking-tight">
              Live Classes Hub
            </h1>
            {data?.summary && data.summary.totalLive > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-rose-700 bg-rose-50 border border-rose-200 text-caption font-bold">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                <span>{data.summary.totalLive} Live</span>
              </span>
            )}
          </div>
          <p className="text-body text-ink-secondary leading-relaxed">
            Attend live interactive lectures, interact with faculty in real-time, and access recorded archives.
          </p>
        </div>

        {/* Action buttons (≥44px) */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/student/recordings"
            className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-field bg-surface hover:bg-paper text-ink border border-line text-body font-bold transition-colors shadow-xs"
          >
            <FilmReel size={16} weight="duotone" className="text-brand" />
            <span>View Recordings</span>
          </Link>

          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-field border border-line bg-surface text-ink text-body font-bold hover:bg-paper transition-colors disabled:opacity-60 shadow-xs"
            title="Refresh schedule"
          >
            <ArrowsClockwise
              size={16}
              weight="bold"
              className={refreshing ? 'animate-spin' : ''}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ─── Loading State ─── */}
      {loading && <StudentClassesLoadingSkeleton />}

      {/* ─── Error State ─── */}
      {!loading && error && (
        <ErrorState
          title="Failed to load classes"
          detail={error}
          onRetry={() => loadData()}
        />
      )}

      {/* ─── Main Content Body ─── */}
      {!loading && !error && data && (
        <div className="space-y-6">
          {/* 1. KPI Stats Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 sm:gap-4">
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption font-bold text-ink-secondary uppercase">Live Now</span>
                <Broadcast
                  size={18}
                  weight={data.summary.totalLive > 0 ? 'fill' : 'regular'}
                  className={data.summary.totalLive > 0 ? 'text-rose-500' : 'text-ink-muted'}
                />
              </div>
              <div className="text-2xl sm:text-display font-black text-ink tabular-nums">{data.summary.totalLive}</div>
              <p className="text-caption font-medium text-ink-secondary mt-1">ongoing lectures</p>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption font-bold text-ink-secondary uppercase">Upcoming</span>
                <Clock size={18} weight="duotone" className="text-brand" />
              </div>
              <div className="text-2xl sm:text-display font-black text-ink tabular-nums">{data.summary.totalUpcoming}</div>
              <p className="text-caption font-medium text-ink-secondary mt-1">scheduled</p>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption font-bold text-ink-secondary uppercase">Completed</span>
                <CheckCircle size={18} weight="duotone" className="text-mint-ink" />
              </div>
              <div className="text-2xl sm:text-display font-black text-ink tabular-nums">{data.summary.totalCompleted}</div>
              <p className="text-caption font-medium text-ink-secondary mt-1">archived</p>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption font-bold text-ink-secondary uppercase">Active Subjects</span>
                <BookOpen size={18} weight="duotone" className="text-lilac-ink" />
              </div>
              <div className="text-2xl sm:text-display font-black text-ink tabular-nums">{data.summary.totalSubjects}</div>
              <p className="text-caption font-medium text-ink-secondary mt-1">enrolled</p>
            </div>
          </div>

          {/* 2. Hero Broadcast Banner (When 1+ class is live) */}
          {primaryLiveClass && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-caption font-black uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-600 animate-ping" />
                  Currently Streaming
                </span>
                <span className="text-caption text-ink-secondary font-medium">
                  {data.liveNow.length} class{data.liveNow.length > 1 ? 'es' : ''} in progress
                </span>
              </div>
              <LiveNowHeroCard item={primaryLiveClass} />
            </div>
          )}

          {/* 3. Tab Switcher & Filter Controls */}
          <div className="space-y-4 pt-2">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Tab navigation pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('live_upcoming')}
                  className={`min-h-[44px] rounded-field px-4 py-2 text-body font-bold transition-colors whitespace-nowrap ${
                    activeTab === 'live_upcoming'
                      ? 'bg-brand text-white shadow-xs'
                      : 'bg-paper text-ink-secondary hover:bg-sky-tint'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={15} weight={activeTab === 'live_upcoming' ? 'bold' : 'regular'} />
                    <span>Live & Upcoming</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-caption bg-white/20">
                      {data.liveNow.length + data.upcoming.length}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('past')}
                  className={`min-h-[44px] rounded-field px-4 py-2 text-body font-bold transition-colors whitespace-nowrap ${
                    activeTab === 'past'
                      ? 'bg-brand text-white shadow-xs'
                      : 'bg-paper text-ink-secondary hover:bg-sky-tint'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={15} weight={activeTab === 'past' ? 'bold' : 'regular'} />
                    <span>Past Classes</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-caption bg-white/20">
                      {data.completed.length}
                    </span>
                  </span>
                </button>
              </div>

              {/* Filter controls */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Search input */}
                <div className="relative flex-1 sm:w-60 min-w-[180px]">
                  <MagnifyingGlass
                    size={15}
                    weight="bold"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by title, teacher, topic..."
                    className="w-full min-h-[44px] pl-9 pr-3.5 py-2 rounded-field bg-surface border border-line text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand transition-all"
                  />
                </div>

                {/* Subject filter */}
                {data.subjects.length > 0 && (
                  <select
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="min-h-[44px] px-3 py-2 rounded-field bg-surface border border-line text-body font-semibold text-ink focus:outline-none focus:border-brand"
                  >
                    <option value="all">All Subjects</option>
                    {data.subjects.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                )}

                {/* Batch filter */}
                {data.batches.length > 1 && (
                  <select
                    value={selectedBatch}
                    onChange={(e) => setSelectedBatch(e.target.value)}
                    className="min-h-[44px] px-3 py-2 rounded-field bg-surface border border-line text-body font-semibold text-ink focus:outline-none focus:border-brand"
                  >
                    <option value="all">All Batches</option>
                    {data.batches.map((batch) => (
                      <option key={batch} value={batch}>
                        {batch}
                      </option>
                    ))}
                  </select>
                )}

                {/* Reset button */}
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-field bg-paper hover:bg-sky-tint text-ink-secondary text-body font-bold transition-colors"
                    title="Clear filters"
                  >
                    <ArrowsClockwise size={15} weight="bold" />
                  </button>
                )}
              </div>
            </div>

            {/* Active filter summary pill */}
            {hasActiveFilters && (
              <div className="flex items-center gap-2 text-body text-ink-secondary">
                <span className="font-semibold">Showing results for:</span>
                {searchQuery && (
                  <span className="rounded-full bg-sky-tint px-2.5 py-0.5 text-caption font-bold text-brand-hover">"{searchQuery}"</span>
                )}
                {selectedSubject !== 'all' && (
                  <span className="rounded-full bg-mint-tint px-2.5 py-0.5 text-caption font-bold text-mint-ink">Subject: {selectedSubject}</span>
                )}
                {selectedBatch !== 'all' && (
                  <span className="rounded-full bg-lilac-tint px-2.5 py-0.5 text-caption font-bold text-lilac-ink">Batch: {selectedBatch}</span>
                )}
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-body font-bold text-brand hover:underline ml-1"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* 4. Classes Grid / Empty states */}
          <div>
            {filteredClasses.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {filteredClasses.map((item) => (
                  <StudentLiveClassCard key={item.classId} item={item} />
                ))}
              </div>
            ) : hasActiveFilters ? (
              <StudentClassesEmptyState type="no-results" onResetFilters={handleResetFilters} />
            ) : activeTab === 'live_upcoming' ? (
              <StudentClassesEmptyState type="no-upcoming" />
            ) : (
              <StudentClassesEmptyState type="no-past" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
