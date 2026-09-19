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
            <Link href="/student/overview">Student Hub</Link>
            <span aria-hidden="true">/</span>
            <span>Live Classes</span>
          </nav>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Live Classes Hub
            </h1>
            {data?.summary && data.summary.totalLive > 0 && (
              <span className="student-pill student-pill-apricot text-rose-700 bg-rose-50 border border-rose-200">
                <span className="student-live-dot bg-rose-500" />
                <span>{data.summary.totalLive} Live</span>
              </span>
            )}
          </div>
          <p className="student-hero-lead">
            Attend live interactive lectures, interact with faculty in real-time, and access recorded archives.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/student/recordings"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold transition-colors shadow-xs"
          >
            <FilmReel size={15} weight="bold" className="text-slate-500" />
            <span>View Recordings</span>
          </Link>

          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors disabled:opacity-60 shadow-xs"
            title="Refresh schedule"
          >
            <ArrowsClockwise
              size={15}
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
        <div className="student-card border-rose-100 bg-rose-50/60 p-8 text-center max-w-xl mx-auto my-8 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
            <WarningCircle size={24} weight="bold" />
          </div>
          <h3 className="text-base font-extrabold text-rose-900">Failed to load classes</h3>
          <p className="text-xs text-rose-700 max-w-md mx-auto">{error}</p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => loadData()}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors shadow-sm"
            >
              <ArrowsClockwise size={14} weight="bold" />
              <span>Try Again</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Main Content Body ─── */}
      {!loading && !error && data && (
        <div className="space-y-6">
          {/* 1. KPI Stats Metric Cards */}
          <div className="student-kpi-grid">
            <div className="student-kpi-card">
              <div className="student-kpi-top">
                <span className="student-kpi-label">Live Now</span>
                <Broadcast
                  size={18}
                  weight={data.summary.totalLive > 0 ? 'fill' : 'regular'}
                  className={data.summary.totalLive > 0 ? 'text-rose-500 animate-pulse' : 'text-slate-400'}
                />
              </div>
              <div className="student-kpi-value tabular-nums">{data.summary.totalLive}</div>
              <p className="student-kpi-sub">ongoing lectures</p>
            </div>

            <div className="student-kpi-card">
              <div className="student-kpi-top">
                <span className="student-kpi-label">Upcoming</span>
                <Clock size={18} weight="bold" style={{ color: 'var(--color-store-blue)' }} />
              </div>
              <div className="student-kpi-value tabular-nums">{data.summary.totalUpcoming}</div>
              <p className="student-kpi-sub">scheduled</p>
            </div>

            <div className="student-kpi-card">
              <div className="student-kpi-top">
                <span className="student-kpi-label">Completed</span>
                <CheckCircle size={18} weight="bold" style={{ color: 'var(--color-store-green)' }} />
              </div>
              <div className="student-kpi-value tabular-nums">{data.summary.totalCompleted}</div>
              <p className="student-kpi-sub">archived</p>
            </div>

            <div className="student-kpi-card">
              <div className="student-kpi-top">
                <span className="student-kpi-label">Active Subjects</span>
                <BookOpen size={18} weight="bold" style={{ color: 'var(--color-store-violet)' }} />
              </div>
              <div className="student-kpi-value tabular-nums">{data.summary.totalSubjects}</div>
              <p className="student-kpi-sub">enrolled</p>
            </div>
          </div>

          {/* 2. Hero Broadcast Banner (When 1+ class is live) */}
          {primaryLiveClass && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-600 animate-ping" />
                  Currently Streaming
                </span>
                <span className="text-xs text-slate-500 font-medium">
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
              <div className="student-filter-strip mb-0 pb-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('live_upcoming')}
                  className={`student-filter-btn ${activeTab === 'live_upcoming' ? 'active' : ''}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={14} weight={activeTab === 'live_upcoming' ? 'bold' : 'regular'} />
                    <span>Live & Upcoming</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">
                      {data.liveNow.length + data.upcoming.length}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('past')}
                  className={`student-filter-btn ${activeTab === 'past' ? 'active' : ''}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={14} weight={activeTab === 'past' ? 'bold' : 'regular'} />
                    <span>Past Classes</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">
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
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by title, teacher, topic..."
                    className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-store-blue transition-all"
                  />
                </div>

                {/* Subject filter */}
                {data.subjects.length > 0 && (
                  <select
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-store-blue"
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
                    className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-store-blue"
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
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition-colors"
                    title="Clear filters"
                  >
                    <ArrowsClockwise size={14} weight="bold" />
                  </button>
                )}
              </div>
            </div>

            {/* Active filter summary pill */}
            {hasActiveFilters && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold">Showing results for:</span>
                {searchQuery && (
                  <span className="student-pill student-pill-sky">"{searchQuery}"</span>
                )}
                {selectedSubject !== 'all' && (
                  <span className="student-pill student-pill-mint">Subject: {selectedSubject}</span>
                )}
                {selectedBatch !== 'all' && (
                  <span className="student-pill student-pill-lilac">Batch: {selectedBatch}</span>
                )}
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-xs font-bold hover:underline ml-1"
                  style={{ color: 'var(--color-store-blue)' }}
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
