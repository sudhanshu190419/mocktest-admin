'use client';

/**
 * Student Mock Tests / Exam Center Page
 *
 * Route: /student/tests
 *
 * Comprehensive assessment hub for enrolled students:
 *   - Real counts for Available, In Progress, and Completed tests
 *   - Tab filtering (All, Assigned, In Progress, Completed, Upcoming)
 *   - Live search by test title, subject, or course
 *   - Performance scorecard snippet for completed tests
 *   - Single batched query layer eliminating N+1 overhead
 *
 * @module app/student/tests/page
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Exam,
  MagnifyingGlass,
  ArrowClockwise,
  Sparkle,
  CheckCircle,
  Clock,
  WarningCircle,
  Funnel,
  ArrowLeft,
  XCircle,
  LockKey,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';
import {
  fetchStudentAssignedMockTests,
  type StudentMockTestCardItem,
  type StudentTestsHubSummary,
  type StudentTestFilterTab,
} from '@/services/student/studentTestWebService';
import { StudentTestCard } from '@/components/student/tests/StudentTestCard';

export default function StudentTestsHubPage() {
  const [tests, setTests] = useState<StudentMockTestCardItem[]>([]);
  const [summary, setSummary] = useState<StudentTestsHubSummary>({
    total: 0,
    available: 0,
    inProgress: 0,
    completed: 0,
    upcoming: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search State
  const [activeTab, setActiveTab] = useState<StudentTestFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [showExpired, setShowExpired] = useState<boolean>(false);

  const loadTests = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchStudentAssignedMockTests();
      if (data.error) {
        setError(data.error);
      } else {
        setTests(data.tests);
        setSummary(data.summary);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load assigned mock tests');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTests();
  }, [loadTests]);

  // Split into active (current) vs expired tests
  const activeTests = useMemo(() => {
    return tests.filter((t) => t.availabilityStatus !== 'expired');
  }, [tests]);

  const expiredTests = useMemo(() => {
    return tests.filter((t) => t.availabilityStatus === 'expired');
  }, [tests]);

  // Unique Subjects for filter dropdown
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    tests.forEach((t) => {
      if (t.subjectName) subjects.add(t.subjectName);
    });
    return Array.from(subjects).sort();
  }, [tests]);

  // Active tests filtered by tab, subject, and search query
  const filteredTests = useMemo(() => {
    return activeTests.filter((test) => {
      // 1. Tab Filter
      if (activeTab === 'assigned' && test.availabilityStatus !== 'available') {
        return false;
      }
      if (activeTab === 'in_progress' && test.attemptSummary.attemptState !== 'in_progress') {
        return false;
      }
      if (activeTab === 'completed' && test.attemptSummary.attemptState !== 'submitted') {
        return false;
      }
      if (activeTab === 'upcoming' && test.availabilityStatus !== 'upcoming') {
        return false;
      }

      // 2. Subject Filter
      if (selectedSubject !== 'all' && test.subjectName !== selectedSubject) {
        return false;
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = test.title.toLowerCase().includes(q);
        const matchSubject = test.subjectName?.toLowerCase().includes(q) ?? false;
        const matchCourse = test.courseTitle?.toLowerCase().includes(q) ?? false;
        const matchType = test.testType.toLowerCase().includes(q);
        if (!matchTitle && !matchSubject && !matchCourse && !matchType) {
          return false;
        }
      }

      return true;
    });
  }, [activeTests, activeTab, selectedSubject, searchQuery]);

  // Expired tests filtered by subject and search query
  const filteredExpiredTests = useMemo(() => {
    return expiredTests.filter((test) => {
      // Subject Filter
      if (selectedSubject !== 'all' && test.subjectName !== selectedSubject) {
        return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = test.title.toLowerCase().includes(q);
        const matchSubject = test.subjectName?.toLowerCase().includes(q) ?? false;
        const matchCourse = test.courseTitle?.toLowerCase().includes(q) ?? false;
        const matchType = test.testType.toLowerCase().includes(q);
        if (!matchTitle && !matchSubject && !matchCourse && !matchType) {
          return false;
        }
      }

      return true;
    });
  }, [expiredTests, selectedSubject, searchQuery]);

  // Dynamic active tab counts
  const activeTabCounts = useMemo(() => {
    return {
      all: activeTests.length,
      assigned: activeTests.filter((t) => t.availabilityStatus === 'available').length,
      inProgress: activeTests.filter((t) => t.attemptSummary.attemptState === 'in_progress').length,
      completed: activeTests.filter((t) => t.attemptSummary.attemptState === 'submitted').length,
      upcoming: activeTests.filter((t) => t.availabilityStatus === 'upcoming').length,
    };
  }, [activeTests]);

  return (
    <div className="space-y-6 sm:space-y-8 pb-12">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <Link
            href="/student/overview"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 mb-2 transition-colors"
          >
            <ArrowLeft size={14} weight="bold" />
            <span>Back to Dashboard</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Exam className="h-5 w-5" weight="bold" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Mock Tests
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Practice, attempt and review your assigned tests
              </p>
            </div>
          </div>
        </div>

        {/* Real Summary Metrics Bar */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-xs">
            <Sparkle className="h-4 w-4 text-indigo-600" weight="bold" />
            <div>
              <p className="text-[10px] font-medium text-slate-400">Available</p>
              <p className="text-sm font-extrabold text-slate-900">{activeTabCounts.assigned}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2 shadow-xs">
            <ArrowClockwise className="h-4 w-4 text-sky-600 animate-pulse" weight="bold" />
            <div>
              <p className="text-[10px] font-medium text-sky-700">In Progress</p>
              <p className="text-sm font-extrabold text-sky-950">{activeTabCounts.inProgress}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 shadow-xs">
            <CheckCircle className="h-4 w-4 text-emerald-600" weight="bold" />
            <div>
              <p className="text-[10px] font-medium text-emerald-700">Completed</p>
              <p className="text-sm font-extrabold text-emerald-950">{activeTabCounts.completed}</p>
            </div>
          </div>

          {activeTabCounts.upcoming > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2 shadow-xs">
              <Clock className="h-4 w-4 text-amber-600" weight="bold" />
              <div>
                <p className="text-[10px] font-medium text-amber-700">Upcoming</p>
                <p className="text-sm font-extrabold text-amber-950">{activeTabCounts.upcoming}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filter Tabs & Search Bar Row */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveTab('all')}
            className={'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ' + (
              activeTab === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <span>All Active</span>
            <span className={'rounded-full px-1.5 py-0.2 text-[10px] ' + (
              activeTab === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'
            )}>
              {activeTabCounts.all}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('assigned')}
            className={'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ' + (
              activeTab === 'assigned'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <span>Assigned</span>
            <span className={'rounded-full px-1.5 py-0.2 text-[10px] ' + (
              activeTab === 'assigned' ? 'bg-indigo-700 text-white' : 'bg-slate-200 text-slate-700'
            )}>
              {activeTabCounts.assigned}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('in_progress')}
            className={'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ' + (
              activeTab === 'in_progress'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <span>In Progress</span>
            {activeTabCounts.inProgress > 0 && (
              <span className={'rounded-full px-1.5 py-0.2 text-[10px] ' + (
                activeTab === 'in_progress' ? 'bg-sky-700 text-white' : 'bg-sky-100 text-sky-800'
              )}>
                {activeTabCounts.inProgress}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('completed')}
            className={'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ' + (
              activeTab === 'completed'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <span>Completed</span>
            {activeTabCounts.completed > 0 && (
              <span className={'rounded-full px-1.5 py-0.2 text-[10px] ' + (
                activeTab === 'completed' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800'
              )}>
                {activeTabCounts.completed}
              </span>
            )}
          </button>

          {activeTabCounts.upcoming > 0 && (
            <button
              onClick={() => setActiveTab('upcoming')}
              className={'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ' + (
                activeTab === 'upcoming'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <span>Upcoming</span>
              <span className={'rounded-full px-1.5 py-0.2 text-[10px] ' + (
                activeTab === 'upcoming' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'
              )}>
                {activeTabCounts.upcoming}
              </span>
            </button>
          )}
        </div>

        {/* Search Input & Subject Filter */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <MagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search tests, subjects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-xs text-slate-800 placeholder-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <XCircle size={14} weight="fill" />
              </button>
            )}
          </div>

          {availableSubjects.length > 0 && (
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white py-2 px-3 text-xs font-medium text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
            >
              <option value="all">All Subjects</option>
              {availableSubjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs animate-pulse space-y-4"
            >
              <div className="flex justify-between">
                <div className="h-5 w-24 bg-slate-200 rounded-full" />
                <div className="h-5 w-20 bg-slate-200 rounded-full" />
              </div>
              <div className="h-6 w-3/4 bg-slate-200 rounded-lg mt-2" />
              <div className="h-4 w-1/2 bg-slate-100 rounded-md" />
              <div className="grid grid-cols-4 gap-2 pt-4">
                <div className="h-12 bg-slate-100 rounded-xl" />
                <div className="h-12 bg-slate-100 rounded-xl" />
                <div className="h-12 bg-slate-100 rounded-xl" />
                <div className="h-12 bg-slate-100 rounded-xl" />
              </div>
              <div className="h-10 bg-slate-200 rounded-xl mt-4" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 sm:p-12 rounded-3xl bg-rose-50/50 border border-rose-200 text-center max-w-xl mx-auto my-8 space-y-4">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-rose-100 text-rose-600 mx-auto">
            <WarningCircle size={24} weight="bold" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Could Not Load Mock Tests</h2>
          <p className="text-xs text-slate-500 leading-relaxed">{error}</p>
          <button
            onClick={loadTests}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 transition-colors shadow-sm"
          >
            <ArrowClockwise size={14} weight="bold" />
            <span>Try Again</span>
          </button>
        </div>
      ) : filteredTests.length === 0 ? (
        <div className="p-8 sm:p-12 rounded-3xl bg-white border border-slate-200 shadow-xs text-center max-w-xl mx-auto my-8 space-y-4">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto">
            <Exam size={28} weight="duotone" />
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            {searchQuery || selectedSubject !== 'all' || activeTab !== 'all'
              ? 'No matching active tests found'
              : 'No active mock tests available'}
          </h2>

          <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
            {searchQuery || selectedSubject !== 'all' || activeTab !== 'all'
              ? 'Try resetting your search query or switching tabs to see more assessments.'
              : 'Tests assigned by your teachers and curriculum schedule will appear here automatically.'}
          </p>

          {(searchQuery || selectedSubject !== 'all' || activeTab !== 'all') ? (
            <button
              onClick={() => {
                setActiveTab('all');
                setSearchQuery('');
                setSelectedSubject('all');
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors shadow-sm"
            >
              <span>Clear All Filters</span>
            </button>
          ) : (
            <Link
              href="/student/courses"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 text-white font-bold text-xs hover:bg-sky-700 transition-colors shadow-sm"
            >
              <span>Explore My Courses</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredTests.map((test) => (
            <StudentTestCard key={test.testId} test={test} />
          ))}
        </div>
      )}

      {/* Dedicated Expired Tests Section at bottom */}
      {!isLoading && !error && expiredTests.length > 0 && (
        <div className="mt-12 pt-8 border-t border-slate-200">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700">
                  <LockKey className="h-5 w-5" weight="bold" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">Expired Tests</h2>
                    <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-extrabold text-slate-700">
                      {expiredTests.length}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Past assessments whose attempt window has closed. You can view scorecards and solutions for previously submitted tests.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowExpired((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:border-slate-300 transition-all shadow-xs shrink-0"
              >
                <span>{showExpired ? 'Hide Expired Tests' : 'View Expired Tests'}</span>
                {showExpired ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
              </button>
            </div>

            {/* Expired Tests Grid (Accordion) */}
            {showExpired && (
              <div className="mt-6 pt-6 border-t border-slate-200/80">
                {filteredExpiredTests.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-4">
                    No expired tests match your current search/filter.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filteredExpiredTests.map((test) => (
                      <StudentTestCard key={test.testId} test={test} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
