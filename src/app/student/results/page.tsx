'use client';

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
      if (selectedSubject !== 'all' && test.subjectName !== selectedSubject) {
        return false;
      }

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
    <div className="store-container space-y-7 pb-12">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">Student Hub</Link>
            <span aria-hidden="true">/</span>
            <span>Test Results</span>
          </nav>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              My Test Results
            </h1>
          </div>
          <p className="student-hero-lead">
            Review your evaluated scorecards, section analytics, and step-by-step verified solutions.
          </p>
        </div>

        {/* Real Summary Metrics Bar */}
        {completedTests.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="student-card p-3 flex items-center gap-2 min-w-[100px]">
              <CheckCircle className="h-4 w-4" style={{ color: 'var(--color-store-green)' }} weight="bold" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Evaluated</p>
                <p className="text-sm font-extrabold text-slate-900 tabular-nums">{aggregateMetrics.totalTests}</p>
              </div>
            </div>

            <div className="student-card p-3 flex items-center gap-2 min-w-[100px]" style={{ background: 'var(--color-store-sky)' }}>
              <Sparkle className="h-4 w-4" style={{ color: 'var(--color-store-blue)' }} weight="bold" />
              <div>
                <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-store-blue-dark)' }}>Avg Score</p>
                <p className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-store-ink)' }}>{aggregateMetrics.avgPercentage}%</p>
              </div>
            </div>

            <div className="student-card p-3 flex items-center gap-2 min-w-[100px]" style={{ background: 'var(--color-store-lilac)' }}>
              <Target className="h-4 w-4" style={{ color: 'var(--color-store-violet)' }} weight="bold" />
              <div>
                <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-store-violet)' }}>Accuracy</p>
                <p className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-store-violet)' }}>{aggregateMetrics.avgAccuracy}%</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Bar Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <span className="student-pill student-pill-sky">
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
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-xs text-slate-800 placeholder-slate-400 focus:border-store-blue focus:outline-none transition-all"
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
              className="rounded-xl border border-slate-200 bg-white py-2 px-3 text-xs font-medium text-slate-700 focus:border-store-blue focus:outline-none"
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
              className="student-card animate-pulse space-y-4 h-64"
            />
          ))}
        </div>
      ) : error ? (
        <div className="student-card border-rose-200 bg-rose-50/50 p-8 text-center max-w-xl mx-auto my-8 space-y-4">
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
        <div className="student-card text-center p-8 sm:p-12 max-w-xl mx-auto my-8 space-y-4">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl mx-auto" style={{ background: 'var(--color-store-lilac)', color: 'var(--color-store-violet)' }}>
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
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white font-bold text-xs hover:opacity-90 transition-colors shadow-sm"
              style={{ backgroundColor: 'var(--color-store-blue)' }}
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
                className="student-card group flex flex-col justify-between hover:-translate-y-0.5 transition-all duration-200"
              >
                <div>
                  {/* Top Badges Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="student-pill student-pill-sky">
                        <Exam className="h-3.5 w-3.5" />
                        {formatTestType(test.testType)}
                      </span>
                      {test.subjectName && (
                        <span className="student-pill student-pill-mint">
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
                      className="text-base sm:text-lg font-bold text-slate-900 line-clamp-1 group-hover:text-store-blue transition-colors"
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
                  <div className="mt-4 rounded-xl border border-emerald-100 p-3.5" style={{ background: 'linear-gradient(135deg, var(--color-store-mint) 0%, var(--color-store-white) 80%)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-store-green)' }}>
                          Total Score
                        </p>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span className="text-xl font-extrabold tabular-nums" style={{ color: 'var(--color-store-green)' }}>
                            {res.totalScore}
                          </span>
                          <span className="text-xs font-medium text-slate-500">
                            / {res.maxScore} marks
                          </span>
                          <span className="student-pill student-pill-mint ml-2">
                            {res.percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-slate-700 block tabular-nums">
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
                    <div className="rounded-xl p-2" style={{ background: 'var(--color-store-mint)' }}>
                      <p className="text-[10px] font-bold" style={{ color: 'var(--color-store-green)' }}>Correct</p>
                      <p className="text-xs font-extrabold mt-0.5 tabular-nums" style={{ color: 'var(--color-store-green)' }}>+{res.correctCount}</p>
                    </div>

                    <div className="rounded-xl bg-rose-50 border border-rose-100 p-2">
                      <p className="text-[10px] font-bold text-rose-700">Incorrect</p>
                      <p className="text-xs font-extrabold text-rose-900 mt-0.5 tabular-nums">-{res.wrongCount}</p>
                    </div>

                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-2">
                      <p className="text-[10px] font-bold text-slate-500">Skipped</p>
                      <p className="text-xs font-extrabold text-slate-700 mt-0.5 tabular-nums">{res.skippedCount}</p>
                    </div>
                  </div>
                </div>

                {/* Bottom CTA Row */}
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <Link
                    href={resultUrl}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl text-white px-4 py-2.5 text-xs font-bold shadow-xs hover:opacity-95 transition-all"
                    style={{ backgroundColor: 'var(--color-store-blue)' }}
                  >
                    <CheckCircle className="h-3.5 w-3.5" weight="bold" />
                    <span>View Scorecard</span>
                  </Link>

                  <Link
                    href={reviewUrl}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <BookOpen className="h-3.5 w-3.5" style={{ color: 'var(--color-store-blue)' }} weight="bold" />
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
