'use client';

import React, { useState, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  IconTest,
  IconSearch,
  IconRefresh,
  IconSpark,
  IconCheckCircle,
  IconClock,
  IconWarning,
  IconXCircle,
  IconLock,
  IconChevronDown,
  IconChevronUp,
  IconPyq,
  IconArrowRight,
} from '@/components/icons/student-icons';
import {
  type StudentTestFilterTab,
  type StudentMockTestCardItem,
} from '@/services/student/studentTestWebService';
import { useStudentAssignedMockTests } from '@/hooks/student/useStudentAssignedMockTests';
import { StudentTestCard } from '@/components/student/tests/StudentTestCard';

function StudentTestsHubContent() {
  const searchParams = useSearchParams();
  const typeParam = searchParams?.get('type') || searchParams?.get('tab') || searchParams?.get('section');
  const [sectionDropdown, setSectionDropdown] = useState<'pyqs' | 'mock_test'>(
    typeParam === 'mock' || typeParam === 'mock_test' ? 'mock_test' : 'pyqs'
  );

  const { data, isLoading, error: queryError, refetch } = useStudentAssignedMockTests();
  const tests = useMemo(() => data?.tests || [], [data?.tests]);
  const error = data?.error || (queryError instanceof Error ? queryError.message : null);

  // Filter & Search State
  const [activeTab, setActiveTab] = useState<StudentTestFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [showExpired, setShowExpired] = useState<boolean>(false);

  const loadTests = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // PYQ papers (purchased past papers)
  const pyqPapers = useMemo(() => {
    return tests.filter((t) => t.testType === 'pyq_paper' || t.testType === 'pyq');
  }, [tests]);

  // Filtered PYQ papers
  const filteredPyqPapers = useMemo(() => {
    return pyqPapers.filter((test) => {
      // 1. Subject filter
      if (selectedSubject !== 'all' && test.subjectName !== selectedSubject) {
        return false;
      }
      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = test.title.toLowerCase().includes(q);
        const matchSubject = test.subjectName?.toLowerCase().includes(q) ?? false;
        const matchYear = String(test.year || '').includes(q);
        const matchCourse = test.courseTitle?.toLowerCase().includes(q) ?? false;
        if (!matchTitle && !matchSubject && !matchYear && !matchCourse) {
          return false;
        }
      }
      return true;
    });
  }, [pyqPapers, selectedSubject, searchQuery]);

  // Mock tests (course assigned assessments)
  const mockTests = useMemo(() => {
    return tests.filter((t) => t.testType !== 'pyq_paper' && t.testType !== 'pyq');
  }, [tests]);

  // Split mock tests into active vs expired
  const activeMockTests = useMemo(() => {
    return mockTests.filter((t) => t.availabilityStatus !== 'expired');
  }, [mockTests]);

  const expiredMockTests = useMemo(() => {
    return mockTests.filter((t) => t.availabilityStatus === 'expired');
  }, [mockTests]);

  // Unique Subjects for filter dropdown
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    const source = sectionDropdown === 'pyqs' ? pyqPapers : mockTests;
    source.forEach((t) => {
      if (t.subjectName) subjects.add(t.subjectName);
    });
    return Array.from(subjects).sort();
  }, [sectionDropdown, pyqPapers, mockTests]);

  // Active mock tests filtered by tab, subject, and search query
  const filteredMockTests = useMemo(() => {
    return activeMockTests.filter((test) => {
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
  }, [activeMockTests, activeTab, selectedSubject, searchQuery]);

  // Expired tests filtered by subject and search query
  const filteredExpiredTests = useMemo(() => {
    return expiredMockTests.filter((test) => {
      if (selectedSubject !== 'all' && test.subjectName !== selectedSubject) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = test.title.toLowerCase().includes(q);
        const matchSubject = test.subjectName?.toLowerCase().includes(q) ?? false;
        const matchCourse = test.courseTitle?.toLowerCase().includes(q) ?? false;
        if (!matchTitle && !matchSubject && !matchCourse) {
          return false;
        }
      }
      return true;
    });
  }, [expiredMockTests, selectedSubject, searchQuery]);

  // Dynamic active tab counts for mock tests
  const activeTabCounts = useMemo(() => {
    return {
      all: activeMockTests.length,
      assigned: activeMockTests.filter((t) => t.availabilityStatus === 'available').length,
      inProgress: activeMockTests.filter((t) => t.attemptSummary.attemptState === 'in_progress').length,
      completed: activeMockTests.filter((t) => t.attemptSummary.attemptState === 'submitted').length,
      upcoming: activeMockTests.filter((t) => t.availabilityStatus === 'upcoming').length,
    };
  }, [activeMockTests]);

  return (
    <div className="store-container space-y-7 pb-12">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">My Learning</Link>
            <span aria-hidden="true">/</span>
            <span>{sectionDropdown === 'pyqs' ? 'PYQ & Sample Paper' : 'Mock Tests'}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
              {sectionDropdown === 'pyqs' ? 'PYQ & Sample Paper' : 'Mock Tests'}
            </h1>

            {/* Dropdown with 1. PYQs and 2. Mock Test */}
            <div className="relative">
              <select
                value={sectionDropdown}
                onChange={(e) => {
                  setSectionDropdown(e.target.value as 'pyqs' | 'mock_test');
                  setSelectedSubject('all');
                  setSearchQuery('');
                }}
                aria-label="Select section"
                className="rounded-field border border-line bg-surface py-2 pl-3.5 pr-8 min-h-[44px] text-xs font-bold text-ink hover:border-brand focus:border-brand focus:outline-none transition-all cursor-pointer shadow-xs"
              >
                <option value="pyqs">1. PYQs</option>
                <option value="mock_test">2. Mock Test</option>
              </select>
              <IconChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" />
            </div>
          </div>
        </div>

        {/* Real Summary Metrics Bar */}
        {sectionDropdown === 'mock_test' ? (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="student-card p-3 flex items-center gap-2 min-w-[100px]">
              <IconSpark className="h-4 w-4" style={{ color: 'var(--color-store-blue)' }} />
              <div>
                <p className="text-caption font-bold text-ink-muted uppercase">Available</p>
                <p className="text-sm font-extrabold text-ink tabular-nums">{activeTabCounts.all}</p>
              </div>
            </div>

            <div className="student-card p-3 flex items-center gap-2 min-w-[100px]" style={{ background: 'var(--color-store-sky)' }}>
              <IconRefresh className="h-4 w-4" style={{ color: 'var(--color-store-blue)' }} />
              <div>
                <p className="text-caption font-bold uppercase" style={{ color: 'var(--color-store-blue-dark)' }}>In Progress</p>
                <p className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-store-ink)' }}>{activeTabCounts.inProgress}</p>
              </div>
            </div>

            <div className="student-card p-3 flex items-center gap-2 min-w-[100px]" style={{ background: 'var(--color-store-mint)' }}>
              <IconCheckCircle className="h-4 w-4" style={{ color: 'var(--color-store-green)' }} />
              <div>
                <p className="text-caption font-bold uppercase" style={{ color: 'var(--color-store-green)' }}>Completed</p>
                <p className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-store-green)' }}>{activeTabCounts.completed}</p>
              </div>
            </div>

            {activeTabCounts.upcoming > 0 && (
              <div className="student-card p-3 flex items-center gap-2 min-w-[100px]" style={{ background: 'var(--color-store-sand)' }}>
                <IconClock className="h-4 w-4 text-amber-600" />
                <div>
                  <p className="text-caption font-bold text-amber-700 uppercase">Upcoming</p>
                  <p className="text-sm font-extrabold text-amber-950 tabular-nums">{activeTabCounts.upcoming}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="student-card p-3 flex items-center gap-2 min-w-[110px]">
              <IconPyq className="h-4 w-4 text-brand" />
              <div>
                <p className="text-caption font-bold text-ink-muted uppercase">Purchased Papers</p>
                <p className="text-sm font-extrabold text-ink tabular-nums">{pyqPapers.length}</p>
              </div>
            </div>

            <div className="student-card p-3 flex items-center gap-2 min-w-[110px]" style={{ background: 'var(--color-store-mint)' }}>
              <IconCheckCircle className="h-4 w-4" style={{ color: 'var(--color-store-green)' }} />
              <div>
                <p className="text-caption font-bold uppercase" style={{ color: 'var(--color-store-green)' }}>Attempted</p>
                <p className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-store-green)' }}>
                  {pyqPapers.filter((p) => p.attemptSummary?.attemptsUsed > 0).length}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Bar Row */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 border-b border-line pb-4">
        {/* Navigation Tabs (Only in Mock Test section) */}
        {sectionDropdown === 'mock_test' ? (
          <div className="student-filter-strip mb-0 pb-0">
            <button
              onClick={() => setActiveTab('all')}
              className={`student-filter-btn ${activeTab === 'all' ? 'active' : ''}`}
            >
              <span>All Active ({activeTabCounts.all})</span>
            </button>

            {activeTabCounts.assigned > 0 && (
              <button
                onClick={() => setActiveTab('assigned')}
                className={`student-filter-btn ${activeTab === 'assigned' ? 'active' : ''}`}
              >
                <span>Course Tests ({activeTabCounts.assigned})</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('in_progress')}
              className={`student-filter-btn ${activeTab === 'in_progress' ? 'active' : ''}`}
            >
              <span>In Progress ({activeTabCounts.inProgress})</span>
            </button>

            <button
              onClick={() => setActiveTab('completed')}
              className={`student-filter-btn ${activeTab === 'completed' ? 'active' : ''}`}
            >
              <span>Completed ({activeTabCounts.completed})</span>
            </button>

            {activeTabCounts.upcoming > 0 && (
              <button
                onClick={() => setActiveTab('upcoming')}
                className={`student-filter-btn ${activeTab === 'upcoming' ? 'active' : ''}`}
              >
                <span>Upcoming ({activeTabCounts.upcoming})</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-field bg-sky-tint text-brand text-xs font-bold border border-blue-200">
              <IconPyq size={14} />
              <span>Purchased PYQ Past Papers ({filteredPyqPapers.length})</span>
            </span>
          </div>
        )}

        {/* Search Input & Subject Filter */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <IconSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted h-4 w-4" />
            <input
              type="text"
              placeholder={sectionDropdown === 'pyqs' ? 'Search papers, subjects, year...' : 'Search tests, subjects...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] rounded-field border border-line bg-white py-2 pl-9 pr-8 text-xs text-ink placeholder:text-ink-muted focus:border-store-blue focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary"
              >
                <IconXCircle size={14} />
              </button>
            )}
          </div>

          {availableSubjects.length > 0 && (
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="rounded-field border border-line bg-white py-2 px-3 min-h-[44px] text-xs font-medium text-ink focus:border-store-blue focus:outline-none"
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
            <div key={i} className="student-card animate-pulse space-y-4 h-64" />
          ))}
        </div>
      ) : error ? (
        <div className="student-card border-rose-200 bg-rose-50/50 p-8 text-center max-w-xl mx-auto my-8 space-y-4">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-rose-100 text-rose-600 mx-auto">
            <IconWarning size={24} />
          </div>
          <h2 className="text-base font-bold text-ink">Could Not Load Tests</h2>
          <p className="text-xs text-ink-secondary leading-relaxed">{error}</p>
          <button
            onClick={loadTests}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-field bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 transition-colors shadow-sm"
          >
            <IconRefresh size={14} />
            <span>Try Again</span>
          </button>
        </div>
      ) : sectionDropdown === 'pyqs' ? (
        /* ── PYQ Purchased Papers Section (Tabular View with Requested Columns) ── */
        filteredPyqPapers.length === 0 ? (
          <div className="student-card text-center p-8 sm:p-12 max-w-xl mx-auto my-8 space-y-4">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-field mx-auto bg-sky-tint text-brand">
              <IconPyq size={28} />
            </div>

            <h2 className="text-base sm:text-lg font-bold text-ink">
              {searchQuery || selectedSubject !== 'all'
                ? 'No matching purchased PYQ papers found'
                : 'No purchased PYQ past papers available'}
            </h2>

            <p className="text-xs text-ink-secondary leading-relaxed max-w-md mx-auto">
              {searchQuery || selectedSubject !== 'all'
                ? 'Try resetting your search query or subject filter.'
                : 'Explore our catalog of official Previous Year Question packages with timed practice mode and step-by-step solutions.'}
            </p>

            {searchQuery || selectedSubject !== 'all' ? (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedSubject('all');
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-field bg-ink text-white font-bold text-xs hover:bg-ink/90 transition-colors shadow-sm"
              >
                <span>Clear Filters</span>
              </button>
            ) : (
              <Link
                href="/pyq"
                className="inline-flex min-h-[44px] items-center gap-1.5 px-5 py-2.5 rounded-field bg-brand hover:bg-brand-hover text-white font-bold text-xs transition-colors shadow-sm"
              >
                <span>Browse PYQ Packages</span>
                <IconArrowRight size={14} />
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-paper/60 text-caption font-bold uppercase tracking-wider text-ink-secondary">
                  <th className="py-3.5 px-4 sm:px-6">Paper Name</th>
                  <th className="py-3.5 px-4">Subject</th>
                  <th className="py-3.5 px-4 text-center">Year</th>
                  <th className="py-3.5 px-4 text-center">Number of Attempts</th>
                  <th className="py-3.5 px-4 text-center">Marks Obtained</th>
                  <th className="py-3.5 px-4 sm:px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-xs font-medium text-ink">
                {filteredPyqPapers.map((test) => {
                  const attemptsUsed = test.attemptSummary?.attemptsUsed || 0;
                  const attemptLimit = test.attemptLimit;
                  const hasScore = test.latestResult?.totalScore != null;
                  const maxMarks = test.totalMarks ?? test.latestResult?.maxScore;

                  return (
                    <tr key={test.testId} className="hover:bg-paper/40 transition-colors">
                      {/* paper name */}
                      <td className="py-4 px-4 sm:px-6 font-bold text-ink">
                        <div className="flex items-start gap-2.5">
                          <IconPyq className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                          <div>
                            <p className="text-body font-bold text-ink line-clamp-1">{test.title}</p>
                            <p className="text-caption text-ink-secondary font-normal mt-0.5">
                              {test.durationMin ? `${test.durationMin} mins` : '180 mins'}
                              {test.questionCount > 0 ? ` · ${test.questionCount} Questions` : ''}
                              {test.courseTitle ? ` · ${test.courseTitle}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Subject */}
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-caption font-bold bg-sky-tint text-brand-hover border border-line">
                          {test.subjectName || 'All Subjects'}
                        </span>
                      </td>

                      {/* Year */}
                      <td className="py-4 px-4 text-center font-bold text-ink tabular-nums">
                        {test.year || '2024'}
                      </td>

                      {/* Number of Attempts */}
                      <td className="py-4 px-4 text-center">
                        <span className="font-extrabold text-ink tabular-nums">
                          {attemptsUsed}
                        </span>
                        <span className="text-ink-secondary text-caption font-normal">
                          {attemptLimit ? ` / ${attemptLimit}` : ' (Unlimited)'}
                        </span>
                      </td>

                      {/* Marks Obtained */}
                      <td className="py-4 px-4 text-center">
                        {hasScore ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="font-black text-emerald-700 text-sm tabular-nums">
                              {test.latestResult!.totalScore}
                              {maxMarks ? <span className="text-xs font-semibold text-emerald-600/80"> / {maxMarks}</span> : ''}
                            </span>
                            {test.latestResult?.percentage != null && (
                              <span className="text-[10px] font-bold text-emerald-600">
                                {test.latestResult.percentage}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-muted font-bold">—</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-4 px-4 sm:px-6 text-right">
                        <Link
                          href={test.attemptSummary?.actionHref || `/student/tests/${test.testId}`}
                          className={`inline-flex min-h-[38px] items-center justify-center px-4 py-1.5 rounded-field text-caption font-bold transition-all shadow-2xs ${
                            test.attemptSummary?.attemptState === 'submitted'
                              ? 'bg-paper hover:bg-sky-tint text-ink border border-line'
                              : 'bg-brand hover:bg-brand-hover text-white'
                          }`}
                        >
                          {test.attemptSummary?.actionLabel || 'Attempt Now'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* ── Mock Tests Section (Card Grid View) ── */
        <>
          {filteredMockTests.length === 0 ? (
            <div className="student-card text-center p-8 sm:p-12 max-w-xl mx-auto my-8 space-y-4">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-field mx-auto" style={{ background: 'var(--color-store-sky)', color: 'var(--color-store-blue)' }}>
                <IconTest size={28} />
              </div>

              <h2 className="text-base sm:text-lg font-bold text-ink">
                {searchQuery || selectedSubject !== 'all' || activeTab !== 'all'
                  ? 'No matching active tests found'
                  : 'No active mock tests available'}
              </h2>

              <p className="text-xs text-ink-secondary leading-relaxed max-w-md mx-auto">
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
                  className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-field bg-ink text-white font-bold text-xs hover:bg-ink transition-colors shadow-sm"
                >
                  <span>Clear All Filters</span>
                </button>
              ) : (
                <Link
                  href="/student/courses"
                  className="inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-field text-white font-bold text-xs hover:opacity-90 transition-colors shadow-sm"
                  style={{ backgroundColor: 'var(--color-store-blue)' }}
                >
                  <span>Explore My Courses</span>
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredMockTests.map((test) => (
                <StudentTestCard key={test.testId} test={test} />
              ))}
            </div>
          )}

          {/* Dedicated Expired Tests Section at bottom */}
          {!isLoading && !error && expiredMockTests.length > 0 && (
            <div className="mt-12 pt-8 border-t border-line">
              <div className="student-card p-6" style={{ background: 'var(--color-store-paper)' }}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-field bg-sky-tint text-ink">
                      <IconLock className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-ink">Expired Tests</h2>
                        <span className="rounded-full bg-sky-tint px-2.5 py-0.5 text-xs font-extrabold text-ink tabular-nums">
                          {expiredMockTests.length}
                        </span>
                      </div>
                      <p className="text-xs text-ink-secondary mt-0.5">
                        Past assessments whose attempt window has closed. You can view scorecards and solutions for previously submitted tests.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowExpired((prev) => !prev)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-field bg-white border border-line px-4 py-2.5 text-xs font-bold text-ink hover:bg-paper transition-all shadow-xs shrink-0"
                  >
                    <span>{showExpired ? 'Hide Expired Tests' : 'View Expired Tests'}</span>
                    {showExpired ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                  </button>
                </div>

                {/* Expired Tests Grid (Accordion) */}
                {showExpired && (
                  <div className="mt-6 pt-6 border-t border-line">
                    {filteredExpiredTests.length === 0 ? (
                      <p className="text-center text-xs text-ink-secondary py-4">
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
        </>
      )}
    </div>
  );
}

export default function StudentTestsHubPage() {
  return (
    <Suspense fallback={<div className="store-container py-12 text-center text-ink-muted">Loading tests...</div>}>
      <StudentTestsHubContent />
    </Suspense>
  );
}
