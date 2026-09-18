'use client';

/**
 * Student "My Test Results" Dedicated Hub Page
 *
 * Route: /student/results
 *
 * Reuses authoritative assessment services and results from `mock_results`:
 *   - Direct listing of all submitted and evaluated mock test results
 *   - Overall performance summary bar (Tests Evaluated, Avg Score, Avg Accuracy)
 *   - Search and subject filter controls
 *   - One-click navigation to full scorecard (/student/tests/[testId]/results/[attemptId])
 *     and question-by-question review (/student/tests/[testId]/results/[attemptId]/review)
 *
 * @module app/student/results/page
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Trophy,
  MagnifyingGlass,
  ArrowClockwise,
  Sparkle,
  CheckCircle,
  Clock,
  WarningCircle,
  ArrowLeft,
  XCircle,
  BookOpen,
  ArrowRight,
  Target,
  Exam,
} from '@phosphor-icons/react';
import {
  fetchStudentAssignedMockTests,
  type StudentMockTestCardItem,
} from '@/services/student/studentTestWebService';

export default function StudentMyTestResultsPage() {
  const [allTests, setAllTests] = useState<StudentMockTestCardItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');

  const loadResults = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchStudentAssignedMockTests();
      if (data.error) {
        setError(data.error);
      } else {
        setAllTests(data.tests);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load test results');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Filter only completed & submitted tests with results
  const completedTests = useMemo(() => {
    return allTests.filter((test) => {
      const isSubmitted = test.attemptSummary.attemptState === 'submitted';
      const hasResult = Boolean(test.latestResult);
      return isSubmitted && hasResult;
    });
  }, [allTests]);

  // Unique Subjects for filter dropdown
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    completedTests.forEach((t) => {
      if (t.subjectName) subjects.add(t.subjectName);
    });
    return Array.from(subjects).sort();
  }, [completedTests]);

  // Filtered & Searched Results
  const filteredResults = useMemo(() => {
    return completedTests.filter((test) => {
      // 1. Subject Filter
      if (selectedSubject !== 'all' && test.subjectName !== selectedSubject) {
        return false;
      }

      // 2. Search Query
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
  }, [completedTests, selectedSubject, searchQuery]);

  // Performance Aggregate Metrics
  const aggregateMetrics = useMemo(() => {
    if (completedTests.length === 0) {
      return { totalTests: 0, avgPercentage: 0, avgAccuracy: 0, totalScoreEarned: 0 };
    }

    let totalPct = 0;
    let totalAcc = 0;
    let totalScore = 0;

    completedTests.forEach((t) => {
      if (t.latestResult) {
        totalPct += t.latestResult.percentage || 0;
        totalAcc += t.latestResult.accuracy || 0;
        totalScore += t.latestResult.totalScore || 0;
      }
    });

    return {
      totalTests: completedTests.length,
      avgPercentage: Math.round(totalPct / completedTests.length),
      avgAccuracy: Math.round(totalAcc / completedTests.length),
      totalScoreEarned: Math.round(totalScore),
    };
  }, [completedTests]);

  // Helper: Format Date
  const formatResultDate = (isoStr?: string | null) => {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('en-IN', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return null;
    }
  };

  // Helper: Format Test Type Label
  const formatTestType = (type: string) => {
    switch (type.toLowerCase()) {
      case 'chapter_test':
        return 'Chapter Assessment';
      case 'mock_test':
        return 'Full Mock Exam';
      case 'pyq_paper':
      case 'pyq':
        return 'PYQ Exam Paper';
      case 'subject_test':
        return 'Subject Assessment';
      default:
        return 'Practice Assessment';
    }
  };

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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm">
              <Trophy className="h-5 w-5" weight="bold" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                My Test Results
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Review your evaluated scorecards, section analytics, and step-by-step verified solutions
              </p>
            </div>
          </div>
        </div>

        {/* Real Summary Metrics Bar */}
        {completedTests.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-xs">
              <CheckCircle className="h-4 w-4 text-emerald-600" weight="bold" />
              <div>
                <p className="text-[10px] font-medium text-slate-400">Evaluated Tests</p>
                <p className="text-sm font-extrabold text-slate-900">{aggregateMetrics.totalTests}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2 shadow-xs">
              <Sparkle className="h-4 w-4 text-sky-600" weight="bold" />
              <div>
                <p className="text-[10px] font-medium text-sky-700">Average Score</p>
                <p className="text-sm font-extrabold text-sky-950">{aggregateMetrics.avgPercentage}%</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2 shadow-xs">
              <Target className="h-4 w-4 text-indigo-600" weight="bold" />
              <div>
                <p className="text-[10px] font-medium text-indigo-700">Average Accuracy</p>
                <p className="text-sm font-extrabold text-indigo-950">{aggregateMetrics.avgAccuracy}%</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Bar Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <span className="rounded-lg bg-slate-900 text-white px-2.5 py-1 text-xs">
            {filteredResults.length} {filteredResults.length === 1 ? 'Result' : 'Results'}
          </span>
          <span className="text-slate-400 font-normal">Available for review</span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <MagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search by test title or subject..."
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
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs animate-pulse space-y-4"
            >
              <div className="flex justify-between">
                <div className="h-5 w-28 bg-slate-200 rounded-full" />
                <div className="h-5 w-20 bg-slate-200 rounded-full" />
              </div>
              <div className="h-6 w-3/4 bg-slate-200 rounded-lg mt-2" />
              <div className="h-4 w-1/2 bg-slate-100 rounded-md" />
              <div className="h-24 bg-slate-100 rounded-xl mt-4" />
              <div className="h-10 bg-slate-200 rounded-xl mt-4" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 sm:p-12 rounded-3xl bg-rose-50/50 border border-rose-200 text-center max-w-xl mx-auto my-8 space-y-4">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-rose-100 text-rose-600 mx-auto">
            <WarningCircle size={24} weight="bold" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Could Not Load Test Results</h2>
          <p className="text-xs text-slate-500 leading-relaxed">{error}</p>
          <button
            onClick={loadResults}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 transition-colors shadow-sm"
          >
            <ArrowClockwise size={14} weight="bold" />
            <span>Try Again</span>
          </button>
        </div>
      ) : filteredResults.length === 0 ? (
        <div className="p-8 sm:p-12 rounded-3xl bg-white border border-slate-200 shadow-xs text-center max-w-xl mx-auto my-8 space-y-4">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto">
            <Trophy size={28} weight="duotone" />
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            {searchQuery || selectedSubject !== 'all'
              ? 'No matching results found'
              : 'No test results available yet'}
          </h2>

          <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
            {searchQuery || selectedSubject !== 'all'
              ? 'Try resetting your search query or subject filter to view more test scorecards.'
              : 'Complete your assigned mock tests to view your performance scorecards, accuracy breakdown, and step-by-step verified solutions.'}
          </p>

          {searchQuery || selectedSubject !== 'all' ? (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedSubject('all');
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors shadow-sm"
            >
              <span>Clear Search Filter</span>
            </button>
          ) : (
            <Link
              href="/student/tests"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <Exam size={16} weight="bold" />
              <span>Browse Assigned Mock Tests</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredResults.map((test) => {
            const res = test.latestResult!;
            const attemptId = res.attemptId || test.attemptSummary.latestAttemptId;
            const resultUrl = `/student/tests/${test.testId}/results/${attemptId}`;
            const reviewUrl = `/student/tests/${test.testId}/results/${attemptId}/review`;

            return (
              <div
                key={test.testId}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
              >
                <div>
                  {/* Top Badges Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                        <Exam className="h-3.5 w-3.5 text-indigo-600" />
                        {formatTestType(test.testType)}
                      </span>
                      {test.subjectName && (
                        <span className="inline-flex items-center rounded-lg bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 border border-sky-100">
                          {test.subjectName}
                        </span>
                      )}
                    </div>

                    {res.submittedAt && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                        <Clock size={12} />
                        <span>{formatResultDate(res.submittedAt)}</span>
                      </span>
                    )}
                  </div>

                  {/* Test Title & Course Details */}
                  <div className="mt-3.5">
                    <Link
                      href={resultUrl}
                      className="text-base sm:text-lg font-bold text-slate-900 line-clamp-1 group-hover:text-indigo-600 transition-colors"
                    >
                      {test.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {test.courseTitle && <span className="font-medium text-slate-600">{test.courseTitle}</span>}
                      {test.courseTitle && test.batchName && <span className="text-slate-300">•</span>}
                      {test.batchName && <span>{test.batchName}</span>}
                    </div>
                  </div>

                  {/* Performance Result Scorecard Box */}
                  <div className="mt-4 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/60 to-white p-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                          Total Score
                        </p>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span className="text-xl font-extrabold text-emerald-950">
                            {res.totalScore}
                          </span>
                          <span className="text-xs font-medium text-slate-500">
                            / {res.maxScore} marks
                          </span>
                          <span className="ml-2 inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                            {res.percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-slate-700 block">
                          {res.accuracy}% Accuracy
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {res.correctCount} Correct • {res.wrongCount} Wrong
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 3-Column Question Breakdown Grid */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 p-2">
                      <p className="text-[10px] font-bold text-emerald-700">Correct</p>
                      <p className="text-xs font-extrabold text-emerald-900 mt-0.5">+{res.correctCount}</p>
                    </div>

                    <div className="rounded-xl bg-rose-50/60 border border-rose-100 p-2">
                      <p className="text-[10px] font-bold text-rose-700">Incorrect</p>
                      <p className="text-xs font-extrabold text-rose-900 mt-0.5">-{res.wrongCount}</p>
                    </div>

                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-2">
                      <p className="text-[10px] font-bold text-slate-500">Skipped</p>
                      <p className="text-xs font-extrabold text-slate-700 mt-0.5">{res.skippedCount}</p>
                    </div>
                  </div>
                </div>

                {/* Bottom CTA Row */}
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <Link
                    href={resultUrl}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 active:scale-[0.98] transition-all"
                  >
                    <CheckCircle className="h-3.5 w-3.5" weight="bold" />
                    <span>View Scorecard</span>
                  </Link>

                  <Link
                    href={reviewUrl}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-indigo-600" weight="bold" />
                    <span>Solutions</span>
                    <ArrowRight className="h-3 w-3 text-slate-400" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
