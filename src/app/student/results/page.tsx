'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Trophy,
  MagnifyingGlass,
  CheckCircle,
  Clock,
  XCircle,
  BookOpen,
  ArrowRight,
  Exam,
  ChartBar,
} from '@phosphor-icons/react';
import {
  fetchStudentAssignedMockTests,
  type StudentMockTestCardItem,
} from '@/services/student/studentTestWebService';
import { formatDate, formatPercent } from '@/lib/format';
import { getRubricLevel } from '@/lib/rubric';
import { Button, ButtonLink, EmptyState, ErrorState, Skeleton } from '@/components/ui/mmt';

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
    <div className="store-container space-y-6 pb-12">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <nav className="store-breadcrumb" aria-label="Breadcrumb">
            <Link href="/student/overview">My Learning</Link>
            <span aria-hidden="true">/</span>
            <span>Test Results</span>
          </nav>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
              My Test Results
            </h1>
          </div>
          <p className="student-hero-lead">
            Review your evaluated scorecards, section analytics, and step-by-step verified solutions.
          </p>
        </div>

        {/* Cross-Link CTA to Full Performance Analytics */}
        <Link
          href="/student/analytics"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-field bg-sky-tint hover:bg-sky-tint/80 border border-line text-brand-hover font-bold text-xs transition-colors self-start md:self-auto shrink-0 shadow-2xs min-h-[44px]"
        >
          <ChartBar size={16} weight="duotone" className="text-brand" />
          <span>View Performance Analytics</span>
          <ArrowRight size={14} weight="bold" />
        </Link>
      </div>

      {/* Filter & Search Bar Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-2 text-xs font-bold text-ink">
          <span className="student-pill student-pill-sky">
            {filteredResults.length} {filteredResults.length === 1 ? 'Result' : 'Results'}
          </span>
          <span className="text-ink-muted font-normal">Available for review</span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <MagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted h-4 w-4" />
            <input
              type="text"
              placeholder="Search by test title or subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-field border border-line bg-surface py-2.5 pl-9 pr-8 text-xs text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none transition-all min-h-[44px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink min-h-[44px] min-w-[32px] flex items-center justify-center"
                aria-label="Clear search"
              >
                <XCircle size={14} weight="fill" />
              </button>
            )}
          </div>

          {availableSubjects.length > 0 && (
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="rounded-field border border-line bg-surface py-2.5 px-3 text-xs font-medium text-ink focus:border-brand focus:outline-none min-h-[44px]"
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
            <Skeleton key={i} className="h-64 rounded-card" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Could Not Load Test Results"
          detail={error}
          onRetry={loadResults}
        />
      ) : filteredResults.length === 0 ? (
        searchQuery || selectedSubject !== 'all' ? (
          <EmptyState
            title="No matching test results found"
            detail="Try resetting your search query or subject filter to view more test scorecards."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedSubject('all');
                }}
              >
                Clear Search Filter
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Trophy}
            title="No test results available yet"
            detail="Complete your assigned mock tests to view your performance scorecards, accuracy breakdown, and step-by-step verified solutions."
            action={
              <ButtonLink href="/student/tests" size="sm">
                Browse Assigned Mock Tests
              </ButtonLink>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredResults.map((test) => {
            const res = test.latestResult!;
            const attemptId = res.attemptId || test.attemptSummary.latestAttemptId;
            const resultUrl = `/student/tests/${test.testId}/results/${attemptId}`;
            const reviewUrl = `/student/tests/${test.testId}/results/${attemptId}/review`;
            const rubric = getRubricLevel(res.percentage);

            return (
              <div
                key={test.testId}
                className="bg-surface border border-line rounded-card p-5 shadow-card hover:border-brand/40 transition-colors flex flex-col justify-between gap-4"
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
                      <span className="inline-flex items-center gap-1 text-caption font-semibold text-ink-muted">
                        <Clock size={12} />
                        <span>{formatDate(res.submittedAt)}</span>
                      </span>
                    )}
                  </div>

                  {/* Test Title & Course Details */}
                  <div className="mt-3.5">
                    <Link
                      href={resultUrl}
                      className="text-base sm:text-lg font-bold text-ink line-clamp-1 hover:text-brand transition-colors"
                    >
                      {test.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                      {test.courseTitle && <span className="font-medium text-ink-secondary">{test.courseTitle}</span>}
                      {test.courseTitle && test.batchName && <span className="text-ink-muted">•</span>}
                      {test.batchName && <span>{test.batchName}</span>}
                    </div>
                  </div>

                  {/* Performance Result Scorecard Box */}
                  <div
                    className={`mt-4 rounded-field border p-3.5 ${
                      rubric
                        ? `${rubric.colorClass.bg} ${rubric.colorClass.border}`
                        : 'bg-mint-tint border-emerald-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p
                          className={`text-caption font-bold uppercase tracking-wider ${
                            rubric ? rubric.colorClass.text : 'text-mint-ink'
                          }`}
                        >
                          Total Score
                        </p>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span
                            className={`text-xl font-extrabold tabular-nums ${
                              rubric ? rubric.colorClass.text : 'text-mint-ink'
                            }`}
                          >
                            {res.totalScore}
                          </span>
                          <span className="text-caption font-medium text-ink-secondary">
                            / {res.maxScore} marks
                          </span>
                          <span
                            className={`text-caption font-bold px-2 py-0.5 rounded-full border ml-1.5 ${
                              rubric ? rubric.colorClass.pill : 'bg-mint-tint text-mint-ink border-emerald-200'
                            }`}
                          >
                            {formatPercent(res.percentage, { forceZero: true })}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-ink block tabular-nums">
                          {formatPercent(res.accuracy, { forceZero: true })} Accuracy
                        </span>
                        <p className="text-caption text-ink-muted mt-0.5">
                          {res.correctCount} Correct • {res.wrongCount} Wrong
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 3-Column Question Breakdown Grid */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-field bg-mint-tint/60 border border-emerald-100 p-2">
                      <p className="text-caption font-bold text-mint-ink">Correct</p>
                      <p className="text-xs font-extrabold mt-0.5 tabular-nums text-mint-ink">+{res.correctCount}</p>
                    </div>

                    <div className="rounded-field bg-amber-50/70 border border-amber-200/80 p-2">
                      <p className="text-caption font-bold text-amber-800">Incorrect</p>
                      <p className="text-xs font-extrabold text-amber-900 mt-0.5 tabular-nums">-{res.wrongCount}</p>
                    </div>

                    <div className="rounded-field bg-paper border border-line p-2">
                      <p className="text-caption font-bold text-ink-secondary">Skipped</p>
                      <p className="text-xs font-extrabold text-ink mt-0.5 tabular-nums">{res.skippedCount}</p>
                    </div>
                  </div>
                </div>

                {/* Bottom CTA Row */}
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3.5">
                  <Link
                    href={resultUrl}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-field bg-brand hover:bg-brand-hover text-white px-4 py-2.5 text-xs font-bold shadow-2xs transition-colors min-h-[44px]"
                  >
                    <CheckCircle className="h-3.5 w-3.5" weight="bold" />
                    <span>View results</span>
                  </Link>

                  <Link
                    href={reviewUrl}
                    className="inline-flex items-center justify-center gap-1.5 rounded-field border border-line bg-surface hover:bg-paper px-3.5 py-2.5 text-xs font-bold text-ink transition-colors min-h-[44px]"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-brand" weight="bold" />
                    <span>Solutions</span>
                    <ArrowRight className="h-3 w-3 text-ink-muted" />
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
